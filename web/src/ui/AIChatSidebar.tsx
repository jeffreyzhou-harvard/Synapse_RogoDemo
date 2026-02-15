import React, { useState, useRef, useEffect } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  agentType?: string;
  agentIcon?: string;
  agentColor?: string;
  agentLabel?: string;
  selectedText?: string;
  content: string;
  timestamp: Date;
  isLoading?: boolean;
}

interface AIChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  onInsertToDoc: (content: string) => void;
  isLoading: boolean;
  documentTitle: string;
}

// Simple markdown renderer
function renderMarkdown(text: string, agentColor: string) {
  return text.split('\n').map((line, i) => {
    // Bold headers
    if (line.startsWith('**') && line.includes('**')) {
      const m = line.match(/^\*\*(.+?)\*\*(.*)/);
      if (m) {
        return (
          <div key={i} style={{ marginTop: i > 0 ? '14px' : '0', marginBottom: '4px' }}>
            <span style={{ fontWeight: 700, color: agentColor, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              {m[1].replace(/:$/, '')}
            </span>
            {m[2] && <span style={{ color: '#4a5568', fontWeight: 400 }}>{m[2]}</span>}
          </div>
        );
      }
    }
    // Bullets
    if (line.trim().startsWith('•') || line.trim().startsWith('-') || line.trim().match(/^\d+\./)) {
      const bulletContent = line.trim().replace(/^[•\-]\s*/, '').replace(/^\d+\.\s*/, '');
      // Render inline bold within bullets
      const parts = bulletContent.split(/(\*\*.*?\*\*)/g);
      return (
        <div key={i} style={{ paddingLeft: '14px', position: 'relative', marginBottom: '5px', color: '#374151', fontSize: '13px', lineHeight: 1.5 }}>
          <span style={{ position: 'absolute', left: '0', color: agentColor, fontWeight: 700, fontSize: '11px' }}>·</span>
          {parts.map((p, j) => {
            const bold = p.match(/^\*\*(.+?)\*\*$/);
            if (bold) return <strong key={j} style={{ color: '#1a202c' }}>{bold[1]}</strong>;
            return <span key={j}>{p}</span>;
          })}
        </div>
      );
    }
    if (!line.trim()) return <div key={i} style={{ height: '6px' }} />;
    // Normal text with inline bold
    const parts = line.split(/(\*\*.*?\*\*)/g);
    return (
      <div key={i} style={{ color: '#4a5568', marginBottom: '3px', fontSize: '13px', lineHeight: 1.55 }}>
        {parts.map((p, j) => {
          const bold = p.match(/^\*\*(.+?)\*\*$/);
          if (bold) return <strong key={j} style={{ color: '#1a202c' }}>{bold[1]}</strong>;
          return <span key={j}>{p}</span>;
        })}
      </div>
    );
  });
}

const AIChatSidebar: React.FC<AIChatSidebarProps> = ({
  isOpen,
  onClose,
  messages,
  onSendMessage,
  onInsertToDoc,
  isLoading,
  documentTitle,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Auto-focus input when sidebar opens
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  const handleSend = () => {
    const msg = inputValue.trim();
    if (!msg) return;
    onSendMessage(msg);
    setInputValue('');
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <>
      <style>{`
        @keyframes chatSlideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes chatFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-dot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div style={{
        position: 'fixed', right: 0, top: 0, width: '380px', height: '100vh',
        backgroundColor: '#ffffff', borderLeft: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column', zIndex: 200,
        boxShadow: '-4px 0 20px rgba(0,0,0,0.06)',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid #f0f0f0', backgroundColor: '#fff',
          position: 'sticky', top: 0, zIndex: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '8px',
              background: 'linear-gradient(135deg, #4a5568 0%, #2d3748 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: '12px', fontWeight: 700,
            }}>S</div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a202c' }}>AI Chat</div>
              <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                {documentTitle || 'Untitled document'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: '28px', height: '28px', border: 'none', backgroundColor: 'transparent',
            borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#9ca3af', fontSize: '18px', lineHeight: 1,
          }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; e.currentTarget.style.color = '#374151'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
          >×</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0' }}>
          {messages.length === 0 && !isLoading && (
            <div style={{ padding: '40px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>🧠</div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                Your thinking partner
              </div>
              <div style={{ fontSize: '13px', color: '#9ca3af', lineHeight: 1.5 }}>
                Select text in your document and choose an agent, or ask a question about your notes below.
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} style={{
              padding: '12px 18px', animation: 'chatFadeIn 0.2s ease-out',
              borderBottom: '1px solid #f9fafb',
            }}>
              {/* User message */}
              {msg.role === 'user' && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{
                    width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#e5e7eb',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', fontWeight: 600, color: '#6b7280', flexShrink: 0, marginTop: '1px',
                  }}>U</div>
                  <div>
                    {msg.selectedText && (
                      <div style={{
                        fontSize: '12px', color: '#6b7280', marginBottom: '4px',
                        padding: '4px 8px', backgroundColor: '#f3f4f6', borderRadius: '4px',
                        borderLeft: `2px solid ${msg.agentColor || '#4a5568'}`, display: 'inline-block',
                      }}>
                        "{msg.selectedText.slice(0, 80)}{msg.selectedText.length > 80 ? '...' : ''}"
                      </div>
                    )}
                    <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.5 }}>
                      {msg.content}
                    </div>
                  </div>
                </div>
              )}

              {/* Agent response */}
              {msg.role === 'agent' && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{
                    width: '26px', height: '26px', borderRadius: '8px',
                    backgroundColor: `${msg.agentColor || '#4a5568'}14`,
                    border: `1px solid ${msg.agentColor || '#4a5568'}25`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '13px', flexShrink: 0, marginTop: '1px',
                  }}>
                    {msg.agentIcon || '🤖'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: msg.agentColor || '#4a5568', marginBottom: '6px' }}>
                      {msg.agentLabel || 'Synapse'}
                    </div>
                    {msg.isLoading ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 0' }}>
                        <span style={{ fontSize: '13px', color: '#9ca3af' }}>Thinking</span>
                        {[0, 1, 2].map(i => (
                          <div key={i} style={{
                            width: '5px', height: '5px', borderRadius: '50%', backgroundColor: msg.agentColor || '#4a5568',
                            animation: `pulse-dot 1.4s ease-in-out ${i * 0.2}s infinite`,
                          }} />
                        ))}
                      </div>
                    ) : (
                      <>
                        <div style={{ color: '#2d3748' }}>
                          {renderMarkdown(msg.content, msg.agentColor || '#4a5568')}
                        </div>
                        {/* Action buttons — like Jenni */}
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px',
                          paddingTop: '8px', borderTop: '1px solid #f3f4f6',
                        }}>
                          <button onClick={() => onInsertToDoc(msg.content)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '5px',
                              fontSize: '12px', padding: '5px 10px', border: '1px solid #e5e7eb',
                              borderRadius: '6px', backgroundColor: '#fff', color: '#374151',
                              cursor: 'pointer', fontWeight: 500, transition: 'all 0.15s',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; e.currentTarget.style.borderColor = '#d1d5db'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
                          >
                            <span style={{ fontSize: '11px' }}>+</span> Add to document
                          </button>
                          <button onClick={() => handleCopy(msg.id, msg.content)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '5px',
                              fontSize: '12px', padding: '5px 10px', border: '1px solid #e5e7eb',
                              borderRadius: '6px', backgroundColor: '#fff', color: '#374151',
                              cursor: 'pointer', fontWeight: 500, transition: 'all 0.15s',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; e.currentTarget.style.borderColor = '#d1d5db'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
                          >
                            {copiedId === msg.id ? '✓ Copied' : '⧉ Copy'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Context pills + Input */}
        <div style={{
          padding: '12px 16px 16px', borderTop: '1px solid #f0f0f0', backgroundColor: '#fff',
        }}>
          {/* Context pills */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '11px', padding: '3px 10px', borderRadius: '12px',
              backgroundColor: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0',
              fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#16a34a' }} />
              Current document
            </span>
          </div>
          {/* Input */}
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: '8px',
            border: '1px solid #e5e7eb', borderRadius: '10px', padding: '8px 10px',
            backgroundColor: '#fafafa', transition: 'border-color 0.15s',
          }}
            onFocus={() => {}}
          >
            <textarea
              ref={inputRef}
              placeholder="Ask about your document..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              rows={1}
              style={{
                flex: 1, border: 'none', outline: 'none', backgroundColor: 'transparent',
                fontSize: '13px', color: '#374151', resize: 'none', minHeight: '20px',
                maxHeight: '80px', lineHeight: 1.4, fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            />
            <button onClick={handleSend} disabled={!inputValue.trim() || isLoading}
              style={{
                width: '28px', height: '28px', borderRadius: '8px', border: 'none',
                backgroundColor: inputValue.trim() && !isLoading ? '#1a202c' : '#e5e7eb',
                color: inputValue.trim() && !isLoading ? '#fff' : '#9ca3af',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: inputValue.trim() && !isLoading ? 'pointer' : 'not-allowed',
                fontSize: '14px', flexShrink: 0, transition: 'all 0.15s',
              }}
            >↑</button>
          </div>
        </div>
      </div>
    </>
  );
};

export default AIChatSidebar;
