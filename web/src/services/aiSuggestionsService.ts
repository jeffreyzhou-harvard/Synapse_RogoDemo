export interface AISuggestion {
  id: string;
  type: 'subtask' | 'architecture' | 'consideration' | 'resource';
  title: string;
  content: string;
  confidence: number;
  priority: 'high' | 'medium' | 'low';
  category: string;
  timestamp: string;
}

export interface DocumentAnalysis {
  keywords: string[];
  documentType: 'design' | 'technical' | 'requirements' | 'other';
  complexity: 'low' | 'medium' | 'high';
  sections: string[];
  missingElements: string[];
}

class AISuggestionsService {
  private analyzeDocument(title: string, content: string): DocumentAnalysis {
    const text = `${title} ${content}`.toLowerCase();
    
    // Detect document type
    const designKeywords = ['design', 'ui', 'ux', 'interface', 'wireframe', 'mockup', 'prototype', 'user experience'];
    const technicalKeywords = ['architecture', 'system', 'api', 'database', 'service', 'component', 'framework'];
    const requirementsKeywords = ['requirement', 'spec', 'feature', 'functionality', 'acceptance criteria'];
    
    let documentType: DocumentAnalysis['documentType'] = 'other';
    if (designKeywords.some(keyword => text.includes(keyword))) documentType = 'design';
    else if (technicalKeywords.some(keyword => text.includes(keyword))) documentType = 'technical';
    else if (requirementsKeywords.some(keyword => text.includes(keyword))) documentType = 'requirements';
    
    // Extract keywords
    const allKeywords = [...designKeywords, ...technicalKeywords, ...requirementsKeywords];
    const keywords = allKeywords.filter(keyword => text.includes(keyword));
    
    // Analyze complexity based on length and technical terms
    const wordCount = content.split(/\s+/).length;
    const complexityIndicators = ['integration', 'scalability', 'performance', 'security', 'microservice', 'distributed'];
    const complexityScore = complexityIndicators.filter(term => text.includes(term)).length;
    
    let complexity: DocumentAnalysis['complexity'] = 'low';
    if (wordCount > 500 || complexityScore > 2) complexity = 'high';
    else if (wordCount > 200 || complexityScore > 0) complexity = 'medium';
    
    // Identify sections
    const sections = this.extractSections(content);
    
    // Identify missing elements
    const missingElements = this.identifyMissingElements(text, documentType);
    
    return {
      keywords,
      documentType,
      complexity,
      sections,
      missingElements
    };
  }

  private extractSections(content: string): string[] {
    const sections: string[] = [];
    const lines = content.split('\n');
    
    lines.forEach(line => {
      const trimmed = line.trim();
      // Look for headers (lines that start with #, are ALL CAPS, or end with :)
      if (trimmed.match(/^#{1,6}\s+/) || 
          (trimmed.length > 0 && trimmed === trimmed.toUpperCase() && trimmed.length < 50) ||
          (trimmed.endsWith(':') && trimmed.length < 50 && !trimmed.includes('http'))) {
        sections.push(trimmed);
      }
    });
    
    return sections;
  }

  private identifyMissingElements(text: string, documentType: DocumentAnalysis['documentType']): string[] {
    const missing: string[] = [];
    
    const commonElements = {
      design: ['user personas', 'user stories', 'wireframes', 'visual hierarchy', 'accessibility considerations'],
      technical: ['system architecture', 'data flow', 'error handling', 'testing strategy', 'deployment plan'],
      requirements: ['acceptance criteria', 'edge cases', 'performance requirements', 'security requirements', 'dependencies']
    };
    
    if (documentType !== 'other') {
      const requiredElements = commonElements[documentType];
      requiredElements.forEach(element => {
        if (!text.includes(element.toLowerCase()) && !text.includes(element.replace(' ', '').toLowerCase())) {
          missing.push(element);
        }
      });
    }
    
    return missing;
  }

  private generateSubtaskSuggestions(analysis: DocumentAnalysis, content: string): AISuggestion[] {
    const suggestions: AISuggestion[] = [];
    const timestamp = new Date().toISOString();
    
    if (analysis.documentType === 'design') {
      if (content.toLowerCase().includes('user interface') || content.toLowerCase().includes('ui')) {
        suggestions.push({
          id: `subtask-${Date.now()}-1`,
          type: 'subtask',
          title: 'Create Wireframes',
          content: 'Develop low-fidelity wireframes to visualize the layout and structure before moving to high-fidelity designs.',
          confidence: 0.85,
          priority: 'high',
          category: 'Design',
          timestamp
        });
        
        suggestions.push({
          id: `subtask-${Date.now()}-2`,
          type: 'subtask',
          title: 'Conduct Usability Testing',
          content: 'Plan and execute usability testing sessions with target users to validate design decisions.',
          confidence: 0.75,
          priority: 'medium',
          category: 'Validation',
          timestamp
        });
      }
      
      if (content.toLowerCase().includes('mobile') || content.toLowerCase().includes('responsive')) {
        suggestions.push({
          id: `subtask-${Date.now()}-3`,
          type: 'subtask',
          title: 'Design Responsive Breakpoints',
          content: 'Define and design key breakpoints for mobile, tablet, and desktop views.',
          confidence: 0.90,
          priority: 'high',
          category: 'Responsive Design',
          timestamp
        });
      }
    }
    
    if (analysis.documentType === 'technical') {
      suggestions.push({
        id: `subtask-${Date.now()}-4`,
        type: 'subtask',
        title: 'Define API Contracts',
        content: 'Specify API endpoints, request/response schemas, and error handling patterns.',
        confidence: 0.80,
        priority: 'high',
        category: 'Architecture',
        timestamp
      });
      
      if (analysis.complexity === 'high') {
        suggestions.push({
          id: `subtask-${Date.now()}-5`,
          type: 'subtask',
          title: 'Plan Database Schema',
          content: 'Design database tables, relationships, and indexing strategy for optimal performance.',
          confidence: 0.85,
          priority: 'high',
          category: 'Data',
          timestamp
        });
      }
    }
    
    return suggestions;
  }

  private generateArchitectureSuggestions(analysis: DocumentAnalysis, content: string): AISuggestion[] {
    const suggestions: AISuggestion[] = [];
    const timestamp = new Date().toISOString();
    
    if (analysis.keywords.includes('api') || content.toLowerCase().includes('service')) {
      suggestions.push({
        id: `arch-${Date.now()}-1`,
        type: 'architecture',
        title: 'Consider Microservices Architecture',
        content: 'For scalable systems, consider breaking down into microservices with clear boundaries and communication patterns.',
        confidence: 0.70,
        priority: 'medium',
        category: 'System Design',
        timestamp
      });
    }
    
    if (content.toLowerCase().includes('user') && content.toLowerCase().includes('data')) {
      suggestions.push({
        id: `arch-${Date.now()}-2`,
        type: 'architecture',
        title: 'Implement CQRS Pattern',
        content: 'Consider Command Query Responsibility Segregation (CQRS) for systems with complex read/write operations.',
        confidence: 0.60,
        priority: 'low',
        category: 'Patterns',
        timestamp
      });
    }
    
    if (analysis.complexity === 'high' && content.toLowerCase().includes('scale')) {
      suggestions.push({
        id: `arch-${Date.now()}-3`,
        type: 'architecture',
        title: 'Plan for Horizontal Scaling',
        content: 'Design with horizontal scaling in mind: stateless services, load balancing, and distributed caching.',
        confidence: 0.85,
        priority: 'high',
        category: 'Scalability',
        timestamp
      });
    }
    
    return suggestions;
  }

  private generateConsiderationSuggestions(analysis: DocumentAnalysis): AISuggestion[] {
    const suggestions: AISuggestion[] = [];
    const timestamp = new Date().toISOString();
    
    analysis.missingElements.forEach((element, index) => {
      suggestions.push({
        id: `consideration-${Date.now()}-${index}`,
        type: 'consideration',
        title: `Consider Adding ${element}`,
        content: `Your document might benefit from including ${element.toLowerCase()}. This is commonly important for ${analysis.documentType} documents.`,
        confidence: 0.65,
        priority: 'medium',
        category: 'Completeness',
        timestamp
      });
    });
    
    // Security considerations
    if (analysis.documentType === 'technical' && !analysis.keywords.includes('security')) {
      suggestions.push({
        id: `consideration-${Date.now()}-security`,
        type: 'consideration',
        title: 'Security Considerations',
        content: 'Consider adding a section on security requirements, authentication, authorization, and data protection.',
        confidence: 0.80,
        priority: 'high',
        category: 'Security',
        timestamp
      });
    }
    
    return suggestions;
  }

  private generateResourceSuggestions(analysis: DocumentAnalysis, content: string): AISuggestion[] {
    const suggestions: AISuggestion[] = [];
    const timestamp = new Date().toISOString();
    
    if (analysis.documentType === 'design') {
      suggestions.push({
        id: `resource-${Date.now()}-1`,
        type: 'resource',
        title: 'Design System Resources',
        content: 'Consider referencing established design systems like Material Design, Human Interface Guidelines, or Ant Design for consistency.',
        confidence: 0.70,
        priority: 'medium',
        category: 'Reference',
        timestamp
      });
    }
    
    if (analysis.keywords.includes('api') || analysis.keywords.includes('service')) {
      suggestions.push({
        id: `resource-${Date.now()}-2`,
        type: 'resource',
        title: 'API Design Best Practices',
        content: 'Reference RESTful API design principles and consider OpenAPI specification for documentation.',
        confidence: 0.75,
        priority: 'medium',
        category: 'Standards',
        timestamp
      });
    }
    
    return suggestions;
  }

  public async generateSuggestions(title: string, content: string): Promise<AISuggestion[]> {
    if (!content.trim() && !title.trim()) {
      return [];
    }

    try {
      // Call the backend Gemini-powered design doc analysis endpoint
      const response = await fetch('http://localhost:8000/analyze-design-doc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: content,
          title: title,
          context: '' // Could be extended to include additional context
        })
      });

      if (!response.ok) {
        throw new Error(`Backend analysis failed: ${response.status}`);
      }

      const analysisResult = await response.json();
      
      // Convert backend response to frontend AISuggestion format
      const suggestions: AISuggestion[] = [];
      const timestamp = new Date().toISOString();
      
      // Convert architecture suggestions
      analysisResult.architecture_suggestions?.forEach((suggestion: string, index: number) => {
        suggestions.push({
          id: `arch-${Date.now()}-${index}`,
          type: 'architecture',
          title: 'Architecture Suggestion',
          content: suggestion,
          confidence: 0.85,
          priority: 'high',
          category: 'Architecture',
          timestamp
        });
      });
      
      // Convert subtasks
      analysisResult.subtasks?.forEach((subtask: any, index: number) => {
        suggestions.push({
          id: `subtask-${Date.now()}-${index}`,
          type: 'subtask',
          title: subtask.title || 'Implementation Task',
          content: `${subtask.description || ''}\n\nCategory: ${subtask.category || 'Development'}\nEstimated Effort: ${subtask.estimated_effort || 'TBD'}\nPriority: ${subtask.priority || 'P2'}`,
          confidence: 0.90,
          priority: subtask.priority === 'P1' ? 'high' : subtask.priority === 'P2' ? 'medium' : 'low',
          category: subtask.category || 'Development',
          timestamp
        });
      });
      
      // Convert technical gaps as considerations
      analysisResult.technical_gaps?.forEach((gap: string, index: number) => {
        suggestions.push({
          id: `gap-${Date.now()}-${index}`,
          type: 'consideration',
          title: 'Technical Gap Identified',
          content: gap,
          confidence: 0.80,
          priority: 'medium',
          category: 'Missing Requirements',
          timestamp
        });
      });
      
      // Convert implementation recommendations
      analysisResult.implementation_recommendations?.forEach((rec: string, index: number) => {
        suggestions.push({
          id: `rec-${Date.now()}-${index}`,
          type: 'resource',
          title: 'Implementation Recommendation',
          content: rec,
          confidence: 0.75,
          priority: 'medium',
          category: 'Best Practices',
          timestamp
        });
      });
      
      // Sort by priority and confidence
      return suggestions
        .sort((a, b) => {
          const priorityOrder = { high: 3, medium: 2, low: 1 };
          const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
          if (priorityDiff !== 0) return priorityDiff;
          return b.confidence - a.confidence;
        })
        .slice(0, 8); // Show more suggestions since they're Claude-powered
        
    } catch (error) {
      console.error('Failed to get Claude-powered suggestions, falling back to local analysis:', error);
      
      // Fallback to local analysis if backend is unavailable
      const analysis = this.analyzeDocument(title, content);
      
      const allSuggestions = [
        ...this.generateSubtaskSuggestions(analysis, content),
        ...this.generateArchitectureSuggestions(analysis, content),
        ...this.generateConsiderationSuggestions(analysis),
        ...this.generateResourceSuggestions(analysis, content)
      ];
      
      return allSuggestions
        .sort((a, b) => {
          const priorityOrder = { high: 3, medium: 2, low: 1 };
          const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
          if (priorityDiff !== 0) return priorityDiff;
          return b.confidence - a.confidence;
        })
        .slice(0, 6);
    }
  }

  public async getSuggestionsForSection(sectionText: string, documentType: DocumentAnalysis['documentType']): Promise<AISuggestion[]> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const suggestions: AISuggestion[] = [];
    const timestamp = new Date().toISOString();
    
    if (sectionText.toLowerCase().includes('problem') || sectionText.toLowerCase().includes('challenge')) {
      suggestions.push({
        id: `section-${Date.now()}-1`,
        type: 'subtask',
        title: 'Define Success Metrics',
        content: 'Establish clear, measurable criteria for evaluating the success of your solution.',
        confidence: 0.85,
        priority: 'high',
        category: 'Planning',
        timestamp
      });
    }
    
    return suggestions.slice(0, 3);
  }
}

export default new AISuggestionsService();