import React, { useState, useRef, useEffect } from 'react';
import Icon from './Icon';
import aiSuggestionsService, { AISuggestion } from '../services/aiSuggestionsService';

interface Comment {
  id: string;
  author: string;
  avatar?: string;
  text: string;
  time: string;
  isUnread?: boolean;
}

interface Activity {
  id: string;
  type: 'edit' | 'comment' | 'share' | 'mention';
  text: string;
  time: string;
  icon: string;
}

interface CommentsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  comments?: Comment[];
  activities?: Activity[];
  documentTitle?: string;
  documentContent?: string;
  onDocumentUpdate?: (newContent: string, explanation: string) => void;
}

const CommentsSidebar: React.FC<CommentsSidebarProps> = ({
  isOpen,
  onClose,
  comments = [],
  activities = [],
  documentTitle = '',
  documentContent = '',
  onDocumentUpdate
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [activeTab, setActiveTab] = useState<'suggestions' | 'comments' | 'tasks'>('suggestions');
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [lastAnalyzedContent, setLastAnalyzedContent] = useState<string>('');
  const [showNewContentIndicator, setShowNewContentIndicator] = useState(false);
  const [acceptingSuggestions, setAcceptingSuggestions] = useState<Set<string>>(new Set());
  const [taskMentions, setTaskMentions] = useState<any[]>([]);
  const [isLoadingMentions, setIsLoadingMentions] = useState(false);
  const [mentionsSummary, setMentionsSummary] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (inputValue.trim()) {
      // TODO: Add comment logic here
      console.log('Sending comment:', inputValue);
      setInputValue('');
    }
  };

  const handleDismissSuggestion = (suggestionId: string) => {
    setDismissedSuggestions(prev => new Set([...prev, suggestionId]));
  };

  const handleAcceptSuggestion = async (suggestion: AISuggestion) => {
    if (!onDocumentUpdate) {
      console.warn('onDocumentUpdate callback not provided');
      return;
    }

    // Add suggestion to accepting state
    setAcceptingSuggestions(prev => new Set([...prev, suggestion.id]));

    try {
      // Call the backend to improve the document with the accepted suggestion
      const response = await fetch('http://localhost:8000/accept-suggestion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          current_content: documentContent,
          title: documentTitle,
          accepted_suggestion: {
            title: suggestion.title,
            content: suggestion.content,
            type: suggestion.type,
            category: suggestion.category
          },
          suggestion_type: suggestion.type
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to accept suggestion: ${response.status}`);
      }

      const result = await response.json();
      
      // Update the document content through the callback
      onDocumentUpdate(result.improved_content, result.explanation);
      
      // Dismiss the suggestion since it's been accepted
      handleDismissSuggestion(suggestion.id);
      
      console.log('Document improved:', result.explanation);
      console.log('Changes made:', result.changes_made);
      
    } catch (error) {
      console.error('Failed to accept suggestion:', error);
      // Still dismiss the suggestion even if the backend call fails
      handleDismissSuggestion(suggestion.id);
    } finally {
      // Remove suggestion from accepting state
      setAcceptingSuggestions(prev => {
        const newSet = new Set(prev);
        newSet.delete(suggestion.id);
        return newSet;
      });
    }
  };

  const detectTaskMentions = async () => {
    console.log('detectTaskMentions called with content:', documentContent);
    
    if (!documentContent.trim()) {
      setTaskMentions([]);
      setMentionsSummary('');
      console.log('No content, clearing mentions');
      return;
    }

    console.log('Starting mention detection...');
    setIsLoadingMentions(true);
    try {
      const response = await fetch('http://localhost:8080/detect-mentions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: documentContent,
          title: documentTitle,
          team_id: '', // Can be configured later
          default_priority: 'medium',
          default_labels: ['documentation', 'task-delegation']
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to detect mentions: ${response.status}`);
      }

      const result = await response.json();
      setTaskMentions(result.mentions || []);
      setMentionsSummary(result.summary || '');
      
    } catch (error) {
      console.error('Failed to detect mentions:', error);
      setTaskMentions([]);
      setMentionsSummary('Failed to detect task mentions');
    } finally {
      setIsLoadingMentions(false);
    }
  };

  const refreshSuggestions = async () => {
    const currentContent = `${documentTitle} ${documentContent}`;
    if (currentContent === lastAnalyzedContent && suggestions.length > 0) {
      return; // Don't re-analyze if content hasn't changed
    }
    
    setIsLoadingSuggestions(true);
    setShowNewContentIndicator(false);
    
    try {
      const newSuggestions = await aiSuggestionsService.generateSuggestions(documentTitle, documentContent);
      setSuggestions(newSuggestions);
      setLastAnalyzedContent(currentContent);
      setDismissedSuggestions(new Set()); // Reset dismissed suggestions
      
      // Auto-switch to suggestions tab if we have new suggestions and were on comments
      if (newSuggestions.length > 0 && activeTab === 'comments' && comments.length === 0) {
        setActiveTab('suggestions');
      }
    } catch (error) {
      console.error('Failed to load suggestions:', error);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const requestMoreSuggestions = async () => {
    if (isLoadingSuggestions) return;
    
    setIsLoadingSuggestions(true);
    try {
      const additionalSuggestions = await aiSuggestionsService.generateSuggestions(documentTitle, documentContent);
      // Merge with existing suggestions, avoiding duplicates
      const existingIds = new Set(suggestions.map(s => s.id));
      const newSuggestions = additionalSuggestions.filter(s => !existingIds.has(s.id));
      setSuggestions(prev => [...prev, ...newSuggestions]);
    } catch (error) {
      console.error('Failed to load additional suggestions:', error);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [inputValue]);

  // Check for content changes to show indicator
  useEffect(() => {
    const currentContent = `${documentTitle} ${documentContent}`;
    if (lastAnalyzedContent && currentContent !== lastAnalyzedContent && currentContent.trim()) {
      setShowNewContentIndicator(true);
    }
  }, [documentTitle, documentContent, lastAnalyzedContent]);

  // Debounced suggestions loading
  useEffect(() => {
    if (!isOpen) return;
    
    const timeoutId = setTimeout(() => {
      if (documentTitle.trim() || documentContent.trim()) {
        refreshSuggestions();
      }
    }, 1500); // Wait 1.5 seconds after user stops typing

    return () => clearTimeout(timeoutId);
  }, [isOpen, documentTitle, documentContent]);

  // Load suggestions immediately when sidebar opens if content exists
  useEffect(() => {
    if (isOpen && (documentTitle.trim() || documentContent.trim()) && suggestions.length === 0) {
      refreshSuggestions();
    }
  }, [isOpen]);

  // Debounced task mentions detection
  useEffect(() => {
    console.log('Mention detection useEffect triggered:', { isOpen, documentContent: documentContent.substring(0, 50) + '...', documentTitle });
    
    if (!isOpen) {
      console.log('Sidebar not open, skipping mention detection');
      return;
    }
    
    const timeoutId = setTimeout(() => {
      console.log('Timeout triggered, checking for mentions in content:', documentContent.substring(0, 100));
      if (documentContent.trim()) {
        detectTaskMentions();
      }
    }, 1000); // Detect mentions faster than suggestions

    return () => clearTimeout(timeoutId);
  }, [isOpen, documentContent, documentTitle]);

  const mockComments: Comment[] = comments;
  const mockActivities: Activity[] = activities;

  return (
    <>
      <style>{`
        @keyframes typingBounce {
          0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .typing-dot {
          animation: typingBounce 1.4s infinite ease-in-out;
        }
        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }
        .typing-dot:nth-child(3) { animation-delay: 0s; }
        .comments-sidebar {
          transform: ${isOpen ? 'translateX(0)' : 'translateX(100%)'};
        }
      `}</style>
      
      <div
        className="comments-sidebar"
        style={{
          position: 'fixed',
          right: '0',
          top: '0',
          width: '360px',
          height: '100vh',
          backgroundColor: '#ffffff',
          borderLeft: '1px solid #e5e7eb',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 200,
          boxShadow: '-2px 0 8px rgba(0, 0, 0, 0.1)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid #f3f4f6',
          backgroundColor: '#ffffff',
          position: 'sticky',
          top: '0',
          zIndex: 10
        }}>
          <div style={{
            fontSize: '16px',
            fontWeight: '600',
            color: '#374151',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Icon name="comment" size={16} color="#374151" />
            <span>Midlayer Assistant</span>
          </div>
          
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <button
              onClick={refreshSuggestions}
              disabled={isLoadingSuggestions}
              style={{
                width: '32px',
                height: '32px',
                border: 'none',
                backgroundColor: showNewContentIndicator ? '#fef3c7' : 'transparent',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: isLoadingSuggestions ? 'not-allowed' : 'pointer',
                color: showNewContentIndicator ? '#f59e0b' : '#6b7280',
                transition: 'all 0.2s ease',
                opacity: isLoadingSuggestions ? '0.5' : '1',
                position: 'relative'
              }}
              onMouseEnter={(e) => {
                if (!isLoadingSuggestions) {
                  e.currentTarget.style.backgroundColor = showNewContentIndicator ? '#fde68a' : '#f3f4f6';
                  e.currentTarget.style.color = showNewContentIndicator ? '#f59e0b' : '#374151';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = showNewContentIndicator ? '#fef3c7' : 'transparent';
                e.currentTarget.style.color = showNewContentIndicator ? '#f59e0b' : '#6b7280';
              }}
            >
              <Icon name="refresh" size={16} />
              {showNewContentIndicator && (
                <div style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  width: '6px',
                  height: '6px',
                  backgroundColor: '#f59e0b',
                  borderRadius: '50%',
                  animation: 'pulse 2s infinite'
                }} />
              )}
            </button>
            
            <button
              onClick={onClose}
              style={{
                width: '32px',
                height: '32px',
                border: 'none',
                backgroundColor: 'transparent',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#6b7280',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f3f4f6';
                e.currentTarget.style.color = '#374151';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#6b7280';
              }}
            >
              <Icon name="delete" size={16} />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#ffffff'
        }}>
          <button
            onClick={() => setActiveTab('suggestions')}
            style={{
              flex: '1',
              padding: '12px 16px',
              border: 'none',
              backgroundColor: 'transparent',
              fontSize: '14px',
              fontWeight: '500',
              color: activeTab === 'suggestions' ? '#3b82f6' : '#6b7280',
              cursor: 'pointer',
              borderBottom: activeTab === 'suggestions' ? '2px solid #3b82f6' : '2px solid transparent',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Icon name="lightbulb" size={14} color={activeTab === 'suggestions' ? '#3b82f6' : '#6b7280'} />
            <span>Suggestions</span>
            {suggestions.length > 0 && (
              <span style={{
                backgroundColor: activeTab === 'suggestions' ? '#3b82f6' : '#e5e7eb',
                color: activeTab === 'suggestions' ? 'white' : '#6b7280',
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '10px',
                minWidth: '16px',
                textAlign: 'center'
              }}>
                {suggestions.filter(s => !dismissedSuggestions.has(s.id)).length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('comments')}
            style={{
              flex: '1',
              padding: '12px 16px',
              border: 'none',
              backgroundColor: 'transparent',
              fontSize: '14px',
              fontWeight: '500',
              color: activeTab === 'comments' ? '#3b82f6' : '#6b7280',
              cursor: 'pointer',
              borderBottom: activeTab === 'comments' ? '2px solid #3b82f6' : '2px solid transparent',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Icon name="comment" size={14} color={activeTab === 'comments' ? '#3b82f6' : '#6b7280'} />
            <span>Comments</span>
            {comments.length > 0 && (
              <span style={{
                backgroundColor: activeTab === 'comments' ? '#3b82f6' : '#e5e7eb',
                color: activeTab === 'comments' ? 'white' : '#6b7280',
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '10px',
                minWidth: '16px',
                textAlign: 'center'
              }}>
                {comments.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('tasks')}
            style={{
              flex: '1',
              padding: '12px 16px',
              border: 'none',
              backgroundColor: 'transparent',
              fontSize: '14px',
              fontWeight: '500',
              color: activeTab === 'tasks' ? '#3b82f6' : '#6b7280',
              cursor: 'pointer',
              borderBottom: activeTab === 'tasks' ? '2px solid #3b82f6' : '2px solid transparent',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Icon name="user" size={14} color={activeTab === 'tasks' ? '#3b82f6' : '#6b7280'} />
            <span>Tasks</span>
            {taskMentions.length > 0 && (
              <span style={{
                backgroundColor: activeTab === 'tasks' ? '#3b82f6' : '#e5e7eb',
                color: activeTab === 'tasks' ? 'white' : '#6b7280',
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '10px',
                minWidth: '16px',
                textAlign: 'center'
              }}>
                {taskMentions.length}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        <div style={{
          flex: '1',
          overflowY: 'auto',
          padding: '0',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {activeTab === 'suggestions' ? (
            /* AI Suggestions Content */
            <div style={{ flex: '1' }}>
              {isLoadingSuggestions ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 20px',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <div style={{
                    width: '24px',
                    height: '24px',
                    border: '3px solid #e5e7eb',
                    borderTop: '3px solid #3b82f6',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }} />
                  <span style={{
                    fontSize: '14px',
                    color: '#6b7280',
                    textAlign: 'center'
                  }}>
                    Analyzing your document...
                  </span>
                </div>
              ) : suggestions.filter(s => !dismissedSuggestions.has(s.id)).length > 0 ? (
                <div style={{ padding: '16px 0' }}>
                  {suggestions
                    .filter(s => !dismissedSuggestions.has(s.id))
                    .map((suggestion) => (
                    <div
                      key={suggestion.id}
                      style={{
                        margin: '0 16px 12px 16px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '16px',
                        transition: 'all 0.2s ease',
                        position: 'relative'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#cbd5e1';
                        e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#e2e8f0';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      {/* Priority Indicator */}
                      <div style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: suggestion.priority === 'high' ? '#ef4444' : 
                                       suggestion.priority === 'medium' ? '#f59e0b' : '#10b981'
                      }} />
                      
                      {/* Suggestion Type Icon */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        marginBottom: '12px'
                      }}>
                        <div style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '6px',
                          backgroundColor: suggestion.type === 'subtask' ? '#dbeafe' :
                                         suggestion.type === 'architecture' ? '#fef3c7' :
                                         suggestion.type === 'consideration' ? '#ecfdf5' : '#f3e8ff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: '0',
                          marginTop: '2px'
                        }}>
                          <Icon 
                            name={suggestion.type === 'subtask' ? 'checkmark' :
                                 suggestion.type === 'architecture' ? 'settings' :
                                 suggestion.type === 'consideration' ? 'lightbulb' : 'link'}
                            size={12} 
                            color={suggestion.type === 'subtask' ? '#3b82f6' :
                                   suggestion.type === 'architecture' ? '#f59e0b' :
                                   suggestion.type === 'consideration' ? '#10b981' : '#8b5cf6'}
                          />
                        </div>
                        
                        <div style={{ flex: '1' }}>
                          {/* Suggestion Title */}
                          <div style={{
                            fontSize: '14px',
                            fontWeight: '600',
                            color: '#1f2937',
                            marginBottom: '6px',
                            lineHeight: '1.3'
                          }}>
                            {suggestion.title}
                          </div>
                          
                          {/* Suggestion Content */}
                          <div style={{
                            fontSize: '13px',
                            color: '#4b5563',
                            lineHeight: '1.4',
                            marginBottom: '12px'
                          }}>
                            {suggestion.content}
                          </div>
                          
                          {/* Category and Confidence */}
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            marginBottom: '12px'
                          }}>
                            <span style={{
                              fontSize: '11px',
                              backgroundColor: '#e5e7eb',
                              color: '#6b7280',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              fontWeight: '500'
                            }}>
                              {suggestion.category}
                            </span>
                            <span style={{
                              fontSize: '11px',
                              color: '#9ca3af'
                            }}>
                              {Math.round(suggestion.confidence * 100)}% confidence
                            </span>
                          </div>
                          
                          {/* Action Buttons */}
                          <div style={{
                            display: 'flex',
                            gap: '8px'
                          }}>
                            <button
                              onClick={() => handleAcceptSuggestion(suggestion)}
                              disabled={acceptingSuggestions.has(suggestion.id)}
                              style={{
                                fontSize: '12px',
                                padding: '6px 12px',
                                backgroundColor: acceptingSuggestions.has(suggestion.id) ? '#9ca3af' : '#3b82f6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: acceptingSuggestions.has(suggestion.id) ? 'not-allowed' : 'pointer',
                                fontWeight: '500',
                                transition: 'background-color 0.2s ease',
                                opacity: acceptingSuggestions.has(suggestion.id) ? 0.7 : 1
                              }}
                              onMouseEnter={(e) => {
                                if (!acceptingSuggestions.has(suggestion.id)) {
                                  e.currentTarget.style.backgroundColor = '#2563eb';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!acceptingSuggestions.has(suggestion.id)) {
                                  e.currentTarget.style.backgroundColor = '#3b82f6';
                                }
                              }}
                            >
                              {acceptingSuggestions.has(suggestion.id) ? 'Processing...' : 'Accept'}
                            </button>
                            <button
                              onClick={() => handleDismissSuggestion(suggestion.id)}
                              style={{
                                fontSize: '12px',
                                padding: '6px 12px',
                                backgroundColor: 'transparent',
                                color: '#6b7280',
                                border: '1px solid #d1d5db',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: '500',
                                transition: 'all 0.2s ease'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#f3f4f6';
                                e.currentTarget.style.borderColor = '#9ca3af';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.borderColor = '#d1d5db';
                              }}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {/* More Suggestions Button */}
                  {suggestions.filter(s => !dismissedSuggestions.has(s.id)).length > 0 && (
                    <div style={{
                      padding: '16px',
                      display: 'flex',
                      justifyContent: 'center'
                    }}>
                      <button
                        onClick={requestMoreSuggestions}
                        disabled={isLoadingSuggestions}
                        style={{
                          fontSize: '13px',
                          padding: '8px 16px',
                          backgroundColor: 'transparent',
                          color: '#6b7280',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          cursor: isLoadingSuggestions ? 'not-allowed' : 'pointer',
                          fontWeight: '500',
                          opacity: isLoadingSuggestions ? '0.6' : '1',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                        onMouseEnter={(e) => {
                          if (!isLoadingSuggestions) {
                            e.currentTarget.style.backgroundColor = '#f9fafb';
                            e.currentTarget.style.borderColor = '#d1d5db';
                            e.currentTarget.style.color = '#374151';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.borderColor = '#e5e7eb';
                          e.currentTarget.style.color = '#6b7280';
                        }}
                      >
                        <Icon name="plus" size={12} />
                        {isLoadingSuggestions ? 'Loading...' : 'More suggestions'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  flex: '1',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 20px',
                  textAlign: 'center'
                }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    color: '#d1d5db',
                    marginBottom: '16px'
                  }}>
                    <Icon name="lightbulb" size={48} color="#d1d5db" />
                  </div>
                  <div style={{
                    fontSize: '16px',
                    fontWeight: '500',
                    color: '#6b7280',
                    marginBottom: '8px'
                  }}>
                    No suggestions yet
                  </div>
                  <div style={{
                    fontSize: '14px',
                    color: '#9ca3af',
                    lineHeight: '1.5',
                    marginBottom: '16px'
                  }}>
                    Start writing your design document to get AI-powered suggestions for subtasks and architecture.
                  </div>
                  {(documentTitle || documentContent) && (
                    <button
                      onClick={refreshSuggestions}
                      disabled={isLoadingSuggestions}
                      style={{
                        fontSize: '14px',
                        padding: '8px 16px',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: isLoadingSuggestions ? 'not-allowed' : 'pointer',
                        fontWeight: '500',
                        opacity: isLoadingSuggestions ? '0.7' : '1',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <Icon name="refresh" size={14} color="white" />
                      {isLoadingSuggestions ? 'Analyzing...' : 'Get Suggestions'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : activeTab === 'comments' ? (
            /* Comments Content */
            <div style={{ flex: '1' }}>
              {mockComments.length > 0 ? (
                <div style={{
                  flex: '1',
                  padding: '16px 0'
                }}>
              {mockComments.map((comment) => (
                <div
                  key={comment.id}
                  style={{
                    padding: '12px 20px',
                    borderBottom: '1px solid #f9fafb',
                    transition: 'background-color 0.2s ease',
                    backgroundColor: comment.isUnread ? '#eff6ff' : 'transparent',
                    borderLeft: comment.isUnread ? '3px solid #3b82f6' : '3px solid transparent'
                  }}
                  onMouseEnter={(e) => {
                    if (!comment.isUnread) {
                      e.currentTarget.style.backgroundColor = '#f9fafb';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!comment.isUnread) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '8px'
                  }}>
                    <div style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      backgroundColor: '#e5e7eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: '500',
                      color: '#6b7280',
                      flexShrink: '0'
                    }}>
                      {comment.author.charAt(0)}
                    </div>
                    <span style={{
                      fontSize: '14px',
                      fontWeight: '500',
                      color: '#374151'
                    }}>
                      {comment.author}
                    </span>
                    <span style={{
                      fontSize: '12px',
                      color: '#9ca3af',
                      marginLeft: 'auto'
                    }}>
                      {comment.time}
                    </span>
                  </div>
                  
                  <div style={{
                    fontSize: '14px',
                    color: '#4b5563',
                    lineHeight: '1.5',
                    marginLeft: '32px'
                  }}>
                    {comment.text}
                  </div>
                  
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginTop: '8px',
                    marginLeft: '32px'
                  }}>
                    <span style={{
                      fontSize: '12px',
                      color: '#6b7280',
                      cursor: 'pointer',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      transition: 'background-color 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#f3f4f6';
                      e.currentTarget.style.color = '#374151';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = '#6b7280';
                    }}
                    >
                      Reply
                    </span>
                    <span style={{
                      fontSize: '12px',
                      color: '#6b7280',
                      cursor: 'pointer',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      transition: 'background-color 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#f3f4f6';
                      e.currentTarget.style.color = '#374151';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = '#6b7280';
                    }}
                    >
                      Like
                    </span>
                  </div>
                </div>
              ))}
              
              {/* Activity Section */}
              <div style={{
                padding: '16px 20px 8px 20px',
                fontSize: '12px',
                fontWeight: '600',
                color: '#718096',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Activity
              </div>
              
              {mockActivities.map((activity) => (
                <div
                  key={activity.id}
                  style={{
                    padding: '12px 20px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    borderBottom: '1px solid #f9fafb'
                  }}
                >
                  <div style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '4px',
                    backgroundColor: '#eff6ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#3b82f6',
                    fontSize: '12px',
                    flexShrink: '0',
                    marginTop: '2px'
                  }}>
                    <Icon name={activity.icon} size={12} color="#3b82f6" />
                  </div>
                  <div style={{ flex: '1' }}>
                    <div style={{
                      fontSize: '14px',
                      color: '#374151',
                      lineHeight: '1.4',
                      marginBottom: '4px'
                    }}>
                      {activity.text}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: '#9ca3af'
                    }}>
                      {activity.time}
                    </div>
                  </div>
                </div>
              ))}
              
              {isTyping && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 20px',
                  fontSize: '14px',
                  color: '#6b7280',
                  fontStyle: 'italic'
                }}>
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <div className="typing-dot" style={{
                      width: '4px',
                      height: '4px',
                      borderRadius: '50%',
                      backgroundColor: '#9ca3af'
                    }} />
                    <div className="typing-dot" style={{
                      width: '4px',
                      height: '4px',
                      borderRadius: '50%',
                      backgroundColor: '#9ca3af'
                    }} />
                    <div className="typing-dot" style={{
                      width: '4px',
                      height: '4px',
                      borderRadius: '50%',
                      backgroundColor: '#9ca3af'
                    }} />
                  </div>
                  <span>Someone is typing...</span>
                </div>
              )}
                </div>
              ) : (
                <div style={{
                  flex: '1',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 20px',
                  textAlign: 'center'
                }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    color: '#d1d5db',
                    marginBottom: '16px'
                  }}>
                    <Icon name="comment" size={48} color="#d1d5db" />
                  </div>
                  <div style={{
                    fontSize: '16px',
                    fontWeight: '500',
                    color: '#6b7280',
                    marginBottom: '8px'
                  }}>
                    No comments yet
                  </div>
                  <div style={{
                    fontSize: '14px',
                    color: '#9ca3af',
                    lineHeight: '1.5'
                  }}>
                    Start the conversation by adding the first comment below.
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'tasks' ? (
            /* Task Mentions Content */
            <div style={{ flex: '1' }}>
              {isLoadingMentions ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 20px'
                }}>
                  <div style={{
                    width: '20px',
                    height: '20px',
                    border: '2px solid #e5e7eb',
                    borderTop: '2px solid #3b82f6',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }} />
                  <span style={{ marginLeft: '12px', color: '#6b7280' }}>
                    Detecting task mentions...
                  </span>
                </div>
              ) : taskMentions.length > 0 ? (
                <div style={{
                  overflowY: 'auto',
                  maxHeight: 'calc(100vh - 300px)',
                  padding: '16px 0'
                }}>
                  <div style={{
                    padding: '0 20px 16px',
                    borderBottom: '1px solid #f3f4f6',
                    marginBottom: '16px'
                  }}>
                    <div style={{
                      fontSize: '14px',
                      color: '#6b7280',
                      marginBottom: '8px'
                    }}>
                      {mentionsSummary}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: '#9ca3af'
                    }}>
                      Click "Create in Linear" to delegate tasks instantly
                    </div>
                  </div>
                  
                  {taskMentions.map((mention) => (
                    <div
                      key={mention.id}
                      style={{
                        padding: '16px 20px',
                        borderBottom: '1px solid #f9fafb',
                        transition: 'background-color 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px'
                      }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          backgroundColor: '#3b82f6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '14px',
                          fontWeight: '600',
                          color: 'white',
                          flexShrink: '0'
                        }}>
                          @
                        </div>
                        
                        <div style={{ flex: '1' }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            marginBottom: '8px'
                          }}>
                            <span style={{
                              fontSize: '14px',
                              fontWeight: '600',
                              color: '#3b82f6'
                            }}>
                              @{mention.assignee}
                            </span>
                            <span style={{
                              fontSize: '12px',
                              color: '#9ca3af',
                              backgroundColor: '#f3f4f6',
                              padding: '2px 6px',
                              borderRadius: '4px'
                            }}>
                              Line {mention.line_number}
                            </span>
                          </div>
                          
                          <div style={{
                            fontSize: '14px',
                            color: '#374151',
                            marginBottom: '12px',
                            lineHeight: '1.5'
                          }}>
                            {mention.task}
                          </div>
                          
                          <button
                            onClick={() => window.open(mention.linear_url, '_blank', 'noopener,noreferrer')}
                            style={{
                              fontSize: '12px',
                              padding: '8px 16px',
                              backgroundColor: '#5e6ad2',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontWeight: '500',
                              transition: 'background-color 0.2s ease',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#4c63d2';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = '#5e6ad2';
                            }}
                          >
                            <Icon name="external-link" size={12} color="white" />
                            Create in Linear
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  flex: '1',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 20px',
                  textAlign: 'center'
                }}>
                  <div style={{
                    width: '64px',
                    height: '64px',
                    backgroundColor: '#f3f4f6',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '20px'
                  }}>
                    <Icon name="user" size={32} color="#9ca3af" />
                  </div>
                  <div style={{
                    fontSize: '16px',
                    fontWeight: '500',
                    color: '#6b7280',
                    marginBottom: '12px'
                  }}>
                    No task assignments detected
                  </div>
                  <div style={{
                    fontSize: '14px',
                    color: '#9ca3af',
                    lineHeight: '1.5',
                    marginBottom: '20px',
                    maxWidth: '280px'
                  }}>
                    Use <code style={{ 
                      backgroundColor: '#f3f4f6', 
                      padding: '2px 6px', 
                      borderRadius: '4px',
                      fontSize: '13px',
                      fontFamily: 'monospace'
                    }}>@username task description</code> in your document to delegate tasks.
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: '#9ca3af',
                    lineHeight: '1.4',
                    fontStyle: 'italic'
                  }}>
                    Example: @jeffrey implement user authentication system
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Chat Input */}
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid #e5e7eb',
          backgroundColor: '#ffffff',
          position: 'sticky',
          bottom: '0'
        }}>
          <div style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-end',
            gap: '8px',
            backgroundColor: '#f9fafb',
            border: isFocused ? '1px solid #3b82f6' : '1px solid #e5e7eb',
            borderRadius: '12px',
            padding: '8px 12px',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
            boxShadow: isFocused ? '0 0 0 3px rgba(59, 130, 246, 0.1)' : 'none'
          }}>
            <textarea
              ref={textareaRef}
              placeholder="Add a comment..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              style={{
                flex: '1',
                border: 'none',
                outline: 'none',
                backgroundColor: 'transparent',
                fontSize: '14px',
                color: '#374151',
                resize: 'none',
                minHeight: '20px',
                maxHeight: '120px',
                lineHeight: '1.4',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            />
            
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              flexShrink: '0'
            }}>
              <button
                style={{
                  width: '28px',
                  height: '28px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#6b7280',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#e5e7eb';
                  e.currentTarget.style.color = '#374151';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#6b7280';
                }}
              >
                <Icon name="link" size={16} />
              </button>
              
              <button
                style={{
                  width: '28px',
                  height: '28px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#6b7280',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#e5e7eb';
                  e.currentTarget.style.color = '#374151';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#6b7280';
                }}
              >
                <Icon name="plus" size={16} />
              </button>
              
              <button
                onClick={handleSend}
                disabled={!inputValue.trim()}
                style={{
                  width: '28px',
                  height: '28px',
                  border: 'none',
                  backgroundColor: '#3b82f6',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
                  color: '#ffffff',
                  transition: 'all 0.2s ease',
                  opacity: inputValue.trim() ? '1' : '0.5'
                }}
                onMouseEnter={(e) => {
                  if (inputValue.trim()) {
                    e.currentTarget.style.backgroundColor = '#2563eb';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#3b82f6';
                }}
              >
                <Icon name="arrow-right" size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CommentsSidebar;