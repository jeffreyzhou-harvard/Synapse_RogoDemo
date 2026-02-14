import os
import json
from typing import Dict, List, Optional, Tuple
from .github_service import GitHubService
import anthropic
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(dotenv_path=_ENV_PATH, override=True)

class AgentService:
    def __init__(self):
        self.github = GitHubService()
        self.anthropic_client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
        self.model = os.getenv('DEFAULT_MODEL', 'claude-3-5-sonnet-20241022')
    
    def _call_claude(self, prompt: str, system_prompt: str, max_tokens: int = 4000) -> str:
        """Helper to call Claude API"""
        try:
            response = self.anthropic_client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                temperature=0.3,
                system=system_prompt,
                messages=[{"role": "user", "content": prompt}]
            )
            return response.content[0].text
        except Exception as e:
            raise Exception(f"Claude API error: {str(e)}")
    
    def analyze_task_and_generate_code(self, task_description: str, selected_text: str, 
                                     document_context: str, repo_structure: List[Dict]) -> Dict:
        """Analyze the task and generate code changes"""
        
        # Get repository context
        repo_info = self.github.get_repository_info()
        
        system_prompt = """You are an expert software engineer and code generator. Your task is to analyze a development request and generate the necessary code changes to implement it.

CRITICAL: You must respond with ONLY a valid JSON object. Do not include any text before or after the JSON. Do not use markdown code blocks. Return raw JSON only.

The JSON must follow this exact format:

{
  "analysis": "Brief analysis of what needs to be implemented",
  "files_to_change": [
    {
      "path": "relative/path/to/file.ext",
      "action": "create",
      "content": "full file content after changes",
      "explanation": "explanation of changes made to this file"
    }
  ],
  "commit_message": "Clear, descriptive commit message",
  "pr_title": "Pull request title",
  "pr_description": "Detailed description of changes for PR"
}

Important guidelines:
- Only generate production-ready, well-tested code
- Follow existing code patterns and conventions in the repository
- Include proper error handling and documentation
- Make minimal, focused changes that address the specific task
- Ensure all imports and dependencies are properly handled
- Use "create" action for new files, "update" for existing files
- Escape all special characters properly in JSON strings"""

        prompt = f"""
Repository: {repo_info.get('name', 'Unknown')}
Description: {repo_info.get('description', 'No description')}
Language: {repo_info.get('language', 'Unknown')}

TASK DESCRIPTION:
{task_description}

SELECTED TEXT FROM DESIGN DOCUMENT:
{selected_text}

DOCUMENT CONTEXT:
{document_context}

REPOSITORY STRUCTURE:
{json.dumps(repo_structure, indent=2)}

Please analyze this task and generate the necessary code changes to implement what's described in the selected text.
"""

        response_text = self._call_claude(prompt, system_prompt, max_tokens=6000)
        
        try:
            # Clean the response text - remove any markdown code blocks or extra text
            cleaned_response = response_text.strip()
            if cleaned_response.startswith('```json'):
                cleaned_response = cleaned_response[7:]
            if cleaned_response.endswith('```'):
                cleaned_response = cleaned_response[:-3]
            cleaned_response = cleaned_response.strip()
            
            # Parse JSON response
            response_data = json.loads(cleaned_response)
            
            # Validate required fields
            required_fields = ['analysis', 'files_to_change', 'commit_message', 'pr_title', 'pr_description']
            for field in required_fields:
                if field not in response_data:
                    raise ValueError(f"Missing required field: {field}")
            
            return response_data
        except json.JSONDecodeError as e:
            # Provide better debugging information
            error_msg = f"Failed to parse Claude response as JSON: {str(e)}\n"
            error_msg += f"Raw response (first 500 chars): {response_text[:500]}"
            raise Exception(error_msg)
    
    def create_code_changes(self, task_description: str, selected_text: str, 
                          document_context: str) -> Dict:
        """Create code changes based on task description and return preview"""
        
        try:
            # Get repository structure for context
            repo_structure = self.github.get_repository_structure()
            
            # Generate code changes using Claude
            code_analysis = self.analyze_task_and_generate_code(
                task_description, selected_text, document_context, repo_structure
            )
            
            # Generate branch name
            branch_name = self.github.generate_branch_name(task_description)
            
            # Create branch
            branch_result = self.github.create_branch(branch_name)
            
            # Prepare file changes with current content for diff
            file_changes = []
            for file_change in code_analysis['files_to_change']:
                file_path = file_change['path']
                new_content = file_change['content']
                
                # Get current content if file exists
                current_content, current_sha = self.github.get_file_content(file_path)
                
                file_changes.append({
                    'path': file_path,
                    'action': file_change['action'],
                    'current_content': current_content,
                    'new_content': new_content,
                    'sha': current_sha,
                    'explanation': file_change['explanation']
                })
            
            return {
                'task_id': f"task-{branch_name}",
                'branch_name': branch_name,
                'analysis': code_analysis['analysis'],
                'commit_message': code_analysis['commit_message'],
                'pr_title': code_analysis['pr_title'],
                'pr_description': code_analysis['pr_description'],
                'file_changes': file_changes,
                'status': 'preview'  # Changes are ready for preview, not committed yet
            }
            
        except Exception as e:
            return {
                'error': str(e),
                'status': 'error'
            }
    
    def commit_and_push_changes(self, task_id: str, branch_name: str, 
                              file_changes: List[Dict], commit_message: str) -> Dict:
        """Commit and push the approved changes"""
        
        try:
            committed_files = []
            
            # Apply each file change
            for file_change in file_changes:
                result = self.github.update_file(
                    file_path=file_change['path'],
                    content=file_change['new_content'],
                    commit_message=commit_message,
                    branch=branch_name,
                    sha=file_change.get('sha')
                )
                
                committed_files.append({
                    'path': file_change['path'],
                    'action': file_change['action'],
                    'commit_sha': result['commit']['sha']
                })
            
            return {
                'task_id': task_id,
                'branch_name': branch_name,
                'committed_files': committed_files,
                'status': 'committed',
                'repository_url': f"https://github.com/{self.github.owner}/{self.github.repo}/tree/{branch_name}"
            }
            
        except Exception as e:
            return {
                'error': str(e),
                'status': 'error'
            }
    
    def create_pull_request(self, branch_name: str, pr_title: str, pr_description: str) -> Dict:
        """Create a pull request for the changes"""
        try:
            pr_result = self.github.create_pull_request(
                title=pr_title,
                body=pr_description,
                head_branch=branch_name
            )
            
            return {
                'pr_number': pr_result['number'],
                'pr_url': pr_result['html_url'],
                'status': 'pr_created'
            }
            
        except Exception as e:
            return {
                'error': str(e),
                'status': 'error'
            }
