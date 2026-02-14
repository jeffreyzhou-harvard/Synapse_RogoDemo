import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from './Icon';
import CommentsSidebar from './CommentsSidebar';
import MentionEditor from './MentionEditor';
import AgentDelegationModal from './AgentDelegationModal';
import agentService from '../services/agentService';
import DocumentService, { Document } from '../services/documentService';
import KnowledgeGraphModal from '../components/KnowledgeGraphModal';

const DocumentEditor: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [isContentFocused, setIsContentFocused] = useState(false);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'published' | 'error'>('saved');
  const [isCommentsSidebarOpen, setIsCommentsSidebarOpen] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [isAgentWorking, setIsAgentWorking] = useState(false);
  const [agentResult, setAgentResult] = useState<any>(null);
  const [showGitDiffModal, setShowGitDiffModal] = useState(false);
  const [taskDescription, setTaskDescription] = useState('');
  const [showKnowledgeGraphModal, setShowKnowledgeGraphModal] = useState(false);
  const [knowledgeGraph, setKnowledgeGraph] = useState<{nodes: any[], edges: any[]} | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Load existing document if ID is provided
    if (id) {
      const doc = DocumentService.getDocument(id);
      if (doc) {
        setTitle(doc.title);
        setContent(doc.content);
        setCurrentDocument(doc);
      }
    }
    
    // Focus on title when component mounts
    if (titleRef.current) {
      titleRef.current.focus();
    }
  }, [id]);

  // Auto-save as draft when content changes
  useEffect(() => {
    const autoSaveTimer = setTimeout(() => {
      if ((title.trim() || content.trim()) && saveStatus !== 'saving') {
        handleAutoSave();
      }
    }, 2000); // Auto-save after 2 seconds of inactivity

    return () => clearTimeout(autoSaveTimer);
  }, [title, content]);

  const handleAutoSave = () => {
    if (!title.trim() && !content.trim()) return;
    
    setSaveStatus('saving');
    
    try {
      if (currentDocument) {
        const updated = DocumentService.updateDocument(currentDocument.id, {
          title: title || 'Untitled',
          content,
          status: 'draft'
        });
        if (updated) {
          setCurrentDocument(updated);
        }
      } else {
        const saved = DocumentService.saveDocument({
          title: title || 'Untitled',
          content,
          status: 'draft'
        });
        setCurrentDocument(saved);
        // Update URL to include document ID
        window.history.replaceState(null, '', `/editor/${saved.id}`);
      }
      setSaveStatus('saved');
    } catch (error) {
      console.error('Auto-save failed:', error);
      setSaveStatus('unsaved');
    }
  };

  async function loadKnowledgeGraph(): Promise<void> {
    try {
      const response = await fetch('http://localhost:8000/knowledge-graph/graph');
      if (response.ok) {
        const graphData = await response.json();
        setKnowledgeGraph(graphData);
      }
    } catch (error) {
      console.error('Failed to load knowledge graph:', error);
    }
  }

  const sidebarItems = [
    { id: 'all', label: 'All', icon: 'document', badgeCount: null },
    { id: 'shared', label: 'Shared with me', icon: 'people', badgeCount: null },
    { id: 'drafts', label: 'Drafts', icon: 'compose', badgeCount: 3 },
    { id: 'favorites', label: 'Favorites', icon: 'star', badgeCount: null },
    { id: 'trash', label: 'Trash', icon: 'delete', badgeCount: null }
  ];

  const collections = [
    'Analytics',
    'Goals & OKRs', 
    'Team Resources'
  ];

  const handleBack = () => {
    navigate('/');
  };

  const handleSaveDraft = () => {
    if (!title.trim() && !content.trim()) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('unsaved'), 3000);
      return;
    }

    setSaveStatus('saving');
    
    try {
      if (currentDocument) {
        const updated = DocumentService.updateDocument(currentDocument.id, {
          title: title || 'Untitled',
          content,
          status: 'draft'
        });
        if (updated) {
          setCurrentDocument(updated);
          // Silent save - status indicator shows it's saved
        }
      } else {
        const saved = DocumentService.saveDocument({
          title: title || 'Untitled',
          content,
          status: 'draft'
        });
        setCurrentDocument(saved);
        // Update URL to include document ID
        window.history.replaceState(null, '', `/editor/${saved.id}`);
        // Silent save - status indicator shows it's saved
      }
      setSaveStatus('saved');
    } catch (error) {
      console.error('Save failed:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('unsaved'), 3000);
    }
  };

  const handlePublish = () => {
    if (!title.trim()) {
      setSaveStatus('error');
      titleRef.current?.focus();
      setTimeout(() => setSaveStatus(currentDocument ? 'saved' : 'unsaved'), 3000);
      return;
    }
    
    if (!content.trim()) {
      setSaveStatus('error');
      contentRef.current?.focus();
      setTimeout(() => setSaveStatus(currentDocument ? 'saved' : 'unsaved'), 3000);
      return;
    }

    setSaveStatus('saving');
    
    try {
      if (currentDocument) {
        const updated = DocumentService.updateDocument(currentDocument.id, {
          title,
          content,
          status: 'published'
        });
        if (updated) {
          setCurrentDocument(updated);
          setSaveStatus('published');
          setTimeout(() => navigate('/'), 1500);
        }
      } else {
        const published = DocumentService.saveDocument({
          title,
          content,
          status: 'published'
        });
        setCurrentDocument(published);
        setSaveStatus('published');
        setTimeout(() => navigate('/'), 1500);
      }
      setSaveStatus('saved');
    } catch (error) {
      console.error('Publish failed:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('unsaved'), 3000);
    }
  };

  // Handle text selection for agent delegation
  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      setSelectedText(selection.toString().trim());
    } else {
      setSelectedText('');
    }
  };

  // Handle agent delegation with inline loading
  const handleDelegateToAgent = async () => {
    if (!selectedText) {
      alert('Please select some text first');
      return;
    }
    
    setIsAgentWorking(true);
    setTaskDescription(selectedText);
    
    try {
      const result = await agentService.delegateToAgent({
        task_description: selectedText,
        selected_text: selectedText,
        document_context: content
      });
      
      if (result.error) {
        alert(`Agent delegation failed: ${result.error}`);
        setIsAgentWorking(false);
      } else {
        setAgentResult(result);
        setIsAgentWorking(false);
        // Show the git diff modal
        setShowGitDiffModal(true);
      }
    } catch (error) {
      console.error('Agent delegation error:', error);
      alert('Failed to delegate to agent. Please check if the backend is running.');
      setIsAgentWorking(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          0% { opacity: 0; transform: translateY(-10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={{
        display: 'flex',
        minHeight: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        backgroundColor: '#f8f9fa',
        color: '#2d3748'
      }}>
      {/* Sidebar */}
      <aside style={{
        width: '250px',
        backgroundColor: '#e2e8f0',
        borderRight: '1px solid #cbd5e0',
        display: 'flex',
        flexDirection: 'column',
        padding: '0'
      }}>
        {/* Navigation */}
        <nav style={{ padding: '16px 0' }}>
          {sidebarItems.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 20px',
                fontSize: '14px',
                color: '#4a5568',
                textDecoration: 'none',
                cursor: 'pointer',
                transition: 'background-color 0.2s, color 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f1f5f9';
                e.currentTarget.style.color = '#2d3748';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#4a5568';
              }}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
              {item.badgeCount && (
                <span style={{
                  marginLeft: 'auto',
                  backgroundColor: '#e5e7eb',
                  color: '#6b7280',
                  fontSize: '12px',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  minWidth: '18px',
                  textAlign: 'center'
                }}>
                  {item.badgeCount}
                </span>
              )}
            </div>
          ))}
        </nav>

        {/* Collections Section */}
        <div>
          <div style={{
            padding: '16px 20px 8px 20px',
            fontSize: '12px',
            fontWeight: '600',
            color: '#718096',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Collections
          </div>
          {collections.map((collection) => (
            <div
              key={collection}
              style={{
                paddingLeft: '48px',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 20px',
                color: '#4a5568',
                cursor: 'pointer',
                transition: 'background-color 0.2s, color 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f1f5f9';
                e.currentTarget.style.color = '#2d3748';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#4a5568';
              }}
            >
              <Icon name="folder" size={16} />
              <span>{collection}</span>
            </div>
          ))}
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 20px',
              fontSize: '13px',
              color: '#6b7280',
              cursor: 'pointer',
              border: 'none',
              background: 'none',
              width: '100%',
              textAlign: 'left'
            }}
          >
            <Icon name="plus" size={13} />
            <span>New collection</span>
          </button>
        </div>

        {/* User Section */}
        <div style={{
          marginTop: 'auto',
          padding: '16px 20px',
          borderTop: '1px solid #cbd5e0'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#6b7280',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: '500'
            }}>
              U
            </div>
            <div style={{
              fontSize: '14px',
              fontWeight: '500',
              color: '#2d3748'
            }}>
              User Name
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div style={{
        flex: '1',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
        backgroundColor: 'white'
      }}>
        {/* Header */}
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 20px',
          backgroundColor: 'white',
          borderBottom: '1px solid #e2e8f0',
          minHeight: '56px'
        }}>
          {/* Left Section */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px'
          }}>
            {/* Logo */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '16px',
              fontWeight: '600',
              color: '#2d3748',
              cursor: 'pointer'
            }} onClick={handleBack}>
              <img
                src="/MidlayerLogo.png"
                alt="Midlayer"
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '4px'
                }}
              />
              <span>Midlayer</span>
            </div>

            {/* Toolbar Icons */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              {['compose', 'link', 'share'].map((icon) => (
                <button
                  key={icon}
                  style={{
                    width: '32px',
                    height: '32px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#4a5568',
                    transition: 'background-color 0.2s, color 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f1f5f9';
                    e.currentTarget.style.color = '#2d3748';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#4a5568';
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.backgroundColor = '#e2e8f0';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.backgroundColor = '#f1f5f9';
                  }}
                >
                  <Icon name={icon} size={16} color="#4a5568" />
                </button>
              ))}
              <button
                onClick={() => setIsCommentsSidebarOpen(!isCommentsSidebarOpen)}
                style={{
                  width: '32px',
                  height: '32px',
                  border: 'none',
                  backgroundColor: isCommentsSidebarOpen ? '#e2e8f0' : 'transparent',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: isCommentsSidebarOpen ? '#2d3748' : '#4a5568',
                  transition: 'background-color 0.2s, color 0.2s'
                }}
                onMouseEnter={(e) => {
                  if (!isCommentsSidebarOpen) {
                    e.currentTarget.style.backgroundColor = '#f1f5f9';
                    e.currentTarget.style.color = '#2d3748';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isCommentsSidebarOpen) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#4a5568';
                  }
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.backgroundColor = '#cbd5e0';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.backgroundColor = isCommentsSidebarOpen ? '#e2e8f0' : '#f1f5f9';
                }}
              >
                <Icon name="comment" size={16} color={isCommentsSidebarOpen ? "#2d3748" : "#4a5568"} />
              </button>
            </div>
          </div>

          {/* Right Section */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            {/* Templates Dropdown */}
            <button
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                backgroundColor: 'white',
                fontSize: '14px',
                color: '#374151',
                cursor: 'pointer',
                transition: 'border-color 0.2s, box-shadow 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#9ca3af';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#d1d5db';
                e.currentTarget.style.boxShadow = 'none';
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#3b82f6';
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#d1d5db';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span>Templates</span>
              <Icon name="arrow-down" size={14} color="#374151" />
            </button>

            {/* Save Status */}
            <div style={{
              fontSize: '12px',
              color: saveStatus === 'saved' ? '#059669' : 
                     saveStatus === 'saving' ? '#d97706' : 
                     saveStatus === 'published' ? '#7c3aed' :
                     saveStatus === 'error' ? '#dc2626' : '#dc2626',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px'
            }}>
              {saveStatus === 'saved' && <Icon name="checkmark" size={12} color="#059669" />}
              {saveStatus === 'published' && <Icon name="star" size={12} color="#7c3aed" />}
              {saveStatus === 'saving' && <div style={{
                width: '12px',
                height: '12px',
                border: '2px solid #d97706',
                borderTop: '2px solid transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />}
              {(saveStatus === 'unsaved' || saveStatus === 'error') && <Icon name="alert" size={12} color="#dc2626" />}
              <span>
                {saveStatus === 'saved' ? 'Saved' : 
                 saveStatus === 'saving' ? 'Saving...' : 
                 saveStatus === 'published' ? 'Published!' :
                 saveStatus === 'error' ? 'Error - check content' :
                 'Unsaved changes'}
              </span>
            </div>

            {/* Save Draft Button */}
            <button
              onClick={handleSaveDraft}
              style={{
                padding: '6px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                backgroundColor: 'white',
                fontSize: '14px',
                color: '#374151',
                cursor: 'pointer',
                transition: 'background-color 0.2s, border-color 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f9fafb';
                e.currentTarget.style.borderColor = '#9ca3af';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'white';
                e.currentTarget.style.borderColor = '#d1d5db';
              }}
            >
              Save draft
            </button>

            {/* Publish Button */}
            <button
              onClick={handlePublish}
              style={{
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                padding: '6px 16px',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#2563eb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#3b82f6';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.backgroundColor = '#1d4ed8';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.backgroundColor = '#2563eb';
              }}
            >
              Publish
            </button>

            {/* User Avatar */}
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#6b7280',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: '500'
            }}>
              U
            </div>

            {/* More Button */}
            <button
              style={{
                width: '32px',
                height: '32px',
                border: 'none',
                backgroundColor: 'transparent',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#6b7280'
              }}
            >
              <Icon name="more" size={16} color="#6b7280" />
            </button>
          </div>
        </header>

        {/* Document Editor */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '800px',
          margin: '0 auto',
          padding: '40px 60px',
          width: '100%',
          minHeight: 'calc(100vh - 56px)' // Account for header height
        }}>
          {/* Title Section */}
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            marginBottom: '16px'
          }}>
            {/* Document Icon */}
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: '#e5e7eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9ca3af',
              fontSize: '18px',
              marginTop: '4px',
              flexShrink: '0'
            }}>
              <Icon name="document" size={18} color="#9ca3af" />
            </div>

            {/* Title Input */}
            <input
              ref={titleRef}
              type="text"
              placeholder="Untitled"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={() => setIsTitleFocused(true)}
              onBlur={() => setIsTitleFocused(false)}
              style={{
                fontSize: '28px',
                fontWeight: '700',
                color: isTitleFocused ? '#2d3748' : (title ? '#2d3748' : '#a0aec0'),
                border: 'none',
                outline: 'none',
                backgroundColor: 'transparent',
                width: '100%',
                padding: '4px 0',
                lineHeight: '1.2'
              }}
            />
          </div>

          {/* Meta Info */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: '14px',
            color: '#718096',
            marginBottom: '32px',
            paddingLeft: '52px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <Icon name="user" size={14} color="#718096" />
              <span>User Name</span>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <Icon name="calendar" size={14} color="#718096" />
              <span>Today at {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <button
              onClick={() => setIsCommentsSidebarOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                backgroundColor: 'white',
                fontSize: '12px',
                color: '#6b7280',
                cursor: 'pointer',
                transition: 'border-color 0.2s, background-color 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#9ca3af';
                e.currentTarget.style.backgroundColor = '#f9fafb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#d1d5db';
                e.currentTarget.style.backgroundColor = 'white';
              }}
            >
              <Icon name="comment" size={12} color="#6b7280" />
              <span>Comment</span>
            </button>
            
            {/* Agent Delegation Button - shows when text is selected */}
            {selectedText && (
              <button
                onClick={handleDelegateToAgent}
                disabled={isAgentWorking}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  border: '1px solid #3b82f6',
                  borderRadius: '4px',
                  backgroundColor: isAgentWorking ? '#9ca3af' : '#3b82f6',
                  fontSize: '12px',
                  color: 'white',
                  cursor: isAgentWorking ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.2s',
                  animation: 'fadeIn 0.2s ease-in'
                }}
                onMouseEnter={(e) => {
                  if (!isAgentWorking) {
                    e.currentTarget.style.backgroundColor = '#2563eb';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isAgentWorking) {
                    e.currentTarget.style.backgroundColor = '#3b82f6';
                  }
                }}
              >
                {isAgentWorking ? (
                  <>
                    <div style={{
                      width: '12px',
                      height: '12px',
                      border: '2px solid #ffffff',
                      borderTop: '2px solid transparent',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }} />
                    <span>Agent Working...</span>
                  </>
                ) : (
                  <span>Delegate to Agent</span>
                )}
              </button>
            )}
          </div>

          {/* Editor Area */}
          <div style={{
            flex: '1',
            minHeight: '400px',
            paddingLeft: '52px'
          }}>
            <div onMouseUp={handleTextSelection}>
              <MentionEditor
                value={content}
                onChange={setContent}
                onFocus={() => setIsContentFocused(true)}
                onBlur={() => setIsContentFocused(false)}
                placeholder="Start writing..."
                isFocused={isContentFocused}
                style={{
                  fontSize: '16px',
                  lineHeight: '1.6',
                  fontFamily: 'inherit'
                }}
              />
            </div>
          </div>
        </div>
      </div>
      
      {/* Comments Sidebar */}
      <CommentsSidebar
        isOpen={isCommentsSidebarOpen}
        onClose={() => setIsCommentsSidebarOpen(false)}
        documentTitle={title}
        documentContent={content}
        onDocumentUpdate={(newContent: string, explanation: string) => {
          setContent(newContent);
          // Show a brief notification about the improvement
          console.log('Document updated:', explanation);
        }}
      />

      {/* Git Diff Modal - shows after agent finishes */}
      {showGitDiffModal && agentResult && (
        <AgentDelegationModal
          isOpen={showGitDiffModal}
          onClose={() => {
            setShowGitDiffModal(false);
            setSelectedText('');
            setTaskDescription('');
            setAgentResult(null);
          }}
          selectedText={selectedText}
          documentContext={content}
          taskDescription={taskDescription}
        />
      )}

      {/* Floating Knowledge Graph Button */}
      <button
        onClick={() => {
          if (!knowledgeGraph) {
            loadKnowledgeGraph();
          }
          setShowKnowledgeGraphModal(true);
        }}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-br from-purple-600 to-indigo-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center text-xl hover:scale-105 z-50"
        title="View Knowledge Graph"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className="w-6 h-6" fill="currentColor">
          <path d="m25.24,28l13,13-13,13-4.24-4.24,5.76-5.76h0s-7.76,0-7.76,0c-8.5,0-14-5.5-14-14s5.5-14,14-14h9v6h-9c-5.16,0-8,2.84-8,8s2.84,8,8,8h7.76l-5.76-5.76,4.24-4.24Zm24.76-18h-18v18h18V10Zm-10,22v18h18v-18h-18Z"/>
        </svg>
      </button>

      {/* Knowledge Graph Modal */}
      <KnowledgeGraphModal
        isOpen={showKnowledgeGraphModal}
        onClose={() => setShowKnowledgeGraphModal(false)}
        graphData={knowledgeGraph}
        onRefresh={loadKnowledgeGraph}
      />
    </div>
    </>
  );
};

export default DocumentEditor;