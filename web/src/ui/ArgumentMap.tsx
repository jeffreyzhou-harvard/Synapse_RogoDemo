import React, { useMemo, useState } from 'react';
import { EvidenceResult, Citation } from './CitationsPanel';

// ── Types ────────────────────────────────────────────────────────────────────

interface ArgumentMapProps {
  isOpen: boolean;
  onClose: () => void;
  citationResults: EvidenceResult[];
}

type NodeType = 'claim' | 'supporting' | 'contradicting' | 'complicating';

interface MapNode {
  id: string;
  type: NodeType;
  label: string;
  detail: string;
  parentId?: string; // for sources, the claim they belong to
}

const TYPE_STYLES: Record<NodeType, { bg: string; border: string; color: string; accent: string; icon: string }> = {
  claim:          { bg: '#f0f4ff', border: '#93c5fd', color: '#1e3a5f', accent: '#3b82f6', icon: '💬' },
  supporting:     { bg: '#ecfdf5', border: '#6ee7b7', color: '#064e3b', accent: '#059669', icon: '✓' },
  contradicting:  { bg: '#fef2f2', border: '#fca5a5', color: '#7f1d1d', accent: '#dc2626', icon: '✗' },
  complicating:   { bg: '#fffbeb', border: '#fcd34d', color: '#78350f', accent: '#d97706', icon: '~' },
};

// ── Component ────────────────────────────────────────────────────────────────

const ArgumentMap: React.FC<ArgumentMapProps> = ({ isOpen, onClose, citationResults }) => {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<string | null>(null);

  const nodes = useMemo(() => {
    const result: MapNode[] = [];
    citationResults.forEach(r => {
      const claimId = r.id;
      result.push({
        id: claimId,
        type: 'claim',
        label: r.claim.length > 80 ? r.claim.slice(0, 80) + '...' : r.claim,
        detail: `Verdict: ${r.verdict} · ${r.sources.length} sources`,
      });
      r.sources.forEach((src, i) => {
        result.push({
          id: `${claimId}-s${i}`,
          type: src.type as NodeType,
          label: src.title,
          detail: src.finding.length > 100 ? src.finding.slice(0, 100) + '...' : src.finding,
          parentId: claimId,
        });
      });
    });
    return result;
  }, [citationResults]);

  const claims = nodes.filter(n => n.type === 'claim');
  const getChildren = (claimId: string) => nodes.filter(n => n.parentId === claimId);

  if (!isOpen) return null;

  // Summary stats
  const totalSources = nodes.filter(n => n.type !== 'claim').length;
  const supportingCount = nodes.filter(n => n.type === 'supporting').length;
  const contradictingCount = nodes.filter(n => n.type === 'contradicting').length;
  const complicatingCount = nodes.filter(n => n.type === 'complicating').length;

  return (
    <>
      <style>{`
        @keyframes mapFadeIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
        @keyframes mapSlideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(4px)', zIndex: 300,
          animation: 'mapFadeIn 0.2s ease',
        }}
      />
      {/* Modal */}
      <div style={{
        position: 'fixed', inset: '40px', zIndex: 301,
        backgroundColor: '#fff', borderRadius: '16px',
        boxShadow: '0 25px 80px rgba(0,0,0,0.2)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'mapFadeIn 0.25s ease',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 24px', borderBottom: '1px solid #f0f0f0', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>🗺️</span>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#1a202c' }}>Argument Map</div>
              <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                {claims.length} claim{claims.length !== 1 ? 's' : ''} · {totalSources} source{totalSources !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {supportingCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: '#059669' }} />
                <span style={{ color: '#6b7280' }}>{supportingCount} supporting</span>
              </div>
            )}
            {contradictingCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: '#dc2626' }} />
                <span style={{ color: '#6b7280' }}>{contradictingCount} contradicting</span>
              </div>
            )}
            {complicatingCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: '#d97706' }} />
                <span style={{ color: '#6b7280' }}>{complicatingCount} complicating</span>
              </div>
            )}
          </div>

          <button onClick={onClose} style={{
            width: '32px', height: '32px', border: 'none', backgroundColor: '#f3f4f6',
            borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#6b7280', fontSize: '18px', transition: 'all 0.12s',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e5e7eb'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '32px' }}>
          {claims.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 40px', color: '#9ca3af' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.4 }}>🗺️</div>
              <div style={{ fontSize: '16px', fontWeight: 500, color: '#6b7280', marginBottom: '8px' }}>No claims mapped yet</div>
              <div style={{ fontSize: '13px', lineHeight: 1.6, maxWidth: '360px', margin: '0 auto' }}>
                Select text in your document and use <strong>Find Evidence</strong> to build your argument map.
                Each claim and its supporting/contradicting sources will appear here.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
              {claims.map((claim, ci) => {
                const children = getChildren(claim.id);
                const supporting = children.filter(c => c.type === 'supporting');
                const contradicting = children.filter(c => c.type === 'contradicting');
                const complicating = children.filter(c => c.type === 'complicating');
                const isSelected = selectedClaim === claim.id;
                const result = citationResults.find(r => r.id === claim.id);
                const verdictColor = result?.verdict === 'well-supported' ? '#059669'
                  : result?.verdict === 'debated' || result?.verdict === 'mixed' ? '#d97706'
                  : result?.verdict === 'weak' || result?.verdict === 'unsupported' ? '#dc2626'
                  : '#6b7280';

                return (
                  <div key={claim.id} style={{ animation: `mapSlideIn 0.3s ease ${ci * 0.08}s both` }}>
                    {/* Claim node (center) */}
                    <div
                      onClick={() => setSelectedClaim(isSelected ? null : claim.id)}
                      onMouseEnter={() => setHoveredNode(claim.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                      style={{
                        maxWidth: '600px', margin: '0 auto', padding: '16px 20px',
                        backgroundColor: hoveredNode === claim.id ? '#eef2ff' : '#f8fafc',
                        border: `2px solid ${isSelected ? '#3b82f6' : '#e2e8f0'}`,
                        borderRadius: '12px', cursor: 'pointer',
                        transition: 'all 0.15s', position: 'relative',
                        boxShadow: isSelected ? '0 4px 20px rgba(59,130,246,0.12)' : '0 1px 4px rgba(0,0,0,0.04)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span style={{ fontSize: '14px' }}>💬</span>
                        <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#6b7280' }}>Claim</span>
                        {result && (
                          <span style={{
                            marginLeft: 'auto', fontSize: '11px', fontWeight: 600,
                            padding: '2px 8px', borderRadius: '4px',
                            color: verdictColor, backgroundColor: verdictColor + '15',
                          }}>{result.verdict}</span>
                        )}
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 500, color: '#1e293b', lineHeight: 1.5 }}>
                        {claim.label}
                      </div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                        {children.length} source{children.length !== 1 ? 's' : ''} · Click to {isSelected ? 'collapse' : 'expand'}
                      </div>
                    </div>

                    {/* Source branches */}
                    {(isSelected || claims.length <= 3) && children.length > 0 && (
                      <div style={{
                        display: 'flex', gap: '16px', marginTop: '16px', justifyContent: 'center', flexWrap: 'wrap',
                      }}>
                        {/* Left: Supporting */}
                        {supporting.length > 0 && (
                          <div style={{ flex: 1, minWidth: '200px', maxWidth: '280px' }}>
                            <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                              <div style={{ width: '2px', height: '16px', backgroundColor: '#059669', margin: '0 auto', opacity: 0.4 }} />
                            </div>
                            {supporting.map((src, i) => (
                              <SourceCard key={src.id} node={src} delay={i * 0.05} isHovered={hoveredNode === src.id}
                                onHover={() => setHoveredNode(src.id)} onLeave={() => setHoveredNode(null)} />
                            ))}
                          </div>
                        )}

                        {/* Center: Complicating */}
                        {complicating.length > 0 && (
                          <div style={{ flex: 1, minWidth: '200px', maxWidth: '280px' }}>
                            <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                              <div style={{ width: '2px', height: '16px', backgroundColor: '#d97706', margin: '0 auto', opacity: 0.4 }} />
                            </div>
                            {complicating.map((src, i) => (
                              <SourceCard key={src.id} node={src} delay={i * 0.05} isHovered={hoveredNode === src.id}
                                onHover={() => setHoveredNode(src.id)} onLeave={() => setHoveredNode(null)} />
                            ))}
                          </div>
                        )}

                        {/* Right: Contradicting */}
                        {contradicting.length > 0 && (
                          <div style={{ flex: 1, minWidth: '200px', maxWidth: '280px' }}>
                            <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                              <div style={{ width: '2px', height: '16px', backgroundColor: '#dc2626', margin: '0 auto', opacity: 0.4 }} />
                            </div>
                            {contradicting.map((src, i) => (
                              <SourceCard key={src.id} node={src} delay={i * 0.05} isHovered={hoveredNode === src.id}
                                onHover={() => setHoveredNode(src.id)} onLeave={() => setHoveredNode(null)} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

// ── Source Card ───────────────────────────────────────────────────────────────

const SourceCard: React.FC<{
  node: MapNode;
  delay: number;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
}> = ({ node, delay, isHovered, onHover, onLeave }) => {
  const style = TYPE_STYLES[node.type];
  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        padding: '10px 12px', marginBottom: '8px',
        backgroundColor: isHovered ? style.bg : '#fff',
        border: `1px solid ${isHovered ? style.border : '#e5e7eb'}`,
        borderRadius: '8px', borderLeft: `3px solid ${style.accent}`,
        transition: 'all 0.15s', cursor: 'default',
        animation: `mapSlideIn 0.2s ease ${delay}s both`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, color: style.accent,
          backgroundColor: style.bg, padding: '1px 6px', borderRadius: '3px',
        }}>{style.icon} {node.type}</span>
      </div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b', lineHeight: 1.4, marginBottom: '3px' }}>
        {node.label}
      </div>
      <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
        {node.detail}
      </div>
    </div>
  );
};

export default ArgumentMap;
