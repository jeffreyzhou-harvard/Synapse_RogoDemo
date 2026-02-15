import React, { useState } from 'react';

export interface Citation {
  title: string;
  finding: string;
  source: string;
  type: 'supporting' | 'contradicting' | 'complicating';
  relevance: 'high' | 'medium' | 'low';
}

export interface EvidenceResult {
  id: string;
  claim: string;
  verdict: string;
  sources: Citation[];
  nextSteps: string[];
  highlightedText: string;
  timestamp: Date;
}

export type CitationFormat = 'apa' | 'mla' | 'chicago';

// ── Format a citation string ────────────────────────────────────────
function formatCitation(src: Citation, format: CitationFormat): string {
  // Parse "Author(s), Year — Journal/Book/Field" pattern from source string
  const parts = src.source.split('—').map(s => s.trim());
  const authorYear = parts[0] || src.source;
  const venue = parts[1] || '';
  const yearMatch = authorYear.match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : 'n.d.';
  const authors = authorYear.replace(/,?\s*\d{4}/, '').trim();

  switch (format) {
    case 'apa':
      return `${authors} (${year}). ${src.title}. ${venue ? `*${venue}*.` : ''}`;
    case 'mla':
      return `${authors}. "${src.title}." ${venue ? `*${venue}*,` : ''} ${year}.`;
    case 'chicago':
      return `${authors}. "${src.title}." ${venue ? `${venue},` : ''} ${year}.`;
    default:
      return `${src.finding} (${src.source})`;
  }
}

function formatInlineCite(src: Citation, format: CitationFormat): string {
  const parts = src.source.split('—').map(s => s.trim());
  const authorYear = parts[0] || src.source;
  const yearMatch = authorYear.match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : 'n.d.';
  const authors = authorYear.replace(/,?\s*\d{4}/, '').trim();
  const lastNameMatch = authors.match(/^([A-Za-z'-]+)/);
  const lastName = lastNameMatch ? lastNameMatch[1] : authors.split(',')[0];

  switch (format) {
    case 'apa': return `(${lastName}, ${year})`;
    case 'mla': return `(${lastName})`;
    case 'chicago': return `(${lastName} ${year})`;
    default: return `(${lastName}, ${year})`;
  }
}

interface CitationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  results: EvidenceResult[];
  isLoading: boolean;
  loadingText?: string;
  onInsertCitation: (citation: Citation, format: CitationFormat) => void;
  onInsertAll: (result: EvidenceResult, format: CitationFormat) => void;
}

const TYPE_CONFIG = {
  supporting:    { label: 'Supporting',    color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', icon: '✓' },
  contradicting: { label: 'Contradicting', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: '✗' },
  complicating:  { label: 'Complicating',  color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '~' },
};

const VERDICT_CONFIG: Record<string, { color: string; bg: string }> = {
  'well-supported': { color: '#059669', bg: '#ecfdf5' },
  'debated':        { color: '#d97706', bg: '#fffbeb' },
  'mixed':          { color: '#d97706', bg: '#fffbeb' },
  'weak':           { color: '#dc2626', bg: '#fef2f2' },
  'unsupported':    { color: '#dc2626', bg: '#fef2f2' },
};

const FORMAT_OPTIONS: { id: CitationFormat; label: string }[] = [
  { id: 'apa', label: 'APA' },
  { id: 'mla', label: 'MLA' },
  { id: 'chicago', label: 'Chicago' },
];

const CitationsPanel: React.FC<CitationsPanelProps> = ({
  isOpen, onClose, results, isLoading, loadingText, onInsertCitation, onInsertAll,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [citationFormat, setCitationFormat] = useState<CitationFormat>('apa');

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const totalSources = results.reduce((n, r) => n + r.sources.length, 0);

  return (
    <>
      <style>{`
        @keyframes citeFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes dotPulse { 0%,80%,100% { opacity:.3; transform:scale(.8); } 40% { opacity:1; transform:scale(1); } }
      `}</style>
      <div style={{
        position: 'fixed', left: 0, top: 0, width: '340px', height: '100vh',
        backgroundColor: '#fff', borderRight: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column', zIndex: 200,
        boxShadow: '4px 0 20px rgba(0,0,0,0.04)',
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        {/* Header */}
        <div style={{ borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>🔍</span>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a202c' }}>Sources</div>
                <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                  {totalSources} source{totalSources !== 1 ? 's' : ''} found
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{
              width: '28px', height: '28px', border: 'none', backgroundColor: 'transparent',
              borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#9ca3af', fontSize: '18px',
            }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >×</button>
          </div>

          {/* Format selector — compact pill row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 16px 10px' }}>
            <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500, flexShrink: 0 }}>Format:</span>
            <div style={{ display: 'flex', gap: '2px', backgroundColor: '#f3f4f6', borderRadius: '6px', padding: '2px' }}>
              {FORMAT_OPTIONS.map(opt => (
                <button key={opt.id} onClick={() => setCitationFormat(opt.id)}
                  style={{
                    fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '4px',
                    border: 'none', cursor: 'pointer', transition: 'all 0.12s',
                    backgroundColor: citationFormat === opt.id ? '#fff' : 'transparent',
                    color: citationFormat === opt.id ? '#1a202c' : '#9ca3af',
                    boxShadow: citationFormat === opt.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}
                >{opt.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
          {isLoading && (
            <div style={{ padding: '24px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: '#6b7280' }}>{loadingText || 'Finding sources'}</span>
              {[0,1,2].map(i => (
                <div key={i} style={{
                  width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#4299e1',
                  animation: `dotPulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          )}

          {!isLoading && results.length === 0 && (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', marginBottom: '10px', opacity: 0.5 }}>🔍</div>
              <div style={{ fontSize: '14px', fontWeight: 500, color: '#6b7280', marginBottom: '6px' }}>No sources yet</div>
              <div style={{ fontSize: '12px', color: '#9ca3af', lineHeight: 1.5 }}>
                Select text in your document and click <strong>Evidence</strong> to find supporting and contradicting sources.
              </div>
            </div>
          )}

          {results.map((result) => {
            const isExpanded = expandedId === result.id || results.length === 1;
            const verdictStyle = VERDICT_CONFIG[result.verdict] || VERDICT_CONFIG['mixed'];
            const supporting = result.sources.filter(s => s.type === 'supporting');
            const contradicting = result.sources.filter(s => s.type === 'contradicting' || s.type === 'complicating');

            return (
              <div key={result.id} style={{ borderBottom: '1px solid #f5f5f5', animation: 'citeFadeIn 0.2s ease-out' }}>
                {/* Claim header */}
                <div onClick={() => setExpandedId(isExpanded ? null : result.id)}
                  style={{ padding: '12px 16px', cursor: 'pointer', transition: 'background-color 0.1s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#fafafa'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{
                      fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px',
                      color: verdictStyle.color, backgroundColor: verdictStyle.bg,
                    }}>{result.verdict}</span>
                    <span style={{ fontSize: '11px', color: '#c4c4c4' }}>{result.sources.length} sources</span>
                    <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#c4c4c4', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▾</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: '#1a202c', lineHeight: 1.4 }}>{result.claim}</div>
                  <div style={{ fontSize: '11px', color: '#c4c4c4', marginTop: '4px' }}>
                    on: "{result.highlightedText.slice(0, 60)}{result.highlightedText.length > 60 ? '...' : ''}"
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 16px 14px' }}>
                    {/* Summary pills */}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      {supporting.length > 0 && (
                        <span style={{ fontSize: '11px', color: '#059669', backgroundColor: '#ecfdf5', padding: '2px 8px', borderRadius: '4px', fontWeight: 500 }}>
                          {supporting.length} supporting
                        </span>
                      )}
                      {contradicting.length > 0 && (
                        <span style={{ fontSize: '11px', color: '#dc2626', backgroundColor: '#fef2f2', padding: '2px 8px', borderRadius: '4px', fontWeight: 500 }}>
                          {contradicting.length} contradicting
                        </span>
                      )}
                    </div>

                    {/* Citation cards */}
                    {result.sources.map((src, idx) => {
                      const cfg = TYPE_CONFIG[src.type] || TYPE_CONFIG.complicating;
                      const citeId = `${result.id}-${idx}`;
                      const formattedRef = formatCitation(src, citationFormat);
                      const inlineCite = formatInlineCite(src, citationFormat);

                      return (
                        <div key={idx} style={{
                          marginBottom: '8px', borderRadius: '8px', border: `1px solid ${cfg.border}`,
                          backgroundColor: '#fff', overflow: 'hidden',
                          animation: `citeFadeIn 0.15s ease-out ${idx * 0.05}s both`,
                        }}>
                          <div style={{ height: '3px', backgroundColor: cfg.color }} />
                          <div style={{ padding: '10px 12px' }}>
                            {/* Title + badge */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', marginBottom: '6px' }}>
                              <span style={{
                                fontSize: '10px', fontWeight: 700, color: cfg.color,
                                backgroundColor: cfg.bg, padding: '1px 6px', borderRadius: '3px',
                                flexShrink: 0, marginTop: '2px',
                              }}>{cfg.icon} {cfg.label}</span>
                              <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a202c', lineHeight: 1.3 }}>{src.title}</span>
                            </div>
                            {/* Finding */}
                            <div style={{ fontSize: '12px', color: '#4a5568', lineHeight: 1.5, marginBottom: '8px' }}>{src.finding}</div>
                            {/* Formatted citation */}
                            <div style={{
                              fontSize: '11px', color: '#6b7280', lineHeight: 1.4, marginBottom: '8px',
                              padding: '6px 8px', backgroundColor: '#f9fafb', borderRadius: '4px',
                              borderLeft: '2px solid #d1d5db', fontFamily: "'Georgia', serif",
                            }}>
                              {formattedRef}
                            </div>
                            {/* Actions */}
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              <button onClick={() => onInsertCitation(src, citationFormat)}
                                title={`Insert finding + ${citationFormat.toUpperCase()} inline citation`}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '4px',
                                  fontSize: '11px', padding: '4px 8px', border: '1px solid #e5e7eb',
                                  borderRadius: '5px', backgroundColor: '#fff', color: '#374151',
                                  cursor: 'pointer', fontWeight: 500, transition: 'all 0.12s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
                              >+ Cite</button>
                              <button onClick={() => handleCopy(formattedRef, citeId + '-ref')}
                                title={`Copy ${citationFormat.toUpperCase()} reference`}
                                style={{
                                  fontSize: '11px', padding: '4px 8px', border: '1px solid #e5e7eb',
                                  borderRadius: '5px', backgroundColor: '#fff', color: '#374151',
                                  cursor: 'pointer', fontWeight: 500, transition: 'all 0.12s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
                              >{copiedId === citeId + '-ref' ? '✓' : `Copy ${citationFormat.toUpperCase()}`}</button>
                              <button onClick={() => handleCopy(inlineCite, citeId + '-inline')}
                                title="Copy inline citation"
                                style={{
                                  fontSize: '11px', padding: '4px 8px', border: '1px solid #e5e7eb',
                                  borderRadius: '5px', backgroundColor: '#fff', color: '#9ca3af',
                                  cursor: 'pointer', fontWeight: 500, transition: 'all 0.12s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; e.currentTarget.style.color = '#374151'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.color = '#9ca3af'; }}
                              >{copiedId === citeId + '-inline' ? '✓' : inlineCite}</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Next steps */}
                    {result.nextSteps.length > 0 && (
                      <div style={{ marginTop: '10px', padding: '8px 10px', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #f0f0f0' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Dig deeper</div>
                        {result.nextSteps.map((step, i) => (
                          <div key={i} style={{ fontSize: '12px', color: '#4a5568', lineHeight: 1.4, paddingLeft: '10px', position: 'relative', marginBottom: '2px' }}>
                            <span style={{ position: 'absolute', left: 0, color: '#4299e1' }}>→</span>
                            {step}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Insert all */}
                    <button onClick={() => onInsertAll(result, citationFormat)}
                      style={{
                        width: '100%', marginTop: '10px', padding: '8px',
                        border: '1px solid #e5e7eb', borderRadius: '6px', backgroundColor: '#fff',
                        fontSize: '12px', fontWeight: 500, color: '#374151', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
                    >
                      Insert all as {citationFormat.toUpperCase()} references
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

export default CitationsPanel;
