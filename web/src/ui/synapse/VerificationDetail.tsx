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
        <div style={{ fontSize: '14px', color: 'var(--syn-text-heading)', fontWeight: 600, marginBottom: '6px' }}>Fetching & analyzing content...</div>
        <div style={{ fontSize: '12px', color: 'var(--syn-text-muted)', maxWidth: '340px', lineHeight: 1.6 }}>
          Extracting main content, identifying claim-dense passages, and preparing for verification.
        </div>
      </div>
    );
  }
  if (isExtracting) {
    return (
      <div className="syn-empty-state">
        <div className="syn-spinner" style={{ width: '28px', height: '28px', marginBottom: '16px' }} />
        <div style={{ fontSize: '14px', color: 'var(--syn-text-heading)', fontWeight: 600, marginBottom: '6px' }}>Extracting verifiable claims...</div>
        <div style={{ fontSize: '12px', color: 'var(--syn-text-muted)', maxWidth: '340px', lineHeight: 1.6 }}>
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
        <div style={{ fontSize: '14px', color: 'var(--syn-text-tertiary)', fontWeight: 500, marginBottom: '6px' }}>
          Select a claim to view verification details
        </div>
        <div style={{ fontSize: '12px', color: 'var(--syn-text-dim)', maxWidth: '300px', lineHeight: 1.6 }}>
          Click any claim in the sidebar, or press "Verify All" to analyze every extracted claim simultaneously.
        </div>
      </div>
    );
  }
  return <div style={{ flex: 1, backgroundColor: 'var(--syn-bg)' }} />;
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
      <div style={{ flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid var(--syn-border)', backgroundColor: 'var(--syn-bg)' }}>
        <div style={{ fontSize: '14px', color: 'var(--syn-text-heading)', lineHeight: 1.5, fontWeight: 500, marginBottom: '10px' }}>
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
              <span style={{ fontSize: '16px', fontWeight: 700, color: vc.text, textTransform: 'uppercase', letterSpacing: '1.5px', flexShrink: 0 }}>
                {v.overallVerdict.verdict.replace('_', ' ')}
              </span>
              <span style={{
                fontSize: '10px', fontWeight: 700,
                color: v.overallVerdict.confidence_score != null
                  ? (v.overallVerdict.confidence_score >= 70 ? '#6fad8e' : v.overallVerdict.confidence_score >= 40 ? '#c4a35a' : '#c47070')
                  : 'var(--syn-text-tertiary)',
                textTransform: 'uppercase', padding: '2px 8px', borderRadius: '4px',
                border: '1px solid var(--syn-border-strong)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                {v.overallVerdict.confidence_score != null && (
                  <span style={{ fontWeight: 900, fontSize: '11px' }}>{v.overallVerdict.confidence_score}</span>
                )}
                {v.overallVerdict.confidence}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--syn-text-secondary)', flex: 1 }}>
                {!verdictExpanded && v.overallVerdict.summary.length > 120
                  ? v.overallVerdict.summary.slice(0, 120) + '...'
                  : v.overallVerdict.summary}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--syn-text-muted)', flexShrink: 0, transition: 'transform 0.2s', transform: verdictExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
            </div>

            {verdictExpanded && (
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${vc.border}` }} className="syn-fade">
                {v.overallVerdict.detail && (
                  <div style={{ fontSize: '12px', color: 'var(--syn-text-tertiary)', lineHeight: 1.6, marginBottom: '12px' }}>
                    {v.overallVerdict.detail}
                  </div>
                )}
                {v.overallVerdict.confidence_breakdown && (() => {
                  const bd = v.overallVerdict!.confidence_breakdown!;
                  const bars = [
                    { label: 'Sources', score: bd.source_count.score, detail: `${bd.source_count.value} independent sources`, color: '#7090aa' },
                    { label: 'Tier Quality', score: bd.tier_quality.score, detail: `Avg authority: ${bd.tier_quality.value}${bd.tier_quality.has_sec_filing ? ' · SEC filing ✓' : ''}`, color: '#a89050' },
                    { label: 'Agreement', score: bd.agreement_ratio.score, detail: `${bd.agreement_ratio.supporting}/${bd.agreement_ratio.total_scored} support · ${bd.agreement_ratio.opposing} oppose`, color: '#6fad8e' },
                    { label: 'Recency', score: bd.recency.score, detail: bd.recency.value ? `Newest: ${bd.recency.value}` : 'Unknown', color: '#8a7ab5' },
                  ];
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div className="syn-section-header" style={{ marginBottom: '2px' }}>Calibrated Confidence Breakdown</div>
                      {bars.map(b => (
                        <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '10px', color: 'var(--syn-text-tertiary)', width: '70px', flexShrink: 0, textAlign: 'right' }}>{b.label}</span>
                          <div style={{ flex: 1, height: '6px', backgroundColor: '#1a1a1a', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${b.score}%`, height: '100%', backgroundColor: b.color, borderRadius: '3px', transition: 'width 0.5s ease' }} />
                          </div>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: b.color, width: '28px', textAlign: 'right', flexShrink: 0 }}>{b.score}</span>
                          <span style={{ fontSize: '9px', color: 'var(--syn-text-muted)', width: '160px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.detail}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {v.reconciliation && (
                  <div style={{
                    marginTop: '12px', padding: '10px 14px', borderRadius: '8px',
                    border: `1px solid ${v.reconciliation.accuracy_level === 'true' || v.reconciliation.accuracy_level === 'essentially_true' ? 'var(--syn-green-border)' : 'var(--syn-orange-border)'}`,
                    backgroundColor: v.reconciliation.accuracy_level === 'true' || v.reconciliation.accuracy_level === 'essentially_true' ? 'var(--syn-green-bg)' : 'var(--syn-orange-bg)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span className="syn-section-header">Final Assessment</span>
                      {v.overallVerdict?.reconciled && (
                        <span style={{ fontSize: '8px', fontWeight: 700, padding: '1px 6px', borderRadius: '3px', backgroundColor: 'var(--syn-green-bg)', color: '#6fad8e', border: '1px solid var(--syn-green-border)' }}>RECONCILED</span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--syn-text-secondary)', lineHeight: 1.6 }}>{v.reconciliation.explanation}</div>
                    {v.reconciliation.detail_added && (
                      <div style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)', lineHeight: 1.5, marginTop: '6px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--syn-text-tertiary)' }}>Added detail:</span> {v.reconciliation.detail_added}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Pipeline progress while verifying */
          <div>
            {/* Current stage banner */}
            {v.currentStep && (
              <div style={{ marginBottom: '10px', padding: '10px 14px', borderRadius: '8px', backgroundColor: 'var(--syn-bg-raised)', border: '1px solid var(--syn-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="syn-dot-pulse" style={{ width: '6px', height: '6px' }} />
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--syn-text-heading)', textTransform: 'capitalize' }}>
                      {v.stepLabel || v.currentStep.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <span className="syn-mono" style={{ fontSize: '10px', color: 'var(--syn-text-muted)' }}>
                    Stage {v.completedSteps.length + 1} of 13
                  </span>
                </div>
                <div style={{ height: '3px', backgroundColor: '#1a1a1a', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: '2px', backgroundColor: '#6fad8e',
                    width: `${Math.round(((v.completedSteps.length + 0.5) / 13) * 100)}%`,
                    transition: 'width 0.6s ease',
                  }} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {['decomposition', 'entity_resolution', 'normalization', 'evidence_retrieval', 'evaluation', 'contradictions', 'consistency', 'plausibility', 'synthesis', 'provenance', 'correction', 'reconciliation', 'risk_signals'].map(step => {
              const isDone = v.completedSteps.includes(step);
              const isCurrent = v.currentStep === step && !isDone;
              return (
                <div key={step} style={{
                  padding: '3px 8px', borderRadius: '5px', fontSize: '9px', fontWeight: 600,
                  border: '1px solid',
                  borderColor: isDone ? 'var(--syn-green-border)' : isCurrent ? 'var(--syn-border-hover)' : 'var(--syn-border)',
                  backgroundColor: isDone ? 'var(--syn-green-bg)' : isCurrent ? 'var(--syn-bg-hover)' : 'transparent',
                  color: isDone ? '#6fad8e' : isCurrent ? 'var(--syn-text-secondary)' : 'var(--syn-text-dim)',
                  display: 'flex', alignItems: 'center', gap: '3px', transition: 'all 0.3s',
                }}>
                  {isCurrent && <span className="syn-dot-pulse" style={{ width: '5px', height: '5px' }} />}
                  {isDone && <span>✓</span>}
                  {STEP_ICONS[step]} {step.replace('_', ' ')}
                </div>
              );
            })}
            </div>
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
                    border: `1px solid ${isDone ? `${chip.color}50` : isActive ? chip.color : 'var(--syn-border)'}`,
                    backgroundColor: isDone ? `${chip.color}15` : isActive ? `${chip.color}20` : 'transparent',
                    color: isDone ? chip.color : isActive ? chip.color : 'var(--syn-text-dim)',
                    opacity: isPending ? 0.35 : isDone ? 0.75 : 1,
                    transition: 'all 0.3s ease',
                    animation: isActive ? 'syn-agent-pulse 1.5s ease-in-out infinite' : 'none',
                    '--agent-glow': `${chip.color}60`,
                  } as React.CSSProperties}>
                    {isDone && <span style={{ fontSize: '8px' }}>✓</span>}
                    {isActive && <span className="syn-dot-pulse" style={{ width: '5px', height: '5px', backgroundColor: chip.color }} />}
                    {chip.label}
                  </div>
                  {i < agentChips.length - 1 && <span style={{ fontSize: '8px', color: 'var(--syn-text-ghost)' }}>→</span>}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Pipeline Stats */}
        {(pipelineStats.steps > 0 || pipelineStats.durationMs > 0) && (
          <div className="syn-mono syn-fade" style={{
            marginTop: '8px', fontSize: '9px', color: 'var(--syn-text-muted)', fontWeight: 600,
            display: 'flex', gap: '10px', flexWrap: 'wrap',
          }}>
            <span>{pipelineStats.steps} agent steps</span>
            <span style={{ color: 'var(--syn-text-ghost)' }}>·</span>
            <span>{pipelineStats.apiCalls} API calls</span>
            <span style={{ color: 'var(--syn-text-ghost)' }}>·</span>
            <span>{pipelineStats.services.size} services</span>
            <span style={{ color: 'var(--syn-text-ghost)' }}>·</span>
            <span>{pipelineStats.sources} sources evaluated</span>
            {pipelineStats.durationMs > 0 && (
              <>
                <span style={{ color: 'var(--syn-text-ghost)' }}>·</span>
                <span>{(pipelineStats.durationMs / 1000).toFixed(1)}s</span>
              </>
            )}
          </div>
        )}

        {/* Action bar — available as soon as verdict exists */}
        {v.overallVerdict && (
          <div style={{
            marginTop: '10px', padding: '10px 14px', borderRadius: '8px',
            border: '1px solid var(--syn-border)', backgroundColor: 'var(--syn-bg-sunken)',
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
          flexShrink: 0, borderBottom: '1px solid var(--syn-border)', backgroundColor: 'var(--syn-bg-sunken)',
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
              cursor: 'pointer', borderBottom: reasoningCollapsed ? 'none' : '1px solid var(--syn-border-subtle)',
              userSelect: 'none',
            }}
          >
            <span className={selectedClaim.status === 'verifying' ? 'syn-dot-pulse' : undefined}
              style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: selectedClaim.status === 'verifying' ? 'var(--syn-text-heading)' : '#333' }} />
            <span className="syn-mono" style={{ fontSize: '9px', fontWeight: 700, color: 'var(--syn-text-dim)', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
              REASONING TRACE
            </span>
            <span className="syn-mono" style={{ fontSize: '9px', color: 'var(--syn-text-ghost)' }}>{reasoningMessages.length}</span>
            <span style={{ marginLeft: 'auto', fontSize: '8px', color: 'var(--syn-text-ghost)', transform: reasoningCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }}>▼</span>
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
                    <span className="syn-mono" style={{ fontSize: '8px', color: 'var(--syn-text-ghost)', minWidth: '32px', flexShrink: 0, paddingTop: '2px', textAlign: 'right' }}>
                      {new Date(msg.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="syn-mono" style={{ fontSize: '8px', fontWeight: 700, color, minWidth: '80px', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.3px', paddingTop: '2px' }}>
                      {msg.agent.replace(/_/g, ' ').slice(0, 12)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="syn-mono" style={{ fontSize: '10px', color: 'var(--syn-text-tertiary)', lineHeight: 1.4, wordBreak: 'break-word' }}>{msg.message}</div>
                      {msg.detail && (
                        <div className="syn-mono" style={{ fontSize: '9px', color: 'var(--syn-text-dim)', lineHeight: 1.4, marginTop: '1px', wordBreak: 'break-word' }}>
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
      <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid var(--syn-border)', backgroundColor: 'var(--syn-bg-raised)' }}>
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
                backgroundColor: activeTab === tab.key ? 'var(--syn-bg-hover)' : '#1a1a1a',
                color: activeTab === tab.key ? 'var(--syn-text-heading)' : 'var(--syn-text-dim)',
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
                  border: `1px solid ${scColor?.border || 'var(--syn-border)'}`,
                  borderLeftWidth: '3px', borderLeftColor: scColor?.text || '#444',
                  backgroundColor: scColor?.bg || 'var(--syn-bg-raised)',
                  animation: `syn-slide-in 0.3s ease ${i * 0.08}s both`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: scColor?.text || '#444', animation: !sc.verdict ? 'syn-pulse 1.2s ease-in-out infinite' : 'none' }} />
                    <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--syn-text-muted)', textTransform: 'uppercase' }}>{sc.type}</span>
                    {sc.verdict && <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 800, color: scColor?.text, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{sc.verdict.replace('_', ' ')}</span>}
                    {sc.confidence && <span style={{ fontSize: '9px', color: 'var(--syn-text-muted)', fontWeight: 600 }}>{sc.confidence}</span>}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--syn-text-secondary)', lineHeight: 1.55 }}>{sc.text}</div>
                  {sc.summary && (
                    <div style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)', marginTop: '6px', lineHeight: 1.5, paddingTop: '6px', borderTop: '1px solid var(--syn-border)' }}>{sc.summary}</div>
                  )}
                </div>
              );
            })}
            {v.subclaims.length === 0 && selectedClaim.status === 'verifying' && (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div className="syn-spinner" style={{ width: '24px', height: '24px', margin: '0 auto 10px' }} />
                <div style={{ fontSize: '12px', color: 'var(--syn-text-heading)', marginBottom: '6px' }}>Decomposing claim into atomic sub-claims...</div>
                <div style={{ fontSize: '10px', color: 'var(--syn-text-muted)', maxWidth: '300px', margin: '0 auto', lineHeight: 1.5 }}>
                  Breaking down the claim into independently verifiable assertions
                </div>
              </div>
            )}
            {v.subclaims.length > 0 && selectedClaim.status === 'verifying' && !v.subclaims.every(sc => sc.verdict) && (
              <div style={{ padding: '10px 14px', marginBottom: '8px', borderRadius: '8px', border: '1px solid var(--syn-border)', backgroundColor: 'var(--syn-bg-sunken)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="syn-dot-pulse" />
                <span style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)' }}>
                  {v.completedSteps.includes('evaluation')
                    ? `Synthesizing verdicts — ${v.subclaims.filter(sc => sc.verdict).length}/${v.subclaims.length} complete`
                    : v.completedSteps.includes('evidence_retrieval')
                    ? 'Evaluating evidence quality...'
                    : v.currentStep
                    ? `${v.stepLabel || v.currentStep.replace(/_/g, ' ')}...`
                    : 'Processing...'}
                </span>
                <div style={{ flex: 1, height: '3px', backgroundColor: '#1a1a1a', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: '2px', backgroundColor: '#555',
                    width: `${Math.round((v.completedSteps.length / 13) * 100)}%`,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
                <span className="syn-mono" style={{ fontSize: '9px', color: 'var(--syn-text-dim)' }}>
                  {v.completedSteps.length}/13
                </span>
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
                  <div style={{ fontSize: '11px', fontWeight: 700, color: scColor?.text || 'var(--syn-text-tertiary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--syn-text-muted)', marginBottom: '8px' }}>Other Sources</div>
                {v.evidence.filter(e => !e.subclaim_id || !v.subclaims.find(sc => sc.id === e.subclaim_id)).map((ev, i) => (
                  <EvidenceCard key={ev.id} ev={ev} i={i} compact
                    isExpanded={expandedEvidenceId === ev.id}
                    onToggle={() => setExpandedEvidenceId(expandedEvidenceId === ev.id ? null : ev.id)} />
                ))}
              </div>
            )}
            {v.evidence.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                {selectedClaim.status === 'verifying' ? (
                  <>
                    <div className="syn-spinner" style={{ width: '20px', height: '20px', margin: '0 auto 12px' }} />
                    <div style={{ fontSize: '12px', color: 'var(--syn-text-heading)', marginBottom: '6px' }}>Searching for evidence...</div>
                    <div style={{ fontSize: '10px', color: 'var(--syn-text-muted)', maxWidth: '280px', margin: '0 auto', lineHeight: 1.5 }}>
                      Querying SEC EDGAR, XBRL, earnings calls, FRED, market data, and adversarial search
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--syn-text-muted)', fontSize: '12px' }}>No evidence collected yet</div>
                )}
              </div>
            )}
            {v.evidence.length > 0 && selectedClaim.status === 'verifying' && (
              <div style={{ padding: '8px 12px', marginBottom: '10px', borderRadius: '6px', backgroundColor: 'var(--syn-bg-sunken)', border: '1px solid var(--syn-border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="syn-dot-pulse" />
                <span style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)' }}>
                  {v.evidence.length} piece{v.evidence.length !== 1 ? 's' : ''} of evidence collected
                  {!v.completedSteps.includes('evidence_retrieval') && ' — still searching...'}
                </span>
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
                    low: { bg: 'var(--syn-amber-bg)', border: 'var(--syn-amber-border)', text: '#b09555' },
                    medium: { bg: 'var(--syn-orange-bg)', border: 'var(--syn-orange-border)', text: '#c48a5a' },
                    high: { bg: 'var(--syn-red-bg)', border: 'var(--syn-red-border)', text: '#c47070' },
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
                        <div style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--syn-bg-raised)', border: '1px solid var(--syn-border)' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: '#a89050', textTransform: 'uppercase', marginBottom: '4px' }}>{c.source_a?.type || 'Source A'}</div>
                          <div style={{ fontSize: '10px', color: 'var(--syn-text-tertiary)', marginBottom: '4px' }}>{c.source_a?.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--syn-text-secondary)', lineHeight: 1.5, fontStyle: 'italic' }}>"{c.source_a?.text}"</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: '10px', fontWeight: 800, color: sev.text }}>VS</span>
                        </div>
                        <div style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--syn-bg-raised)', border: '1px solid var(--syn-border)' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: '#6b9bd2', textTransform: 'uppercase', marginBottom: '4px' }}>{c.source_b?.type || 'Source B'}</div>
                          <div style={{ fontSize: '10px', color: 'var(--syn-text-tertiary)', marginBottom: '4px' }}>{c.source_b?.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--syn-text-secondary)', lineHeight: 1.5, fontStyle: 'italic' }}>"{c.source_b?.text}"</div>
                        </div>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--syn-text-tertiary)', lineHeight: 1.5, paddingTop: '10px', borderTop: `1px solid ${sev.border}` }}>{c.explanation}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--syn-text-muted)', fontSize: '12px' }}>
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
                <div style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)', lineHeight: 1.5, marginBottom: '4px' }}>
                  Cross-document consistency analysis detected subtle tensions between sources — beyond direct contradictions.
                </div>
                {v.consistencyIssues.map((ci, i) => {
                  const typeColors: Record<string, { bg: string; border: string; text: string; label: string }> = {
                    narrative_drift: { bg: 'var(--syn-purple-bg)', border: 'var(--syn-purple-border)', text: '#9a80b8', label: 'Narrative Drift' },
                    metric_inconsistency: { bg: 'var(--syn-red-bg)', border: 'var(--syn-red-border)', text: '#c47070', label: 'Metric Inconsistency' },
                    temporal_inconsistency: { bg: 'var(--syn-amber-bg)', border: 'var(--syn-amber-border)', text: '#c4a35a', label: 'Temporal Issue' },
                    omission_flag: { bg: 'var(--syn-teal-bg)', border: 'var(--syn-teal-border)', text: '#6a9f9c', label: 'Omission Flag' },
                    risk_factor_tension: { bg: 'var(--syn-orange-bg)', border: 'var(--syn-orange-border)', text: '#c48a5a', label: 'Risk Factor Tension' },
                  };
                  const tc = typeColors[ci.type] || typeColors.omission_flag;
                  const sevColors: Record<string, string> = { low: '#b09555', medium: '#c48a5a', high: '#c47070' };
                  return (
                    <div key={ci.id || i} style={{
                      padding: '16px', borderRadius: '10px',
                      border: `1px solid ${tc.border}`, backgroundColor: tc.bg,
                      animation: `syn-slide-in 0.3s ease ${i * 0.08}s both`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                        <span style={{ fontSize: '9px', fontWeight: 800, padding: '2px 8px', borderRadius: '3px', backgroundColor: `${tc.text}20`, color: tc.text, border: `1px solid ${tc.text}40`, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{tc.label}</span>
                        <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '3px', color: sevColors[ci.severity] || 'var(--syn-text-tertiary)', border: `1px solid ${(sevColors[ci.severity] || 'var(--syn-text-tertiary)')}40`, textTransform: 'uppercase' }}>{ci.severity}</span>
                        {ci.sources_involved?.length > 0 && (
                          <span style={{ fontSize: '9px', color: 'var(--syn-text-muted)', marginLeft: 'auto' }}>Sources: {ci.sources_involved.join(', ')}</span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--syn-text-secondary)', lineHeight: 1.6, marginBottom: '8px' }}>{ci.description}</div>
                      {ci.implication && (
                        <div style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)', lineHeight: 1.5, paddingTop: '8px', borderTop: `1px solid ${tc.border}`, fontStyle: 'italic' }}>
                          Implication: {ci.implication}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--syn-text-muted)', fontSize: '12px' }}>No cross-document consistency issues detected</div>
            )}
          </div>
        )}

        {/* Plausibility */}
        {activeTab === 'plausibility' && v.plausibility && (
          <div className="syn-fade">
            <div style={{ padding: '20px', borderRadius: '12px', marginBottom: '16px', border: '1px solid var(--syn-border)', backgroundColor: 'var(--syn-bg-raised)', textAlign: 'center' }}>
              <div className="syn-section-header" style={{ marginBottom: '8px', letterSpacing: '1.5px' }}>Forward-Looking Plausibility</div>
              <div style={{ fontSize: '40px', fontWeight: 700, letterSpacing: '-1px', color: v.plausibility.plausibility_score >= 70 ? '#6fad8e' : v.plausibility.plausibility_score >= 40 ? '#c4a35a' : '#c47070' }}>
                {v.plausibility.plausibility_score}
              </div>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: v.plausibility.plausibility_score >= 70 ? '#6fad8e' : v.plausibility.plausibility_score >= 40 ? '#c4a35a' : '#c47070', marginBottom: '12px' }}>
                {v.plausibility.plausibility_level?.replace(/_/g, ' ')}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--syn-text-tertiary)', lineHeight: 1.6, maxWidth: '500px', margin: '0 auto' }}>{v.plausibility.assessment}</div>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <div style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid var(--syn-green-border)', backgroundColor: 'var(--syn-green-bg)' }}>
                <div className="syn-section-header" style={{ color: '#6fad8e', marginBottom: '8px', letterSpacing: '1px' }}>Projection</div>
                <div style={{ fontSize: '12px', color: 'var(--syn-text-secondary)', lineHeight: 1.6 }}>
                  <div><span style={{ color: 'var(--syn-text-tertiary)' }}>Target:</span> {v.plausibility.projection?.target_metric}</div>
                  <div><span style={{ color: 'var(--syn-text-tertiary)' }}>Value:</span> {v.plausibility.projection?.target_value}</div>
                  <div><span style={{ color: 'var(--syn-text-tertiary)' }}>By:</span> {v.plausibility.projection?.target_date}</div>
                  <div><span style={{ color: 'var(--syn-text-tertiary)' }}>Requires:</span> {v.plausibility.projection?.implied_growth_rate}</div>
                </div>
              </div>
              <div style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid var(--syn-blue-border)', backgroundColor: 'var(--syn-blue-bg)' }}>
                <div className="syn-section-header" style={{ color: '#7090aa', marginBottom: '8px', letterSpacing: '1px' }}>Current Trajectory</div>
                <div style={{ fontSize: '12px', color: 'var(--syn-text-secondary)', lineHeight: 1.6 }}>
                  <div><span style={{ color: 'var(--syn-text-tertiary)' }}>Current:</span> {v.plausibility.current_trajectory?.current_value}</div>
                  <div><span style={{ color: 'var(--syn-text-tertiary)' }}>Trend:</span> {v.plausibility.current_trajectory?.trend?.replace(/_/g, ' ')}</div>
                  <div><span style={{ color: 'var(--syn-text-tertiary)' }}>Historical:</span> {v.plausibility.current_trajectory?.historical_growth_rate}</div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {v.plausibility.key_risks?.length > 0 && (
                <div style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid var(--syn-red-border)', backgroundColor: 'var(--syn-red-bg)' }}>
                  <div className="syn-section-header" style={{ color: '#c47070', marginBottom: '8px', letterSpacing: '1px' }}>Key Risks</div>
                  {v.plausibility.key_risks.map((r, i) => (
                    <div key={i} style={{ fontSize: '11px', color: 'var(--syn-text-secondary)', lineHeight: 1.5, marginBottom: '4px', paddingLeft: '10px', borderLeft: '2px solid var(--syn-red-border)' }}>{r}</div>
                  ))}
                </div>
              )}
              {v.plausibility.key_assumptions?.length > 0 && (
                <div style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid var(--syn-blue-border)', backgroundColor: 'var(--syn-blue-bg)' }}>
                  <div className="syn-section-header" style={{ color: '#8a7ab5', marginBottom: '8px', letterSpacing: '1px' }}>Key Assumptions</div>
                  {v.plausibility.key_assumptions.map((a, i) => (
                    <div key={i} style={{ fontSize: '11px', color: 'var(--syn-text-secondary)', lineHeight: 1.5, marginBottom: '4px', paddingLeft: '10px', borderLeft: '2px solid var(--syn-blue-border)' }}>{a}</div>
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
                  <div style={{ flex: 1, height: '1px', background: 'var(--syn-border)' }} />
                  <span style={{ fontSize: '10px', color: 'var(--syn-text-dim)' }}>{v.provenanceNodes.length} sources traced</span>
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
                              <div style={{ fontSize: '10px', color: 'var(--syn-text-tertiary)' }}>{node.source_name}</div>
                            </div>
                            {node.date && <span style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--syn-text-muted)', fontWeight: 600 }}>{node.date}</span>}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--syn-text-secondary)', lineHeight: 1.55, fontStyle: 'italic' }}>"{node.text}"</div>
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
                  <div style={{ marginTop: '8px', padding: '14px 16px', borderRadius: '10px', backgroundColor: 'var(--syn-bg-input)', border: '1px solid var(--syn-border)', fontSize: '13px', color: 'var(--syn-text-tertiary)', lineHeight: 1.65 }}>
                    <span style={{ fontWeight: 700, color: 'var(--syn-text-heading)', marginRight: '6px' }}>Analysis:</span>
                    {v.provenanceAnalysis}
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--syn-text-muted)', fontSize: '12px' }}>
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
                <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--syn-green-border)', backgroundColor: 'var(--syn-green-bg)' }}>
                  <div className="syn-section-header" style={{ color: '#6fad8e', marginBottom: '8px', letterSpacing: '1px' }}>Corrected Claim</div>
                  <div style={{ fontSize: '14px', color: 'var(--syn-text)', lineHeight: 1.6 }}>"{v.correctedClaim.corrected}"</div>
                </div>
                {(v.correctedClaim as any).changes?.length > 0 && (
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--syn-border)', backgroundColor: 'var(--syn-bg-raised)' }}>
                    <div className="syn-section-header" style={{ color: 'var(--syn-text-heading)', marginBottom: '10px', letterSpacing: '0.5px' }}>Changes Made</div>
                    {((v.correctedClaim as any).changes as { description: string; reason: string }[]).map((ch, i, arr) => (
                      <div key={i} style={{ padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--syn-border-subtle)' : 'none' }}>
                        <div style={{ fontSize: '12px', color: 'var(--syn-text)', fontWeight: 600, marginBottom: '4px' }}>{ch.description}</div>
                        <div style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)', lineHeight: 1.5 }}>{ch.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
                {v.correctedClaim.caveats?.length > 0 && (
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--syn-amber-border)', backgroundColor: 'var(--syn-amber-bg)' }}>
                    <div className="syn-section-header" style={{ color: '#c4a35a', marginBottom: '8px', letterSpacing: '0.5px' }}>Caveats</div>
                    {v.correctedClaim.caveats.map((c, i) => (
                      <div key={i} style={{ fontSize: '12px', color: 'var(--syn-text-secondary)', lineHeight: 1.5, padding: '3px 0', display: 'flex', gap: '8px' }}>
                        <span style={{ color: '#c4a35a', flexShrink: 0 }}>●</span> {c}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--syn-text-muted)', fontSize: '12px' }}>
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
                <div style={{ padding: '20px', borderRadius: '12px', border: '1px solid var(--syn-border)', backgroundColor: 'var(--syn-bg-raised)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-1px', color: v.riskSignals.risk_level === 'critical' ? '#c47070' : v.riskSignals.risk_level === 'high' ? '#c48a5a' : v.riskSignals.risk_level === 'medium' ? '#c4a35a' : '#6fad8e' }}>
                      {v.riskSignals.risk_score}
                    </span>
                    <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: v.riskSignals.risk_level === 'critical' ? '#c47070' : v.riskSignals.risk_level === 'high' ? '#c48a5a' : v.riskSignals.risk_level === 'medium' ? '#c4a35a' : '#6fad8e' }}>
                      Risk: {v.riskSignals.risk_level} ({v.riskSignals.risk_score}/100)
                    </div>
                  </div>
                  <div style={{ fontSize: '14px', color: 'var(--syn-text)', lineHeight: 1.6, fontWeight: 600 }}>{v.riskSignals.headline}</div>
                  <div style={{ fontSize: '12px', color: 'var(--syn-text-tertiary)', lineHeight: 1.6, marginTop: '8px' }}>{v.riskSignals.risk_narrative}</div>
                </div>
                {v.riskSignals.patterns_detected.length > 0 && (
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--syn-border)', backgroundColor: 'var(--syn-bg-raised)' }}>
                    <div className="syn-section-header" style={{ color: 'var(--syn-text-heading)', marginBottom: '10px', letterSpacing: '0.5px' }}>Patterns Detected</div>
                    {v.riskSignals.patterns_detected.map((p, i) => (
                      <div key={i} style={{ padding: '10px 0', borderBottom: i < v.riskSignals!.patterns_detected.length - 1 ? '1px solid var(--syn-border-subtle)' : 'none' }}>
                        <div style={{ fontSize: '12px', color: 'var(--syn-text)', fontWeight: 600, marginBottom: '4px' }}>{p.pattern}</div>
                        <div style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)', lineHeight: 1.5 }}>{p.evidence}</div>
                        <div style={{ fontSize: '10px', color: 'var(--syn-text-muted)', marginTop: '4px' }}>{p.frequency}</div>
                      </div>
                    ))}
                  </div>
                )}
                {v.riskSignals.red_flags.length > 0 && (
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--syn-red-border)', backgroundColor: 'var(--syn-red-bg)' }}>
                    <div className="syn-section-header" style={{ color: '#c47070', marginBottom: '8px', letterSpacing: '0.5px' }}>Red Flags</div>
                    {v.riskSignals.red_flags.map((f, i) => (
                      <div key={i} style={{ fontSize: '12px', color: '#c09090', lineHeight: 1.5, padding: '3px 0', display: 'flex', gap: '8px' }}>
                        <span style={{ color: '#c47070', flexShrink: 0 }}>●</span> {f}
                      </div>
                    ))}
                  </div>
                )}
                {v.riskSignals.recommended_actions.length > 0 && (
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--syn-green-border)', backgroundColor: 'var(--syn-green-bg)' }}>
                    <div className="syn-section-header" style={{ color: '#6fad8e', marginBottom: '8px', letterSpacing: '0.5px' }}>Recommended Actions</div>
                    {v.riskSignals.recommended_actions.map((a, i) => (
                      <div key={i} style={{ fontSize: '12px', color: '#90b8a0', lineHeight: 1.5, padding: '3px 0', display: 'flex', gap: '8px' }}>
                        <span style={{ color: '#6fad8e', flexShrink: 0 }}>{i + 1}.</span> {a}
                      </div>
                    ))}
                  </div>
                )}
                {(v.materiality || v.authorityConflicts.length > 0) && (
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--syn-border)', backgroundColor: 'var(--syn-bg-raised)' }}>
                    {v.materiality && (
                      <div style={{ marginBottom: v.authorityConflicts.length > 0 ? '12px' : '0' }}>
                        <div className="syn-section-header" style={{ color: 'var(--syn-text-heading)', marginBottom: '6px', letterSpacing: '0.5px' }}>Materiality</div>
                        <div style={{ fontSize: '12px', color: 'var(--syn-text-tertiary)', lineHeight: 1.5 }}>
                          <span style={{ color: v.materiality.materiality_level === 'critical' ? '#c47070' : v.materiality.materiality_level === 'high' ? '#c48a5a' : 'var(--syn-text-tertiary)', fontWeight: 600 }}>
                            {v.materiality.materiality_level.toUpperCase()}
                          </span>
                          {' '}({v.materiality.materiality_score}/100) — {v.materiality.category.replace(/_/g, ' ')}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)', marginTop: '4px' }}>{v.materiality.impact_assessment}</div>
                      </div>
                    )}
                    {v.authorityConflicts.length > 0 && (
                      <div>
                        <div className="syn-section-header" style={{ color: 'var(--syn-text-heading)', marginBottom: '6px', letterSpacing: '0.5px' }}>Source Authority Conflicts</div>
                        {v.authorityConflicts.map((ac, i) => (
                          <div key={i} style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)', lineHeight: 1.5, padding: '4px 0', borderBottom: i < v.authorityConflicts.length - 1 ? '1px solid var(--syn-border-subtle)' : 'none' }}>
                            <span style={{ color: ac.severity === 'critical' ? '#c47070' : ac.severity === 'high' ? '#c48a5a' : '#b09555', fontWeight: 600 }}>
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
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--syn-text-muted)', fontSize: '12px' }}>
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
  const qColor = qScore >= 70 ? '#6fad8e' : qScore >= 40 ? '#b09555' : '#8090a0';

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
          <span style={{ fontSize: '9px', color: 'var(--syn-text-muted)', fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: '#1a1a1a' }}>{ev.study_type}</span>
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
            backgroundColor: ev.supports_claim === true ? 'var(--syn-green-bg)' : ev.supports_claim === false ? 'var(--syn-red-bg)' : 'var(--syn-amber-bg)',
            color: ev.supports_claim === true ? '#6fad8e' : ev.supports_claim === false ? '#c47070' : '#c4a35a',
            border: `1px solid ${ev.supports_claim === true ? 'var(--syn-green-border)' : ev.supports_claim === false ? 'var(--syn-red-border)' : 'var(--syn-amber-border)'}`,
          }}>
            {ev.supports_claim === true ? 'SUPPORTS' : ev.supports_claim === false ? 'OPPOSES' : 'PARTIAL'}
          </span>
        )}
        <span style={{
          fontSize: compact ? '10px' : '10px', color: 'var(--syn-text-muted)',
          marginLeft: compact ? 'auto' : undefined,
          transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>▸</span>
      </div>

      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--syn-text-secondary)', marginBottom: '3px' }}>{ev.title}</div>
      <div style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)', lineHeight: 1.5 }}>
        {isExpanded ? (ev.snippet_full || ev.snippet) : (ev.snippet?.slice(0, 180) + ((ev.snippet?.length || 0) > 180 ? '...' : ''))}
      </div>

      {isExpanded && (
        <div style={{ marginTop: '10px', borderTop: '1px solid var(--syn-border)', paddingTop: '10px' }} className="syn-fade">
          {ev.assessment && (
            <div style={{ marginBottom: '8px' }}>
              <div className="syn-section-header" style={{ marginBottom: '4px', letterSpacing: '0.5px' }}>Assessment</div>
              <div style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)', lineHeight: 1.6 }}>{ev.assessment}</div>
            </div>
          )}
          {ev.source && (
            <div style={{ marginBottom: '8px' }}>
              <div className="syn-section-header" style={{ marginBottom: '4px', letterSpacing: '0.5px' }}>Source</div>
              <div style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)', lineHeight: 1.5 }}>{ev.source}</div>
            </div>
          )}
          {(ev.filing_type || ev.filing_date || ev.accession_number) && (
            <div style={{ marginBottom: '8px' }}>
              <div className="syn-section-header" style={{ marginBottom: '4px', letterSpacing: '0.5px' }}>Filing Details</div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--syn-text-tertiary)' }}>
                {ev.filing_type && <span><span style={{ color: 'var(--syn-text-tertiary)' }}>Type:</span> {ev.filing_type}</span>}
                {ev.filing_date && <span><span style={{ color: 'var(--syn-text-tertiary)' }}>Date:</span> {ev.filing_date}</span>}
                {ev.company_ticker && <span><span style={{ color: 'var(--syn-text-tertiary)' }}>Ticker:</span> {ev.company_ticker}</span>}
                {ev.accession_number && <span><span style={{ color: 'var(--syn-text-tertiary)' }}>Accession:</span> {ev.accession_number}</span>}
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
                      <span style={{ fontSize: '9px', color: 'var(--syn-text-muted)', marginLeft: 'auto', flexShrink: 0 }}>↗</span>
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
          backgroundColor: ev.xbrl_match === 'exact' ? 'var(--syn-green-bg)' : ev.xbrl_match === 'close' ? 'var(--syn-amber-bg)' : 'var(--syn-red-bg)',
          border: `1px solid ${ev.xbrl_match === 'exact' ? 'var(--syn-green-border)' : ev.xbrl_match === 'close' ? 'var(--syn-amber-border)' : 'var(--syn-red-border)'}`,
        }}>
          <div style={{ fontSize: '9px', fontWeight: 800, color: '#a89050', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            XBRL Ground Truth
            <span style={{ fontSize: '8px', padding: '1px 5px', borderRadius: '3px', backgroundColor: ev.xbrl_match === 'exact' ? '#6fad8e20' : ev.xbrl_match === 'close' ? '#c4a35a20' : '#c4707020', color: ev.xbrl_match === 'exact' ? '#6fad8e' : ev.xbrl_match === 'close' ? '#c4a35a' : '#c47070', border: `1px solid ${ev.xbrl_match === 'exact' ? '#6fad8e40' : ev.xbrl_match === 'close' ? '#c4a35a40' : '#c4707040'}` }}>{ev.xbrl_match?.toUpperCase()} MATCH</span>
          </div>
          <div style={{ display: 'flex', gap: '12px', fontSize: '11px' }}>
            {ev.xbrl_claimed && <div><span style={{ color: 'var(--syn-text-tertiary)', fontSize: '9px', fontWeight: 600 }}>CLAIMED: </span><span style={{ color: 'var(--syn-text-heading)', fontWeight: 700 }}>{ev.xbrl_claimed}</span></div>}
            {ev.xbrl_actual && <div><span style={{ color: 'var(--syn-text-tertiary)', fontSize: '9px', fontWeight: 600 }}>ACTUAL: </span><span style={{ color: '#a89050', fontWeight: 700 }}>{ev.xbrl_actual}</span></div>}
          </div>
          {ev.xbrl_computation && <div className="syn-mono" style={{ fontSize: '10px', color: 'var(--syn-text-tertiary)', marginTop: '4px' }}>{ev.xbrl_computation}</div>}
          {ev.xbrl_discrepancy && ev.xbrl_match !== 'exact' && <div style={{ fontSize: '10px', color: ev.xbrl_match === 'close' ? '#c4a35a' : '#c47070', marginTop: '4px' }}>{ev.xbrl_discrepancy}</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '9px', color: 'var(--syn-text-muted)' }}>
        {ev.verified_against && <span style={{ color: '#a89050', fontWeight: 600 }}>{ev.verified_against}</span>}
        {ev.year && <span>{ev.year}</span>}
        {ev.citations != null && <span>{ev.citations} cit.</span>}
        {!isExpanded && <span style={{ marginLeft: 'auto', color: 'var(--syn-text-dim)' }}>click to expand</span>}
      </div>
    </div>
  );
};

export default React.memo(VerificationDetail);
