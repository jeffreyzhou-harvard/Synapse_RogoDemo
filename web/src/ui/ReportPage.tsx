import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

// ─── Types (shared with SynapsePage) ─────────────────────────────────────

interface SubClaim {
  id: string; text: string; type: string;
  verdict?: string; confidence?: string; summary?: string;
}

interface EvidenceItem {
  id: string; subclaim_id?: string; title: string; snippet: string;
  tier: string; source: string; year?: number; citations?: number;
  quality_score?: number; study_type?: string;
  supports_claim?: boolean | string; assessment?: string;
}

interface ProvenanceNode {
  id: string; source_type: string; source_name: string;
  text: string; date?: string; mutation_severity: string;
}

interface CorrectedClaim {
  original: string; corrected: string; steelmanned: string;
  one_sentence: string; caveats: string[];
}

interface ClaimData {
  id: string; original: string; normalized: string; type: string;
  status: string;
  verification?: {
    subclaims: SubClaim[];
    evidence: EvidenceItem[];
    overallVerdict?: { verdict: string; confidence: string; summary: string };
    provenanceNodes: ProvenanceNode[];
    provenanceEdges: { from: string; to: string }[];
    provenanceAnalysis?: string;
    correctedClaim?: CorrectedClaim;
    totalDurationMs?: number;
    totalSources?: number;
  };
}

interface Report {
  id: string; title: string; url?: string; source_type: string;
  claims: ClaimData[]; analyzed_at: string; created_at: string;
}

// ─── Constants ───────────────────────────────────────────────────────────

const VERDICT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  supported:           { bg: '#0a1a0a', text: '#4ade80', border: '#1a3a1a' },
  partially_supported: { bg: '#1a1500', text: '#fbbf24', border: '#3a3000' },
  exaggerated:         { bg: '#1a1000', text: '#fb923c', border: '#3a2000' },
  contradicted:        { bg: '#1a0a0a', text: '#f87171', border: '#3a1a1a' },
  unsupported:         { bg: '#111111', text: '#888888', border: '#222222' },
  mixed:               { bg: '#1a1500', text: '#fbbf24', border: '#3a3000' },
};

const MUTATION_COLORS: Record<string, string> = {
  none: '#4ade80', slight: '#fbbf24', significant: '#fb923c', severe: '#f87171',
};

// ─── Component ───────────────────────────────────────────────────────────

const ReportPage: React.FC = () => {
  const { reportId } = useParams<{ reportId: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedClaim, setExpandedClaim] = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) return;
    // Try localStorage first (works on Vercel where backend is stateless)
    const stored = localStorage.getItem(`synapse-report-${reportId}`);
    if (stored) {
      try {
        setReport(JSON.parse(stored));
        setLoading(false);
        return;
      } catch {}
    }
    // Fallback to backend API (works locally)
    fetch(`/api/reports/${reportId}`)
      .then(r => { if (!r.ok) throw new Error('Report not found'); return r.json(); })
      .then(data => { setReport(data); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [reportId]);

  // Scroll to claim anchor on load
  useEffect(() => {
    if (report && window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }
  }, [report]);

  if (loading) return (
    <div style={{ height: '100vh', backgroundColor: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: '24px', height: '24px', border: '2px solid #1a1a1a', borderTopColor: '#ffffff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <div style={{ fontSize: '13px', color: '#555555' }}>Loading report...</div>
      </div>
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (error || !report) return (
    <div style={{ height: '100vh', backgroundColor: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: '400px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.2 }}>🔍</div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#ffffff', marginBottom: '8px' }}>Report not found</div>
        <div style={{ fontSize: '13px', color: '#555555', marginBottom: '24px' }}>This verification report may have expired or doesn't exist.</div>
        <a href="/" style={{ padding: '8px 20px', borderRadius: '6px', backgroundColor: '#ffffff', color: '#000000', fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}>Verify your own content →</a>
      </div>
    </div>
  );

  // Compute summary
  const verdictCounts: Record<string, number> = {};
  let totalSources = 0;
  let totalDuration = 0;
  report.claims.forEach(c => {
    const v = c.verification?.overallVerdict?.verdict;
    if (v) verdictCounts[v] = (verdictCounts[v] || 0) + 1;
    totalSources += c.verification?.totalSources || 0;
    totalDuration += c.verification?.totalDurationMs || 0;
  });
  const totalClaims = report.claims.length;
  const supportedCount = verdictCounts['supported'] || 0;
  const mixedCount = (verdictCounts['partially_supported'] || 0) + (verdictCounts['mixed'] || 0) + (verdictCounts['exaggerated'] || 0);
  const unsupportedCount = (verdictCounts['unsupported'] || 0) + (verdictCounts['contradicted'] || 0);

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: '#000000', color: '#e0e0e0',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        ::selection { background: rgba(255,255,255,0.2); }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #222222; border-radius: 3px; }
      `}</style>

      {/* ═══ Header ═══════════════════════════════════════════════════════ */}
      <header style={{
        padding: '16px 32px', borderBottom: '1px solid #1a1a1a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
            <img src="/synapse-logo.svg" alt="Synapse" style={{ width: '24px', height: '24px', opacity: 0.9 }} />
            <div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.5px' }}>SYNAPSE</div>
              <div style={{ fontSize: '9px', fontWeight: 600, color: '#666666', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Verification Report</div>
            </div>
          </a>
        </div>
        <a href="/" style={{
          padding: '6px 14px', borderRadius: '6px', backgroundColor: '#ffffff', color: '#000000',
          fontSize: '11px', fontWeight: 700, textDecoration: 'none', transition: 'opacity 0.15s',
        }}>Verify your own →</a>
      </header>

      {/* ═══ Report Content ═══════════════════════════════════════════════ */}
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 24px' }}>

        {/* Source info */}
        <div style={{ marginBottom: '24px', animation: 'fadeIn 0.4s ease' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#ffffff', marginBottom: '8px', letterSpacing: '-0.5px', lineHeight: 1.3 }}>
            {report.title}
          </h1>
          {report.url && (
            <a href={report.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '12px', color: '#555555', textDecoration: 'underline', wordBreak: 'break-all' }}>
              {report.url}
            </a>
          )}
          <div style={{ fontSize: '11px', color: '#444444', marginTop: '6px' }}>
            Analyzed {report.analyzed_at || report.created_at}
          </div>
        </div>

        {/* Summary bar */}
        <div style={{
          padding: '16px 20px', borderRadius: '10px', border: '1px solid #1a1a1a',
          backgroundColor: '#0a0a0a', marginBottom: '24px', animation: 'fadeIn 0.5s ease',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff', marginBottom: '10px' }}>
            {totalClaims} claims extracted · {supportedCount} supported · {mixedCount} mixed · {unsupportedCount} unsupported
          </div>
          {/* Stacked bar */}
          <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', backgroundColor: '#1a1a1a' }}>
            {supportedCount > 0 && <div style={{ flex: supportedCount, backgroundColor: '#4ade80', transition: 'flex 0.5s' }} />}
            {mixedCount > 0 && <div style={{ flex: mixedCount, backgroundColor: '#fbbf24', transition: 'flex 0.5s' }} />}
            {unsupportedCount > 0 && <div style={{ flex: unsupportedCount, backgroundColor: '#f87171', transition: 'flex 0.5s' }} />}
          </div>
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '10px', color: '#555555' }}>
            {supportedCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4ade80' }} />Supported</span>}
            {mixedCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fbbf24' }} />Mixed/Exaggerated</span>}
            {unsupportedCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f87171' }} />Unsupported</span>}
          </div>
        </div>

        {/* Claims */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {report.claims.map((claim, ci) => {
            const v = claim.verification;
            const vc = v?.overallVerdict ? (VERDICT_COLORS[v.overallVerdict.verdict] || VERDICT_COLORS.unsupported) : null;
            const isExpanded = expandedClaim === claim.id;

            return (
              <div key={claim.id} id={`claim-${ci + 1}`}
                style={{
                  borderRadius: '12px', border: `1px solid ${vc?.border || '#1a1a1a'}`,
                  backgroundColor: vc?.bg || '#0a0a0a', overflow: 'hidden',
                  animation: `slideIn 0.3s ease ${ci * 0.08}s both`,
                }}>
                {/* Claim header */}
                <div
                  onClick={() => setExpandedClaim(isExpanded ? null : claim.id)}
                  style={{ padding: '16px 20px', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '14px', color: '#ffffff', lineHeight: 1.5, fontWeight: 500, marginBottom: '6px' }}>
                        "{claim.original}"
                      </div>
                      {v?.overallVerdict && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: '11px', fontWeight: 800, padding: '3px 10px', borderRadius: '4px',
                            backgroundColor: vc?.bg, color: vc?.text, border: `1px solid ${vc?.border}`,
                            textTransform: 'uppercase', letterSpacing: '0.5px',
                          }}>
                            {v.overallVerdict.verdict.replace('_', ' ')}
                          </span>
                          <span style={{ fontSize: '10px', color: '#555555', fontWeight: 600, textTransform: 'uppercase' }}>
                            {v.overallVerdict.confidence}
                          </span>
                          <span style={{ fontSize: '12px', color: '#888888', flex: 1 }}>
                            {v.overallVerdict.summary}
                          </span>
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: '14px', color: '#333333', flexShrink: 0, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▼</span>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && v && (
                  <div style={{ borderTop: '1px solid #1a1a1a', padding: '16px 20px', animation: 'fadeIn 0.2s ease' }}>

                    {/* Sub-claims */}
                    {v.subclaims.length > 0 && (
                      <div style={{ marginBottom: '16px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Sub-Claims</div>
                        {v.subclaims.map(sc => {
                          const scVc = sc.verdict ? (VERDICT_COLORS[sc.verdict] || VERDICT_COLORS.unsupported) : null;
                          return (
                            <div key={sc.id} style={{
                              padding: '8px 10px', borderRadius: '6px', marginBottom: '4px',
                              borderLeft: `3px solid ${scVc?.text || '#333333'}`,
                              backgroundColor: '#080808',
                            }}>
                              <div style={{ fontSize: '12px', color: '#cccccc', lineHeight: 1.5 }}>{sc.text}</div>
                              {sc.verdict && <span style={{ fontSize: '9px', fontWeight: 700, color: scVc?.text, textTransform: 'uppercase' }}>{sc.verdict.replace('_', ' ')}</span>}
                              {sc.summary && <div style={{ fontSize: '11px', color: '#666666', marginTop: '4px' }}>{sc.summary}</div>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Evidence */}
                    {v.evidence.length > 0 && (
                      <div style={{ marginBottom: '16px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Evidence ({v.evidence.length} sources)</div>
                        {v.evidence.slice(0, 5).map(ev => (
                          <div key={ev.id} style={{
                            padding: '8px 10px', borderRadius: '6px', marginBottom: '4px',
                            border: '1px solid #1a1a1a', backgroundColor: '#080808',
                          }}>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: '#cccccc' }}>{ev.title}</div>
                            <div style={{ fontSize: '10px', color: '#666666', marginTop: '2px', lineHeight: 1.4 }}>
                              {ev.snippet?.slice(0, 150)}{(ev.snippet?.length || 0) > 150 ? '...' : ''}
                            </div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '9px', color: '#444444' }}>
                              <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{ev.tier}</span>
                              {ev.year && <span>{ev.year}</span>}
                              {ev.quality_score != null && <span>Q: {ev.quality_score}</span>}
                            </div>
                          </div>
                        ))}
                        {v.evidence.length > 5 && <div style={{ fontSize: '10px', color: '#444444', marginTop: '4px' }}>+{v.evidence.length - 5} more sources</div>}
                      </div>
                    )}

                    {/* Provenance */}
                    {v.provenanceNodes.length > 0 && (
                      <div style={{ marginBottom: '16px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Provenance Chain</div>
                        <div style={{ display: 'flex', gap: '0', overflowX: 'auto', paddingBottom: '8px' }}>
                          {v.provenanceNodes.map((node, ni, arr) => {
                            const mutColor = MUTATION_COLORS[node.mutation_severity] || '#888888';
                            return (
                              <React.Fragment key={node.id}>
                                <div style={{
                                  flexShrink: 0, width: '160px', padding: '10px',
                                  borderRadius: '8px', border: `1px solid ${mutColor}30`,
                                  backgroundColor: '#080808', position: 'relative',
                                }}>
                                  <div style={{
                                    position: 'absolute', top: '-4px', left: '50%', transform: 'translateX(-50%)',
                                    width: '8px', height: '8px', borderRadius: '50%',
                                    backgroundColor: mutColor, border: '2px solid #000000',
                                  }} />
                                  <div style={{ fontSize: '9px', fontWeight: 700, color: mutColor, textTransform: 'uppercase', marginBottom: '4px' }}>{node.source_type}</div>
                                  <div style={{ fontSize: '10px', color: '#888888', marginBottom: '3px' }}>{node.source_name}</div>
                                  <div style={{ fontSize: '10px', color: '#aaaaaa', fontStyle: 'italic', lineHeight: 1.4 }}>
                                    "{node.text.length > 80 ? node.text.slice(0, 80) + '...' : node.text}"
                                  </div>
                                </div>
                                {ni < arr.length - 1 && (
                                  <div style={{ flexShrink: 0, width: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333333', fontSize: '10px' }}>→</div>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>
                        {v.provenanceAnalysis && (
                          <div style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '6px', backgroundColor: '#080808', border: '1px solid #1a1a1a', fontSize: '11px', color: '#888888', lineHeight: 1.5 }}>
                            <span style={{ fontWeight: 700, color: '#ffffff' }}>Analysis: </span>{v.provenanceAnalysis}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Corrected claim */}
                    {v.correctedClaim && (
                      <div>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Corrected Claim</div>
                        <div style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #1a3a1a', backgroundColor: '#0a1a0a' }}>
                          <div style={{ fontSize: '13px', color: '#bbf7d0', lineHeight: 1.5 }}>{v.correctedClaim.corrected}</div>
                        </div>
                        {v.correctedClaim.one_sentence && (
                          <div style={{ marginTop: '6px', fontSize: '11px', color: '#888888', lineHeight: 1.5 }}>
                            <strong style={{ color: '#cccc88' }}>TL;DR:</strong> {v.correctedClaim.one_sentence}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ Footer ═══════════════════════════════════════════════════════ */}
      <footer style={{
        padding: '24px 32px', borderTop: '1px solid #111111', marginTop: '48px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#333333', marginBottom: '12px' }}>
          Powered by Synapse — Every claim, interrogated
        </div>
        <a href="/" style={{
          display: 'inline-block', padding: '8px 20px', borderRadius: '6px',
          backgroundColor: '#ffffff', color: '#000000', fontSize: '12px', fontWeight: 700,
          textDecoration: 'none', marginBottom: '16px',
        }}>Verify your own content →</a>
        <div style={{ fontSize: '9px', color: '#333333', marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          {[
            { label: 'Claude Sonnet', color: '#e8c8a0' },
            { label: 'Perplexity Sonar', color: '#6bccc8' },
            { label: 'Semantic Scholar', color: '#6b9bd2' },
          ].map(s => (
            <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: s.color, opacity: 0.6 }} />
              {s.label}
            </span>
          ))}
          {totalSources > 0 && <span>· {totalSources} sources</span>}
          {totalDuration > 0 && <span>· {(totalDuration / 1000).toFixed(0)}s</span>}
        </div>
      </footer>
    </div>
  );
};

export default ReportPage;
