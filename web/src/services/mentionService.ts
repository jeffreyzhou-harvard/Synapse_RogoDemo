export interface TaskMention {
  id: string;
  assignee: string;
  task: string;
  lineNumber: number;
  startIndex: number;
  endIndex: number;
  linearUrl: string;
}

export interface LinearConfig {
  teamId?: string;
  defaultPriority?: 'low' | 'medium' | 'high' | 'urgent';
  defaultLabels?: string[];
}

export class MentionService {
  private static instance: MentionService;
  private config: LinearConfig = {};

  static getInstance(): MentionService {
    if (!MentionService.instance) {
      MentionService.instance = new MentionService();
    }
    return MentionService.instance;
  }

  setConfig(config: LinearConfig) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Detect @username task mentions in document content
   * Pattern: @username followed by task description on the same line
   */
  detectMentions(content: string, documentTitle: string = ''): TaskMention[] {
    const mentions: TaskMention[] = [];
    const lines = content.split('\n');
    
    // Regex to match @username followed by task description
    // Captures: @username task description (rest of line after @username)
    const mentionRegex = /@([a-zA-Z0-9_-]+)\s+(.+)/g;
    
    lines.forEach((line, lineIndex) => {
      let match;
      while ((match = mentionRegex.exec(line)) !== null) {
        const assignee = match[1];
        const task = match[2].trim();
        
        if (task.length > 0) {
          const mention: TaskMention = {
            id: `mention-${lineIndex}-${match.index}`,
            assignee,
            task,
            lineNumber: lineIndex + 1,
            startIndex: match.index,
            endIndex: match.index + match[0].length,
            linearUrl: this.generateLinearUrl(assignee, task, documentTitle)
          };
          
          mentions.push(mention);
        }
      }
      
      // Reset regex lastIndex for next line
      mentionRegex.lastIndex = 0;
    });
    
    return mentions;
  }

  /**
   * Generate Linear pre-filled URL for task creation
   */
  private generateLinearUrl(assignee: string, task: string, documentTitle: string = ''): string {
    const baseUrl = this.config.teamId 
      ? `https://linear.app/team/${this.config.teamId}/new`
      : 'https://linear.new';
    
    const params = new URLSearchParams();
    
    // Set title - use task description
    params.set('title', task);
    
    // Set assignee
    params.set('assignee', assignee);
    
    // Set description with context
    let description = `Task delegated from: ${documentTitle || 'Design Document'}`;
    if (documentTitle) {
      description += `\n\nContext: This task was identified while working on ${documentTitle}`;
    }
    params.set('description', description);
    
    // Set default priority if configured
    if (this.config.defaultPriority) {
      params.set('priority', this.config.defaultPriority);
    }
    
    // Set default labels if configured
    if (this.config.defaultLabels && this.config.defaultLabels.length > 0) {
      params.set('labels', this.config.defaultLabels.join(','));
    }
    
    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Open Linear issue creation in new tab
   */
  createLinearIssue(mention: TaskMention): void {
    window.open(mention.linearUrl, '_blank', 'noopener,noreferrer');
  }

  /**
   * Get summary of detected mentions for display
   */
  getMentionsSummary(mentions: TaskMention[]): string {
    if (mentions.length === 0) {
      return 'No task assignments detected';
    }
    
    const assigneeCount = new Set(mentions.map(m => m.assignee)).size;
    return `${mentions.length} task${mentions.length > 1 ? 's' : ''} assigned to ${assigneeCount} person${assigneeCount > 1 ? 's' : ''}`;
  }

  /**
   * Group mentions by assignee for organized display
   */
  groupMentionsByAssignee(mentions: TaskMention[]): Record<string, TaskMention[]> {
    return mentions.reduce((groups, mention) => {
      if (!groups[mention.assignee]) {
        groups[mention.assignee] = [];
      }
      groups[mention.assignee].push(mention);
      return groups;
    }, {} as Record<string, TaskMention[]>);
  }
}

export default MentionService.getInstance();
