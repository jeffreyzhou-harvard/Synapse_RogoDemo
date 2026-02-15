export interface AgentDelegationRequest {
  task_description: string;
  selected_text: string;
  document_context: string;
}

export interface FileChange {
  path: string;
  action: 'create' | 'update' | 'delete';
  current_content: string;
  new_content: string;
  sha: string;
  explanation: string;
}

export interface AgentDelegationResponse {
  task_id: string;
  branch_name: string;
  analysis: string;
  commit_message: string;
  pr_title: string;
  pr_description: string;
  file_changes: FileChange[];
  status: string;
  error?: string;
}

export interface CommitChangesRequest {
  task_id: string;
  branch_name: string;
  file_changes: FileChange[];
  commit_message: string;
}

export interface CommitChangesResponse {
  task_id: string;
  branch_name: string;
  committed_files: Array<{
    path: string;
    action: string;
    commit_sha: string;
  }>;
  status: string;
  repository_url: string;
  error?: string;
}

export interface CreatePRRequest {
  branch_name: string;
  pr_title: string;
  pr_description: string;
}

export interface CreatePRResponse {
  pr_number: number;
  pr_url: string;
  status: string;
  error?: string;
}

class AgentService {
  private baseUrl = '';

  async delegateToAgent(request: AgentDelegationRequest): Promise<AgentDelegationResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/delegate-to-agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error delegating to agent:', error);
      throw error;
    }
  }

  async commitChanges(request: CommitChangesRequest): Promise<CommitChangesResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/commit-changes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error committing changes:', error);
      throw error;
    }
  }

  async createPullRequest(request: CreatePRRequest): Promise<CreatePRResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/create-pr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating pull request:', error);
      throw error;
    }
  }

  // Utility method to generate diff display for UI
  generateDiffDisplay(fileChange: FileChange): string {
    const currentLines = fileChange.current_content.split('\n');
    const newLines = fileChange.new_content.split('\n');
    
    // Simple diff algorithm - in production you'd use a proper diff library
    let diff = '';
    const maxLines = Math.max(currentLines.length, newLines.length);
    
    for (let i = 0; i < maxLines; i++) {
      const currentLine = currentLines[i] || '';
      const newLine = newLines[i] || '';
      
      if (currentLine !== newLine) {
        if (currentLine && !newLine) {
          diff += `- ${currentLine}\n`;
        } else if (!currentLine && newLine) {
          diff += `+ ${newLine}\n`;
        } else if (currentLine !== newLine) {
          diff += `- ${currentLine}\n`;
          diff += `+ ${newLine}\n`;
        }
      } else if (currentLine) {
        diff += `  ${currentLine}\n`;
      }
    }
    
    return diff;
  }

  // Utility to format file changes for display
  formatFileChangesForDisplay(fileChanges: FileChange[]): Array<{
    path: string;
    action: string;
    explanation: string;
    diff: string;
    linesAdded: number;
    linesRemoved: number;
  }> {
    return fileChanges.map(change => {
      const diff = this.generateDiffDisplay(change);
      const linesAdded = (diff.match(/^\+/gm) || []).length;
      const linesRemoved = (diff.match(/^-/gm) || []).length;
      
      return {
        path: change.path,
        action: change.action,
        explanation: change.explanation,
        diff,
        linesAdded,
        linesRemoved
      };
    });
  }
}

export default new AgentService();
