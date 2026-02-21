import type { AgentChip } from './types';

// ─── API Base URL ────────────────────────────────────────────────────────
export const API_BASE = window.location.hostname === 'localhost' ? '' : 'https://web-production-d3011.up.railway.app';

// ─── Verdict Colors ──────────────────────────────────────────────────────
export const VERDICT_COLORS: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  supported:            { bg: '#0a1a0a', text: '#4ade80', border: '#1a3a1a', glow: 'rgba(74,222,128,0.12)' },
  partially_supported:  { bg: '#1a1500', text: '#fbbf24', border: '#3a3000', glow: 'rgba(251,191,36,0.12)' },
  exaggerated:          { bg: '#1a1000', text: '#fb923c', border: '#3a2000', glow: 'rgba(251,146,60,0.12)' },
  contradicted:         { bg: '#1a0a0a', text: '#f87171', border: '#3a1a1a', glow: 'rgba(248,113,113,0.12)' },
  unsupported:          { bg: '#111111', text: '#888888', border: '#222222', glow: 'rgba(136,136,136,0.08)' },
  mixed:                { bg: '#1a1500', text: '#fbbf24', border: '#3a3000', glow: 'rgba(251,191,36,0.12)' },
};

// ─── Evidence Tier Labels ────────────────────────────────────────────────
export const TIER_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  sec_filing:           { label: 'SEC Filing',      icon: '⚖️', color: '#d4af37' },
  earnings_transcript:  { label: 'Earnings Call',   icon: '🎙️', color: '#6b9bd2' },
  press_release:        { label: 'Press Release',   icon: '📰', color: '#5ec4a0' },
  analyst_report:       { label: 'Analyst Report',  icon: '📊', color: '#a78bfa' },
  market_data:          { label: 'Market Data',     icon: '📈', color: '#4ade80' },
  counter:              { label: 'Contradicting',   icon: '⚠️', color: '#f87171' },
};

// ─── Mutation Colors (Provenance) ────────────────────────────────────────
export const MUTATION_COLORS: Record<string, string> = {
  none: '#4ade80',
  slight: '#fbbf24',
  significant: '#fb923c',
  severe: '#f87171',
};

// ─── Pipeline Step Icons ─────────────────────────────────────────────────
export const STEP_ICONS: Record<string, string> = {
  decomposition: '🔬',
  entity_resolution: '🏢',
  normalization: '📐',
  numerical_grounding: '🔢',
  evidence_retrieval: '🔍',
  temporal_xbrl: '📅',
  staleness: '⏰',
  citation_verification: '📎',
  evaluation: '⚖️',
  contradictions: '⚡',
  consistency: '🔄',
  plausibility: '📊',
  synthesis: '🧠',
  provenance: '🔗',
  correction: '✏️',
  reconciliation: '⚖️',
  risk_signals: '🚨',
};

// ─── Agent Brand Colors ──────────────────────────────────────────────────
export const AGENT_BRAND_COLORS: Record<string, { color: string; label: string }> = {
  reasoning:   { color: '#e8c8a0', label: 'Reasoning' },
  filings:     { color: '#d4af37', label: 'Filings' },
  search:      { color: '#6bccc8', label: 'Search' },
  transcribe:  { color: '#a78bfa', label: 'Transcribe' },
};

// ─── Agent Reasoning Feed Colors ─────────────────────────────────────────
export const AGENT_COLORS: Record<string, string> = {
  resolver: '#6bccc8',
  decomposer: '#6bccc8',
  normalizer: '#6b9bd2',
  numerical_engine: '#60a5fa',
  temporal_analyst: '#d4af37',
  staleness_detector: '#fbbf24',
  citation_verifier: '#f0abfc',
  retriever: '#6bccc8',
  evaluator: '#e8c8a0',
  contradiction_detector: '#f87171',
  consistency_analyzer: '#fbbf24',
  plausibility_assessor: '#a78bfa',
  synthesizer: '#e8c8a0',
  provenance_tracer: '#6bccc8',
  reconciler: '#4ade80',
  risk_analyst: '#f87171',
};

// ─── Initial Pipeline Chips ──────────────────────────────────────────────
export const INITIAL_PIPELINE: Omit<AgentChip, 'status'>[] = [
  { id: 'extract',       service: 'reasoning',  task: 'Extract',        label: 'Extract Claims',               color: '#e8c8a0' },
  { id: 'decompose',     service: 'reasoning',  task: 'Decompose',      label: 'Decompose Claims',             color: '#e8c8a0' },
  { id: 'numground',     service: 'reasoning',  task: 'Numbers',        label: 'Numerical Grounding',          color: '#60a5fa' },
  { id: 'edgar',         service: 'filings',    task: 'SEC Filings',    label: 'SEC Filing Retrieval',          color: '#d4af37' },
  { id: 'sonar_web',     service: 'search',     task: 'Earnings/News',  label: 'Earnings & News Search',       color: '#6bccc8' },
  { id: 'temporal',      service: 'filings',    task: 'XBRL Series',    label: 'Multi-Period XBRL',            color: '#d4af37' },
  { id: 'staleness',     service: 'filings',    task: 'Freshness',      label: 'Source Staleness Check',       color: '#fbbf24' },
  { id: 'citations',     service: 'reasoning',  task: 'Citations',      label: 'Citation Verification',        color: '#f0abfc' },
  { id: 'sonar_counter', service: 'reasoning',  task: 'Counter',        label: 'Contradiction Detection',      color: '#e8c8a0' },
  { id: 'evaluate',      service: 'reasoning',  task: 'Evaluate',       label: 'Evidence Evaluation',           color: '#e8c8a0' },
  { id: 'synthesize',    service: 'reasoning',  task: 'Synthesize',     label: 'Verdict Synthesis',             color: '#e8c8a0' },
  { id: 'provenance',    service: 'search',     task: 'Provenance',     label: 'Provenance Tracing',            color: '#6bccc8' },
  { id: 'correct',       service: 'reasoning',  task: 'Correct',        label: 'Claim Correction',              color: '#e8c8a0' },
];

// ─── Step → Chip Mappings ────────────────────────────────────────────────
export const STEP_TO_CHIP: Record<string, string> = {
  decomposition: 'decompose',
  entity_resolution: 'decompose',
  normalization: 'decompose',
  numerical_grounding: 'numground',
  staleness: 'staleness',
  citation_verification: 'citations',
  evaluation: 'evaluate',
  contradictions: 'sonar_counter',
  consistency: 'sonar_counter',
  plausibility: 'evaluate',
  temporal_xbrl: 'temporal',
  synthesis: 'synthesize',
  provenance: 'provenance',
  correction: 'correct',
  reconciliation: 'correct',
  risk_signals: 'synthesize',
};

export const STEP_COMPLETE_CHIPS: Record<string, string[]> = {
  decomposition: ['decompose'],
  entity_resolution: ['decompose'],
  normalization: ['decompose'],
  numerical_grounding: ['numground'],
  staleness: ['staleness'],
  citation_verification: ['citations'],
  evaluation: ['evaluate'],
  contradictions: ['sonar_counter'],
  consistency: ['sonar_counter'],
  plausibility: ['evaluate'],
  temporal_xbrl: ['temporal'],
  synthesis: ['synthesize'],
  provenance: ['provenance'],
  correction: ['correct'],
  reconciliation: ['correct'],
  risk_signals: ['synthesize'],
  evidence_retrieval: ['edgar', 'sonar_web'],
};

export const STEP_BADGE: Record<string, string> = {
  decomposition: 'reasoning',
  entity_resolution: 'reasoning',
  normalization: 'reasoning',
  numerical_grounding: 'reasoning',
  temporal_xbrl: 'filings',
  staleness: 'filings',
  citation_verification: 'reasoning',
  evaluation: 'reasoning',
  contradictions: 'reasoning',
  consistency: 'reasoning',
  plausibility: 'reasoning',
  synthesis: 'reasoning',
  correction: 'reasoning',
  reconciliation: 'reasoning',
  provenance: 'search',
  risk_signals: 'reasoning',
  evidence_retrieval: 'filings',
};

// ─── Preloaded Examples ──────────────────────────────────────────────────
export const PRELOADED_EXAMPLES = [
  { claim: "Apple's gross margin was 46.2% in Q4 2024", verdict: 'supported', source: '10-K FY2024', tag: 'VERIFIED' },
  { claim: "Company X acquired Company Y in 2023 for $500M", verdict: 'contradicted', source: 'No 8-K found', tag: 'HALLUCINATION' },
  { claim: "Nvidia's data center revenue grew 409% YoY", verdict: 'exaggerated', source: '10-K FY2024', tag: 'EXAGGERATED' },
  { claim: "SaaS market will grow 15% per Gartner 2021", verdict: 'exaggerated', source: 'Revised 2024', tag: 'STALE' },
  { claim: "Management expects profitability by Q3 2026", verdict: 'partially_supported', source: 'CIM vs 10-K', tag: 'UNVERIFIABLE' },
  { claim: "95% customer retention (CIM) vs churn risk (10-K)", verdict: 'mixed', source: 'Cross-doc', tag: 'INCONSISTENT' },
];

// ─── Claim Type Config ───────────────────────────────────────────────────
export const CLAIM_TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  financial_metric: { color: '#4ade80', label: 'Metric' },
  valuation: { color: '#a78bfa', label: 'Valuation' },
  transaction: { color: '#6b9bd2', label: 'Transaction' },
  regulatory: { color: '#d4af37', label: 'Regulatory' },
  guidance: { color: '#fbbf24', label: 'Guidance' },
};

// ─── Severity Colors ─────────────────────────────────────────────────────
export const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  low: { bg: '#1a1500', border: '#3a3000', text: '#fbbf24' },
  medium: { bg: '#1a1000', border: '#3a2000', text: '#fb923c' },
  high: { bg: '#1a0a0a', border: '#3a1a1a', text: '#f87171' },
};
