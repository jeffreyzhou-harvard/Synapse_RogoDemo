import React, { useState } from 'react';
import type {
  ExtractedClaim, VerificationState, AgentChip,
  ProvenanceNode, ProvenanceEdge,
  SymbolicPredicate, SymbolicRuleFiring, SymbolicProofNode, SymbolicConfidence,
} from './types';
import {
  VERDICT_COLORS, TIER_LABELS, MUTATION_COLORS,
  STEP_ICONS, AGENT_COLORS,
} from './constants';

type TabId = 'subclaims' | 'evidence' | 'contradictions' | 'consistency' | 'plausibility' | 'provenance' | 'correction' | 'risk_signals' | 'reasoning';

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

/* ═══ Provenance Graph (expandable timeline) ═════════════════════════ */

const SOURCE_ICONS: Record<string, string> = {
  study: '📄', journalist: '📰', podcast: '🎙️', social: '📱', blog: '💻', claim: '💬',
  sec_filing: '⚖️', earnings_call: '🎙️', press_release: '📰', analyst_report: '📊', market_data: '📈',
};

const MUTATION_LABELS: Record<string, { label: string; description: string }> = {
  none:        { label: 'Faithful', description: 'Claim accurately reflects the original source with no meaningful alteration.' },
  slight:      { label: 'Minor Drift', description: 'Small wording changes that preserve core meaning but may lose nuance.' },
  significant: { label: 'Significant Mutation', description: 'Meaning has shifted noticeably — numbers rounded, context dropped, or scope changed.' },
  severe:      { label: 'Severe Distortion', description: 'The claim materially misrepresents the original source.' },
};

interface ProvenanceGraphProps {
  nodes: ProvenanceNode[];
  edges: ProvenanceEdge[];
  analysis?: string;
  isVerifying: boolean;
}

const ProvenanceGraph: React.FC<ProvenanceGraphProps> = ({ nodes, edges, analysis, isVerifying }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (nodes.length === 0) {
    return (
      <div className="syn-fade" style={{ textAlign: 'center', padding: '40px', color: '#555', fontSize: '12px' }}>
        {isVerifying ? (
          <div>
            <div className="syn-spinner" style={{ width: '24px', height: '24px', margin: '0 auto 10px' }} />
            <div>Tracing claim origins...</div>
          </div>
        ) : 'No provenance data yet'}
      </div>
    );
  }

  const expandedNode = expandedId ? nodes.find(n => n.id === expandedId) : null;
  const expandedMutInfo = expandedNode ? (MUTATION_LABELS[expandedNode.mutation_severity] || MUTATION_LABELS.none) : null;
  const expandedMutColor = expandedNode ? (MUTATION_COLORS[expandedNode.mutation_severity] || '#94a3b8') : '#555';

  return (
    <div className="syn-fade">
      {/* Header */}
      <div style={{ padding: '12px 0 4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className="syn-section-header" style={{ letterSpacing: '1px' }}>Claim Origin Timeline</span>
        <div style={{ flex: 1, height: '1px', background: '#1a1a1a' }} />
        <span style={{ fontSize: '10px', color: '#444' }}>{nodes.length} sources traced</span>
      </div>

      {/* Horizontal block timeline */}
      <div style={{ overflowX: 'auto', overflowY: 'hidden', padding: '28px 12px 20px', display: 'flex', alignItems: 'stretch', gap: '0', minHeight: '240px' }}>
        {nodes.map((node, i) => {
          const mutColor = MUTATION_COLORS[node.mutation_severity] || '#94a3b8';
          const nextNode = nodes[i + 1];
          const nextColor = nextNode ? (MUTATION_COLORS[nextNode.mutation_severity] || '#94a3b8') : mutColor;
          const icon = SOURCE_ICONS[node.source_type] || '📋';
          const isSelected = expandedId === node.id;

          return (
            <React.Fragment key={node.id}>
              <div
                role="button" tabIndex={0}
                onClick={() => setExpandedId(isSelected ? null : node.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isSelected ? null : node.id); } }}
                style={{
                  flexShrink: 0, width: '280px', padding: '16px 18px',
                  borderRadius: '10px', border: `1px solid ${isSelected ? `${mutColor}60` : `${mutColor}30`}`,
                  backgroundColor: `${mutColor}${isSelected ? '14' : '08'}`,
                  animation: `syn-slide-in 0.3s ease ${i * 0.15}s both`,
                  display: 'flex', flexDirection: 'column', gap: '10px',
                  cursor: 'pointer', transition: 'all 0.25s ease',
                  boxShadow: isSelected ? `0 0 24px ${mutColor}20` : 'none',
                  transform: isSelected ? 'scale(1.03)' : 'scale(1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: mutColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{node.source_type.replace(/_/g, ' ')}</div>
                    <div style={{ fontSize: '10px', color: '#888' }}>{node.source_name}</div>
                  </div>
                  {node.date && <span style={{ marginLeft: 'auto', fontSize: '9px', color: '#555', fontWeight: 600 }}>{node.date}</span>}
                </div>
                <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.55, fontStyle: 'italic' }}>"{node.text.length > 120 ? node.text.slice(0, 120) + '...' : node.text}"</div>
                <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: mutColor }} />
                  <span style={{ fontSize: '9px', fontWeight: 700, color: mutColor, textTransform: 'uppercase' }}>{node.mutation_severity} mutation</span>
                  <span style={{
                    marginLeft: 'auto', fontSize: '9px', color: isSelected ? mutColor : '#444',
                    transition: 'color 0.2s',
                  }}>
                    {isSelected ? '▲ collapse' : '▼ details'}
                  </span>
                </div>
              </div>
              {i < nodes.length - 1 && (
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

      {/* Expanded detail panel (slides in below the timeline) */}
      {expandedNode && expandedMutInfo && (
        <div style={{
          margin: '0 12px 16px', padding: '18px 20px', borderRadius: '12px',
          border: `1px solid ${expandedMutColor}35`,
          backgroundColor: `${expandedMutColor}06`,
          animation: 'syn-slide-in 0.25s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
            {/* Left: full source text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <span style={{ fontSize: '18px' }}>{SOURCE_ICONS[expandedNode.source_type] || '📋'}</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{expandedNode.source_name}</div>
                  <div style={{ fontSize: '10px', color: '#666', display: 'flex', gap: '8px', marginTop: '2px' }}>
                    <span>{expandedNode.source_type.replace(/_/g, ' ')}</span>
                    {expandedNode.date && <span>· {expandedNode.date}</span>}
                  </div>
                </div>
              </div>
              <div style={{
                padding: '14px 16px', borderRadius: '8px',
                backgroundColor: '#050505', border: '1px solid #141414',
              }}>
                <div className="syn-section-header" style={{ marginBottom: '8px', color: '#555' }}>Full Source Text</div>
                <div style={{ fontSize: '13px', color: '#ddd', lineHeight: 1.7, fontStyle: 'italic' }}>
                  "{expandedNode.text}"
                </div>
              </div>
            </div>

            {/* Right: mutation analysis */}
            <div style={{ width: '260px', flexShrink: 0 }}>
              <div style={{
                padding: '14px 16px', borderRadius: '10px',
                backgroundColor: `${expandedMutColor}0a`, border: `1px solid ${expandedMutColor}25`,
                marginBottom: '10px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div style={{
                    width: '12px', height: '12px', borderRadius: '50%', backgroundColor: expandedMutColor,
                    boxShadow: `0 0 8px ${expandedMutColor}50`,
                  }} />
                  <span style={{ fontSize: '13px', fontWeight: 800, color: expandedMutColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {expandedMutInfo.label}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#999', lineHeight: 1.65 }}>
                  {expandedMutInfo.description}
                </div>
              </div>

              {/* Mutation severity scale */}
              <div style={{
                padding: '12px 14px', borderRadius: '8px',
                backgroundColor: '#080808', border: '1px solid #1a1a1a',
              }}>
                <div className="syn-section-header" style={{ marginBottom: '8px', color: '#444' }}>Mutation Scale</div>
                {(['none', 'slight', 'significant', 'severe'] as const).map(sev => {
                  const c = MUTATION_COLORS[sev] || '#555';
                  const isActive = expandedNode.mutation_severity === sev;
                  return (
                    <div key={sev} style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0',
                      opacity: isActive ? 1 : 0.35,
                      transition: 'opacity 0.2s',
                    }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%', backgroundColor: c,
                        boxShadow: isActive ? `0 0 6px ${c}60` : 'none',
                      }} />
                      <span style={{ fontSize: '10px', fontWeight: isActive ? 800 : 500, color: isActive ? c : '#555', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                        {(MUTATION_LABELS[sev] || { label: sev }).label}
                      </span>
                      {isActive && <span style={{ fontSize: '8px', color: c, marginLeft: 'auto' }}>◀</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analysis */}
      {analysis && (
        <div style={{ marginTop: '8px', padding: '14px 16px', borderRadius: '10px', backgroundColor: '#080808', border: '1px solid #1a1a1a', fontSize: '13px', color: '#999', lineHeight: 1.65 }}>
          <span style={{ fontWeight: 700, color: '#fff', marginRight: '6px' }}>Analysis:</span>
          {analysis}
        </div>
      )}
    </div>
  );
};

/* ═══ Agent Activity Panel (live during verification) ════════════════ */

interface AgentActivityPanelProps {
  agentChips: AgentChip[];
  reasoningMessages: ReasoningMessage[];
  currentStep: string | undefined;
  stepLabel: string | undefined;
  pipelineStats: PipelineStats;
}

const AgentActivityPanel: React.FC<AgentActivityPanelProps> = ({
  agentChips, reasoningMessages, currentStep, stepLabel, pipelineStats,
}) => {
  const activeAgents = agentChips.filter(c => c.status === 'active');
  const doneAgents = agentChips.filter(c => c.status === 'done');
  const recentMessages = reasoningMessages.slice(-6);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} className="syn-fade">
      {/* Current step banner */}
      {stepLabel && (
        <div style={{
          padding: '12px 16px', borderRadius: '10px',
          border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a',
          display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <div className="syn-spinner" style={{ width: '18px', height: '18px', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{stepLabel}</div>
            <div className="syn-mono" style={{ fontSize: '10px', color: '#555', marginTop: '2px' }}>
              {pipelineStats.sources > 0 ? `${pipelineStats.sources} sources found` : 'Querying data sources...'}
              {pipelineStats.apiCalls > 0 && ` · ${pipelineStats.apiCalls} API calls`}
            </div>
          </div>
        </div>
      )}

      {/* Active agents grid */}
      {activeAgents.length > 0 && (
        <div>
          <div className="syn-section-header" style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="syn-dot-pulse" style={{ width: '5px', height: '5px' }} />
            Active Agents ({activeAgents.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {activeAgents.map((agent, i) => (
              <div key={agent.id} style={{
                padding: '10px 14px', borderRadius: '8px',
                border: `1px solid ${agent.color}30`,
                backgroundColor: `${agent.color}08`,
                display: 'flex', alignItems: 'center', gap: '10px',
                animation: `syn-slide-in 0.3s ease ${i * 0.05}s both`,
              }}>
                <span className="syn-dot-pulse" style={{ width: '7px', height: '7px', backgroundColor: agent.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: agent.color }}>{agent.label}</div>
                  <div className="syn-mono" style={{ fontSize: '9px', color: '#555', marginTop: '1px' }}>{agent.service}</div>
                </div>
                <div style={{
                  padding: '2px 8px', borderRadius: '4px', fontSize: '8px', fontWeight: 700,
                  backgroundColor: `${agent.color}15`, color: agent.color,
                  border: `1px solid ${agent.color}25`, textTransform: 'uppercase', letterSpacing: '0.5px',
                  animation: 'syn-pulse 1.5s ease-in-out infinite',
                }}>
                  working
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live reasoning stream */}
      {recentMessages.length > 0 && (
        <div>
          <div className="syn-section-header" style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            Agent Reasoning
          </div>
          <div style={{
            borderRadius: '8px', border: '1px solid #1a1a1a', backgroundColor: '#050505',
            overflow: 'hidden',
          }}>
            {recentMessages.map((msg, i) => {
              const color = AGENT_COLORS[msg.agent] || '#555';
              const isLatest = i === recentMessages.length - 1;
              return (
                <div key={i} style={{
                  padding: '8px 14px',
                  borderBottom: i < recentMessages.length - 1 ? '1px solid #111' : 'none',
                  opacity: isLatest ? 1 : 0.5 + (i / recentMessages.length) * 0.4,
                  animation: isLatest ? 'syn-slide-in 0.25s ease' : 'none',
                  display: 'flex', gap: '10px', alignItems: 'flex-start',
                }}>
                  <span style={{
                    width: '5px', height: '5px', borderRadius: '50%', backgroundColor: color,
                    flexShrink: 0, marginTop: '5px',
                    animation: isLatest ? 'syn-pulse 1.2s ease-in-out infinite' : 'none',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                      <span className="syn-mono" style={{ fontSize: '9px', fontWeight: 700, color, textTransform: 'uppercase' }}>
                        {msg.agent.replace(/_/g, ' ')}
                      </span>
                      <span className="syn-mono" style={{ fontSize: '8px', color: '#333' }}>{msg.stage.replace(/_/g, ' ')}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: isLatest ? '#ccc' : '#777', lineHeight: 1.45 }}>
                      {msg.message}
                    </div>
                    {msg.detail && isLatest && (
                      <div className="syn-mono" style={{ fontSize: '9px', color: '#444', lineHeight: 1.4, marginTop: '3px' }}>
                        {msg.detail.slice(0, 200)}{msg.detail.length > 200 ? '...' : ''}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Completed agents summary */}
      {doneAgents.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {doneAgents.map(agent => (
            <span key={agent.id} className="syn-mono" style={{
              fontSize: '9px', fontWeight: 600, padding: '3px 8px', borderRadius: '4px',
              backgroundColor: `${agent.color}10`, color: `${agent.color}90`,
              border: `1px solid ${agent.color}20`,
            }}>
              ✓ {agent.task}
            </span>
          ))}
        </div>
      )}
    </div>
  );
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

  /* Expandable story step state */
  const [expandedStory, setExpandedStory] = useState<string | null>(null);
  const toggleStory = (id: string) => setExpandedStory(prev => prev === id ? null : id);

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* ═══ VERDICT STORY — The Brain of Synapse ═══════════════════════ */}
      <div style={{
        borderBottom: '1px solid #1a1a1a', backgroundColor: '#000',
        background: v.overallVerdict && v.symbolicConfidence
          ? 'linear-gradient(180deg, #000 0%, #050208 40%, #000 100%)'
          : '#000',
      }}>
        {/* Claim text */}
        <div style={{ padding: '14px 16px 0' }}>
          <div style={{ fontSize: '13px', color: '#fff', lineHeight: 1.5, fontWeight: 500 }}>
            "{selectedClaim.original}"
          </div>
        </div>

        {/* ── Pipeline progress (while verifying, before verdict) ── */}
        {!v.overallVerdict && (
          <div style={{ padding: '10px 16px' }}>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {['decomposition', 'entity_resolution', 'normalization', 'evidence_retrieval', 'evaluation', 'contradictions', 'consistency', 'plausibility', 'synthesis', 'provenance', 'correction', 'reconciliation', 'risk_signals', 'symbolic_reasoning'].map(step => {
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
          </div>
        )}

        {/* ── THE VERDICT STORY (appears after verification completes) ── */}
        {v.overallVerdict && vc && (() => {
          const sc = v.symbolicConfidence;
          const neuralScore = v.overallVerdict!.confidence_score ?? 0;
          const bayScore = sc?.bayesian_score ?? neuralScore;
          const bayColor = bayScore >= 70 ? '#4ade80' : bayScore >= 40 ? '#fbbf24' : '#f87171';
          const neuralColor = neuralScore >= 70 ? '#4ade80' : neuralScore >= 40 ? '#fbbf24' : '#f87171';
          const delta = bayScore - neuralScore;
          const aligned = Math.abs(delta) < 10;
          const overrideRules = v.symbolicRuleFireings.filter(r => r.severity === 'override');
          const rel = sc?.symbolic_reliability;
          const relColor = rel ? (rel.score >= 65 ? '#4ade80' : rel.score >= 40 ? '#fbbf24' : '#f87171') : '#555';
          const hasOverride = v.symbolicVerdictOverride?.should_override;
          const supportingEvidence = v.evidence.filter(e => e.supports_claim === true);
          const opposingEvidence = v.evidence.filter(e => e.supports_claim === false);

          /* Build the story steps */
          const storySteps: { id: string; num: number; icon: string; title: string; summary: string; color: string; detail: React.ReactNode; done: boolean }[] = [];

          /* Step 1: Decomposition */
          storySteps.push({
            id: 'decompose', num: 1, icon: '🔬', title: 'Claim Decomposed',
            summary: v.subclaims.length > 0
              ? `Broke into ${v.subclaims.length} verifiable sub-claims: ${v.subclaims.slice(0, 2).map(s => `"${s.text.slice(0, 50)}${s.text.length > 50 ? '...' : ''}"`).join(', ')}${v.subclaims.length > 2 ? ` +${v.subclaims.length - 2} more` : ''}`
              : 'Analyzing claim structure...',
            color: '#60a5fa', done: v.subclaims.length > 0,
            detail: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {v.subclaims.map((sc, i) => {
                  const scColor = sc.verdict ? (VERDICT_COLORS[sc.verdict] || VERDICT_COLORS.unsupported) : null;
                  return (
                    <div key={sc.id} style={{
                      padding: '10px 12px', borderRadius: '8px',
                      borderLeft: `3px solid ${scColor?.text || '#444'}`,
                      backgroundColor: '#0a0a0a', border: `1px solid ${scColor?.border || '#1a1a1a'}`,
                      borderLeftWidth: '3px', borderLeftColor: scColor?.text || '#444',
                      animation: `syn-slide-in 0.2s ease ${i * 0.05}s both`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '9px', color: '#555', fontWeight: 600 }}>{sc.type}</span>
                        {sc.verdict && <span style={{ marginLeft: 'auto', fontSize: '9px', fontWeight: 800, color: scColor?.text, textTransform: 'uppercase' }}>{sc.verdict.replace('_', ' ')}</span>}
                        {sc.confidence && <span style={{ fontSize: '9px', color: '#555' }}>{sc.confidence}</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: '#ddd', lineHeight: 1.5 }}>{sc.text}</div>
                      {sc.summary && <div style={{ fontSize: '10px', color: '#888', marginTop: '4px', lineHeight: 1.4, paddingTop: '4px', borderTop: '1px solid #1a1a1a' }}>{sc.summary}</div>}
                    </div>
                  );
                })}
              </div>
            ),
          });

          /* Step 2: Evidence Gathered */
          storySteps.push({
            id: 'evidence', num: 2, icon: '📄', title: 'Evidence Gathered',
            summary: v.evidence.length > 0
              ? `Found ${v.evidence.length} sources: ${supportingEvidence.length} supporting, ${opposingEvidence.length} opposing. Top tiers: ${[...new Set(v.evidence.map(e => e.tier).filter(Boolean))].slice(0, 3).join(', ')}`
              : 'Searching for evidence...',
            color: '#fbbf24', done: v.evidence.length > 0,
            detail: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {v.evidence.slice(0, 8).map((ev, i) => {
                  const tierInfo = TIER_LABELS[ev.tier] || { label: ev.tier, icon: '📋', color: '#94a3b8' };
                  return (
                    <div key={ev.id} style={{
                      padding: '8px 10px', borderRadius: '6px', backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a',
                      animation: `syn-slide-in 0.15s ease ${i * 0.04}s both`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                        <span style={{ fontSize: '10px' }}>{tierInfo.icon}</span>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: tierInfo.color, textTransform: 'uppercase' }}>{tierInfo.label}</span>
                        <span style={{ fontSize: '11px', color: '#ccc', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</span>
                        {ev.supports_claim != null && (
                          <span style={{
                            fontSize: '8px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                            backgroundColor: ev.supports_claim === true ? '#0a1a0a' : ev.supports_claim === false ? '#1a0a0a' : '#1a1500',
                            color: ev.supports_claim === true ? '#4ade80' : ev.supports_claim === false ? '#f87171' : '#fbbf24',
                          }}>
                            {ev.supports_claim === true ? 'SUPPORTS' : ev.supports_claim === false ? 'OPPOSES' : 'PARTIAL'}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '10px', color: '#888', lineHeight: 1.4 }}>{ev.snippet?.slice(0, 120)}{(ev.snippet?.length || 0) > 120 ? '...' : ''}</div>
                    </div>
                  );
                })}
                {v.evidence.length > 8 && <div style={{ fontSize: '10px', color: '#555', textAlign: 'center', padding: '4px' }}>+{v.evidence.length - 8} more sources — see Evidence tab</div>}
              </div>
            ),
          });

          /* Step 3: Contradictions Found */
          if (v.contradictions.length > 0) {
            storySteps.push({
              id: 'contradictions', num: 3, icon: '⚡', title: 'Contradictions Detected',
              summary: `Found ${v.contradictions.length} contradiction${v.contradictions.length > 1 ? 's' : ''} between sources. ${v.contradictions[0]?.explanation?.slice(0, 100) || ''}`,
              color: '#f87171', done: true,
              detail: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {v.contradictions.map((c, i) => {
                    const sevColor = c.severity === 'high' ? '#f87171' : c.severity === 'medium' ? '#fb923c' : '#fbbf24';
                    return (
                      <div key={c.id || i} style={{
                        padding: '10px 12px', borderRadius: '8px', backgroundColor: '#0a0808', border: `1px solid ${sevColor}25`,
                        animation: `syn-slide-in 0.2s ease ${i * 0.06}s both`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                          <span style={{ fontSize: '8px', fontWeight: 800, padding: '2px 6px', borderRadius: '3px', backgroundColor: `${sevColor}15`, color: sevColor, textTransform: 'uppercase' }}>{c.severity}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '6px', fontSize: '10px' }}>
                          <div style={{ flex: 1, padding: '6px 8px', borderRadius: '4px', backgroundColor: '#080808', border: '1px solid #1a1a1a' }}>
                            <div style={{ fontSize: '8px', fontWeight: 700, color: '#d4af37', textTransform: 'uppercase', marginBottom: '2px' }}>{c.source_a?.type || 'Source A'}</div>
                            <div style={{ color: '#ccc', lineHeight: 1.4, fontStyle: 'italic' }}>"{c.source_a?.text?.slice(0, 100)}"</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', color: sevColor, fontWeight: 800, fontSize: '9px' }}>VS</div>
                          <div style={{ flex: 1, padding: '6px 8px', borderRadius: '4px', backgroundColor: '#080808', border: '1px solid #1a1a1a' }}>
                            <div style={{ fontSize: '8px', fontWeight: 700, color: '#6b9bd2', textTransform: 'uppercase', marginBottom: '2px' }}>{c.source_b?.type || 'Source B'}</div>
                            <div style={{ color: '#ccc', lineHeight: 1.4, fontStyle: 'italic' }}>"{c.source_b?.text?.slice(0, 100)}"</div>
                          </div>
                        </div>
                        <div style={{ fontSize: '10px', color: '#aaa', lineHeight: 1.4 }}>{c.explanation}</div>
                      </div>
                    );
                  })}
                </div>
              ),
            });
          }

          /* Step N-1: Symbolic Reasoning */
          if (sc) {
            const stepNum = storySteps.length + 1;
            storySteps.push({
              id: 'symbolic', num: stepNum, icon: '🧠', title: 'Neurosymbolic Analysis',
              summary: `Extracted ${sc.total_predicates} formal predicates (${sc.grounded_predicates} grounded), fired ${sc.rules_fired} inference rules. `
                + `Bayesian confidence: ${bayScore}/100 (${sc.bayesian_level}). `
                + (rel ? `Self-assessed reliability: ${rel.score}/100. ` : '')
                + (!aligned ? `Neural-symbolic divergence: ${Math.abs(delta)} points. ` : 'Neural and symbolic analysis aligned. ')
                + (overrideRules.length > 0 ? `${overrideRules.length} override rule${overrideRules.length > 1 ? 's' : ''} triggered.` : ''),
              color: '#a78bfa', done: true,
              detail: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {/* Dual confidence bars */}
                  <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: '#0a0a0a', border: '1px solid #a78bfa20' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                          <span style={{ fontSize: '9px', color: '#888', width: '55px', flexShrink: 0 }}>Neural</span>
                          <div style={{ flex: 1, height: '6px', borderRadius: '3px', backgroundColor: '#1a1a1a', overflow: 'hidden' }}>
                            <div style={{ width: `${neuralScore}%`, height: '100%', borderRadius: '3px', backgroundColor: neuralColor, transition: 'width 0.8s ease' }} />
                          </div>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: neuralColor, width: '32px', textAlign: 'right' }}>{neuralScore}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '9px', color: '#a78bfa', width: '55px', flexShrink: 0, fontWeight: 600 }}>Symbolic</span>
                          <div style={{ flex: 1, height: '6px', borderRadius: '3px', backgroundColor: '#1a1a1a', overflow: 'hidden' }}>
                            <div style={{ width: `${bayScore}%`, height: '100%', borderRadius: '3px', backgroundColor: bayColor, transition: 'width 0.8s ease' }} />
                          </div>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: bayColor, width: '32px', textAlign: 'right' }}>{bayScore}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'center', padding: '6px 12px', borderRadius: '6px', backgroundColor: aligned ? '#4ade8010' : '#fbbf2410', border: `1px solid ${aligned ? '#4ade8020' : '#fbbf2420'}` }}>
                        <div style={{ fontSize: '8px', color: '#888', textTransform: 'uppercase', fontWeight: 600 }}>{aligned ? 'Aligned' : 'Divergent'}</div>
                        <div style={{ fontSize: '14px', fontWeight: 900, color: aligned ? '#4ade80' : '#fbbf24' }}>{delta > 0 ? '+' : ''}{delta}</div>
                      </div>
                    </div>
                  </div>

                  {/* Reliability self-assessment */}
                  {rel && (
                    <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: '#080808', border: `1px solid ${relColor}20` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span style={{ fontSize: '10px' }}>🔍</span>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Self-Assessment</span>
                        <span style={{ fontSize: '11px', fontWeight: 900, color: relColor, marginLeft: 'auto' }}>{rel.score}/100</span>
                        <span style={{
                          fontSize: '8px', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                          backgroundColor: rel.can_override ? '#4ade8015' : '#f8717115',
                          color: rel.can_override ? '#4ade80' : '#f87171',
                          border: `1px solid ${rel.can_override ? '#4ade8030' : '#f8717130'}`,
                        }}>
                          {rel.can_override ? 'CAN OVERRIDE' : 'DEFERS TO NEURAL'}
                        </span>
                      </div>
                      {Object.entries(rel.factors).map(([key, val]) => {
                        const fColor = val >= 65 ? '#4ade80' : val >= 40 ? '#fbbf24' : '#f87171';
                        const labels: Record<string, string> = { predicate_coverage: 'Predicates', grounding_ratio: 'Grounding', evidence_structure: 'Evidence', claim_type_suitability: 'Claim Type', neural_consistency: 'Neural Agree' };
                        return (
                          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                            <span style={{ fontSize: '9px', color: '#555', width: '70px', flexShrink: 0, textAlign: 'right' }}>{labels[key] || key}</span>
                            <div style={{ flex: 1, height: '4px', borderRadius: '2px', backgroundColor: '#1a1a1a', overflow: 'hidden' }}>
                              <div style={{ width: `${val}%`, height: '100%', borderRadius: '2px', backgroundColor: fColor, transition: 'width 0.5s ease' }} />
                            </div>
                            <span style={{ fontSize: '9px', fontWeight: 700, color: fColor, width: '22px', textAlign: 'right' }}>{val}</span>
                          </div>
                        );
                      })}
                      {rel.reasons.length > 0 && (
                        <div style={{ marginTop: '6px' }}>
                          {rel.reasons.map((r: string, i: number) => (
                            <div key={i} style={{ fontSize: '9px', color: '#f8717199', lineHeight: 1.4, paddingLeft: '8px', borderLeft: '2px solid #f8717130', marginBottom: '2px' }}>{r}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Override rules */}
                  {overrideRules.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {overrideRules.map((rf, i) => (
                        <div key={rf.rule_id} style={{ padding: '6px 10px', borderRadius: '6px', backgroundColor: '#0a0808', border: '1px solid #f8717122' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                            <span style={{ fontSize: '9px' }}>🔴</span>
                            <span className="syn-mono" style={{ fontSize: '9px', fontWeight: 700, color: '#f87171' }}>{rf.rule_name}</span>
                            {rf.suggested_verdict && <span style={{ fontSize: '8px', color: '#f87171', fontWeight: 600, marginLeft: 'auto' }}>→ {rf.suggested_verdict.toUpperCase()}</span>}
                          </div>
                          <div style={{ fontSize: '10px', color: '#999', lineHeight: 1.4 }}>{rf.conclusion}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Quick predicate + rule stats */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '9px', padding: '2px 7px', borderRadius: '4px', backgroundColor: '#a78bfa10', border: '1px solid #a78bfa20', color: '#a78bfa' }}>
                      {sc.grounded_predicates}/{sc.total_predicates} predicates grounded
                    </span>
                    <span style={{ fontSize: '9px', padding: '2px 7px', borderRadius: '4px', backgroundColor: '#a78bfa10', border: '1px solid #a78bfa20', color: '#a78bfa' }}>
                      {sc.rules_fired} rules fired
                    </span>
                    <span style={{ fontSize: '9px', padding: '2px 7px', borderRadius: '4px', backgroundColor: '#a78bfa10', border: '1px solid #a78bfa20', color: '#a78bfa' }}>
                      {v.symbolicProofTree.length} proof nodes
                    </span>
                  </div>
                </div>
              ),
            });
          }

          /* Step N: Final Verdict */
          const finalStepNum = storySteps.length + 1;
          storySteps.push({
            id: 'verdict', num: finalStepNum, icon: hasOverride ? '⚠️' : '✅', title: hasOverride ? 'Verdict Overridden by Symbolic Layer' : 'Final Verdict',
            summary: hasOverride
              ? `Neural said "${v.symbolicVerdictOverride!.original_verdict.toUpperCase()}" but symbolic analysis (reliability: ${rel?.score || '?'}/100) overrode to "${v.symbolicVerdictOverride!.new_verdict.toUpperCase()}". ${v.symbolicVerdictOverride!.reason.slice(0, 120)}`
              : `${v.overallVerdict!.verdict.replace('_', ' ').toUpperCase()} — ${v.overallVerdict!.summary}`,
            color: hasOverride ? '#f87171' : vc.text, done: true,
            detail: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {hasOverride && (
                  <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: '#0a0808', border: '1px solid #f8717130' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#888', textDecoration: 'line-through', textDecorationColor: '#f87171' }}>
                        {v.symbolicVerdictOverride!.original_verdict.toUpperCase()}
                      </span>
                      <span style={{ fontSize: '10px', color: '#555' }}>→</span>
                      <span style={{ fontSize: '12px', fontWeight: 900, color: vc.text, textTransform: 'uppercase' }}>
                        {v.symbolicVerdictOverride!.new_verdict.replace('_', ' ')}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#aaa', lineHeight: 1.5 }}>{v.symbolicVerdictOverride!.reason}</div>
                  </div>
                )}
                {v.overallVerdict!.detail && (
                  <div style={{ fontSize: '11px', color: '#aaa', lineHeight: 1.6 }}>{v.overallVerdict!.detail}</div>
                )}
                {v.overallVerdict!.confidence_breakdown && (() => {
                  const bd = v.overallVerdict!.confidence_breakdown!;
                  const bars = [
                    { label: 'Sources', score: bd.source_count.score, detail: `${bd.source_count.value} independent`, color: '#6b9bd2' },
                    { label: 'Tier Quality', score: bd.tier_quality.score, detail: `Avg: ${bd.tier_quality.value}${bd.tier_quality.has_sec_filing ? ' · SEC ✓' : ''}`, color: '#d4af37' },
                    { label: 'Agreement', score: bd.agreement_ratio.score, detail: `${bd.agreement_ratio.supporting}/${bd.agreement_ratio.total_scored} support`, color: '#4ade80' },
                    { label: 'Recency', score: bd.recency.score, detail: bd.recency.value ? `${bd.recency.value}` : '?', color: '#a78bfa' },
                  ];
                  return (
                    <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
                      <div className="syn-section-header" style={{ marginBottom: '6px' }}>Confidence Breakdown</div>
                      {bars.map(b => (
                        <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                          <span style={{ fontSize: '9px', color: '#888', width: '60px', flexShrink: 0, textAlign: 'right' }}>{b.label}</span>
                          <div style={{ flex: 1, height: '5px', backgroundColor: '#1a1a1a', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${b.score}%`, height: '100%', backgroundColor: b.color, borderRadius: '3px', transition: 'width 0.5s ease' }} />
                          </div>
                          <span style={{ fontSize: '9px', fontWeight: 700, color: b.color, width: '24px', textAlign: 'right' }}>{b.score}</span>
                          <span style={{ fontSize: '8px', color: '#555', width: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.detail}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {v.reconciliation && (
                  <div style={{
                    padding: '10px 12px', borderRadius: '8px',
                    border: `1px solid ${v.reconciliation.accuracy_level === 'true' || v.reconciliation.accuracy_level === 'essentially_true' ? '#1a3a1a' : '#3a2a1a'}`,
                    backgroundColor: v.reconciliation.accuracy_level === 'true' || v.reconciliation.accuracy_level === 'essentially_true' ? '#0a1a0a' : '#1a1008',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span className="syn-section-header">Final Assessment</span>
                      {v.overallVerdict?.reconciled && <span style={{ fontSize: '8px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px', backgroundColor: '#1a3a1a', color: '#4ade80', border: '1px solid #2a4a2a' }}>RECONCILED</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: '#ccc', lineHeight: 1.5 }}>{v.reconciliation.explanation}</div>
                  </div>
                )}
              </div>
            ),
          });

          return (
            <div style={{ padding: '0 16px 12px' }}>
              {/* ── Hero verdict badge ── */}
              <div style={{
                margin: '10px 0 14px', padding: '14px 18px', borderRadius: '10px',
                border: `1px solid ${vc.border}`, backgroundColor: vc.bg,
                boxShadow: `0 0 24px ${vc.glow}`, animation: 'syn-verdict-pop 0.4s ease',
                display: 'flex', alignItems: 'center', gap: '16px',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '8px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>Synapse Verdict</span>
                  <span style={{ fontSize: '20px', fontWeight: 900, color: vc.text, textTransform: 'uppercase', letterSpacing: '1px', lineHeight: 1 }}>
                    {v.overallVerdict!.verdict.replace('_', ' ')}
                  </span>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
                  {sc && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '7px', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Symbolic</div>
                      <div style={{ fontSize: '16px', fontWeight: 900, color: bayColor }}>{bayScore}</div>
                    </div>
                  )}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '7px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Neural</div>
                    <div style={{ fontSize: '16px', fontWeight: 900, color: neuralColor }}>{neuralScore}</div>
                  </div>
                  {rel && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '7px', fontWeight: 700, color: relColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Reliability</div>
                      <div style={{ fontSize: '16px', fontWeight: 900, color: relColor }}>{rel.score}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Story header ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <span style={{ fontSize: '10px', fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1px' }}>How Synapse Reached This Verdict</span>
                <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, #a78bfa30, transparent)' }} />
              </div>

              {/* ── Story steps ── */}
              <div style={{ position: 'relative', paddingLeft: '20px' }}>
                {/* Vertical line */}
                <div style={{
                  position: 'absolute', left: '7px', top: '4px', bottom: '4px', width: '2px',
                  background: 'linear-gradient(180deg, #a78bfa40, #a78bfa10)',
                  borderRadius: '1px',
                }} />

                {storySteps.map((step, i) => {
                  const isExpanded = expandedStory === step.id;
                  const isLast = i === storySteps.length - 1;
                  return (
                    <div key={step.id} style={{
                      marginBottom: isLast ? '0' : '2px',
                      animation: `syn-slide-in 0.3s ease ${i * 0.08}s both`,
                    }}>
                      {/* Step header (always visible) */}
                      <div
                        role="button" tabIndex={0}
                        onClick={() => toggleStory(step.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStory(step.id); }}}
                        style={{
                          padding: '8px 12px', borderRadius: '8px', cursor: 'pointer',
                          backgroundColor: isExpanded ? `${step.color}08` : 'transparent',
                          border: `1px solid ${isExpanded ? `${step.color}25` : 'transparent'}`,
                          transition: 'all 0.2s',
                          marginLeft: '-20px', paddingLeft: '28px',
                          position: 'relative',
                        }}
                      >
                        {/* Timeline dot */}
                        <div style={{
                          position: 'absolute', left: '3px', top: '12px',
                          width: '10px', height: '10px', borderRadius: '50%',
                          backgroundColor: step.done ? step.color : '#333',
                          border: `2px solid ${step.done ? step.color : '#555'}`,
                          boxShadow: step.done ? `0 0 8px ${step.color}40` : 'none',
                          transition: 'all 0.3s',
                        }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px' }}>{step.icon}</span>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: step.color, letterSpacing: '0.2px' }}>{step.title}</span>
                          <span style={{
                            fontSize: '9px', color: '#555', marginLeft: 'auto', flexShrink: 0,
                            transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          }}>▼</span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#999', lineHeight: 1.5, marginTop: '3px' }}>
                          {step.summary}
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div style={{
                          marginTop: '4px', marginBottom: '8px', marginLeft: '8px',
                          padding: '10px 14px', borderRadius: '8px',
                          backgroundColor: '#050505', border: `1px solid ${step.color}15`,
                          animation: 'syn-fade 0.25s ease',
                        }}>
                          {step.detail}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ── Pipeline stats + actions (compact) ── */}
              <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {(pipelineStats.steps > 0 || pipelineStats.durationMs > 0) && (
                  <div className="syn-mono" style={{ fontSize: '9px', color: '#444', fontWeight: 600, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <span>{pipelineStats.steps} steps</span>
                    <span style={{ color: '#222' }}>·</span>
                    <span>{pipelineStats.apiCalls} API calls</span>
                    <span style={{ color: '#222' }}>·</span>
                    <span>{pipelineStats.sources} sources</span>
                    {pipelineStats.durationMs > 0 && (
                      <>
                        <span style={{ color: '#222' }}>·</span>
                        <span>{(pipelineStats.durationMs / 1000).toFixed(1)}s</span>
                      </>
                    )}
                  </div>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                  <button className="syn-btn" style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '9px' }}
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
                      ].filter(Boolean).join('\n');
                      navigator.clipboard.writeText(lines);
                    }}>
                    Copy Report
                  </button>
                  <button className="syn-btn" style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '9px' }}
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
                  {(v.overallVerdict?.verdict === 'contradicted' || v.overallVerdict?.verdict === 'exaggerated' || v.contradictions.length > 0) && (
                    <button className="syn-btn-danger" style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '9px' }}
                      onClick={() => {
                        const flag = [
                          '[FLAGGED FOR REVIEW]', `Claim: ${selectedClaim.original}`,
                          `Verdict: ${v.overallVerdict?.verdict}`,
                          `Reason: ${v.contradictions[0]?.explanation || v.overallVerdict?.summary}`,
                        ].join('\n');
                        navigator.clipboard.writeText(flag);
                      }}>
                      Flag
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Agent Chips (during verification) */}
        {!v.overallVerdict && agentChips.length > 0 && (
          <div style={{ padding: '0 16px 10px', display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }} className="syn-fade">
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
      </div>

      {/* ═══ Reasoning Feed ════════════════════════════════════════ */}
      {reasoningMessages.length > 0 && (
        <div style={{
          borderBottom: '1px solid #1a1a1a', backgroundColor: '#030303',
          maxHeight: reasoningCollapsed ? '28px' : (selectedClaim.status === 'verifying' ? '160px' : '100px'),
          overflow: 'hidden', transition: 'max-height 0.3s ease',
        }}>
          <div
            role="button" tabIndex={0}
            onClick={() => setReasoningCollapsed(!reasoningCollapsed)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setReasoningCollapsed(!reasoningCollapsed); }}}
            aria-expanded={!reasoningCollapsed}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 16px',
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
              overflow: 'auto', padding: '4px 0',
              maxHeight: selectedClaim.status === 'verifying' ? '128px' : '68px',
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

      {/* ═══ Tab Bar ════════════════════════════════════════════ */}
      <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', borderBottom: '1px solid #1a1a1a', backgroundColor: '#0a0a0a' }}>
        {([
          { key: 'reasoning' as const, label: 'Reasoning', icon: '🧠', count: v.symbolicProofTree.length, accent: true },
          { key: 'subclaims' as const, label: 'Sub-Claims', icon: '🔬', count: v.subclaims.length },
          { key: 'evidence' as const, label: 'Evidence', icon: '📄', count: v.evidence.length },
          { key: 'contradictions' as const, label: 'Contradictions', icon: '⚡', count: v.contradictions.length },
          ...(v.consistencyIssues.length > 0 ? [{ key: 'consistency' as const, label: 'Consistency', icon: '🔍', count: v.consistencyIssues.length }] : []),
          ...(v.plausibility ? [{ key: 'plausibility' as const, label: 'Plausibility', icon: '🎯', count: 1 }] : []),
          { key: 'provenance' as const, label: 'Provenance', icon: '🔗', count: v.provenanceNodes.length },
          { key: 'correction' as const, label: 'Correction', icon: '✏️', count: v.correctedClaim ? 1 : 0 },
          ...(v.riskSignals ? [{ key: 'risk_signals' as const, label: 'Risk', icon: '🚨', count: (v.riskSignals.red_flags || []).length }] : []),
        ] as { key: TabId; label: string; icon: string; count: number; accent?: boolean }[]).map(tab => (
          <button key={tab.key}
            className={`syn-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            style={tab.accent ? {
              borderBottomColor: activeTab === tab.key ? '#a78bfa' : undefined,
              color: activeTab === tab.key ? '#a78bfa' : undefined,
            } : undefined}
          >
            <span>{tab.icon}</span>
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                backgroundColor: activeTab === tab.key
                  ? (tab.accent ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.1)')
                  : '#1a1a1a',
                color: activeTab === tab.key
                  ? (tab.accent ? '#a78bfa' : '#fff')
                  : (tab.accent ? '#a78bfa80' : '#444'),
              }}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ Tab Content ═════════════════════════════════════════ */}
      <div style={{ padding: '12px 16px' }}>
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
              <AgentActivityPanel
                agentChips={agentChips}
                reasoningMessages={reasoningMessages}
                currentStep={v.currentStep}
                stepLabel={v.stepLabel}
                pipelineStats={pipelineStats}
              />
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
              <div style={{ padding: selectedClaim.status === 'verifying' ? '20px 0' : '40px', textAlign: selectedClaim.status === 'verifying' ? 'left' : 'center' }}>
                {selectedClaim.status === 'verifying' ? (
                  <AgentActivityPanel
                    agentChips={agentChips}
                    reasoningMessages={reasoningMessages}
                    currentStep={v.currentStep}
                    stepLabel={v.stepLabel}
                    pipelineStats={pipelineStats}
                  />
                ) : (
                  <div style={{ color: '#555', fontSize: '12px' }}>No evidence collected yet</div>
                )}
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
          <ProvenanceGraph
            nodes={v.provenanceNodes}
            edges={v.provenanceEdges}
            analysis={v.provenanceAnalysis}
            isVerifying={selectedClaim.status === 'verifying'}
          />
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

        {/* ═══ Reasoning (Neurosymbolic) ═══════════════════════════════ */}
        {activeTab === 'reasoning' && (
          <div className="syn-fade">
            {/* Bayesian Confidence Banner */}
            {v.symbolicConfidence && (() => {
              const sc = v.symbolicConfidence!;
              const bayColor = sc.bayesian_score >= 70 ? '#4ade80' : sc.bayesian_score >= 40 ? '#fbbf24' : '#f87171';
              const neuralScore = v.overallVerdict?.confidence_score ?? 0;
              const delta = sc.bayesian_score - neuralScore;
              const deltaColor = Math.abs(delta) < 10 ? '#4ade80' : Math.abs(delta) < 20 ? '#fbbf24' : '#f87171';
              return (
                <div style={{
                  padding: '12px 14px', borderRadius: '8px', marginBottom: '12px',
                  background: 'linear-gradient(135deg, #0a0a0a 0%, #111 100%)',
                  border: `1px solid ${bayColor}33`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '14px' }}>🧮</span>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' }}>Bayesian Confidence</span>
                    <span style={{ fontSize: '18px', fontWeight: 900, color: bayColor, marginLeft: 'auto' }}>{sc.bayesian_score}/100</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ flex: 1, height: '6px', borderRadius: '3px', backgroundColor: '#1a1a1a', overflow: 'hidden' }}>
                      <div style={{ width: `${sc.bayesian_score}%`, height: '100%', borderRadius: '3px', backgroundColor: bayColor, transition: 'width 0.8s ease' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '10px', color: '#888' }}>
                      <span style={{ color: '#555' }}>Neural: </span>
                      <span style={{ fontWeight: 700 }}>{neuralScore}/100</span>
                    </div>
                    <div style={{ fontSize: '10px', color: '#888' }}>
                      <span style={{ color: '#555' }}>Symbolic: </span>
                      <span style={{ fontWeight: 700, color: bayColor }}>{sc.bayesian_score}/100</span>
                    </div>
                    <div style={{ fontSize: '10px', color: deltaColor }}>
                      <span style={{ color: '#555' }}>Δ: </span>
                      <span style={{ fontWeight: 700 }}>{delta > 0 ? '+' : ''}{delta}</span>
                      <span style={{ color: '#555', marginLeft: '4px' }}>
                        {Math.abs(delta) < 10 ? '(aligned)' : Math.abs(delta) < 20 ? '(minor divergence)' : '(significant divergence)'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '9px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#111', border: '1px solid #222', color: '#888' }}>
                      P(claim) = {sc.claim_probability}
                    </div>
                    <div style={{ fontSize: '9px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#111', border: '1px solid #222', color: '#888' }}>
                      Rule adj: {sc.rule_adjustment > 0 ? '+' : ''}{sc.rule_adjustment}
                    </div>
                    <div style={{ fontSize: '9px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#111', border: '1px solid #222', color: '#888' }}>
                      {sc.grounded_predicates}/{sc.total_predicates} grounded
                    </div>
                    <div style={{ fontSize: '9px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#111', border: '1px solid #222', color: '#888' }}>
                      {sc.rules_fired} rules ({sc.override_rules} overrides)
                    </div>
                  </div>

                  {/* Symbolic Reliability Self-Assessment */}
                  {sc.symbolic_reliability && (() => {
                    const rel = sc.symbolic_reliability;
                    const relColor = rel.score >= 65 ? '#4ade80' : rel.score >= 40 ? '#fbbf24' : '#f87171';
                    const factorLabels: Record<string, string> = {
                      predicate_coverage: 'Predicate Coverage',
                      grounding_ratio: 'Grounding Ratio',
                      evidence_structure: 'Evidence Structure',
                      claim_type_suitability: 'Claim Type Fit',
                      neural_consistency: 'Neural Consistency',
                    };
                    return (
                      <div style={{
                        marginTop: '10px', padding: '10px 12px', borderRadius: '6px',
                        backgroundColor: '#080808', border: `1px solid ${relColor}20`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <span style={{ fontSize: '10px' }}>🔍</span>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Self-Assessment: How Reliable Is This Analysis?</span>
                          <span style={{ fontSize: '11px', fontWeight: 900, color: relColor, marginLeft: 'auto' }}>{rel.score}/100</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                          {Object.entries(rel.factors).map(([key, val]) => {
                            const fColor = val >= 65 ? '#4ade80' : val >= 40 ? '#fbbf24' : '#f87171';
                            return (
                              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '9px', color: '#666', width: '100px', flexShrink: 0, textAlign: 'right' }}>{factorLabels[key] || key}</span>
                                <div style={{ flex: 1, height: '4px', borderRadius: '2px', backgroundColor: '#1a1a1a', overflow: 'hidden' }}>
                                  <div style={{ width: `${val}%`, height: '100%', borderRadius: '2px', backgroundColor: fColor, transition: 'width 0.5s ease' }} />
                                </div>
                                <span style={{ fontSize: '9px', fontWeight: 700, color: fColor, width: '24px', textAlign: 'right' }}>{val}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: '8px', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                            backgroundColor: rel.can_override ? '#4ade8015' : '#f8717115',
                            color: rel.can_override ? '#4ade80' : '#f87171',
                            border: `1px solid ${rel.can_override ? '#4ade8030' : '#f8717130'}`,
                          }}>
                            {rel.can_override ? 'CAN OVERRIDE NEURAL' : 'CANNOT OVERRIDE — DEFERS TO NEURAL'}
                          </span>
                          <span style={{ fontSize: '8px', padding: '2px 6px', borderRadius: '3px', backgroundColor: '#111', border: '1px solid #222', color: '#888' }}>
                            Override conf: {rel.override_confidence}/100
                          </span>
                        </div>
                        {rel.reasons.length > 0 && (
                          <div style={{ marginTop: '6px' }}>
                            {rel.reasons.map((r: string, i: number) => (
                              <div key={i} style={{ fontSize: '9px', color: '#f8717199', lineHeight: 1.4, paddingLeft: '8px', borderLeft: '2px solid #f8717130', marginBottom: '2px' }}>
                                {r}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* Proof Tree */}
            {v.symbolicProofTree.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div className="syn-section-header" style={{ fontSize: '11px', fontWeight: 700, color: '#888', marginBottom: '8px', letterSpacing: '0.5px' }}>
                  PROOF TREE
                </div>
                <ProofTreeView nodes={v.symbolicProofTree} />
              </div>
            )}

            {/* Rule Firings */}
            {v.symbolicRuleFireings.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div className="syn-section-header" style={{ fontSize: '11px', fontWeight: 700, color: '#888', marginBottom: '8px', letterSpacing: '0.5px' }}>
                  INFERENCE RULES ({v.symbolicRuleFireings.length})
                </div>
                {v.symbolicRuleFireings.map((rf, i) => {
                  const sevColor = rf.severity === 'override' ? '#f87171' : rf.severity === 'warning' ? '#fbbf24' : '#4ade80';
                  const sevIcon = rf.severity === 'override' ? '🔴' : rf.severity === 'warning' ? '🟡' : '🟢';
                  return (
                    <div key={rf.rule_id} className="syn-fade" style={{
                      padding: '8px 10px', borderRadius: '6px', marginBottom: '6px',
                      backgroundColor: '#0a0a0a', border: `1px solid ${sevColor}22`,
                      animation: `syn-slide-in 0.2s ease ${i * 0.05}s both`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '10px' }}>{sevIcon}</span>
                        <span className="syn-mono" style={{ fontSize: '10px', fontWeight: 700, color: sevColor }}>{rf.rule_name}</span>
                        <span style={{
                          fontSize: '8px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                          backgroundColor: `${sevColor}15`, color: sevColor, textTransform: 'uppercase',
                        }}>{rf.severity}</span>
                        {rf.confidence_delta !== 0 && (
                          <span style={{
                            fontSize: '9px', fontWeight: 700, marginLeft: 'auto',
                            color: rf.confidence_delta > 0 ? '#4ade80' : '#f87171',
                          }}>
                            {rf.confidence_delta > 0 ? '+' : ''}{(rf.confidence_delta * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '10px', color: '#999', lineHeight: 1.4 }}>{rf.description}</div>
                      <div style={{ fontSize: '10px', color: '#666', marginTop: '3px', fontStyle: 'italic' }}>→ {rf.conclusion}</div>
                      {rf.suggested_verdict && (
                        <div style={{ fontSize: '9px', color: '#f87171', marginTop: '3px', fontWeight: 600 }}>
                          Suggests: {rf.suggested_verdict.toUpperCase()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Predicates */}
            {v.symbolicPredicates.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div className="syn-section-header" style={{ fontSize: '11px', fontWeight: 700, color: '#888', marginBottom: '8px', letterSpacing: '0.5px' }}>
                  FORMAL PREDICATES ({v.symbolicPredicates.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {v.symbolicPredicates.map((pred, i) => {
                    const typeColors: Record<string, string> = {
                      metric: '#60a5fa', growth: '#4ade80', comparison: '#fbbf24',
                      temporal: '#a78bfa', source: '#f472b6', relation: '#fb923c',
                      existence: '#94a3b8', causal: '#e879f9',
                    };
                    const color = typeColors[pred.type] || '#94a3b8';
                    const argsStr = Object.entries(pred.args).slice(0, 3).map(([k, v]) => `${k}=${typeof v === 'number' ? v.toLocaleString() : String(v).slice(0, 20)}`).join(', ');
                    return (
                      <div key={pred.id} style={{
                        padding: '3px 8px', borderRadius: '4px', fontSize: '9px',
                        backgroundColor: `${color}10`, border: `1px solid ${color}30`,
                        color: color, fontFamily: 'monospace', fontWeight: 600,
                        animation: `syn-slide-in 0.15s ease ${i * 0.03}s both`,
                      }}>
                        {pred.type.toUpperCase()}({argsStr})
                        <span style={{ marginLeft: '4px', opacity: 0.6 }}>{pred.grounded ? '✓' : '?'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sub-claim Probability Breakdown */}
            {v.symbolicConfidence && Object.keys(v.symbolicConfidence.subclaim_probabilities).length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div className="syn-section-header" style={{ fontSize: '11px', fontWeight: 700, color: '#888', marginBottom: '8px', letterSpacing: '0.5px' }}>
                  SUB-CLAIM PROBABILITIES
                </div>
                {Object.entries(v.symbolicConfidence.subclaim_probabilities).map(([scId, prob]) => {
                  const pct = Math.round(prob * 100);
                  const barColor = pct >= 70 ? '#4ade80' : pct >= 40 ? '#fbbf24' : '#f87171';
                  const scVerdict = v.subclaims.find(sc => sc.id === scId);
                  return (
                    <div key={scId} style={{ marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                        <span className="syn-mono" style={{ fontSize: '9px', color: '#555', minWidth: '40px' }}>{scId}</span>
                        <span style={{ fontSize: '10px', color: '#999', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {scVerdict?.text || scId}
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: barColor }}>{pct}%</span>
                      </div>
                      <div style={{ height: '3px', borderRadius: '2px', backgroundColor: '#1a1a1a', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', borderRadius: '2px', backgroundColor: barColor, transition: 'width 0.6s ease' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Empty state */}
            {v.symbolicProofTree.length === 0 && v.symbolicPredicates.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#555', fontSize: '12px' }}>
                {selectedClaim.status === 'verifying' ? (
                  <div>
                    <div className="syn-spinner" style={{ width: '24px', height: '24px', margin: '0 auto 10px' }} />
                    <div>Running neurosymbolic reasoning...</div>
                  </div>
                ) : 'No symbolic reasoning data yet'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══ Proof Tree Visualization ═══════════════════════════════════════ */

const PROOF_NODE_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  claim:     { bg: '#0a0a1a', border: '#3b82f6', icon: '💬' },
  premise:   { bg: '#0a1a0a', border: '#4ade80', icon: '📋' },
  evidence:  { bg: '#1a1a0a', border: '#fbbf24', icon: '📄' },
  rule:      { bg: '#1a0a0a', border: '#f87171', icon: '⚖️' },
  inference: { bg: '#1a0a1a', border: '#a78bfa', icon: '🔣' },
  verdict:   { bg: '#0a1a1a', border: '#06b6d4', icon: '✅' },
};

const PROOF_STATUS_COLORS: Record<string, string> = {
  verified: '#4ade80', refuted: '#f87171', partial: '#fbbf24',
  supported: '#4ade80', contradicted: '#f87171', mixed: '#fbbf24',
  exaggerated: '#fb923c', unsupported: '#94a3b8', pending: '#555',
};

const ProofTreeView: React.FC<{ nodes: SymbolicProofNode[] }> = ({ nodes }) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const toggleNode = (id: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Find the root (verdict node or first node)
  const verdictNode = nodes.find(n => n.type === 'verdict') || nodes[0];
  if (!verdictNode) return null;

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const renderNode = (nodeId: string, depth: number): React.ReactNode => {
    const node = nodeMap.get(nodeId);
    if (!node) return null;

    const style = PROOF_NODE_COLORS[node.type] || PROOF_NODE_COLORS.inference;
    const statusColor = PROOF_STATUS_COLORS[node.status] || '#555';
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedNodes.has(node.id);
    const confPct = Math.round(node.confidence * 100);

    return (
      <div key={node.id} style={{ marginLeft: depth * 16, marginBottom: '4px' }}>
        <div
          role={hasChildren ? 'button' : undefined}
          tabIndex={hasChildren ? 0 : undefined}
          onClick={() => hasChildren && toggleNode(node.id)}
          onKeyDown={e => { if (hasChildren && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleNode(node.id); }}}
          style={{
            padding: '6px 10px', borderRadius: '6px',
            backgroundColor: style.bg, border: `1px solid ${style.border}30`,
            cursor: hasChildren ? 'pointer' : 'default',
            transition: 'all 0.15s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {hasChildren && (
              <span style={{ fontSize: '8px', color: '#555', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▶</span>
            )}
            <span style={{ fontSize: '10px' }}>{style.icon}</span>
            <span style={{ fontSize: '9px', fontWeight: 700, color: style.border, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{node.type}</span>
            <span style={{ fontSize: '10px', color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.label}
            </span>
            <span style={{
              fontSize: '8px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
              backgroundColor: `${statusColor}15`, color: statusColor, textTransform: 'uppercase',
            }}>{node.status}</span>
            <span style={{ fontSize: '9px', fontWeight: 700, color: statusColor }}>{confPct}%</span>
          </div>
          {node.detail && isExpanded && (
            <div style={{ fontSize: '10px', color: '#888', marginTop: '4px', lineHeight: 1.4, paddingLeft: '20px' }}>
              {node.detail}
            </div>
          )}
        </div>
        {isExpanded && hasChildren && (
          <div style={{ borderLeft: `1px solid ${style.border}20`, marginLeft: '8px', paddingLeft: '4px', marginTop: '2px' }}>
            {node.children.map(childId => renderNode(childId, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return <div>{renderNode(verdictNode.id, 0)}</div>;
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
