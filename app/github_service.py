import os
import base64
import json
from typing import Dict, List, Optional, Tuple
import requests
from datetime import datetime
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(dotenv_path=_ENV_PATH, override=True)

class GitHubService:
    def __init__(self):
        self.token = os.getenv('GITHUB_TOKEN')
        self.owner = os.getenv('GITHUB_OWNER')
        self.repo = os.getenv('GITHUB_REPO')
        self.default_branch = os.getenv('DEFAULT_BRANCH', 'main')
        self.base_url = 'https://api.github.com'
        
        if not all([self.token, self.owner, self.repo]):
            raise ValueError("GitHub configuration missing. Please set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO in .env")
    
    def _headers(self) -> Dict[str, str]:
        return {
            'Authorization': f'token {self.token}',
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        }
    
    def get_repository_info(self) -> Dict:
        """Get basic repository information"""
        url = f"{self.base_url}/repos/{self.owner}/{self.repo}"
        response = requests.get(url, headers=self._headers())
        response.raise_for_status()
        return response.json()
    
    def get_file_content(self, file_path: str, branch: str = None) -> Tuple[str, str]:
        """Get file content and SHA from repository"""
        branch = branch or self.default_branch
        url = f"{self.base_url}/repos/{self.owner}/{self.repo}/contents/{file_path}"
        params = {'ref': branch}
        
        response = requests.get(url, headers=self._headers(), params=params)
        if response.status_code == 404:
            return "", ""  # File doesn't exist
        
        response.raise_for_status()
        data = response.json()
        
        if data['type'] == 'file':
            content = base64.b64decode(data['content']).decode('utf-8')
            return content, data['sha']
        else:
            raise ValueError(f"Path {file_path} is not a file")
    
    def initialize_repository(self) -> Dict:
        """Initialize an empty repository with a README file"""
        try:
            # Check if repository has any commits by trying to get the default branch
            url = f"{self.base_url}/repos/{self.owner}/{self.repo}/branches/{self.default_branch}"
            response = requests.get(url, headers=self._headers())
            
            if response.status_code == 404:
                # Repository is empty, create initial commit
                readme_content = "# Demo Repository\n\nThis repository is used for AI agent code generation demonstrations."
                
                # Create the initial commit with README
                self.update_file(
                    file_path="README.md",
                    content=readme_content,
                    commit_message="Initial commit",
                    branch=self.default_branch
                )
                return {"status": "initialized", "message": "Repository initialized with README.md"}
            else:
                return {"status": "exists", "message": "Repository already has commits"}
                
        except Exception as e:
            raise ValueError(f"Failed to initialize repository: {str(e)}")

    def create_branch(self, branch_name: str, from_branch: str = None) -> Dict:
        """Create a new branch from the default branch"""
        from_branch = from_branch or self.default_branch
        
        # First ensure the repository is initialized
        self.initialize_repository()
        
        # Get the SHA of the source branch
        url = f"{self.base_url}/repos/{self.owner}/{self.repo}/git/refs/heads/{from_branch}"
        response = requests.get(url, headers=self._headers())
        response.raise_for_status()
        source_sha = response.json()['object']['sha']
        
        # Create new branch
        url = f"{self.base_url}/repos/{self.owner}/{self.repo}/git/refs"
        data = {
            'ref': f'refs/heads/{branch_name}',
            'sha': source_sha
        }
        
        response = requests.post(url, headers=self._headers(), json=data)
        if response.status_code == 422:  # Branch already exists
            return {'message': 'Branch already exists', 'exists': True}
        
        response.raise_for_status()
        return response.json()
    
    def update_file(self, file_path: str, content: str, commit_message: str, 
                   branch: str, sha: str = None) -> Dict:
        """Update or create a file in the repository"""
        url = f"{self.base_url}/repos/{self.owner}/{self.repo}/contents/{file_path}"
        
        # For empty repositories, we need to create the initial commit differently
        if branch == self.default_branch and sha is None:
            # Check if this is an empty repository by trying to get existing file
            try:
                existing_content, existing_sha = self.get_file_content(file_path, branch)
                if existing_sha:
                    sha = existing_sha
            except:
                # File doesn't exist or branch doesn't exist - this is fine for new files
                pass
        
        data = {
            'message': commit_message,
            'content': base64.b64encode(content.encode('utf-8')).decode('utf-8'),
            'branch': branch
        }
        
        if sha:  # File exists, need SHA for update
            data['sha'] = sha
        
        response = requests.put(url, headers=self._headers(), json=data)
        response.raise_for_status()
        return response.json()
    
    def get_branch_diff(self, base_branch: str, compare_branch: str) -> List[Dict]:
        """Get diff between two branches"""
        url = f"{self.base_url}/repos/{self.owner}/{self.repo}/compare/{base_branch}...{compare_branch}"
        response = requests.get(url, headers=self._headers())
        response.raise_for_status()
        
        data = response.json()
        return data.get('files', [])
    
    def create_pull_request(self, title: str, body: str, head_branch: str, 
                          base_branch: str = None) -> Dict:
        """Create a pull request"""
        base_branch = base_branch or self.default_branch
        url = f"{self.base_url}/repos/{self.owner}/{self.repo}/pulls"
        
        data = {
            'title': title,
            'body': body,
            'head': head_branch,
            'base': base_branch
        }
        
        response = requests.post(url, headers=self._headers(), json=data)
        response.raise_for_status()
        return response.json()
    
    def get_repository_structure(self, path: str = "", branch: str = None) -> List[Dict]:
        """Get repository file structure"""
        branch = branch or self.default_branch
        url = f"{self.base_url}/repos/{self.owner}/{self.repo}/contents/{path}"
        params = {'ref': branch}
        
        response = requests.get(url, headers=self._headers(), params=params)
        response.raise_for_status()
        return response.json()
    
    def generate_branch_name(self, task_description: str) -> str:
        """Generate a branch name from task description"""
        # Clean and format task description for branch name
        import re
        clean_desc = re.sub(r'[^a-zA-Z0-9\s-]', '', task_description.lower())
        clean_desc = re.sub(r'\s+', '-', clean_desc.strip())
        clean_desc = clean_desc[:50]  # Limit length
        
        timestamp = datetime.now().strftime("%m%d-%H%M")
        return f"midlayer-{clean_desc}-{timestamp}"
