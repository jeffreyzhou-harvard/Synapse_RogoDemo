import React, { useState, useRef, useCallback, useEffect } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ResearchDirection {
  title: string;
  description: string;
  agent_action: string;
  query: string;
}

export interface SourceMaterial {
  id: string;
  title: string;
  content: string;
  type: 'text' | 'pdf' | 'transcript';
  addedAt: Date;
  authors?: string;
  summary?: string;
  keyClaims?: string[];
  researchDirections?: ResearchDirection[];
  pageCount?: number;
}

// Synthesis types
export interface SynthesisTheme {
  title: string;
  description: string;
  sources: string[];
  agent_action: string;
  query: string;
}

export interface SynthesisResult {
  overview?: string;
  themes?: SynthesisTheme[];
  contradictions?: string[];
  knowledge_gaps?: string[];
  suggested_thesis?: string;
}

interface SourcePanelProps {
  isOpen: boolean;
  sources: SourceMaterial[];
  onAddSource: (source: Omit<SourceMaterial, 'id' | 'addedAt'>) => void;
  onRemoveSource: (id: string) => void;
  onSelectionChange: (text: string, sourceTitle: string) => void;
  onUploadPDF: (file: File) => void;
  onUploadAudio: (file: File) => void;
  onDelegateAgent: (action: string, query: string) => void;
  isLoadingPDF?: boolean;
  isLoadingTranscript?: boolean;
  loadingText?: string;
}

// ── Agent action metadata ────────────────────────────────────────────────────

const AGENT_META: Record<string, { icon: string; label: string; color: string; bg: string; border: string }> = {
  'deep-dive': { icon: '🔬', label: 'Deep Dive',          color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  evidence:  { icon: '🔍', label: 'Find Evidence',       color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  challenge: { icon: '⚔️', label: 'Challenge This',      color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
  connect:   { icon: '🔗', label: 'Find Connections',    color: '#c2410c', bg: '#fff7ed', border: '#fed7aa' },
  socratic:  { icon: '🤔', label: 'Go Deeper',           color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  steelman:  { icon: '💪', label: 'Strengthen Argument', color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  eli5:      { icon: '💡', label: 'Simplify',            color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
};

// ── Demo sample transcripts ──────────────────────────────────────────────────

const DEMO_LECTURE_TRANSCRIPT = `Speaker 0: Good morning everyone. Today we're continuing our discussion on neural networks, specifically focusing on the transformer architecture and why it's fundamentally changed how we approach sequence modeling.

Speaker 0: So last week we talked about recurrent neural networks and their limitations. The key problem with RNNs is the vanishing gradient problem — as sequences get longer, the gradients that flow backward through time become exponentially small, making it nearly impossible for the network to learn long-range dependencies.

Speaker 0: The transformer, introduced in the 2017 paper "Attention Is All You Need" by Vaswani et al., solved this by replacing recurrence entirely with a mechanism called self-attention. The core insight is elegant: instead of processing tokens sequentially, we let every token attend to every other token in parallel.

Speaker 0: Let me walk through the math briefly. Given an input sequence, we project each token into three vectors: a query, a key, and a value. The attention score between any two tokens is computed as the dot product of the query of one token with the key of another, scaled by the square root of the dimension. We then apply softmax to get attention weights and use those to compute a weighted sum of the values.

Speaker 0: What makes this so powerful is that the computational complexity is O(n²) with respect to sequence length, but it's highly parallelizable — unlike RNNs which are inherently sequential. This is why transformers can be trained on massive datasets using GPU clusters.

Speaker 0: Now, there's been interesting recent work challenging whether attention is truly all you need. State space models like Mamba have shown competitive performance with linear complexity. The question of whether quadratic attention is fundamentally necessary or just a convenient approximation is still open.

Speaker 0: For your research projects, I want you to think about this: if you're working with sequence data — whether that's text, audio, genomics, or time series — the choice of architecture has deep implications for what patterns your model can learn. Transformers excel at capturing long-range dependencies but struggle with very long sequences due to the quadratic cost. This is an active area of research.

Speaker 1: Professor, how does this relate to the scaling laws we discussed? Is there a point where making transformers bigger stops helping?

Speaker 0: Great question. The Chinchilla paper from DeepMind showed that most large language models were actually undertrained relative to their size. The optimal balance between model size and training data follows a specific power law. But there's growing evidence that we might be approaching the limits of what scaling alone can achieve — we need architectural innovations too.`;

const DEMO_INTERVIEW_TRANSCRIPT = `Speaker 0: Thank you for joining us, Professor Chen. Your recent paper on AI ethics in educational settings has generated a lot of discussion. Can you start by summarizing your main argument?

Speaker 1: Of course. The central thesis is that AI tools in education — things like automated tutoring, essay grading, and now large language models — are not neutral technologies. They embed specific pedagogical assumptions about what learning looks like, and those assumptions often privilege certain kinds of knowledge and certain kinds of students.

Speaker 0: Can you give a concrete example?

Speaker 1: Sure. Take automated essay scoring. These systems are typically trained on essays that received high scores from human graders. But research shows that human graders have systematic biases — they tend to reward longer essays, more complex vocabulary, and certain rhetorical structures that are more common in Western academic traditions. So the AI learns to replicate and even amplify those biases.

Speaker 1: We found in our study that essays written by non-native English speakers were scored 15-20% lower by AI systems compared to human graders who were specifically trained to evaluate content over form. That's a significant finding because many institutions are adopting these tools precisely because they're supposed to be more "objective."

Speaker 0: That's striking. What about AI tutoring systems? Are there similar concerns?

Speaker 1: Absolutely. Most AI tutoring systems use a model of learning that's essentially behaviorist — they break knowledge into discrete skills, test each skill, and provide feedback. This works well for procedural knowledge like math computation, but it's much less effective for developing critical thinking, creativity, or the kind of deep understanding that comes from struggling with ambiguity.

Speaker 1: There's also a surveillance dimension. These systems track every click, every pause, every wrong answer. Students report feeling watched and judged, which research in educational psychology tells us actually impairs learning. The irony is that the data collection meant to improve learning may be undermining it.

Speaker 0: So what's your recommendation? Should we stop using AI in education?

Speaker 1: No, not at all. AI has enormous potential in education. But we need to be intentional about how we deploy it. My recommendation is threefold: first, make the pedagogical assumptions of AI tools transparent and auditable. Second, ensure that AI augments rather than replaces human judgment in high-stakes decisions. And third, involve students as co-designers of these systems rather than just subjects of them.

Speaker 1: The most promising applications I've seen are tools that help students engage more deeply with material — not tools that try to replace the learning process itself. For example, systems that help students find connections between ideas, challenge their assumptions, or explore different perspectives on a topic.`;

// ── Research Direction Card ──────────────────────────────────────────────────

const DirectionCard: React.FC<{
  direction: ResearchDirection;
  onDelegate: (action: string, query: string) => void;
  delegatedActions: Set<string>;
}> = ({ direction, onDelegate, delegatedActions }) => {
  const [isHovered, setIsHovered] = useState(false);
  const meta = AGENT_META[direction.agent_action] || AGENT_META.evidence;
  const isDelegated = delegatedActions.has(direction.title);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        padding: '14px 16px', borderRadius: '10px',
        border: `1px solid ${isHovered ? meta.border : '#e5e7eb'}`,
        backgroundColor: isHovered ? meta.bg : '#fff',
        transition: 'all 0.15s', marginBottom: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <span style={{ fontSize: '18px', flexShrink: 0, marginTop: '1px' }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a202c', marginBottom: '4px', lineHeight: 1.4 }}>
            {direction.title}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.5, marginBottom: '10px' }}>
            {direction.description}
          </div>
          <button
            onClick={() => {
              if (!isDelegated) onDelegate(direction.agent_action, direction.query);
            }}
            disabled={isDelegated}
            style={{
              padding: '6px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '6px',
              border: 'none', cursor: isDelegated ? 'default' : 'pointer',
              backgroundColor: isDelegated ? '#f3f4f6' : meta.color,
              color: isDelegated ? '#9ca3af' : '#fff',
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '5px',
            }}
          >
            {isDelegated ? (
              <>✓ Delegated</>
            ) : (
              <>{meta.icon} {meta.label}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Selectable text block (for plain text / transcript sources) ──────────────

const TextBlock: React.FC<{ text: string }> = ({ text }) => {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        fontSize: '13.5px', lineHeight: 1.75, color: '#374151',
        fontFamily: "'Georgia', 'Times New Roman', serif",
        padding: '6px 12px', marginBottom: '4px', borderRadius: '6px',
        backgroundColor: isHovered ? '#f8f9fa' : 'transparent',
        borderLeft: isHovered ? '3px solid #d1d5db' : '3px solid transparent',
        transition: 'all 0.12s', userSelect: 'text', cursor: 'text',
      }}
    >
      {text}
    </div>
  );
};

// ── Source metadata bar ──────────────────────────────────────────────────────

const SourceMetaBar: React.FC<{ source: SourceMaterial; onRemove: () => void }> = ({ source, onRemove }) => {
  const typeLabel = source.type === 'pdf' ? 'PDF Document' : source.type === 'transcript' ? 'Transcript' : 'Text Source';
  const typeIcon = source.type === 'pdf' ? '📕' : source.type === 'transcript' ? '🎙️' : '📝';
  const wordCount = source.content.split(/\s+/).filter(Boolean).length;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px',
      backgroundColor: '#fff', borderBottom: '1px solid #f0f0f0', flexShrink: 0,
    }}>
      <span style={{ fontSize: '16px' }}>{typeIcon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a202c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {source.title}
        </div>
        <div style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{typeLabel}</span>
          <span style={{ color: '#e5e7eb' }}>·</span>
          <span>{wordCount.toLocaleString()} words</span>
          {source.pageCount ? (
            <>
              <span style={{ color: '#e5e7eb' }}>·</span>
              <span>{source.pageCount} pg</span>
            </>
          ) : null}
        </div>
      </div>
      <button
        onClick={onRemove}
        style={{ border: 'none', background: 'none', color: '#c4c4c4', cursor: 'pointer', fontSize: '16px', padding: '2px 6px', borderRadius: '4px' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#c4c4c4'; e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        ×
      </button>
    </div>
  );
};

// ── Main Component ───────────────────────────────────────────────────────────

const SourcePanel: React.FC<SourcePanelProps> = ({
  isOpen,
  sources,
  onAddSource,
  onRemoveSource,
  onSelectionChange,
  onUploadPDF,
  onUploadAudio,
  onDelegateAgent,
  isLoadingPDF,
  isLoadingTranscript,
  loadingText,
}) => {
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [pasteType, setPasteType] = useState<'text' | 'transcript'>('text');
  const [isDragOver, setIsDragOver] = useState(false);
  const [delegatedActions, setDelegatedActions] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceContentRef = useRef<HTMLDivElement>(null);

  // Auto-select latest source
  useEffect(() => {
    if (sources.length > 0 && (!activeSourceId || !sources.find(s => s.id === activeSourceId))) {
      setActiveSourceId(sources[sources.length - 1].id);
      setShowAddForm(false);
    }
  }, [sources, activeSourceId]);

  // Track text selection in source content
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim() && sourceContentRef.current?.contains(sel.anchorNode)) {
        const text = sel.toString().trim();
        const activeSource = sources.find(s => s.id === activeSourceId);
        onSelectionChange(text, activeSource?.title || 'Source');
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [activeSourceId, sources, onSelectionChange]);

  const activeSource = sources.find(s => s.id === activeSourceId);

  const handleDelegate = useCallback((action: string, query: string, dirTitle: string) => {
    onDelegateAgent(action, query);
    setDelegatedActions(prev => new Set(prev).add(dirTitle));
  }, [onDelegateAgent]);

  const handlePasteSubmit = useCallback(() => {
    if (!pasteContent.trim()) return;
    onAddSource({
      title: pasteTitle.trim() || (pasteType === 'transcript' ? 'Pasted Transcript' : 'Pasted Source'),
      content: pasteContent.trim(),
      type: pasteType,
    });
    setPasteTitle('');
    setPasteContent('');
    setShowAddForm(false);
  }, [pasteTitle, pasteContent, pasteType, onAddSource]);

  const handleFileUpload = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf' || file.type === 'application/pdf') {
      onUploadPDF(file);
    } else if (['mp3', 'wav', 'mp4', 'm4a', 'ogg', 'webm', 'mov', 'avi', 'flac', 'aac'].includes(ext) || file.type.startsWith('audio/') || file.type.startsWith('video/')) {
      onUploadAudio(file);
    } else if (ext === 'txt' || ext === 'md' || file.type.startsWith('text/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) onAddSource({ title: file.name, content: text, type: 'text' });
      };
      reader.readAsText(file);
    }
  }, [onAddSource, onUploadPDF, onUploadAudio]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const handleRemoveSource = useCallback((id: string) => {
    onRemoveSource(id);
    if (activeSourceId === id) {
      const remaining = sources.filter(s => s.id !== id);
      setActiveSourceId(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [activeSourceId, sources, onRemoveSource]);

  // ── Synthesis state ──
  const [synthesis, setSynthesis] = useState<SynthesisResult | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [showSynthesis, setShowSynthesis] = useState(false);

  const handleSynthesize = useCallback(async () => {
    if (sources.length < 2) return;
    setIsSynthesizing(true);
    setShowSynthesis(true);
    try {
      const resp = await fetch('/synthesize-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources: sources.map(s => ({ title: s.title, content: s.content })),
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setSynthesis(data);
      }
    } catch { /* non-fatal */ } finally {
      setIsSynthesizing(false);
    }
  }, [sources]);

  if (!isOpen) return null;

  const showEmptyState = sources.length === 0 && !showAddForm;
  const showSources = sources.length > 0 && !showAddForm && !showSynthesis;

  // Determine if a source has AI analysis (works for both PDF and transcript)
  const hasAIAnalysis = (source: SourceMaterial) => !!(source.summary || source.researchDirections?.length);

  // Unified AI analysis view — works for PDFs, transcripts, and text sources with analysis
  const renderAISource = (source: SourceMaterial) => {
    const typeLabel = source.type === 'pdf' ? 'What this paper says' : source.type === 'transcript' ? 'What was discussed' : 'Key points';
    return (
      <div style={{ padding: '16px 16px 80px' }}>
        {/* Title + Authors */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a202c', lineHeight: 1.3, fontFamily: "'Georgia', serif", marginBottom: '4px' }}>
            {source.title}
          </div>
          {source.authors && (
            <div style={{ fontSize: '13px', color: '#6b7280', fontStyle: 'italic' }}>
              {source.authors}
            </div>
          )}
          {source.type === 'transcript' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '6px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '11px', color: '#15803d', fontWeight: 500 }}>
              🎙️ Lecture / Meeting Recording
            </div>
          )}
        </div>

        {/* Summary card */}
        {source.summary && (
          <div style={{
            padding: '14px 16px', borderRadius: '10px', marginBottom: '16px',
            backgroundColor: '#f8fafc', border: '1px solid #e2e8f0',
          }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
              {typeLabel}
            </div>
            <div style={{ fontSize: '13.5px', lineHeight: 1.7, color: '#334155', fontFamily: "'Georgia', serif" }}>
              {source.summary}
            </div>
          </div>
        )}

        {/* Key claims */}
        {source.keyClaims && source.keyClaims.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', padding: '0 2px' }}>
              {source.type === 'transcript' ? 'Key claims & assertions' : 'Key claims you can cite'}
            </div>
            <div ref={sourceContentRef} data-source-content="true" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {source.keyClaims.map((claim, i) => (
                <ClaimBlock key={i} claim={claim} index={i + 1} />
              ))}
            </div>
          </div>
        )}

        {/* Research Directions */}
        {source.researchDirections && source.researchDirections.length > 0 && (
          <div>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', padding: '0 2px' }}>
              Where to go from here
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px', padding: '0 2px' }}>
              Delegate to an agent — they'll research while you think.
            </div>
            {source.researchDirections.map((dir, i) => (
              <DirectionCard
                key={i}
                direction={dir}
                onDelegate={(action, query) => handleDelegate(action, query, dir.title)}
                delegatedActions={delegatedActions}
              />
            ))}
          </div>
        )}

        {/* Fallback: raw text if no AI analysis */}
        {!source.summary && !source.researchDirections?.length && (
          <div ref={sourceContentRef} data-source-content="true">
            {source.content.split(/\n\n+/).filter(p => p.trim()).map((para, i) => (
              <TextBlock key={i} text={para.trim()} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderTextSource = (source: SourceMaterial) => (
    <div ref={sourceContentRef} data-source-content="true" style={{ padding: '16px 12px 80px' }}>
      {source.content.split(/\n\n+/).filter(p => p.trim()).map((para, i) => (
        <TextBlock key={i} text={para.trim()} />
      ))}
    </div>
  );

  // Render the cross-source synthesis view
  const renderSynthesisView = () => (
    <div style={{ padding: '16px 16px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a202c', lineHeight: 1.3 }}>
            Cross-Source Synthesis
          </div>
          <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
            {sources.length} sources analyzed together
          </div>
        </div>
        <button onClick={() => setShowSynthesis(false)}
          style={{ fontSize: '11px', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '4px 10px', backgroundColor: '#fff', cursor: 'pointer' }}
        >← Back to sources</button>
      </div>

      {isSynthesizing && (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ width: '20px', height: '20px', border: '2px solid #d1d5db', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <div style={{ fontSize: '13px', color: '#6b7280' }}>Finding connections across your sources...</div>
        </div>
      )}

      {synthesis && !isSynthesizing && (
        <>
          {/* Overview */}
          {synthesis.overview && (
            <div style={{
              padding: '14px 16px', borderRadius: '10px', marginBottom: '16px',
              backgroundColor: '#f0f9ff', border: '1px solid #bae6fd',
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                The big picture
              </div>
              <div style={{ fontSize: '13.5px', lineHeight: 1.7, color: '#0c4a6e', fontFamily: "'Georgia', serif" }}>
                {synthesis.overview}
              </div>
            </div>
          )}

          {/* Suggested thesis */}
          {synthesis.suggested_thesis && (
            <div style={{
              padding: '12px 16px', borderRadius: '10px', marginBottom: '16px',
              backgroundColor: '#faf5ff', border: '1px solid #e9d5ff',
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                💡 Potential thesis
              </div>
              <div style={{ fontSize: '13.5px', lineHeight: 1.7, color: '#581c87', fontFamily: "'Georgia', serif", fontStyle: 'italic' }}>
                {synthesis.suggested_thesis}
              </div>
            </div>
          )}

          {/* Themes */}
          {synthesis.themes && synthesis.themes.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                Cross-cutting themes
              </div>
              {synthesis.themes.map((theme, i) => {
                const meta = AGENT_META[theme.agent_action] || AGENT_META.evidence;
                return (
                  <div key={i} style={{
                    padding: '14px 16px', borderRadius: '10px', marginBottom: '8px',
                    border: '1px solid #e5e7eb', backgroundColor: '#fff',
                  }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a202c', marginBottom: '4px' }}>
                      {theme.title}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.5, marginBottom: '6px' }}>
                      {theme.description}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
                      {theme.sources.map((src, j) => (
                        <span key={j} style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#f3f4f6', color: '#6b7280' }}>
                          {src}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        onDelegateAgent(theme.agent_action, theme.query);
                      }}
                      style={{
                        padding: '5px 12px', fontSize: '11px', fontWeight: 600, borderRadius: '6px',
                        border: 'none', cursor: 'pointer', backgroundColor: meta.color, color: '#fff',
                        display: 'flex', alignItems: 'center', gap: '4px',
                      }}
                    >
                      {meta.icon} {meta.label}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Contradictions */}
          {synthesis.contradictions && synthesis.contradictions.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                ⚡ Tensions & contradictions
              </div>
              {synthesis.contradictions.map((c, i) => (
                <div key={i} style={{
                  padding: '10px 12px', borderRadius: '8px', marginBottom: '6px',
                  border: '1px solid #fecaca', backgroundColor: '#fef2f2',
                  fontSize: '13px', lineHeight: 1.6, color: '#991b1b',
                }}>
                  {c}
                </div>
              ))}
            </div>
          )}

          {/* Knowledge gaps */}
          {synthesis.knowledge_gaps && synthesis.knowledge_gaps.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                🔍 Knowledge gaps to investigate
              </div>
              {synthesis.knowledge_gaps.map((g, i) => (
                <div key={i} style={{
                  padding: '10px 12px', borderRadius: '8px', marginBottom: '6px',
                  border: '1px solid #fed7aa', backgroundColor: '#fffbeb',
                  fontSize: '13px', lineHeight: 1.6, color: '#92400e',
                }}>
                  {g}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        backgroundColor: '#fafafa', overflow: 'hidden', position: 'relative',
      }}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          backgroundColor: 'rgba(99, 102, 241, 0.06)',
          border: '2px dashed #6366f1', borderRadius: '8px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '28px', marginBottom: '6px' }}>📎</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#4338ca' }}>Drop to add source</div>
          </div>
        </div>
      )}

      {/* Source tabs bar */}
      {sources.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '2px', padding: '6px 10px',
          backgroundColor: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0,
          overflowX: 'auto',
        }}>
          {sources.map(s => (
            <button key={s.id} onClick={() => { setActiveSourceId(s.id); setShowAddForm(false); setShowSynthesis(false); }}
              style={{
                padding: '5px 10px', fontSize: '11px', fontWeight: 500, borderRadius: '5px',
                border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.12s',
                backgroundColor: activeSourceId === s.id && !showAddForm ? '#4a5568' : 'transparent',
                color: activeSourceId === s.id && !showAddForm ? '#fff' : '#6b7280',
              }}
              onMouseEnter={(e) => { if (activeSourceId !== s.id || showAddForm) e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
              onMouseLeave={(e) => { if (activeSourceId !== s.id || showAddForm) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span style={{ fontSize: '12px' }}>{s.type === 'pdf' ? '📕' : s.type === 'transcript' ? '🎙️' : '📝'}</span>
              {s.title.length > 20 ? s.title.slice(0, 20) + '…' : s.title}
            </button>
          ))}
          <button
            onClick={() => { setShowAddForm(true); setShowSynthesis(false); }}
            style={{
              padding: '5px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '5px',
              border: 'none', cursor: 'pointer', color: showAddForm ? '#4338ca' : '#9ca3af',
              backgroundColor: showAddForm ? '#eff6ff' : 'transparent',
              transition: 'all 0.12s', whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { if (!showAddForm) e.currentTarget.style.color = '#6b7280'; }}
            onMouseLeave={(e) => { if (!showAddForm) e.currentTarget.style.color = '#9ca3af'; }}
          >
            + Add
          </button>
          {/* Synthesize button — appears when 2+ sources */}
          {sources.length >= 2 && (
            <>
              <div style={{ width: '1px', height: '16px', backgroundColor: '#e5e7eb', margin: '0 4px', flexShrink: 0 }} />
              <button
                onClick={handleSynthesize}
                style={{
                  padding: '5px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '5px',
                  border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  display: 'flex', alignItems: 'center', gap: '4px',
                  color: showSynthesis ? '#fff' : '#7c3aed',
                  backgroundColor: showSynthesis ? '#7c3aed' : '#f5f3ff',
                  transition: 'all 0.12s',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                Synthesize
              </button>
            </>
          )}
        </div>
      )}

      {/* Loading indicator */}
      {(isLoadingPDF || isLoadingTranscript) && (
        <div style={{
          padding: '10px 16px', backgroundColor: '#eff6ff', borderBottom: '1px solid #dbeafe',
          fontSize: '12px', color: '#3b82f6', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px',
          flexShrink: 0,
        }}>
          <div style={{ width: '14px', height: '14px', border: '2px solid #93c5fd', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          {loadingText || 'Processing...'}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Empty state */}
        {showEmptyState && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '14px', backgroundColor: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
              Your evidence goes here
            </div>
            <div style={{ fontSize: '13px', color: '#9ca3af', lineHeight: 1.6, maxWidth: '260px', marginBottom: '20px' }}>
              Upload a PDF, paste a transcript, or add notes. AI agents will analyze it and suggest research directions.
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: '8px 16px', fontSize: '13px', fontWeight: 600, borderRadius: '8px',
                  border: 'none', backgroundColor: '#4a5568', color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                📎 Upload file
              </button>
              <button
                onClick={() => setShowAddForm(true)}
                style={{
                  padding: '8px 16px', fontSize: '13px', fontWeight: 500, borderRadius: '8px',
                  border: '1px solid #d1d5db', backgroundColor: '#fff', color: '#374151', cursor: 'pointer',
                }}
              >
                Paste text
              </button>
            </div>
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #f0f0f0', width: '100%', maxWidth: '300px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                Try the demo
              </div>
              <button
                onClick={() => {
                  onAddSource({
                    title: 'CS 229 — Lecture on Neural Networks',
                    type: 'transcript',
                    content: DEMO_LECTURE_TRANSCRIPT,
                  });
                  setTimeout(() => {
                    onAddSource({
                      title: 'Interview: Prof. Chen on AI Ethics',
                      type: 'transcript',
                      content: DEMO_INTERVIEW_TRANSCRIPT,
                    });
                  }, 500);
                }}
                style={{
                  width: '100%', padding: '10px 14px', fontSize: '12px', fontWeight: 500, borderRadius: '8px',
                  border: '1px solid #e9d5ff', backgroundColor: '#faf5ff', color: '#7c3aed', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3e8ff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#faf5ff'; }}
              >
                <span style={{ fontSize: '16px' }}>🎓</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600 }}>Load sample lecture + interview</div>
                  <div style={{ fontSize: '11px', color: '#a78bfa', marginTop: '1px' }}>See the post-lecture workflow in action</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Add source form */}
        {showAddForm && (
          <div style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a202c' }}>Add Source</span>
              {sources.length > 0 && (
                <button onClick={() => setShowAddForm(false)}
                  style={{ fontSize: '11px', color: '#9ca3af', border: 'none', background: 'none', cursor: 'pointer' }}
                >Cancel</button>
              )}
            </div>
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: '20px', borderRadius: '10px', textAlign: 'center', cursor: 'pointer',
                border: '2px dashed #d1d5db', backgroundColor: '#fff',
                transition: 'all 0.15s', marginBottom: '16px',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#9ca3af'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#d1d5db'; }}
            >
              <div style={{ fontSize: '20px', marginBottom: '6px' }}>📎</div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '2px' }}>Click to upload</div>
              <div style={{ fontSize: '11px', color: '#9ca3af' }}>PDF, TXT, or audio/video</div>
            </div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', textAlign: 'center' }}>
              or paste content
            </div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              {(['text', 'transcript'] as const).map(t => (
                <button key={t} onClick={() => setPasteType(t)}
                  style={{
                    flex: 1, padding: '6px 12px', fontSize: '11px', fontWeight: 500, borderRadius: '6px',
                    border: '1px solid', cursor: 'pointer', transition: 'all 0.12s',
                    borderColor: pasteType === t ? '#4a5568' : '#e5e7eb',
                    backgroundColor: pasteType === t ? '#4a5568' : '#fff',
                    color: pasteType === t ? '#fff' : '#6b7280',
                  }}
                >
                  {t === 'text' ? '📝 Notes / Article' : '🎙️ Transcript'}
                </button>
              ))}
            </div>
            <input type="text" placeholder="Source title (optional)" value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '6px', marginBottom: '6px', outline: 'none', boxSizing: 'border-box' }}
            />
            <textarea
              placeholder={pasteType === 'transcript' ? 'Paste interview transcript here...' : 'Paste article, notes, or source text here...'}
              value={pasteContent} onChange={(e) => setPasteContent(e.target.value)}
              style={{ width: '100%', minHeight: '140px', padding: '10px', fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '6px', resize: 'vertical', outline: 'none', lineHeight: 1.6, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            <button onClick={handlePasteSubmit} disabled={!pasteContent.trim()}
              style={{
                marginTop: '8px', width: '100%', padding: '8px', fontSize: '13px', fontWeight: 600,
                borderRadius: '6px', border: 'none', cursor: pasteContent.trim() ? 'pointer' : 'default',
                backgroundColor: pasteContent.trim() ? '#4a5568' : '#e5e7eb',
                color: pasteContent.trim() ? '#fff' : '#9ca3af', transition: 'all 0.15s',
              }}
            >
              Add Source
            </button>
          </div>
        )}

        {/* Synthesis view */}
        {showSynthesis && renderSynthesisView()}

        {/* Active source view */}
        {showSources && activeSource && (
          <div>
            <SourceMetaBar source={activeSource} onRemove={() => handleRemoveSource(activeSource.id)} />
            {hasAIAnalysis(activeSource) ? renderAISource(activeSource) : renderTextSource(activeSource)}
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md,audio/*,video/*,.mp3,.wav,.mp4,.m4a,.webm"
        style={{ display: 'none' }}
        onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileUpload(file); e.target.value = ''; }}
      />
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// ── Claim block (selectable, highlightable) ──────────────────────────────────

const ClaimBlock: React.FC<{ claim: string; index: number }> = ({ claim, index }) => {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        padding: '10px 12px', borderRadius: '8px', userSelect: 'text', cursor: 'text',
        border: `1px solid ${isHovered ? '#c7d2fe' : '#e5e7eb'}`,
        backgroundColor: isHovered ? '#f8f9ff' : '#fff',
        borderLeft: `3px solid ${isHovered ? '#6366f1' : '#d1d5db'}`,
        transition: 'all 0.12s', display: 'flex', gap: '8px', alignItems: 'flex-start',
      }}
    >
      <span style={{ fontSize: '11px', fontWeight: 700, color: '#6366f1', flexShrink: 0, marginTop: '2px' }}>
        {index}
      </span>
      <span style={{ fontSize: '13px', lineHeight: 1.6, color: '#374151', fontFamily: "'Georgia', serif" }}>
        {claim}
      </span>
    </div>
  );
};

export default SourcePanel;
