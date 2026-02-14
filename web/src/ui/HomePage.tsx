import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon';
import DocumentService, { Document } from '../services/documentService';
import KnowledgeGraphModal from '../components/KnowledgeGraphModal';

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<Document[]>([]);
  const [showKnowledgeGraphModal, setShowKnowledgeGraphModal] = useState(false);
  const [knowledgeGraph, setKnowledgeGraph] = useState<{nodes: any[], edges: any[]} | null>(null);
  const [showTasks, setShowTasks] = useState(false);
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);

  const getDraftsCount = () => {
    return documents.filter(doc => doc.status === 'draft').length;
  };

  async function loadKnowledgeGraph(): Promise<void> {
    try {
      const response = await fetch('http://localhost:8000/knowledge-graph/graph');
      if (response.ok) {
        const graphData = await response.json();
        setKnowledgeGraph(graphData);
        // Show tasks if there are any task nodes
        if (graphData.nodes && graphData.nodes.some(n => n.type === 'task')) {
          setShowTasks(true);
        }
      }
    } catch (error) {
      console.error('Failed to load knowledge graph:', error);
    }
  }

  async function generatePlan(): Promise<void> {
    if (!goal.trim()) return;
    
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          goal: goal,
          notes: ''
        })
      });

      if (response.ok) {
        const planData = await response.json();
        console.log('Plan generated:', planData);
        // Reload knowledge graph to show new tasks
        await loadKnowledgeGraph();
        setShowTasks(true);
      }
    } catch (error) {
      console.error('Failed to generate plan:', error);
    } finally {
      setLoading(false);
    }
  }

  const sidebarItems = [
    { id: 'all', label: 'All', icon: 'document', badgeCount: null },
    { id: 'shared', label: 'Shared with me', icon: 'people', badgeCount: null },
    { id: 'drafts', label: 'Drafts', icon: 'compose', badgeCount: getDraftsCount() },
    { id: 'favorites', label: 'Favorites', icon: 'star', badgeCount: null },
    { id: 'trash', label: 'Trash', icon: 'delete', badgeCount: null }
  ];

  const collections = [
    'Analytics',
    'Goals & OKRs', 
    'Team Resources'
  ];

  const tabs = ['All', 'Recently viewed', 'Recently updated', 'Created by me'];

  // Load documents on component mount
  useEffect(() => {
    const loadDocuments = () => {
      const allDocs = DocumentService.getAllDocuments();
      setDocuments(allDocs);
      filterDocuments(allDocs, activeTab, searchTerm);
    };
    
    loadDocuments();
    loadKnowledgeGraph(); // Load existing tasks on mount
    
    // Listen for storage changes (in case documents are updated in another tab)
    const handleStorageChange = () => {
      loadDocuments();
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Filter documents based on active tab and search term
  useEffect(() => {
    filterDocuments(documents, activeTab, searchTerm);
  }, [documents, activeTab, searchTerm]);

  const filterDocuments = (docs: Document[], tab: string, search: string) => {
    let filtered = docs;
    
    // Apply search filter
    if (search.trim()) {
      filtered = DocumentService.searchDocuments(search);
    }
    
    // Apply tab filter
    switch (tab) {
      case 'All':
        break;
      case 'Recently viewed':
        // For now, just sort by updated date
        filtered = filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        break;
      case 'Recently updated':
        filtered = filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        break;
      case 'Created by me':
        // All documents are created by the user in this local setup
        break;
    }
    
    setFilteredDocuments(filtered);
  };

  const handleDocumentClick = (doc: Document) => {
    navigate(`/editor/${doc.id}`);
  };

  const handleDeleteDocument = (doc: Document, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${doc.title}"?`)) {
      DocumentService.deleteDocument(doc.id);
      const updatedDocs = documents.filter(d => d.id !== doc.id);
      setDocuments(updatedDocs);
      filterDocuments(updatedDocs, activeTab, searchTerm);
    }
  };

  const handleNewDoc = () => {
    navigate('/editor');
  };

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
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
                color: item.id === 'all' ? '#2d3748' : '#4a5568',
                textDecoration: 'none',
                cursor: 'pointer',
                transition: 'background-color 0.2s, color 0.2s',
                backgroundColor: item.id === 'all' ? '#cbd5e0' : 'transparent',
                fontWeight: item.id === 'all' ? '500' : 'normal'
              }}
              onMouseEnter={(e) => {
                if (item.id !== 'all') {
                  e.currentTarget.style.backgroundColor = '#f1f5f9';
                  e.currentTarget.style.color = '#2d3748';
                }
              }}
              onMouseLeave={(e) => {
                if (item.id !== 'all') {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#4a5568';
                }
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
        overflow: 'hidden'
      }}>
        {/* Header */}
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          backgroundColor: 'white',
          borderBottom: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
        }}>
          {/* Logo */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '16px',
            fontWeight: '600',
            color: '#2d3748'
          }}>
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

          {/* Search Bar */}
          <div style={{
            position: 'relative',
            maxWidth: '400px',
            flex: '1',
            margin: '0 20px'
          }}>
            <div style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#9ca3af',
              width: '16px',
              height: '16px'
            }}>
              <Icon name="search" size={16} color="#9ca3af" />
            </div>
            <input
              type="text"
              placeholder="Search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: '#f9fafb',
                outline: 'none',
                transition: 'border-color 0.2s, box-shadow 0.2s'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#3b82f6';
                e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#d1d5db';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>

          {/* New Doc Button */}
          <button
            onClick={handleNewDoc}
            style={{
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
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
            <Icon name="plus" size={16} color="white" />
            <span>New</span>
          </button>
        </header>

        {/* Main Content Area */}
        <main style={{
          padding: '40px 60px',
          maxWidth: '1200px',
          margin: '0 auto',
          width: '100%'
        }}>
          <h1 style={{
            fontSize: '32px',
            fontWeight: '700',
            color: '#1a202c',
            marginBottom: '32px'
          }}>
            Welcome back
          </h1>

          {/* Task Planning Section */}
          <div style={{
            backgroundColor: '#f8fafc',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '32px',
            border: '1px solid #e2e8f0'
          }}>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: '#1a202c',
              marginBottom: '16px'
            }}>
              Task Planning
            </h2>
            
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <input
                type="text"
                placeholder="Enter your goal (e.g., Build a mobile app for food delivery)"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                style={{
                  flex: '1',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#3b82f6';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#d1d5db';
                }}
              />
              <button
                onClick={generatePlan}
                disabled={loading || !goal.trim()}
                style={{
                  backgroundColor: loading || !goal.trim() ? '#9ca3af' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                  padding: '12px 24px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: loading || !goal.trim() ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.2s'
                }}
              >
                {loading ? 'Generating...' : 'Generate Plan'}
              </button>
            </div>

            {showTasks && knowledgeGraph && (
              <div style={{
                backgroundColor: 'white',
                borderRadius: '8px',
                padding: '20px',
                border: '1px solid #e2e8f0'
              }}>
                <h3 style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  color: '#1a202c',
                  marginBottom: '16px'
                }}>
                  Generated Tasks ({knowledgeGraph.nodes.filter(n => n.type === 'task').length})
                </h3>
                
                <div style={{
                  display: 'grid',
                  gap: '12px',
                  maxHeight: '400px',
                  overflowY: 'auto'
                }}>
                  {knowledgeGraph.nodes.filter(node => node.type === 'task').map((node, index) => (
                    <div
                      key={node.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        padding: '16px',
                        backgroundColor: '#f8fafc',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0'
                      }}
                    >
                      <div style={{
                        minWidth: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}>
                        {index + 1}
                      </div>
                      <div style={{ flex: '1' }}>
                        <h4 style={{
                          fontSize: '14px',
                          fontWeight: '600',
                          color: '#1a202c',
                          marginBottom: '4px'
                        }}>
                          {node.name || node.id}
                        </h4>
                        {node.metadata?.description && (
                          <p style={{
                            fontSize: '13px',
                            color: '#4a5568',
                            lineHeight: '1.4',
                            marginBottom: '8px'
                          }}>
                            {node.metadata.description}
                          </p>
                        )}
                        <div style={{
                          display: 'flex',
                          gap: '12px',
                          fontSize: '12px',
                          color: '#6b7280'
                        }}>
                          {node.metadata?.priority && (
                            <span>Priority: {node.metadata.priority}</span>
                          )}
                          {node.metadata?.estimate && (
                            <span>Estimate: {node.metadata.estimate}</span>
                          )}
                          <span>Status: {node.metadata?.status || 'pending'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tab Navigation */}
          <div style={{
            display: 'flex',
            gap: '32px',
            marginBottom: '24px',
            borderBottom: '1px solid #e2e8f0'
          }}>
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '12px 0',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: activeTab === tab ? '#2d3748' : '#718096',
                  cursor: 'pointer',
                  transition: 'color 0.2s, border-color 0.2s',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent'
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== tab) {
                    e.currentTarget.style.color = '#4a5568';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== tab) {
                    e.currentTarget.style.color = '#718096';
                  }
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Documents List or Empty State */}
          {filteredDocuments.length > 0 ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '16px',
              padding: '0 20px'
            }}>
              {filteredDocuments.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => handleDocumentClick(doc)}
                  style={{
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '16px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#cbd5e0';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#e2e8f0';
                    e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '8px'
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <Icon name="document" size={16} color="#4a5568" />
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: '500',
                        backgroundColor: doc.status === 'published' ? '#dcfce7' : '#fef3c7',
                        color: doc.status === 'published' ? '#166534' : '#92400e'
                      }}>
                        {doc.status === 'published' ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteDocument(doc, e)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#9ca3af',
                        cursor: 'pointer',
                        padding: '4px',
                        borderRadius: '4px',
                        transition: 'color 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#ef4444';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#9ca3af';
                      }}
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  </div>
                  
                  <h3 style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#1a202c',
                    margin: '0 0 8px 0',
                    lineHeight: '1.3',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical'
                  }}>
                    {doc.title || 'Untitled'}
                  </h3>
                  
                  <p style={{
                    fontSize: '14px',
                    color: '#4a5568',
                    margin: '0 0 12px 0',
                    lineHeight: '1.4',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical'
                  }}>
                    {doc.content ? doc.content.slice(0, 150) + (doc.content.length > 150 ? '...' : '') : 'No content'}
                  </p>
                  
                  <div style={{
                    fontSize: '12px',
                    color: '#9ca3af',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span>
                      Updated {new Date(doc.updatedAt).toLocaleDateString()}
                    </span>
                    <span>
                      {Math.ceil(doc.content.length / 250)} min read
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '60px 20px',
              color: '#718096'
            }}>
              <div style={{
                fontSize: '48px',
                marginBottom: '16px'
              }}>
                <Icon name="document" size={48} color="#718096" />
              </div>
              <div style={{
                fontSize: '16px',
                lineHeight: '1.5'
              }}>
                {searchTerm ? (
                  <>
                    <p>No documents found for "{searchTerm}"</p>
                    <p>Try a different search term</p>
                  </>
                ) : (
                  <>
                    <p>No documents yet</p>
                    <p>Create your first document to get started</p>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Floating Knowledge Graph Button */}
      <button
        onClick={() => {
          if (!knowledgeGraph) {
            loadKnowledgeGraph();
          }
          setShowKnowledgeGraphModal(true);
        }}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-br from-purple-600 to-indigo-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center text-xl hover:scale-105"
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
  );
};

export default HomePage;