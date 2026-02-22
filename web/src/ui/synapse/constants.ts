import type { AgentChip } from './types';

// ─── API Base URL ────────────────────────────────────────────────────────
export const API_BASE = window.location.hostname === 'localhost' ? '' : 'https://web-production-d3011.up.railway.app';

// ─── Verdict Colors ──────────────────────────────────────────────────────
export const VERDICT_COLORS: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  supported:            { bg: '#0d1410', text: '#6fad8e', border: '#1a2a22', glow: 'rgba(111,173,142,0.06)' },
  partially_supported:  { bg: '#141210', text: '#c4a35a', border: '#2a2518', glow: 'rgba(196,163,90,0.06)' },
  exaggerated:          { bg: '#14110e', text: '#c48a5a', border: '#2a2018', glow: 'rgba(196,138,90,0.06)' },
  contradicted:         { bg: '#140e0e', text: '#c47070', border: '#2a1a1a', glow: 'rgba(196,112,112,0.06)' },
  unsupported:          { bg: '#111111', text: '#777777', border: '#1e1e1e', glow: 'rgba(119,119,119,0.04)' },
  mixed:                { bg: '#141210', text: '#c4a35a', border: '#2a2518', glow: 'rgba(196,163,90,0.06)' },
};

// ─── Evidence Tier Labels ────────────────────────────────────────────────
export const TIER_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  sec_filing:           { label: 'SEC Filing',      icon: '⚖️', color: '#a89050' },
  earnings_transcript:  { label: 'Earnings Call',   icon: '🎙️', color: '#7090aa' },
  press_release:        { label: 'Press Release',   icon: '📰', color: '#6a9f8a' },
  analyst_report:       { label: 'Analyst Report',  icon: '📊', color: '#8a7ab5' },
  market_data:          { label: 'Market Data',     icon: '📈', color: '#6fad8e' },
  counter:              { label: 'Contradicting',   icon: '⚠️', color: '#c47070' },
};

// ─── Mutation Colors (Provenance) ────────────────────────────────────────
export const MUTATION_COLORS: Record<string, string> = {
  none: '#6fad8e',
  slight: '#c4a35a',
  significant: '#c48a5a',
  severe: '#c47070',
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
  symbolic_reasoning: '🧠',
};

// ─── Agent Brand Colors ──────────────────────────────────────────────────
export const AGENT_BRAND_COLORS: Record<string, { color: string; label: string }> = {
  reasoning:   { color: '#b0a088', label: 'Reasoning' },
  filings:     { color: '#a89050', label: 'Filings' },
  search:      { color: '#6a9f9c', label: 'Search' },
  transcribe:  { color: '#8a7ab5', label: 'Transcribe' },
};

// ─── Agent Reasoning Feed Colors ─────────────────────────────────────────
export const AGENT_COLORS: Record<string, string> = {
  resolver: '#6a9f9c',
  decomposer: '#6a9f9c',
  normalizer: '#7090aa',
  numerical_engine: '#6a8db5',
  temporal_analyst: '#a89050',
  staleness_detector: '#b09555',
  citation_verifier: '#b090c0',
  retriever: '#6a9f9c',
  evaluator: '#b0a088',
  contradiction_detector: '#c47070',
  consistency_analyzer: '#b09555',
  plausibility_assessor: '#8a7ab5',
  synthesizer: '#b0a088',
  provenance_tracer: '#6a9f9c',
  reconciler: '#6fad8e',
  risk_analyst: '#c47070',
  symbolic_engine: '#a78bfa',
};

// ─── Initial Pipeline Chips ──────────────────────────────────────────────
export const INITIAL_PIPELINE: Omit<AgentChip, 'status'>[] = [
  { id: 'extract',       service: 'reasoning',  task: 'Extract',        label: 'Extract Claims',               color: '#b0a088' },
  { id: 'decompose',     service: 'reasoning',  task: 'Decompose',      label: 'Decompose Claims',             color: '#b0a088' },
  { id: 'numground',     service: 'reasoning',  task: 'Numbers',        label: 'Numerical Grounding',          color: '#6a8db5' },
  { id: 'edgar',         service: 'filings',    task: 'SEC Filings',    label: 'SEC Filing Retrieval',          color: '#a89050' },
  { id: 'sonar_web',     service: 'search',     task: 'Earnings/News',  label: 'Earnings & News Search',       color: '#6a9f9c' },
  { id: 'temporal',      service: 'filings',    task: 'XBRL Series',    label: 'Multi-Period XBRL',            color: '#a89050' },
  { id: 'staleness',     service: 'filings',    task: 'Freshness',      label: 'Source Staleness Check',       color: '#b09555' },
  { id: 'citations',     service: 'reasoning',  task: 'Citations',      label: 'Citation Verification',        color: '#b090c0' },
  { id: 'sonar_counter', service: 'reasoning',  task: 'Counter',        label: 'Contradiction Detection',      color: '#b0a088' },
  { id: 'evaluate',      service: 'reasoning',  task: 'Evaluate',       label: 'Evidence Evaluation',           color: '#b0a088' },
  { id: 'synthesize',    service: 'reasoning',  task: 'Synthesize',     label: 'Verdict Synthesis',             color: '#b0a088' },
  { id: 'provenance',    service: 'search',     task: 'Provenance',     label: 'Provenance Tracing',            color: '#6a9f9c' },
  { id: 'correct',       service: 'reasoning',  task: 'Correct',        label: 'Claim Correction',              color: '#b0a088' },
  { id: 'symbolic',      service: 'reasoning',  task: 'Symbolic',       label: 'Neurosymbolic Reasoning',       color: '#a78bfa' },
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
  symbolic_reasoning: 'symbolic',
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
  symbolic_reasoning: ['symbolic'],
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
  financial_metric: { color: '#6fad8e', label: 'Metric' },
  valuation: { color: '#8a7ab5', label: 'Valuation' },
  transaction: { color: '#7090aa', label: 'Transaction' },
  regulatory: { color: '#a89050', label: 'Regulatory' },
  guidance: { color: '#b09555', label: 'Guidance' },
};

// ─── Severity Colors ─────────────────────────────────────────────────────
export const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  low: { bg: '#141210', border: '#2a2518', text: '#b09555' },
  medium: { bg: '#14110e', border: '#2a2018', text: '#c48a5a' },
  high: { bg: '#140e0e', border: '#2a1a1a', text: '#c47070' },
};
