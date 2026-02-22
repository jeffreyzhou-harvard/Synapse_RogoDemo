import React from 'react';
import type {
  ExtractedClaim, VerificationState, AgentChip,
} from './types';
import {
  VERDICT_COLORS, TIER_LABELS, MUTATION_COLORS,
  STEP_ICONS, AGENT_COLORS,
} from './constants';

type TabId = 'subclaims' | 'evidence' | 'contradictions' | 'consistency' | 'plausibility' | 'provenance' | 'correction' | 'risk_signals';

interface PipelineStats {
  steps: number;
  apiCalls: number;
  services: Set<string>;
  sources: number;
  durationMs: number;
}

interface ReasoningMessage {
  agent: string;
  stage: string;
  message: string;
  detail: string;
  ts: number;
}

interface VerificationDetailProps {
  selectedClaim: ExtractedClaim | null;
  v: VerificationState | undefined;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  expandedEvidenceId: string | null;
  setExpandedEvidenceId: (id: string | null) => void;
  verdictExpanded: boolean;
  setVerdictExpanded: (v: boolean) => void;
  reasoningCollapsed: boolean;
  setReasoningCollapsed: (v: boolean) => void;
  agentChips: AgentChip[];
  pipelineStats: PipelineStats;
  reasoningMessages: ReasoningMessage[];
  reasoningRef: React.RefObject<HTMLDivElement>;
  hasClaims: boolean;
  isIngesting: boolean;
  isExtracting: boolean;
}

/* ═══ Empty / Loading States ════════════════════════════════════════════ */

const EmptyState: React.FC<{ hasClaims: boolean; isIngesting: boolean; isExtracting: boolean }> = ({
  hasClaims, isIngesting, isExtracting,
}) => {
  if (isIngesting) {
    return (
      <div className="syn-empty-state">
        <div className="syn-spinner" style={{ width: '28px', height: '28px', marginBottom: '16px' }} />
        <div style={{ fontSize: '14px', color: '#fff', fontWeight: 600, marginBottom: '6px' }}>Fetching & analyzing content...</div>
        <div style={{ fontSize: '12px', color: '#555', maxWidth: '340px', lineHeight: 1.6 }}>
          Extracting main content, identifying claim-dense passages, and preparing for verification.
        </div>
      </div>
    );
  }
  if (isExtracting) {
    return (
      <div className="syn-empty-state">
        <div className="syn-spinner" style={{ width: '28px', height: '28px', marginBottom: '16px' }} />
        <div style={{ fontSize: '14px', color: '#fff', fontWeight: 600, marginBottom: '6px' }}>Extracting verifiable claims...</div>
        <div style={{ fontSize: '12px', color: '#555', maxWidth: '340px', lineHeight: 1.6 }}>
          Chunking document, scoring passages, and identifying discrete factual assertions.
        </div>
        {/* Skeleton cards */}
        <div style={{ marginTop: '24px', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[0.9, 0.7, 0.5].map((opacity, i) => (
            <div key={i} style={{ opacity, display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div className="syn-skeleton" style={{ width: '40px', height: '12px' }} />
              <div className="syn-skeleton" style={{ flex: 1, height: '12px' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (hasClaims) {
    return (
      <div className="syn-empty-state">
        <div style={{ fontSize: '32px', marginBottom: '16px', opacity: 0.3 }}>←</div>
        <div style={{ fontSize: '14px', color: '#666', fontWeight: 500, marginBottom: '6px' }}>
          Select a claim to view verification details
        </div>
        <div style={{ fontSize: '12px', color: '#444', maxWidth: '300px', lineHeight: 1.6 }}>
          Click any claim in the sidebar, or press "Verify All" to analyze every extracted claim simultaneously.
        </div>
      </div>
    );
  }
  return <div style={{ flex: 1, backgroundColor: '#000' }} />;
};

/* ═══ Main Component ═══════════════════════════════════════════════════ */

const VerificationDetail: React.FC<VerificationDetailProps> = ({
  selectedClaim, v, activeTab, setActiveTab,
  expandedEvidenceId, setExpandedEvidenceId,
  verdictExpanded, setVerdictExpanded,
  reasoningCollapsed, setReasoningCollapsed,
  agentChips, pipelineStats, reasoningMessages, reasoningRef,
  hasClaims, isIngesting, isExtracting,
}) => {
  if (!selectedClaim || !v) {
    return <EmptyState hasClaims={hasClaims} isIngesting={isIngesting} isExtracting={isExtracting} />;
  }

  const vc = v.overallVerdict
    ? VERDICT_COLORS[v.overallVerdict.verdict] || VERDICT_COLORS.unsupported
    : null;

  return (
    <>
      {/* ═══ Sticky Header: Claim + Verdict ════════════════════════════ */}
      <div style={{ flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid #1a1a1a', backgroundColor: '#000' }}>
        <div style={{ fontSize: '14px', color: '#fff', lineHeight: 1.5, fontWeight: 500, marginBottom: '10px' }}>
          "{selectedClaim.original}"
        </div>

        {v.overallVerdict && vc ? (
          <div
            role="button" tabIndex={0}
            onClick={() => setVerdictExpanded(!verdictExpanded)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setVerdictExpanded(!verdictExpanded); }}}
            style={{
              padding: '12px 16px', borderRadius: '10px',
              border: `1px solid ${vc.border}`, backgroundColor: vc.bg,
              boxShadow: `0 0 20px ${vc.glow}`, animation: 'syn-verdict-pop 0.4s ease',
              cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span style={{ fontSize: '20px', fontWeight: 900, color: vc.text, textTransform: 'uppercase', letterSpacing: '1.5px', flexShrink: 0 }}>
                {v.overallVerdict.verdict.replace('_', ' ')}
              </span>
              <span style={{
                fontSize: '10px', fontWeight: 700,
                color: v.overallVerdict.confidence_score != null
                  ? (v.overallVerdict.confidence_score >= 70 ? '#4ade80' : v.overallVerdict.confidence_score >= 40 ? '#fbbf24' : '#f87171')
                  : '#888',
                textTransform: 'uppercase', padding: '2px 8px', borderRadius: '4px',
                border: '1px solid #333', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                {v.overallVerdict.confidence_score != null && (
                  <span style={{ fontWeight: 900, fontSize: '11px' }}>{v.overallVerdict.confidence_score}</span>
                )}
                {v.overallVerdict.confidence}
              </span>
              <span style={{ fontSize: '12px', color: '#ccc', flex: 1 }}>
                {!verdictExpanded && v.overallVerdict.summary.length > 120
                  ? v.overallVerdict.summary.slice(0, 120) + '...'
                  : v.overallVerdict.summary}
              </span>
              <span style={{ fontSize: '10px', color: '#555', flexShrink: 0, transition: 'transform 0.2s', transform: verdictExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
            </div>

            {verdictExpanded && (
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${vc.border}` }} className="syn-fade">
                {v.overallVerdict.detail && (
                  <div style={{ fontSize: '12px', color: '#aaa', lineHeight: 1.6, marginBottom: '12px' }}>
                    {v.overallVerdict.detail}
                  </div>
                )}
                {v.overallVerdict.confidence_breakdown && (() => {
                  const bd = v.overallVerdict!.confidence_breakdown!;
                  const bars = [
                    { label: 'Sources', score: bd.source_count.score, detail: `${bd.source_count.value} independent sources`, color: '#6b9bd2' },
                    { label: 'Tier Quality', score: bd.tier_quality.score, detail: `Avg authority: ${bd.tier_quality.value}${bd.tier_quality.has_sec_filing ? ' · SEC filing ✓' : ''}`, color: '#d4af37' },
                    { label: 'Agreement', score: bd.agreement_ratio.score, detail: `${bd.agreement_ratio.supporting}/${bd.agreement_ratio.total_scored} support · ${bd.agreement_ratio.opposing} oppose`, color: '#4ade80' },
                    { label: 'Recency', score: bd.recency.score, detail: bd.recency.value ? `Newest: ${bd.recency.value}` : 'Unknown', color: '#a78bfa' },
                  ];
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div className="syn-section-header" style={{ marginBottom: '2px' }}>Calibrated Confidence Breakdown</div>
                      {bars.map(b => (
                        <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '10px', color: '#888', width: '70px', flexShrink: 0, textAlign: 'right' }}>{b.label}</span>
                          <div style={{ flex: 1, height: '6px', backgroundColor: '#1a1a1a', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${b.score}%`, height: '100%', backgroundColor: b.color, borderRadius: '3px', transition: 'width 0.5s ease' }} />
                          </div>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: b.color, width: '28px', textAlign: 'right', flexShrink: 0 }}>{b.score}</span>
                          <span style={{ fontSize: '9px', color: '#555', width: '160px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.detail}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {v.reconciliation && (
                  <div style={{
                    marginTop: '12px', padding: '10px 14px', borderRadius: '8px',
                    border: `1px solid ${v.reconciliation.accuracy_level === 'true' || v.reconciliation.accuracy_level === 'essentially_true' ? '#1a3a1a' : '#3a2a1a'}`,
                    backgroundColor: v.reconciliation.accuracy_level === 'true' || v.reconciliation.accuracy_level === 'essentially_true' ? '#0a1a0a' : '#1a1008',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span className="syn-section-header">Final Assessment</span>
                      {v.overallVerdict?.reconciled && (
                        <span style={{ fontSize: '8px', fontWeight: 700, padding: '1px 6px', borderRadius: '3px', backgroundColor: '#1a3a1a', color: '#4ade80', border: '1px solid #2a4a2a' }}>RECONCILED</span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.6 }}>{v.reconciliation.explanation}</div>
                    {v.reconciliation.detail_added && (
                      <div style={{ fontSize: '11px', color: '#777', lineHeight: 1.5, marginTop: '6px' }}>
                        <span style={{ fontWeight: 600, color: '#999' }}>Added detail:</span> {v.reconciliation.detail_added}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Pipeline progress while verifying */
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {['decomposition', 'entity_resolution', 'normalization', 'evidence_retrieval', 'evaluation', 'contradictions', 'consistency', 'plausibility', 'synthesis', 'provenance', 'correction', 'reconciliation', 'risk_signals'].map(step => {
              const isDone = v.completedSteps.includes(step);
              const isCurrent = v.currentStep === step && !isDone;
              return (
                <div key={step} style={{
                  padding: '3px 8px', borderRadius: '5px', fontSize: '9px', fontWeight: 600,
                  border: '1px solid',
                  borderColor: isDone ? '#1a3a1a' : isCurrent ? '#333' : '#1a1a1a',
                  backgroundColor: isDone ? '#0a1a0a' : isCurrent ? '#111' : 'transparent',
                  color: isDone ? '#4ade80' : isCurrent ? '#fff' : '#444',
                  display: 'flex', alignItems: 'center', gap: '3px', transition: 'all 0.3s',
                }}>
                  {isCurrent && <span className="syn-dot-pulse" style={{ width: '5px', height: '5px' }} />}
                  {isDone && <span>✓</span>}
                  {STEP_ICONS[step]} {step.replace('_', ' ')}
                </div>
              );
            })}
          </div>
        )}

        {/* Agent Chips */}
        {agentChips.length > 0 && (
          <div style={{ marginTop: '10px', display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }} className="syn-fade">
            {agentChips.map((chip, i) => {
              const isDone = chip.status === 'done';
              const isActive = chip.status === 'active';
              const isPending = chip.status === 'pending';
              return (
                <React.Fragment key={chip.id}>
                  <div style={{
                    padding: '3px 8px', borderRadius: '5px', fontSize: '9px', fontWeight: 700,
                    display: 'flex', alignItems: 'center', gap: '4px',
                    border: `1px solid ${isDone ? `${chip.color}50` : isActive ? chip.color : '#1a1a1a'}`,
                    backgroundColor: isDone ? `${chip.color}15` : isActive ? `${chip.color}20` : 'transparent',
                    color: isDone ? chip.color : isActive ? chip.color : '#444',
                    opacity: isPending ? 0.35 : isDone ? 0.75 : 1,
                    transition: 'all 0.3s ease',
                    animation: isActive ? 'syn-agent-pulse 1.5s ease-in-out infinite' : 'none',
                    '--agent-glow': `${chip.color}60`,
                  } as React.CSSProperties}>
                    {isDone && <span style={{ fontSize: '8px' }}>✓</span>}
                    {isActive && <span className="syn-dot-pulse" style={{ width: '5px', height: '5px', backgroundColor: chip.color }} />}
                    {chip.label}
                  </div>
                  {i < agentChips.length - 1 && <span style={{ fontSize: '8px', color: '#333' }}>→</span>}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Pipeline Stats */}
        {(pipelineStats.steps > 0 || pipelineStats.durationMs > 0) && (
          <div className="syn-mono syn-fade" style={{
            marginTop: '8px', fontSize: '9px', color: '#555', fontWeight: 600,
            display: 'flex', gap: '10px', flexWrap: 'wrap',
          }}>
            <span>{pipelineStats.steps} agent steps</span>
            <span style={{ color: '#333' }}>·</span>
            <span>{pipelineStats.apiCalls} API calls</span>
            <span style={{ color: '#333' }}>·</span>
            <span>{pipelineStats.services.size} services</span>
            <span style={{ color: '#333' }}>·</span>
            <span>{pipelineStats.sources} sources evaluated</span>
            {pipelineStats.durationMs > 0 && (
              <>
                <span style={{ color: '#333' }}>·</span>
                <span>{(pipelineStats.durationMs / 1000).toFixed(1)}s</span>
              </>
            )}
          </div>
        )}

        {/* Action bar */}
        {v.completedSteps.includes('correction') && (
          <div style={{
            marginTop: '10px', padding: '10px 14px', borderRadius: '8px',
            border: '1px solid #1a1a1a', backgroundColor: '#050505',
            display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center',
          }} className="syn-fade">
            <span className="syn-section-header" style={{ marginRight: '4px' }}>Actions</span>
            <button className="syn-btn" style={{ padding: '4px 12px', borderRadius: '5px' }}
              onClick={() => {
                const verdict = v.overallVerdict;
                const lines = [
                  'SYNAPSE VERIFICATION REPORT',
                  `Claim: ${selectedClaim.original}`,
                  `Verdict: ${verdict?.verdict?.toUpperCase().replace('_', ' ') || 'UNKNOWN'} (${verdict?.confidence || '?'} confidence)`,
                  `Summary: ${verdict?.summary || ''}`,
                  verdict?.reconciled ? `Final Assessment: ${v.reconciliation?.explanation || ''}` : '',
                  '', `Sub-claims: ${v.subclaims.length} · Evidence: ${v.evidence.length} · Contradictions: ${v.contradictions.length}`,
                  v.correctedClaim?.corrected ? `\nCorrected Claim: ${v.correctedClaim.corrected}` : '',
                  v.riskSignals?.red_flags?.length ? `\nRed Flags:\n${v.riskSignals.red_flags.map(f => `• ${f}`).join('\n')}` : '',
                ].filter(Boolean).join('\n');
                navigator.clipboard.writeText(lines);
              }}>
              Copy Report
            </button>
            <button className="syn-btn" style={{ padding: '4px 12px', borderRadius: '5px' }}
              onClick={() => {
                const payload = {
                  claim: selectedClaim.original, verdict: v.overallVerdict,
                  reconciliation: v.reconciliation, subclaims: v.subclaims,
                  evidence: v.evidence, contradictions: v.contradictions,
                  consistencyIssues: v.consistencyIssues, correctedClaim: v.correctedClaim,
                  riskSignals: v.riskSignals, materiality: v.materiality,
                  exportedAt: new Date().toISOString(),
                };
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'synapse-verification.json'; a.click();
                URL.revokeObjectURL(url);
              }}>
              Export JSON
            </button>
            {v.overallVerdict?.verdict !== 'supported' && (
              <button className="syn-btn" style={{ padding: '4px 12px', borderRadius: '5px' }}
                onClick={() => {
                  const hint = v.contradictions[0]
                    ? `Dig deeper: "${v.contradictions[0].explanation?.slice(0, 120)}"`
                    : v.consistencyIssues[0]
                    ? `Investigate: "${v.consistencyIssues[0].description?.slice(0, 120)}"`
                    : `Verify: "${selectedClaim.original.slice(0, 120)}"`;
                  navigator.clipboard.writeText(hint);
                }}>
                Copy Follow-up
              </button>
            )}
            {(v.overallVerdict?.verdict === 'contradicted' || v.overallVerdict?.verdict === 'exaggerated' || v.contradictions.length > 0) && (
              <button className="syn-btn-danger" style={{ padding: '4px 12px', borderRadius: '5px' }}
                onClick={() => {
                  const flag = [
                    '[FLAGGED FOR REVIEW]', `Claim: ${selectedClaim.original}`,
                    `Verdict: ${v.overallVerdict?.verdict}`,
                    `Reason: ${v.contradictions[0]?.explanation || v.overallVerdict?.summary}`,
                    `Flagged at: ${new Date().toLocaleString()}`,
                  ].join('\n');
                  navigator.clipboard.writeText(flag);
                }}>
                Flag for Review
              </button>
            )}
            {v.correctedClaim?.corrected && (
              <button className="syn-btn-success" style={{ padding: '4px 12px', borderRadius: '5px' }}
                onClick={() => {
                  const rebuttal = [
                    'REBUTTAL', `Original claim: "${selectedClaim.original}"`, '',
                    `This claim is ${v.reconciliation?.accuracy_level?.replace('_', ' ') || v.overallVerdict?.verdict}.`, '',
                    v.reconciliation?.explanation || v.overallVerdict?.summary || '', '',
                    `More accurate version: "${v.correctedClaim?.corrected}"`,
                    v.correctedClaim?.caveats?.length ? `\nCaveats:\n${v.correctedClaim.caveats.map((c: string) => `• ${c}`).join('\n')}` : '',
                  ].filter(Boolean).join('\n');
                  navigator.clipboard.writeText(rebuttal);
                }}>
                Copy Rebuttal
              </button>
            )}
          </div>
        )}
      </div>

      {/* ═══ Reasoning Feed ════════════════════════════════════════════ */}
      {reasoningMessages.length > 0 && (
        <div style={{
          flexShrink: 0, borderBottom: '1px solid #1a1a1a', backgroundColor: '#030303',
          maxHeight: reasoningCollapsed ? '32px' : (selectedClaim.status === 'verifying' ? '280px' : '180px'),
          overflow: 'hidden', transition: 'max-height 0.3s ease',
        }}>
          <div
            role="button" tabIndex={0}
            onClick={() => setReasoningCollapsed(!reasoningCollapsed)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setReasoningCollapsed(!reasoningCollapsed); }}}
            aria-expanded={!reasoningCollapsed}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 20px',
              cursor: 'pointer', borderBottom: reasoningCollapsed ? 'none' : '1px solid #111',
              userSelect: 'none',
            }}
          >
            <span className={selectedClaim.status === 'verifying' ? 'syn-dot-pulse' : undefined}
              style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: selectedClaim.status === 'verifying' ? '#fff' : '#333' }} />
            <span className="syn-mono" style={{ fontSize: '9px', fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
              REASONING TRACE
            </span>
            <span className="syn-mono" style={{ fontSize: '9px', color: '#333' }}>{reasoningMessages.length}</span>
            <span style={{ marginLeft: 'auto', fontSize: '8px', color: '#333', transform: reasoningCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }}>▼</span>
          </div>
          {!reasoningCollapsed && (
            <div ref={reasoningRef} style={{
              overflow: 'auto', padding: '6px 0',
              maxHeight: selectedClaim.status === 'verifying' ? '245px' : '145px',
            }}>
              {reasoningMessages.map((msg, i) => {
                const color = AGENT_COLORS[msg.agent] || '#555';
                const isLatest = i === reasoningMessages.length - 1 && selectedClaim.status === 'verifying';
                return (
                  <div key={i} style={{
                    padding: '4px 20px', display: 'flex', gap: '8px', alignItems: 'flex-start',
                    opacity: isLatest ? 1 : 0.65,
                    animation: isLatest ? 'syn-fade 0.3s ease' : 'none',
                  }}>
                    <span className="syn-mono" style={{ fontSize: '8px', color: '#222', minWidth: '32px', flexShrink: 0, paddingTop: '2px', textAlign: 'right' }}>
                      {new Date(msg.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="syn-mono" style={{ fontSize: '8px', fontWeight: 700, color, minWidth: '80px', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.3px', paddingTop: '2px' }}>
                      {msg.agent.replace(/_/g, ' ').slice(0, 12)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="syn-mono" style={{ fontSize: '10px', color: '#999', lineHeight: 1.4, wordBreak: 'break-word' }}>{msg.message}</div>
                      {msg.detail && (
                        <div className="syn-mono" style={{ fontSize: '9px', color: '#444', lineHeight: 1.4, marginTop: '1px', wordBreak: 'break-word' }}>
                          {msg.detail.slice(0, 180)}{msg.detail.length > 180 ? '...' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Tab Bar ════════════════════════════════════════════════════ */}
      <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid #1a1a1a', backgroundColor: '#0a0a0a' }}>
        {([
          { key: 'subclaims' as const, label: 'Sub-Claims', icon: '🔬', count: v.subclaims.length },
          { key: 'evidence' as const, label: 'Evidence', icon: '📄', count: v.evidence.length },
          { key: 'contradictions' as const, label: 'Contradictions', icon: '⚡', count: v.contradictions.length },
          ...(v.consistencyIssues.length > 0 ? [{ key: 'consistency' as const, label: 'Consistency', icon: '🔍', count: v.consistencyIssues.length }] : []),
          ...(v.plausibility ? [{ key: 'plausibility' as const, label: 'Plausibility', icon: '🎯', count: 1 }] : []),
          { key: 'provenance' as const, label: 'Provenance', icon: '🔗', count: v.provenanceNodes.length },
          { key: 'correction' as const, label: 'Correction', icon: '✏️', count: v.correctedClaim ? 1 : 0 },
          ...(v.riskSignals ? [{ key: 'risk_signals' as const, label: 'Risk', icon: '🚨', count: (v.riskSignals.red_flags || []).length }] : []),
        ]).map(tab => (
          <button key={tab.key}
            className={`syn-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}>
            <span>{tab.icon}</span>
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                backgroundColor: activeTab === tab.key ? 'rgba(255,255,255,0.1)' : '#1a1a1a',
                color: activeTab === tab.key ? '#fff' : '#444',
              }}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ Tab Content ═══════════════════════════════════════════════ */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {/* Sub-Claims */}
        {activeTab === 'subclaims' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} className="syn-fade">
            {v.subclaims.map((sc, i) => {
              const scColor = sc.verdict ? (VERDICT_COLORS[sc.verdict] || VERDICT_COLORS.unsupported) : null;
              return (
                <div key={sc.id} style={{
                  padding: '14px 16px', borderRadius: '10px',
                  borderLeft: `3px solid ${scColor?.text || '#444'}`,
                  border: `1px solid ${scColor?.border || '#1a1a1a'}`,
                  borderLeftWidth: '3px', borderLeftColor: scColor?.text || '#444',
                  backgroundColor: scColor?.bg || '#0a0a0a',
                  animation: `syn-slide-in 0.3s ease ${i * 0.08}s both`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: scColor?.text || '#444', animation: !sc.verdict ? 'syn-pulse 1.2s ease-in-out infinite' : 'none' }} />
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#555', textTransform: 'uppercase' }}>{sc.type}</span>
                    {sc.verdict && <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 800, color: scColor?.text, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{sc.verdict.replace('_', ' ')}</span>}
                    {sc.confidence && <span style={{ fontSize: '9px', color: '#555', fontWeight: 600 }}>{sc.confidence}</span>}
                  </div>
                  <div style={{ fontSize: '13px', color: '#ddd', lineHeight: 1.55 }}>{sc.text}</div>
                  {sc.summary && (
                    <div style={{ fontSize: '11px', color: '#888', marginTop: '6px', lineHeight: 1.5, paddingTop: '6px', borderTop: '1px solid #1a1a1a' }}>{sc.summary}</div>
                  )}
                </div>
              );
            })}
            {v.subclaims.length === 0 && selectedClaim.status === 'verifying' && (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div className="syn-spinner" style={{ width: '24px', height: '24px', margin: '0 auto 10px' }} />
                <div style={{ fontSize: '12px', color: '#fff' }}>Decomposing claim...</div>
              </div>
            )}
          </div>
        )}

        {/* Evidence */}
        {activeTab === 'evidence' && (
          <div className="syn-fade">
            {v.subclaims.map(sc => {
              const scEvidence = v.evidence.filter(e => e.subclaim_id === sc.id);
              if (scEvidence.length === 0) return null;
              const scColor = sc.verdict ? (VERDICT_COLORS[sc.verdict] || VERDICT_COLORS.unsupported) : null;
              return (
                <div key={sc.id} style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: scColor?.text || '#888', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: scColor?.text || '#444' }} />
                    {sc.text.slice(0, 80)}{sc.text.length > 80 ? '...' : ''}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {scEvidence.map((ev, i) => (
                      <EvidenceCard key={ev.id} ev={ev} i={i}
                        isExpanded={expandedEvidenceId === ev.id}
                        onToggle={() => setExpandedEvidenceId(expandedEvidenceId === ev.id ? null : ev.id)} />
                    ))}
                  </div>
                </div>
              );
            })}
            {v.evidence.filter(e => !e.subclaim_id || !v.subclaims.find(sc => sc.id === e.subclaim_id)).length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#555', marginBottom: '8px' }}>Other Sources</div>
                {v.evidence.filter(e => !e.subclaim_id || !v.subclaims.find(sc => sc.id === e.subclaim_id)).map((ev, i) => (
                  <EvidenceCard key={ev.id} ev={ev} i={i} compact
                    isExpanded={expandedEvidenceId === ev.id}
                    onToggle={() => setExpandedEvidenceId(expandedEvidenceId === ev.id ? null : ev.id)} />
                ))}
              </div>
            )}
            {v.evidence.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#555', fontSize: '12px' }}>
                {selectedClaim.status === 'verifying' ? 'Searching for evidence...' : 'No evidence collected yet'}
              </div>
            )}
          </div>
        )}

        {/* Contradictions */}
        {activeTab === 'contradictions' && (
          <div className="syn-fade">
            {v.contradictions.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {v.contradictions.map((c, i) => {
                  const sevColors: Record<string, { bg: string; border: string; text: string }> = {
                    low: { bg: '#1a1500', border: '#3a3000', text: '#fbbf24' },
                    medium: { bg: '#1a1000', border: '#3a2000', text: '#fb923c' },
                    high: { bg: '#1a0a0a', border: '#3a1a1a', text: '#f87171' },
                  };
                  const sev = sevColors[c.severity] || sevColors.medium;
                  return (
                    <div key={c.id || i} style={{
                      padding: '16px', borderRadius: '10px',
                      border: `1px solid ${sev.border}`, backgroundColor: sev.bg,
                      animation: `syn-slide-in 0.3s ease ${i * 0.08}s both`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <span style={{ fontSize: '9px', fontWeight: 800, padding: '2px 8px', borderRadius: '3px', backgroundColor: `${sev.text}20`, color: sev.text, border: `1px solid ${sev.text}40`, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{c.severity} severity</span>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                        <div style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: '#d4af37', textTransform: 'uppercase', marginBottom: '4px' }}>{c.source_a?.type || 'Source A'}</div>
                          <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>{c.source_a?.name}</div>
                          <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.5, fontStyle: 'italic' }}>"{c.source_a?.text}"</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: '10px', fontWeight: 800, color: sev.text }}>VS</span>
                        </div>
                        <div style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: '#6b9bd2', textTransform: 'uppercase', marginBottom: '4px' }}>{c.source_b?.type || 'Source B'}</div>
                          <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>{c.source_b?.name}</div>
                          <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.5, fontStyle: 'italic' }}>"{c.source_b?.text}"</div>
                        </div>
                      </div>
                      <div style={{ fontSize: '12px', color: '#aaa', lineHeight: 1.5, paddingTop: '10px', borderTop: `1px solid ${sev.border}` }}>{c.explanation}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#555', fontSize: '12px' }}>
                {selectedClaim.status === 'verifying' ? 'Checking for contradictions...' : 'No contradictions detected between sources'}
              </div>
            )}
          </div>
        )}

        {/* Consistency */}
        {activeTab === 'consistency' && (
          <div className="syn-fade">
            {v.consistencyIssues.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '11px', color: '#777', lineHeight: 1.5, marginBottom: '4px' }}>
                  Cross-document consistency analysis detected subtle tensions between sources — beyond direct contradictions.
                </div>
                {v.consistencyIssues.map((ci, i) => {
                  const typeColors: Record<string, { bg: string; border: string; text: string; label: string }> = {
                    narrative_drift: { bg: '#1a0a1a', border: '#3a1a3a', text: '#c084fc', label: 'Narrative Drift' },
                    metric_inconsistency: { bg: '#1a0a0a', border: '#3a1a1a', text: '#f87171', label: 'Metric Inconsistency' },
                    temporal_inconsistency: { bg: '#1a1500', border: '#3a3000', text: '#fbbf24', label: 'Temporal Issue' },
                    omission_flag: { bg: '#0a1a1a', border: '#1a3a3a', text: '#6bccc8', label: 'Omission Flag' },
                    risk_factor_tension: { bg: '#1a1000', border: '#3a2000', text: '#fb923c', label: 'Risk Factor Tension' },
                  };
                  const tc = typeColors[ci.type] || typeColors.omission_flag;
                  const sevColors: Record<string, string> = { low: '#fbbf24', medium: '#fb923c', high: '#f87171' };
                  return (
                    <div key={ci.id || i} style={{
                      padding: '16px', borderRadius: '10px',
                      border: `1px solid ${tc.border}`, backgroundColor: tc.bg,
                      animation: `syn-slide-in 0.3s ease ${i * 0.08}s both`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                        <span style={{ fontSize: '9px', fontWeight: 800, padding: '2px 8px', borderRadius: '3px', backgroundColor: `${tc.text}20`, color: tc.text, border: `1px solid ${tc.text}40`, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{tc.label}</span>
                        <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '3px', color: sevColors[ci.severity] || '#888', border: `1px solid ${(sevColors[ci.severity] || '#888')}40`, textTransform: 'uppercase' }}>{ci.severity}</span>
                        {ci.sources_involved?.length > 0 && (
                          <span style={{ fontSize: '9px', color: '#555', marginLeft: 'auto' }}>Sources: {ci.sources_involved.join(', ')}</span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.6, marginBottom: '8px' }}>{ci.description}</div>
                      {ci.implication && (
                        <div style={{ fontSize: '11px', color: '#999', lineHeight: 1.5, paddingTop: '8px', borderTop: `1px solid ${tc.border}`, fontStyle: 'italic' }}>
                          Implication: {ci.implication}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#555', fontSize: '12px' }}>No cross-document consistency issues detected</div>
            )}
          </div>
        )}

        {/* Plausibility */}
        {activeTab === 'plausibility' && v.plausibility && (
          <div className="syn-fade">
            <div style={{ padding: '20px', borderRadius: '12px', marginBottom: '16px', border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a', textAlign: 'center' }}>
              <div className="syn-section-header" style={{ marginBottom: '8px', letterSpacing: '1.5px' }}>Forward-Looking Plausibility</div>
              <div style={{ fontSize: '48px', fontWeight: 800, letterSpacing: '-2px', color: v.plausibility.plausibility_score >= 70 ? '#4ade80' : v.plausibility.plausibility_score >= 40 ? '#fbbf24' : '#f87171' }}>
                {v.plausibility.plausibility_score}
              </div>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: v.plausibility.plausibility_score >= 70 ? '#4ade80' : v.plausibility.plausibility_score >= 40 ? '#fbbf24' : '#f87171', marginBottom: '12px' }}>
                {v.plausibility.plausibility_level?.replace(/_/g, ' ')}
              </div>
              <div style={{ fontSize: '13px', color: '#aaa', lineHeight: 1.6, maxWidth: '500px', margin: '0 auto' }}>{v.plausibility.assessment}</div>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <div style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid #1a3a1a', backgroundColor: '#0a1a0a' }}>
                <div className="syn-section-header" style={{ color: '#4ade80', marginBottom: '8px', letterSpacing: '1px' }}>Projection</div>
                <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.6 }}>
                  <div><span style={{ color: '#666' }}>Target:</span> {v.plausibility.projection?.target_metric}</div>
                  <div><span style={{ color: '#666' }}>Value:</span> {v.plausibility.projection?.target_value}</div>
                  <div><span style={{ color: '#666' }}>By:</span> {v.plausibility.projection?.target_date}</div>
                  <div><span style={{ color: '#666' }}>Requires:</span> {v.plausibility.projection?.implied_growth_rate}</div>
                </div>
              </div>
              <div style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid #1a1a3a', backgroundColor: '#0a0a1a' }}>
                <div className="syn-section-header" style={{ color: '#6b9bd2', marginBottom: '8px', letterSpacing: '1px' }}>Current Trajectory</div>
                <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.6 }}>
                  <div><span style={{ color: '#666' }}>Current:</span> {v.plausibility.current_trajectory?.current_value}</div>
                  <div><span style={{ color: '#666' }}>Trend:</span> {v.plausibility.current_trajectory?.trend?.replace(/_/g, ' ')}</div>
                  <div><span style={{ color: '#666' }}>Historical:</span> {v.plausibility.current_trajectory?.historical_growth_rate}</div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {v.plausibility.key_risks?.length > 0 && (
                <div style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid #3a1a1a', backgroundColor: '#1a0a0a' }}>
                  <div className="syn-section-header" style={{ color: '#f87171', marginBottom: '8px', letterSpacing: '1px' }}>Key Risks</div>
                  {v.plausibility.key_risks.map((r, i) => (
                    <div key={i} style={{ fontSize: '11px', color: '#bbb', lineHeight: 1.5, marginBottom: '4px', paddingLeft: '10px', borderLeft: '2px solid #3a1a1a' }}>{r}</div>
                  ))}
                </div>
              )}
              {v.plausibility.key_assumptions?.length > 0 && (
                <div style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid #1a1a3a', backgroundColor: '#0a0a1a' }}>
                  <div className="syn-section-header" style={{ color: '#a78bfa', marginBottom: '8px', letterSpacing: '1px' }}>Key Assumptions</div>
                  {v.plausibility.key_assumptions.map((a, i) => (
                    <div key={i} style={{ fontSize: '11px', color: '#bbb', lineHeight: 1.5, marginBottom: '4px', paddingLeft: '10px', borderLeft: '2px solid #1a1a3a' }}>{a}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Provenance */}
        {activeTab === 'provenance' && (
          <div className="syn-fade">
            {v.provenanceNodes.length > 0 ? (
              <>
                <div style={{ padding: '12px 0 4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="syn-section-header" style={{ letterSpacing: '1px' }}>Claim Origin Timeline</span>
                  <div style={{ flex: 1, height: '1px', background: '#1a1a1a' }} />
                  <span style={{ fontSize: '10px', color: '#444' }}>{v.provenanceNodes.length} sources traced</span>
                </div>
                <div style={{ overflowX: 'auto', overflowY: 'hidden', padding: '28px 12px 20px', display: 'flex', alignItems: 'stretch', gap: '0', minHeight: '240px' }}>
                  {v.provenanceNodes.map((node, i) => {
                    const mutColor = MUTATION_COLORS[node.mutation_severity] || '#94a3b8';
                    const nextNode = v.provenanceNodes[i + 1];
                    const nextColor = nextNode ? (MUTATION_COLORS[nextNode.mutation_severity] || '#94a3b8') : mutColor;
                    const sourceIcons: Record<string, string> = {
                      study: '📄', journalist: '📰', podcast: '🎙️', social: '📱', blog: '💻', claim: '💬',
                      sec_filing: '⚖️', earnings_call: '🎙️', press_release: '📰', analyst_report: '📊', market_data: '📈',
                    };
                    return (
                      <React.Fragment key={node.id}>
                        <div style={{
                          flexShrink: 0, width: '280px', padding: '16px 18px',
                          borderRadius: '10px', border: `1px solid ${mutColor}30`,
                          backgroundColor: `${mutColor}08`,
                          animation: `syn-slide-in 0.3s ease ${i * 0.15}s both`,
                          display: 'flex', flexDirection: 'column', gap: '10px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '16px' }}>{sourceIcons[node.source_type] || '📋'}</span>
                            <div>
                              <div style={{ fontSize: '11px', fontWeight: 700, color: mutColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{node.source_type.replace(/_/g, ' ')}</div>
                              <div style={{ fontSize: '10px', color: '#888' }}>{node.source_name}</div>
                            </div>
                            {node.date && <span style={{ marginLeft: 'auto', fontSize: '9px', color: '#555', fontWeight: 600 }}>{node.date}</span>}
                          </div>
                          <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.55, fontStyle: 'italic' }}>"{node.text}"</div>
                          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: mutColor }} />
                            <span style={{ fontSize: '9px', fontWeight: 700, color: mutColor, textTransform: 'uppercase' }}>{node.mutation_severity} mutation</span>
                          </div>
                        </div>
                        {i < v.provenanceNodes.length - 1 && (
                          <div style={{ flexShrink: 0, width: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: `syn-fade 0.3s ease ${i * 0.15 + 0.1}s both` }}>
                            <svg width="48" height="24" viewBox="0 0 48 24">
                              <defs><linearGradient id={`pg-${i}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor={mutColor} /><stop offset="100%" stopColor={nextColor} /></linearGradient></defs>
                              <line x1="4" y1="12" x2="36" y2="12" stroke={`url(#pg-${i})`} strokeWidth="2" />
                              <polygon points="36,6 44,12 36,18" fill={nextColor} />
                            </svg>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
                {v.provenanceAnalysis && (
                  <div style={{ marginTop: '8px', padding: '14px 16px', borderRadius: '10px', backgroundColor: '#080808', border: '1px solid #1a1a1a', fontSize: '13px', color: '#999', lineHeight: 1.65 }}>
                    <span style={{ fontWeight: 700, color: '#fff', marginRight: '6px' }}>Analysis:</span>
                    {v.provenanceAnalysis}
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#555', fontSize: '12px' }}>
                {selectedClaim.status === 'verifying' ? 'Tracing claim origins...' : 'No provenance data yet'}
              </div>
            )}
          </div>
        )}

        {/* Correction */}
        {activeTab === 'correction' && (
          <div className="syn-fade">
            {v.correctedClaim ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #1a3a1a', backgroundColor: '#0a1a0a' }}>
                  <div className="syn-section-header" style={{ color: '#4ade80', marginBottom: '8px', letterSpacing: '1px' }}>Corrected Claim</div>
                  <div style={{ fontSize: '14px', color: '#e0e0e0', lineHeight: 1.6 }}>"{v.correctedClaim.corrected}"</div>
                </div>
                {(v.correctedClaim as any).changes?.length > 0 && (
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a' }}>
                    <div className="syn-section-header" style={{ color: '#fff', marginBottom: '10px', letterSpacing: '0.5px' }}>Changes Made</div>
                    {((v.correctedClaim as any).changes as { description: string; reason: string }[]).map((ch, i, arr) => (
                      <div key={i} style={{ padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid #111' : 'none' }}>
                        <div style={{ fontSize: '12px', color: '#e0e0e0', fontWeight: 600, marginBottom: '4px' }}>{ch.description}</div>
                        <div style={{ fontSize: '11px', color: '#777', lineHeight: 1.5 }}>{ch.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
                {v.correctedClaim.caveats?.length > 0 && (
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #3a3000', backgroundColor: '#1a1500' }}>
                    <div className="syn-section-header" style={{ color: '#fbbf24', marginBottom: '8px', letterSpacing: '0.5px' }}>Caveats</div>
                    {v.correctedClaim.caveats.map((c, i) => (
                      <div key={i} style={{ fontSize: '12px', color: '#ddd', lineHeight: 1.5, padding: '3px 0', display: 'flex', gap: '8px' }}>
                        <span style={{ color: '#fbbf24', flexShrink: 0 }}>●</span> {c}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#555', fontSize: '12px' }}>
                {selectedClaim.status === 'verifying' ? 'Generating corrected claim...' : 'No correction generated yet'}
              </div>
            )}
          </div>
        )}

        {/* Risk Signals */}
        {activeTab === 'risk_signals' && (
          <div className="syn-fade">
            {v.riskSignals ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ padding: '20px', borderRadius: '12px', border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-1px', color: v.riskSignals.risk_level === 'critical' ? '#f87171' : v.riskSignals.risk_level === 'high' ? '#fb923c' : v.riskSignals.risk_level === 'medium' ? '#fbbf24' : '#4ade80' }}>
                      {v.riskSignals.risk_score}
                    </span>
                    <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: v.riskSignals.risk_level === 'critical' ? '#f87171' : v.riskSignals.risk_level === 'high' ? '#fb923c' : v.riskSignals.risk_level === 'medium' ? '#fbbf24' : '#4ade80' }}>
                      Risk: {v.riskSignals.risk_level} ({v.riskSignals.risk_score}/100)
                    </div>
                  </div>
                  <div style={{ fontSize: '14px', color: '#e0e0e0', lineHeight: 1.6, fontWeight: 600 }}>{v.riskSignals.headline}</div>
                  <div style={{ fontSize: '12px', color: '#888', lineHeight: 1.6, marginTop: '8px' }}>{v.riskSignals.risk_narrative}</div>
                </div>
                {v.riskSignals.patterns_detected.length > 0 && (
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a' }}>
                    <div className="syn-section-header" style={{ color: '#fff', marginBottom: '10px', letterSpacing: '0.5px' }}>Patterns Detected</div>
                    {v.riskSignals.patterns_detected.map((p, i) => (
                      <div key={i} style={{ padding: '10px 0', borderBottom: i < v.riskSignals!.patterns_detected.length - 1 ? '1px solid #111' : 'none' }}>
                        <div style={{ fontSize: '12px', color: '#e0e0e0', fontWeight: 600, marginBottom: '4px' }}>{p.pattern}</div>
                        <div style={{ fontSize: '11px', color: '#777', lineHeight: 1.5 }}>{p.evidence}</div>
                        <div style={{ fontSize: '10px', color: '#555', marginTop: '4px' }}>{p.frequency}</div>
                      </div>
                    ))}
                  </div>
                )}
                {v.riskSignals.red_flags.length > 0 && (
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #3a1a1a', backgroundColor: '#1a0a0a' }}>
                    <div className="syn-section-header" style={{ color: '#f87171', marginBottom: '8px', letterSpacing: '0.5px' }}>Red Flags</div>
                    {v.riskSignals.red_flags.map((f, i) => (
                      <div key={i} style={{ fontSize: '12px', color: '#fca5a5', lineHeight: 1.5, padding: '3px 0', display: 'flex', gap: '8px' }}>
                        <span style={{ color: '#f87171', flexShrink: 0 }}>●</span> {f}
                      </div>
                    ))}
                  </div>
                )}
                {v.riskSignals.recommended_actions.length > 0 && (
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #1a2a1a', backgroundColor: '#0a1a0a' }}>
                    <div className="syn-section-header" style={{ color: '#4ade80', marginBottom: '8px', letterSpacing: '0.5px' }}>Recommended Actions</div>
                    {v.riskSignals.recommended_actions.map((a, i) => (
                      <div key={i} style={{ fontSize: '12px', color: '#bbf7d0', lineHeight: 1.5, padding: '3px 0', display: 'flex', gap: '8px' }}>
                        <span style={{ color: '#4ade80', flexShrink: 0 }}>{i + 1}.</span> {a}
                      </div>
                    ))}
                  </div>
                )}
                {(v.materiality || v.authorityConflicts.length > 0) && (
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a' }}>
                    {v.materiality && (
                      <div style={{ marginBottom: v.authorityConflicts.length > 0 ? '12px' : '0' }}>
                        <div className="syn-section-header" style={{ color: '#fff', marginBottom: '6px', letterSpacing: '0.5px' }}>Materiality</div>
                        <div style={{ fontSize: '12px', color: '#aaa', lineHeight: 1.5 }}>
                          <span style={{ color: v.materiality.materiality_level === 'critical' ? '#f87171' : v.materiality.materiality_level === 'high' ? '#fb923c' : '#888', fontWeight: 600 }}>
                            {v.materiality.materiality_level.toUpperCase()}
                          </span>
                          {' '}({v.materiality.materiality_score}/100) — {v.materiality.category.replace(/_/g, ' ')}
                        </div>
                        <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>{v.materiality.impact_assessment}</div>
                      </div>
                    )}
                    {v.authorityConflicts.length > 0 && (
                      <div>
                        <div className="syn-section-header" style={{ color: '#fff', marginBottom: '6px', letterSpacing: '0.5px' }}>Source Authority Conflicts</div>
                        {v.authorityConflicts.map((ac, i) => (
                          <div key={i} style={{ fontSize: '11px', color: '#888', lineHeight: 1.5, padding: '4px 0', borderBottom: i < v.authorityConflicts.length - 1 ? '1px solid #111' : 'none' }}>
                            <span style={{ color: ac.severity === 'critical' ? '#f87171' : ac.severity === 'high' ? '#fb923c' : '#fbbf24', fontWeight: 600 }}>
                              [{ac.severity.toUpperCase()}]
                            </span>{' '}
                            {ac.implication}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#555', fontSize: '12px' }}>
                {selectedClaim.status === 'verifying' ? 'Extracting risk signals...' : 'No risk signals generated yet'}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

/* ═══ Evidence Card Sub-Component ═════════════════════════════════════ */

const EvidenceCard: React.FC<{
  ev: any; i: number; compact?: boolean;
  isExpanded: boolean; onToggle: () => void;
}> = ({ ev, i, compact, isExpanded, onToggle }) => {
  const tierInfo = TIER_LABELS[ev.tier] || { label: ev.tier, icon: '📋', color: '#94a3b8' };
  const qScore = ev.quality_score ?? 0;
  const qColor = qScore >= 70 ? '#4ade80' : qScore >= 40 ? '#fbbf24' : '#94a3b8';

  return (
    <div
      role="button" tabIndex={0}
      className={`syn-evidence-card ${isExpanded ? 'expanded' : ''} ${ev.tier === 'counter' ? 'counter' : ''}`}
      onClick={onToggle}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }}}
      style={{
        animation: `syn-slide-in 0.2s ease ${i * 0.04}s both`,
        marginBottom: compact ? '4px' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? '6px' : '8px', marginBottom: compact ? '0' : '6px' }}>
        <span style={{ fontSize: compact ? '10px' : '11px' }}>{tierInfo.icon}</span>
        {!compact && (
          <span style={{ fontSize: '9px', fontWeight: 700, color: tierInfo.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{tierInfo.label}</span>
        )}
        {ev.study_type && !compact && (
          <span style={{ fontSize: '9px', color: '#555', fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: '#1a1a1a' }}>{ev.study_type}</span>
        )}
        {ev.quality_score != null && !compact && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '40px', height: '4px', borderRadius: '2px', backgroundColor: '#1a1a1a', overflow: 'hidden' }}>
              <div style={{ width: `${qScore}%`, height: '100%', borderRadius: '2px', backgroundColor: qColor, transition: 'width 0.5s ease' }} />
            </div>
            <span style={{ fontSize: '9px', fontWeight: 700, color: qColor }}>{qScore}</span>
          </div>
        )}
        {ev.supports_claim != null && !compact && (
          <span style={{
            fontSize: '8px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
            backgroundColor: ev.supports_claim === true ? '#0a1a0a' : ev.supports_claim === false ? '#1a0a0a' : '#1a1500',
            color: ev.supports_claim === true ? '#4ade80' : ev.supports_claim === false ? '#f87171' : '#fbbf24',
            border: `1px solid ${ev.supports_claim === true ? '#1a3a1a' : ev.supports_claim === false ? '#3a1a1a' : '#3a3000'}`,
          }}>
            {ev.supports_claim === true ? 'SUPPORTS' : ev.supports_claim === false ? 'OPPOSES' : 'PARTIAL'}
          </span>
        )}
        <span style={{
          fontSize: compact ? '10px' : '10px', color: '#555',
          marginLeft: compact ? 'auto' : undefined,
          transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>▸</span>
      </div>

      <div style={{ fontSize: '12px', fontWeight: 600, color: '#ddd', marginBottom: '3px' }}>{ev.title}</div>
      <div style={{ fontSize: '11px', color: '#888', lineHeight: 1.5 }}>
        {isExpanded ? (ev.snippet_full || ev.snippet) : (ev.snippet?.slice(0, 180) + ((ev.snippet?.length || 0) > 180 ? '...' : ''))}
      </div>

      {isExpanded && (
        <div style={{ marginTop: '10px', borderTop: '1px solid #1a1a1a', paddingTop: '10px' }} className="syn-fade">
          {ev.assessment && (
            <div style={{ marginBottom: '8px' }}>
              <div className="syn-section-header" style={{ marginBottom: '4px', letterSpacing: '0.5px' }}>Assessment</div>
              <div style={{ fontSize: '11px', color: '#aaa', lineHeight: 1.6 }}>{ev.assessment}</div>
            </div>
          )}
          {ev.source && (
            <div style={{ marginBottom: '8px' }}>
              <div className="syn-section-header" style={{ marginBottom: '4px', letterSpacing: '0.5px' }}>Source</div>
              <div style={{ fontSize: '11px', color: '#aaa', lineHeight: 1.5 }}>{ev.source}</div>
            </div>
          )}
          {(ev.filing_type || ev.filing_date || ev.accession_number) && (
            <div style={{ marginBottom: '8px' }}>
              <div className="syn-section-header" style={{ marginBottom: '4px', letterSpacing: '0.5px' }}>Filing Details</div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '11px', color: '#aaa' }}>
                {ev.filing_type && <span><span style={{ color: '#666' }}>Type:</span> {ev.filing_type}</span>}
                {ev.filing_date && <span><span style={{ color: '#666' }}>Date:</span> {ev.filing_date}</span>}
                {ev.company_ticker && <span><span style={{ color: '#666' }}>Ticker:</span> {ev.company_ticker}</span>}
                {ev.accession_number && <span><span style={{ color: '#666' }}>Accession:</span> {ev.accession_number}</span>}
              </div>
            </div>
          )}
          {ev.citations_urls?.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div className="syn-section-header" style={{ marginBottom: '6px', letterSpacing: '0.5px' }}>Sources & Links</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {ev.citations_urls.map((url: string, ci: number) => {
                  let displayUrl = url;
                  try { displayUrl = new URL(url).hostname.replace('www.', ''); } catch {}
                  return (
                    <a key={ci} href={url} target="_blank" rel="noopener noreferrer"
                      className="syn-link" onClick={e => e.stopPropagation()}>
                      <span style={{ fontSize: '10px', flexShrink: 0 }}>🔗</span>
                      <span style={{ fontWeight: 600, flexShrink: 0 }}>[{ci + 1}]</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayUrl}</span>
                      <span style={{ fontSize: '9px', color: '#555', marginLeft: 'auto', flexShrink: 0 }}>↗</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {ev.xbrl_match && (
        <div style={{
          marginTop: '8px', padding: '8px 10px', borderRadius: '6px',
          backgroundColor: ev.xbrl_match === 'exact' ? '#0a1a0a' : ev.xbrl_match === 'close' ? '#1a1500' : '#1a0a0a',
          border: `1px solid ${ev.xbrl_match === 'exact' ? '#1a3a1a' : ev.xbrl_match === 'close' ? '#3a3000' : '#3a1a1a'}`,
        }}>
          <div style={{ fontSize: '9px', fontWeight: 800, color: '#d4af37', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            XBRL Ground Truth
            <span style={{ fontSize: '8px', padding: '1px 5px', borderRadius: '3px', backgroundColor: ev.xbrl_match === 'exact' ? '#4ade8020' : ev.xbrl_match === 'close' ? '#fbbf2420' : '#f8717120', color: ev.xbrl_match === 'exact' ? '#4ade80' : ev.xbrl_match === 'close' ? '#fbbf24' : '#f87171', border: `1px solid ${ev.xbrl_match === 'exact' ? '#4ade8040' : ev.xbrl_match === 'close' ? '#fbbf2440' : '#f8717140'}` }}>{ev.xbrl_match?.toUpperCase()} MATCH</span>
          </div>
          <div style={{ display: 'flex', gap: '12px', fontSize: '11px' }}>
            {ev.xbrl_claimed && <div><span style={{ color: '#888', fontSize: '9px', fontWeight: 600 }}>CLAIMED: </span><span style={{ color: '#fff', fontWeight: 700 }}>{ev.xbrl_claimed}</span></div>}
            {ev.xbrl_actual && <div><span style={{ color: '#888', fontSize: '9px', fontWeight: 600 }}>ACTUAL: </span><span style={{ color: '#d4af37', fontWeight: 700 }}>{ev.xbrl_actual}</span></div>}
          </div>
          {ev.xbrl_computation && <div className="syn-mono" style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>{ev.xbrl_computation}</div>}
          {ev.xbrl_discrepancy && ev.xbrl_match !== 'exact' && <div style={{ fontSize: '10px', color: ev.xbrl_match === 'close' ? '#fbbf24' : '#f87171', marginTop: '4px' }}>{ev.xbrl_discrepancy}</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '9px', color: '#555' }}>
        {ev.verified_against && <span style={{ color: '#d4af37', fontWeight: 600 }}>{ev.verified_against}</span>}
        {ev.year && <span>{ev.year}</span>}
        {ev.citations != null && <span>{ev.citations} cit.</span>}
        {!isExpanded && <span style={{ marginLeft: 'auto', color: '#444' }}>click to expand</span>}
      </div>
    </div>
  );
};

export default React.memo(VerificationDetail);
