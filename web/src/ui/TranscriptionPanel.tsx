import React, { useState, useRef, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SuggestedSource {
  type: string;
  description: string;
  search_query: string;
}

export interface Claim {
  claim: string;
  speaker?: string;
  timestamp_context?: string;
  verifiability: 'high' | 'medium' | 'low';
  suggested_sources: SuggestedSource[];
  recommendation: string;
}

export interface TranscriptionResult {
  id: string;
  filename: string;
  transcript: string;
  duration?: number;
  confidence?: number;
  speakers?: { id: number; label: string }[];
  paragraphs?: string[];
  analysis?: string;
  claims?: Claim[];
  timestamp: Date;
}

interface TranscriptionPanelProps {
  isOpen: boolean;
  onClose: () => void;
  results: TranscriptionResult[];
  isLoading: boolean;
  loadingText: string;
  onInsertTranscript: (result: TranscriptionResult) => void;
  onInsertClaim: (claim: Claim) => void;
  onFindEvidence: (claim: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const verifiabilityColor: Record<string, { bg: string; fg: string; label: string }> = {
  high:   { bg: '#dcfce7', fg: '#166534', label: 'High' },
  medium: { bg: '#fef9c3', fg: '#854d0e', label: 'Medium' },
  low:    { bg: '#fee2e2', fg: '#991b1b', label: 'Low' },
};

// ── Component ────────────────────────────────────────────────────────────────

const TranscriptionPanel: React.FC<TranscriptionPanelProps> = ({
  isOpen,
  onClose,
  results,
  isLoading,
  loadingText,
  onInsertTranscript,
  onInsertClaim,
  onFindEvidence,
}) => {
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [expandedClaims, setExpandedClaims] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'claims' | 'transcript'>('claims');

  const toggleResult = (id: string) => {
    setExpandedResults(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleClaim = (id: string) => {
    setExpandedClaims(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '420px',
        height: '100vh',
        backgroundColor: '#fff',
        borderRight: '1px solid #e5e7eb',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s ease',
        boxShadow: isOpen ? '4px 0 24px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🎙️</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a202c' }}>
            Transcriptions
          </span>
          {results.length > 0 && (
            <span
              style={{
                fontSize: '11px',
                backgroundColor: '#dbeafe',
                color: '#1d4ed8',
                padding: '1px 6px',
                borderRadius: '8px',
              }}
            >
              {results.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontSize: '18px',
            color: '#9ca3af',
            padding: '2px 6px',
            borderRadius: '4px',
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        {/* Loading indicator */}
        {isLoading && (
          <div
            style={{
              padding: '16px',
              backgroundColor: '#f0f9ff',
              borderRadius: '8px',
              marginBottom: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <div
              style={{
                width: '18px',
                height: '18px',
                border: '2px solid #93c5fd',
                borderTop: '2px solid #3b82f6',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e40af' }}>
                Processing recording...
              </div>
              <div style={{ fontSize: '12px', color: '#3b82f6', marginTop: '2px' }}>
                {loadingText || 'Transcribing with Deepgram Nova-3'}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && results.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: '#9ca3af',
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎙️</div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#6b7280', marginBottom: '6px' }}>
              No transcriptions yet
            </div>
            <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
              Drag & drop a meeting recording (MP3, MP4, WAV, M4A, WebM) onto the editor to transcribe it and find citable claims.
            </div>
          </div>
        )}

        {/* Results */}
        {results.map((result) => {
          const isExpanded = expandedResults.has(result.id);
          return (
            <div
              key={result.id}
              style={{
                marginBottom: '12px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              {/* Result header */}
              <button
                onClick={() => toggleResult(result.id)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: '#fafafa',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '12px', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)' }}>▶</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a202c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {result.filename}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', gap: '8px', marginTop: '2px' }}>
                    {result.duration && <span>{formatDuration(result.duration)}</span>}
                    {result.confidence && <span>{(result.confidence * 100).toFixed(0)}% confidence</span>}
                    {result.claims && <span>{result.claims.length} claims found</span>}
                  </div>
                </div>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid #f0f0f0' }}>
                  {/* Tabs */}
                  <div style={{ display: 'flex', borderBottom: '1px solid #f0f0f0' }}>
                    <button
                      onClick={() => setActiveTab('claims')}
                      style={{
                        flex: 1,
                        padding: '8px',
                        border: 'none',
                        backgroundColor: activeTab === 'claims' ? '#fff' : '#fafafa',
                        borderBottom: activeTab === 'claims' ? '2px solid #3b82f6' : '2px solid transparent',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: activeTab === 'claims' ? '#1d4ed8' : '#9ca3af',
                        cursor: 'pointer',
                      }}
                    >
                      Claims & Citations {result.claims ? `(${result.claims.length})` : ''}
                    </button>
                    <button
                      onClick={() => setActiveTab('transcript')}
                      style={{
                        flex: 1,
                        padding: '8px',
                        border: 'none',
                        backgroundColor: activeTab === 'transcript' ? '#fff' : '#fafafa',
                        borderBottom: activeTab === 'transcript' ? '2px solid #3b82f6' : '2px solid transparent',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: activeTab === 'transcript' ? '#1d4ed8' : '#9ca3af',
                        cursor: 'pointer',
                      }}
                    >
                      Full Transcript
                    </button>
                  </div>

                  {/* Claims tab */}
                  {activeTab === 'claims' && (
                    <div style={{ padding: '10px 12px' }}>
                      {/* Analysis summary */}
                      {result.analysis && (
                        <div style={{ fontSize: '12px', color: '#4b5563', lineHeight: 1.5, marginBottom: '10px', padding: '8px', backgroundColor: '#f9fafb', borderRadius: '6px', borderLeft: '3px solid #3b82f6' }}>
                          {result.analysis}
                        </div>
                      )}

                      {result.claims && result.claims.length > 0 ? (
                        result.claims.map((claim, ci) => {
                          const claimId = `${result.id}-${ci}`;
                          const isClaimExpanded = expandedClaims.has(claimId);
                          const vColor = verifiabilityColor[claim.verifiability] || verifiabilityColor.medium;

                          return (
                            <div
                              key={ci}
                              style={{
                                marginBottom: '8px',
                                border: '1px solid #e5e7eb',
                                borderRadius: '6px',
                                overflow: 'hidden',
                              }}
                            >
                              {/* Claim header */}
                              <button
                                onClick={() => toggleClaim(claimId)}
                                style={{
                                  width: '100%',
                                  padding: '8px 10px',
                                  border: 'none',
                                  backgroundColor: '#fff',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  display: 'flex',
                                  gap: '6px',
                                  alignItems: 'flex-start',
                                }}
                              >
                                <span style={{ fontSize: '10px', marginTop: '3px', transition: 'transform 0.15s', transform: isClaimExpanded ? 'rotate(90deg)' : 'rotate(0)' }}>▶</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '12px', fontWeight: 500, color: '#1a202c', lineHeight: 1.4 }}>
                                    "{claim.claim}"
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                                    {claim.speaker && (
                                      <span style={{ fontSize: '10px', color: '#6b7280', backgroundColor: '#f3f4f6', padding: '1px 5px', borderRadius: '4px' }}>
                                        {claim.speaker}
                                      </span>
                                    )}
                                    <span
                                      style={{
                                        fontSize: '10px',
                                        padding: '1px 5px',
                                        borderRadius: '4px',
                                        backgroundColor: vColor.bg,
                                        color: vColor.fg,
                                        fontWeight: 600,
                                      }}
                                    >
                                      {vColor.label} verifiability
                                    </span>
                                  </div>
                                </div>
                              </button>

                              {/* Claim details */}
                              {isClaimExpanded && (
                                <div style={{ padding: '8px 10px 10px 26px', borderTop: '1px solid #f5f5f5', backgroundColor: '#fafafa' }}>
                                  {/* Recommendation */}
                                  {claim.recommendation && (
                                    <div style={{ fontSize: '12px', color: '#4b5563', lineHeight: 1.4, marginBottom: '8px' }}>
                                      💡 {claim.recommendation}
                                    </div>
                                  )}

                                  {/* Suggested sources */}
                                  {claim.suggested_sources.length > 0 && (
                                    <div style={{ marginBottom: '8px' }}>
                                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>
                                        Suggested sources:
                                      </div>
                                      {claim.suggested_sources.map((src, si) => (
                                        <div
                                          key={si}
                                          style={{
                                            fontSize: '11px',
                                            color: '#374151',
                                            padding: '4px 6px',
                                            backgroundColor: '#fff',
                                            borderRadius: '4px',
                                            border: '1px solid #e5e7eb',
                                            marginBottom: '3px',
                                            lineHeight: 1.4,
                                          }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ fontSize: '10px', color: '#9ca3af' }}>📚</span>
                                            <span style={{ fontWeight: 500 }}>{src.type}</span>
                                          </div>
                                          <div style={{ color: '#6b7280', marginTop: '2px' }}>{src.description}</div>
                                          {src.search_query && (
                                            <div style={{ color: '#3b82f6', marginTop: '2px', fontStyle: 'italic' }}>
                                              Search: "{src.search_query}"
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Action buttons */}
                                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                    <button
                                      onClick={() => onFindEvidence(claim.claim)}
                                      style={{
                                        fontSize: '11px',
                                        padding: '4px 8px',
                                        border: '1px solid #3b82f6',
                                        borderRadius: '4px',
                                        backgroundColor: '#eff6ff',
                                        color: '#1d4ed8',
                                        cursor: 'pointer',
                                        fontWeight: 500,
                                      }}
                                    >
                                      🔍 Find Evidence
                                    </button>
                                    <button
                                      onClick={() => onInsertClaim(claim)}
                                      style={{
                                        fontSize: '11px',
                                        padding: '4px 8px',
                                        border: '1px solid #e5e7eb',
                                        borderRadius: '4px',
                                        backgroundColor: '#fff',
                                        color: '#374151',
                                        cursor: 'pointer',
                                        fontWeight: 500,
                                      }}
                                    >
                                      + Add to doc
                                    </button>
                                    <button
                                      onClick={() => navigator.clipboard.writeText(claim.claim)}
                                      style={{
                                        fontSize: '11px',
                                        padding: '4px 8px',
                                        border: '1px solid #e5e7eb',
                                        borderRadius: '4px',
                                        backgroundColor: '#fff',
                                        color: '#374151',
                                        cursor: 'pointer',
                                        fontWeight: 500,
                                      }}
                                    >
                                      Copy
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center', padding: '16px' }}>
                          No verifiable claims were identified.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Transcript tab */}
                  {activeTab === 'transcript' && (
                    <div style={{ padding: '10px 12px' }}>
                      <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                        {result.paragraphs && result.paragraphs.length > 0 ? (
                          result.paragraphs.map((para, pi) => (
                            <div
                              key={pi}
                              style={{
                                fontSize: '12px',
                                color: '#374151',
                                lineHeight: 1.6,
                                marginBottom: '8px',
                                padding: '4px 0',
                                borderBottom: '1px solid #f5f5f5',
                              }}
                            >
                              {para}
                            </div>
                          ))
                        ) : (
                          <div style={{ fontSize: '12px', color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                            {result.transcript}
                          </div>
                        )}
                      </div>

                      {/* Insert transcript button */}
                      <button
                        onClick={() => onInsertTranscript(result)}
                        style={{
                          width: '100%',
                          marginTop: '8px',
                          padding: '8px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          backgroundColor: '#fafafa',
                          fontSize: '12px',
                          fontWeight: 500,
                          color: '#374151',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                        }}
                      >
                        📝 Insert full transcript into document
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TranscriptionPanel;
