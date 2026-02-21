// ─── Synapse Verification Types ──────────────────────────────────────────

export interface ExtractedClaim {
  id: string;
  original: string;
  normalized: string;
  type: string;
  location?: string;
  status: 'pending' | 'verifying' | 'done' | 'error';
  verification?: VerificationState;
}

export interface ConfidenceBreakdown {
  source_count: { value: number; score: number; weight: number };
  tier_quality: { value: number; score: number; weight: number; has_sec_filing?: boolean };
  agreement_ratio: { value: number; score: number; weight: number; supporting: number; opposing: number; total_scored: number };
  recency: { value: number | null; score: number; weight: number };
}

export interface SubClaim {
  id: string;
  text: string;
  type: string;
  verdict?: string;
  confidence?: string;
  confidence_score?: number;
  confidence_breakdown?: ConfidenceBreakdown;
  summary?: string;
}

export interface EvidenceItem {
  id: string;
  subclaim_id?: string;
  title: string;
  snippet: string;
  snippet_full?: string;
  tier: string;
  source: string;
  year?: number;
  citations?: number;
  citations_urls?: string[];
  quality_score?: number;
  study_type?: string;
  supports_claim?: boolean | string;
  assessment?: string;
  filing_type?: string;
  accession_number?: string;
  filing_date?: string;
  company_ticker?: string;
  verified_against?: string;
  xbrl_match?: string;
  xbrl_claimed?: string;
  xbrl_actual?: string;
  xbrl_discrepancy?: string;
  xbrl_computation?: string;
}

export interface ContradictionItem {
  id: string;
  source_a: { id?: string; type: string; name: string; text: string; filing_ref?: string };
  source_b: { id?: string; type: string; name: string; text: string; filing_ref?: string };
  severity: 'low' | 'medium' | 'high';
  explanation: string;
}

export interface ProvenanceNode {
  id: string;
  source_type: string;
  source_name: string;
  text: string;
  date?: string;
  mutation_severity: string;
}

export interface ProvenanceEdge {
  from: string;
  to: string;
}

export interface CorrectedClaim {
  original: string;
  corrected: string;
  steelmanned: string;
  one_sentence: string;
  caveats: string[];
}

export interface ConsistencyIssue {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  sources_involved: string[];
  description: string;
  implication: string;
}

export interface PlausibilityAssessment {
  is_forward_looking: boolean;
  projection: {
    target_metric: string;
    target_value: string;
    target_date: string;
    implied_growth_rate: string;
  };
  current_trajectory: {
    current_value: string;
    trend: string;
    historical_growth_rate: string;
  };
  peer_comparison?: {
    industry_median: string;
    best_in_class: string;
    is_outlier: boolean;
    outlier_explanation: string;
  };
  plausibility_score: number;
  plausibility_level: string;
  assessment: string;
  key_risks: string[];
  key_assumptions: string[];
}

export interface EntityResolution {
  entities: { canonical_name: string; ticker: string; type: string; aliases: string[] }[];
  resolutions: { original_text: string; resolved_to: string; context: string }[];
  ambiguities: string[];
}

export interface Normalization {
  normalizations: {
    subclaim_id: string;
    original_expression: string;
    normalized_value: string;
    unit: string;
    period: string;
    accounting_basis: string;
    precision: string;
    flags: string[];
  }[];
  comparison_warnings: string[];
}

export interface MaterialityAssessment {
  materiality_level: string;
  materiality_score: number;
  category: string;
  error_magnitude: string;
  impact_assessment: string;
  attention_flag: boolean;
}

export interface AuthorityConflict {
  id: string;
  higher_authority: { id: string; tier: string; authority_label: string; rank: number; position: string };
  lower_authority: { id: string; tier: string; authority_label: string; rank: number; position: string };
  severity: string;
  implication: string;
}

export interface RiskSignals {
  risk_level: string;
  risk_score: number;
  headline: string;
  patterns_detected: { pattern: string; evidence: string; frequency: string }[];
  red_flags: string[];
  recommended_actions: string[];
  risk_narrative: string;
}

export interface Reconciliation {
  core_claim_true: boolean | null;
  misleading: boolean | null;
  accuracy_level: string;
  reconciled_verdict: string;
  override_mechanical: boolean;
  explanation: string;
  detail_added: string;
}

export interface NumericalFact {
  id: string;
  raw_text: string;
  value: number;
  normalized_value: number;
  unit: string;
  scale: string;
  category: string;
  period_type: string;
  period_label: string;
  accounting_basis: string;
  context_sentence: string;
}

export interface IntraConsistencyIssue {
  id: string;
  issue_type: string;
  severity: string;
  fact_ids: string[];
  description: string;
  expected_value?: number;
  actual_value?: number;
  discrepancy_pct?: number;
}

export interface VerificationState {
  subclaims: SubClaim[];
  evidence: EvidenceItem[];
  contradictions: ContradictionItem[];
  consistencyIssues: ConsistencyIssue[];
  plausibility?: PlausibilityAssessment;
  entityResolution?: EntityResolution;
  normalization?: Normalization;
  materiality?: MaterialityAssessment;
  authorityConflicts: AuthorityConflict[];
  riskSignals?: RiskSignals;
  reconciliation?: Reconciliation;
  overallVerdict?: { verdict: string; confidence: string; confidence_score?: number; confidence_breakdown?: ConfidenceBreakdown; summary: string; detail?: string; verified_against?: string; reconciled?: boolean };
  provenanceNodes: ProvenanceNode[];
  provenanceEdges: ProvenanceEdge[];
  provenanceAnalysis?: string;
  correctedClaim?: CorrectedClaim;
  numericalFacts?: NumericalFact[];
  intraConsistencyIssues?: IntraConsistencyIssue[];
  methodologyIssues?: IntraConsistencyIssue[];
  numberDependencies?: { source_fact_id: string; derived_fact_id: string; relationship: string; description: string }[];
  temporalXbrl?: { metrics_tracked: number; total_data_points: number; restatements_found: number; growth_checks: number };
  restatements?: { period: string; metric: string; severity: string; assessment: string }[];
  growthVerifications?: { claimed_growth_pct: number; actual_growth_pct: number; metric_key: string; period: string; comparison: { match_level: string; assessment: string } }[];
  stalenessFindings?: { id: string; evidence_id: string; source_type: string; issue: string; severity: string; description: string; recommendation: string }[];
  citationResults?: { id: string; source_cited: string; source_type: string; attributed_claim: string; key_value: string; verification_status: string; actual_value: string | null; discrepancy: string | null; assessment: string }[];
  currentStep: string;
  stepLabel: string;
  completedSteps: string[];
  totalDurationMs?: number;
  totalSources?: number;
}

export interface AgentChip {
  id: string;
  service: string;
  task: string;
  label: string;
  color: string;
  status: 'pending' | 'active' | 'done';
}

export interface ReasoningMessage {
  agent: string;
  stage: string;
  message: string;
  detail: string;
  ts: number;
}

export interface TraceLine {
  text: string;
  type: string;
  indent: number;
  badge?: string;
}

export interface PipelineStats {
  steps: number;
  apiCalls: number;
  services: Set<string>;
  sources: number;
  durationMs: number;
}

export type TabId = 'subclaims' | 'evidence' | 'contradictions' | 'consistency' | 'plausibility' | 'provenance' | 'correction' | 'risk_signals';
