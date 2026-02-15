import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon';
import DocumentService, { Document } from '../services/documentService';

const PAPER_STYLES = [
  { id: 'academic', label: 'Academic', desc: 'Formal research paper with standard sections' },
  { id: 'argumentative', label: 'Argumentative', desc: 'Thesis-driven with evidence and counterarguments' },
  { id: 'literature-review', label: 'Literature Review', desc: 'Survey of existing research and gaps' },
  { id: 'expository', label: 'Expository', desc: 'In-depth explanation of a topic' },
];

interface WizardMessage {
  role: 'user' | 'ai';
  text: string;
}

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [topic, setTopic] = useState('');
  const [paperStyle, setPaperStyle] = useState('academic');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Research question wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTopic, setWizardTopic] = useState('');
  const [wizardConvo, setWizardConvo] = useState<WizardMessage[]>([]);
  const [wizardInput, setWizardInput] = useState('');
  const [wizardLoading, setWizardLoading] = useState(false);
  const [refinedQuestion, setRefinedQuestion] = useState('');

  useEffect(() => {
    setDocuments(DocumentService.getAllDocuments());
    const handleStorageChange = () => setDocuments(DocumentService.getAllDocuments());
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const filtered = searchTerm.trim()
    ? DocumentService.searchDocuments(searchTerm)
    : documents.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // ── Research Question Wizard ──────────────────────────────────────
  const askSocratic = useCallback(async (topicStr: string, convo: WizardMessage[]) => {
    setWizardLoading(true);
    try {
      const resp = await fetch('/refine-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topicStr, conversation: convo }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.is_complete && data.question) {
          setRefinedQuestion(data.question);
        } else if (data.follow_up) {
          setWizardConvo(prev => [...prev, { role: 'ai', text: data.follow_up }]);
        }
      }
    } catch {
      setWizardConvo(prev => [...prev, { role: 'ai', text: 'What specific aspect of this topic interests you most?' }]);
    } finally {
      setWizardLoading(false);
    }
  }, []);

  const startWizard = useCallback(() => {
    if (!topic.trim()) return;
    setWizardTopic(topic.trim());
    setWizardConvo([]);
    setRefinedQuestion('');
    setWizardOpen(true);
    // Start first Socratic question
    askSocratic(topic.trim(), []);
  }, [topic, askSocratic]);

  const handleWizardReply = useCallback(async () => {
    if (!wizardInput.trim() || wizardLoading) return;
    const reply = wizardInput.trim();
    setWizardInput('');
    const newConvo = [...wizardConvo, { role: 'user' as const, text: reply }];
    setWizardConvo(newConvo);
    await askSocratic(wizardTopic, newConvo);
  }, [wizardInput, wizardConvo, wizardTopic, wizardLoading, askSocratic]);

  const useRefinedQuestion = useCallback(() => {
    setTopic(refinedQuestion.replace(/\?$/, ''));
    setWizardOpen(false);
  }, [refinedQuestion]);

  async function generatePaper() {
    if (!topic.trim()) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/generate-paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), style: paperStyle }),
      });
      if (response.ok) {
        const data = await response.json();
        // Create a new document with the generated content
        const doc = DocumentService.saveDocument({
          title: data.title || topic,
          content: data.content || '',
          status: 'draft',
        });
        // Navigate to the editor with the new document
        navigate(`/editor/${doc.id}`);
      } else {
        const errData = await response.json().catch(() => null);
        setError(errData?.detail || 'Failed to generate paper. Try again.');
      }
    } catch (err) {
      console.error('Failed to generate paper:', err);
      setError('Network error. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  const handleDeleteDocument = (doc: Document, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${doc.title}"?`)) {
      DocumentService.deleteDocument(doc.id);
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
    }
  };

  return (
    <div style={{ minHeight: '100vh', fontFamily: "'Inter', system-ui, -apple-system, sans-serif", backgroundColor: '#fff', color: '#1a202c' }}>
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>

      {/* Top bar */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, backgroundColor: '#fff', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '26px', height: '26px', borderRadius: '6px', background: 'linear-gradient(135deg, #4a5568 0%, #2d3748 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '12px', fontWeight: 700 }}>S</div>
          <span style={{ fontSize: '16px', fontWeight: 600 }}>Synapse</span>
        </div>

        <div style={{ position: 'relative', maxWidth: '360px', flex: 1, margin: '0 24px' }}>
          <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}>
            <Icon name="search" size={15} color="#9ca3af" />
          </div>
          <input type="text" placeholder="Search documents..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '7px 12px 7px 34px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '13px', backgroundColor: '#fafafa', outline: 'none', transition: 'border-color 0.15s' }}
            onFocus={(e) => { e.target.style.borderColor = '#9ca3af'; }}
            onBlur={(e) => { e.target.style.borderColor = '#e5e7eb'; }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => navigate('/editor?split=true')}
            style={{ backgroundColor: '#fff', color: '#374151', border: '1px solid #e5e7eb', padding: '7px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#9ca3af'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
            title="Open editor with source material side-by-side"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" /></svg>
            Split view
          </button>
          <button onClick={() => navigate('/editor')}
            style={{ backgroundColor: '#1a202c', color: 'white', border: 'none', padding: '7px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', transition: 'background-color 0.15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#2d3748'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#1a202c'; }}
          >
            <Icon name="plus" size={14} color="white" />
            New document
          </button>
        </div>
      </header>

      {/* Main content */}
      <main style={{ maxWidth: '860px', margin: '0 auto', padding: '40px 24px 80px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#1a202c', marginBottom: '6px' }}>Welcome back</h1>
        <p style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '36px', lineHeight: 1.5 }}>
          Plan your paper, then write. Highlight text to find evidence, challenge ideas, and verify claims.
        </p>

        {/* Paper Format Planner */}
        <div style={{ backgroundColor: '#fafafa', borderRadius: '10px', padding: '20px', marginBottom: '36px', border: '1px solid #f0f0f0' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#1a202c', margin: '0 0 12px' }}>Plan a Paper Format</h2>

          {/* Topic input */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <input type="text"
              placeholder="Enter your topic (e.g., Impact of AI on Healthcare, Climate Policy...)"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !loading) generatePaper(); }}
              style={{ flex: 1, padding: '9px 14px', borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px', outline: 'none', transition: 'border-color 0.15s' }}
              onFocus={(e) => { e.target.style.borderColor = '#9ca3af'; }}
              onBlur={(e) => { e.target.style.borderColor = '#e5e7eb'; }}
            />
            <button onClick={startWizard} disabled={!topic.trim()}
              title="Refine your topic into a specific research question through guided questions"
              style={{
                padding: '9px 14px', borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px', fontWeight: 500,
                backgroundColor: !topic.trim() ? '#f9fafb' : '#fff', color: !topic.trim() ? '#d1d5db' : '#6b7280',
                cursor: !topic.trim() ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => { if (topic.trim()) e.currentTarget.style.borderColor = '#9ca3af'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
            >
              🤔 Refine
            </button>
            <button onClick={generatePaper} disabled={loading || !topic.trim()}
              style={{
                padding: '9px 18px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: 500,
                backgroundColor: loading || !topic.trim() ? '#d1d5db' : '#1a202c', color: 'white',
                cursor: loading || !topic.trim() ? 'not-allowed' : 'pointer', transition: 'background-color 0.15s',
                minWidth: '110px',
              }}>
              {loading ? 'Planning...' : 'Plan Format'}
            </button>
          </div>

          {/* Style selector */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {PAPER_STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => setPaperStyle(s.id)}
                title={s.desc}
                style={{
                  padding: '4px 12px',
                  borderRadius: '6px',
                  border: paperStyle === s.id ? '1px solid #4a5568' : '1px solid #e5e7eb',
                  backgroundColor: paperStyle === s.id ? '#1a202c' : '#fff',
                  color: paperStyle === s.id ? '#fff' : '#4a5568',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Loading indicator */}
          {loading && (
            <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
              <div style={{ width: '16px', height: '16px', border: '2px solid #d1d5db', borderTop: '2px solid #4a5568', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: '#1a202c' }}>Planning your format...</div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>Creating an {PAPER_STYLES.find(s => s.id === paperStyle)?.label.toLowerCase()} outline for "{topic}"</div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div style={{ marginTop: '10px', padding: '8px 12px', backgroundColor: '#fef2f2', borderRadius: '6px', fontSize: '12px', color: '#991b1b' }}>
              {error}
            </div>
          )}
        </div>

        {/* Documents */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#1a202c', margin: 0 }}>
            {searchTerm ? `Results for "${searchTerm}"` : 'Recent documents'}
          </h2>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>{filtered.length} document{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {filtered.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', border: '1px solid #f0f0f0', borderRadius: '10px', overflow: 'hidden' }}>
            {filtered.map((doc) => (
              <div key={doc.id} onClick={() => navigate(`/editor/${doc.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 18px', backgroundColor: '#fff', cursor: 'pointer', transition: 'background-color 0.12s', borderBottom: '1px solid #f9f9f9' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#fafafa'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
              >
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="document" size={15} color="#9ca3af" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: '#1a202c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {doc.title || 'Untitled'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {doc.content ? doc.content.slice(0, 100) : 'No content'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                  <span style={{ fontSize: '12px', color: '#c4c4c4' }}>
                    {new Date(doc.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <button onClick={(e) => handleDeleteDocument(doc, e)}
                    style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.12s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#d1d5db'; }}
                  >
                    <Icon name="delete" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af' }}>
            {searchTerm ? (
              <p style={{ fontSize: '14px' }}>No documents found for "{searchTerm}"</p>
            ) : (
              <>
                <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.4 }}>
                  <Icon name="document" size={36} color="#9ca3af" />
                </div>
                <p style={{ fontSize: '15px', fontWeight: 500, color: '#6b7280', marginBottom: '4px' }}>No documents yet</p>
                <p style={{ fontSize: '13px' }}>Create a new document to start writing and using AI agents.</p>
              </>
            )}
          </div>
        )}
      </main>

      {/* ── Research Question Refinement Wizard ─────────────────────── */}
      {wizardOpen && (
        <>
          <div onClick={() => setWizardOpen(false)} style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)',
            backdropFilter: 'blur(4px)', zIndex: 100,
          }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: '480px', maxHeight: '80vh', backgroundColor: '#fff', borderRadius: '16px',
            boxShadow: '0 25px 60px rgba(0,0,0,0.2)', zIndex: 101,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>🤔</span>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a202c' }}>Refine Your Research Question</div>
                    <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>Answer 3 questions to sharpen your focus</div>
                  </div>
                </div>
                <button onClick={() => setWizardOpen(false)} style={{
                  border: 'none', background: '#f3f4f6', borderRadius: '8px', width: '28px', height: '28px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: '#6b7280', fontSize: '16px',
                }}>×</button>
              </div>
              <div style={{ marginTop: '10px', padding: '8px 12px', backgroundColor: '#f8fafc', borderRadius: '8px', fontSize: '13px', color: '#4a5568' }}>
                Topic: <strong>{wizardTopic}</strong>
              </div>
            </div>

            {/* Conversation */}
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
              {/* Progress dots */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '20px' }}>
                {[0, 1, 2].map(i => {
                  const userCount = wizardConvo.filter(m => m.role === 'user').length;
                  const done = userCount > i;
                  const active = userCount === i;
                  return (
                    <div key={i} style={{
                      width: done ? '24px' : '8px', height: '8px', borderRadius: '4px',
                      backgroundColor: done ? '#059669' : active ? '#3b82f6' : '#e5e7eb',
                      transition: 'all 0.3s',
                    }} />
                  );
                })}
              </div>

              {wizardConvo.map((msg, i) => (
                <div key={i} style={{
                  marginBottom: '12px',
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}>
                  <div style={{
                    maxWidth: '85%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    backgroundColor: msg.role === 'user' ? '#1a202c' : '#f3f4f6',
                    color: msg.role === 'user' ? '#fff' : '#1a202c',
                    fontSize: '13px', lineHeight: 1.5,
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}

              {wizardLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
                  <div style={{ padding: '10px 14px', borderRadius: '12px 12px 12px 4px', backgroundColor: '#f3f4f6', display: 'flex', gap: '4px' }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#9ca3af',
                        animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                      }} />
                    ))}
                  </div>
                </div>
              )}

              {/* Refined question result */}
              {refinedQuestion && (
                <div style={{
                  marginTop: '16px', padding: '16px', backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0', borderRadius: '12px',
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                    Your refined research question
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 500, color: '#1a202c', lineHeight: 1.5, fontFamily: "'Georgia', serif", fontStyle: 'italic' }}>
                    {refinedQuestion}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button onClick={useRefinedQuestion}
                      style={{
                        flex: 1, padding: '9px', border: 'none', borderRadius: '8px',
                        backgroundColor: '#1a202c', color: '#fff', fontSize: '13px',
                        fontWeight: 500, cursor: 'pointer', transition: 'background-color 0.15s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#2d3748'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#1a202c'; }}
                    >
                      Use this question
                    </button>
                    <button onClick={() => setWizardOpen(false)}
                      style={{
                        padding: '9px 16px', border: '1px solid #e5e7eb', borderRadius: '8px',
                        backgroundColor: '#fff', color: '#6b7280', fontSize: '13px',
                        fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Input area */}
            {!refinedQuestion && (
              <div style={{ padding: '12px 24px 16px', borderTop: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Type your answer..."
                    value={wizardInput}
                    onChange={(e) => setWizardInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleWizardReply(); }}
                    disabled={wizardLoading || wizardConvo.length === 0}
                    style={{
                      flex: 1, padding: '9px 14px', borderRadius: '8px', border: '1px solid #e5e7eb',
                      fontSize: '13px', outline: 'none', transition: 'border-color 0.15s',
                    }}
                    onFocus={(e) => { e.target.style.borderColor = '#9ca3af'; }}
                    onBlur={(e) => { e.target.style.borderColor = '#e5e7eb'; }}
                  />
                  <button onClick={handleWizardReply}
                    disabled={wizardLoading || !wizardInput.trim()}
                    style={{
                      padding: '9px 16px', borderRadius: '8px', border: 'none',
                      backgroundColor: wizardLoading || !wizardInput.trim() ? '#d1d5db' : '#1a202c',
                      color: '#fff', fontSize: '13px', fontWeight: 500,
                      cursor: wizardLoading || !wizardInput.trim() ? 'not-allowed' : 'pointer',
                    }}
                  >Reply</button>
                </div>
              </div>
            )}
          </div>
          <style>{`@keyframes pulse { 0%,80%,100% { opacity:.3; transform:scale(.8); } 40% { opacity:1; transform:scale(1); } }`}</style>
        </>
      )}
    </div>
  );
};

export default HomePage;
