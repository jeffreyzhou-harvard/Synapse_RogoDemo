import React, { useState, useRef, useCallback, useEffect } from 'react';

// ─── API Base URL (Railway backend for real SSE streaming) ─────────────────
// Local dev: empty string (Vite proxy handles /api → localhost:4000)
// Production: Railway backend URL
const API_BASE = window.location.hostname === 'localhost' ? '' : 'https://web-production-d3011.up.railway.app';

// ─── Types ────────────────────────────────────────────────────────────────

interface ExtractedClaim {
  id: string;
  original: string;
  normalized: string;
  type: string;
  location?: string;
  status: 'pending' | 'verifying' | 'done' | 'error';
  verification?: VerificationState;
}

interface ConfidenceBreakdown {
  source_count: { value: number; score: number; weight: number };
  tier_quality: { value: number; score: number; weight: number; has_sec_filing?: boolean };
  agreement_ratio: { value: number; score: number; weight: number; supporting: number; opposing: number; total_scored: number };
  recency: { value: number | null; score: number; weight: number };
}

interface SubClaim {
  id: string;
  text: string;
  type: string;
  verdict?: string;
  confidence?: string;
  confidence_score?: number;
  confidence_breakdown?: ConfidenceBreakdown;
  summary?: string;
}

interface EvidenceItem {
  id: string;
  subclaim_id?: string;
  title: string;
  snippet: string;
  tier: string;
  source: string;
  year?: number;
  citations?: number;
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

interface ContradictionItem {
  id: string;
  source_a: { id?: string; type: string; name: string; text: string; filing_ref?: string };
  source_b: { id?: string; type: string; name: string; text: string; filing_ref?: string };
  severity: 'low' | 'medium' | 'high';
  explanation: string;
}

interface ProvenanceNode {
  id: string;
  source_type: string;
  source_name: string;
  text: string;
  date?: string;
  mutation_severity: string;
}

interface ProvenanceEdge {
  from: string;
  to: string;
}

interface CorrectedClaim {
  original: string;
  corrected: string;
  steelmanned: string;
  one_sentence: string;
  caveats: string[];
}

interface ConsistencyIssue {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  sources_involved: string[];
  description: string;
  implication: string;
}

interface PlausibilityAssessment {
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

interface EntityResolution {
  entities: { canonical_name: string; ticker: string; type: string; aliases: string[] }[];
  resolutions: { original_text: string; resolved_to: string; context: string }[];
  ambiguities: string[];
}

interface Normalization {
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

interface MaterialityAssessment {
  materiality_level: string;
  materiality_score: number;
  category: string;
  error_magnitude: string;
  impact_assessment: string;
  attention_flag: boolean;
}

interface AuthorityConflict {
  id: string;
  higher_authority: { id: string; tier: string; authority_label: string; rank: number; position: string };
  lower_authority: { id: string; tier: string; authority_label: string; rank: number; position: string };
  severity: string;
  implication: string;
}

interface RiskSignals {
  risk_level: string;
  risk_score: number;
  headline: string;
  patterns_detected: { pattern: string; evidence: string; frequency: string }[];
  red_flags: string[];
  recommended_actions: string[];
  risk_narrative: string;
}

interface Reconciliation {
  core_claim_true: boolean | null;
  misleading: boolean | null;
  accuracy_level: string;
  reconciled_verdict: string;
  override_mechanical: boolean;
  explanation: string;
  detail_added: string;
}

interface NumericalFact {
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

interface IntraConsistencyIssue {
  id: string;
  issue_type: string;
  severity: string;
  fact_ids: string[];
  description: string;
  expected_value?: number;
  actual_value?: number;
  discrepancy_pct?: number;
}

interface VerificationState {
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

// ─── Constants ────────────────────────────────────────────────────────────

const VERDICT_COLORS: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  supported:            { bg: '#0a1a0a', text: '#4ade80', border: '#1a3a1a', glow: 'rgba(74,222,128,0.12)' },
  partially_supported:  { bg: '#1a1500', text: '#fbbf24', border: '#3a3000', glow: 'rgba(251,191,36,0.12)' },
  exaggerated:          { bg: '#1a1000', text: '#fb923c', border: '#3a2000', glow: 'rgba(251,146,60,0.12)' },
  contradicted:         { bg: '#1a0a0a', text: '#f87171', border: '#3a1a1a', glow: 'rgba(248,113,113,0.12)' },
  unsupported:          { bg: '#111111', text: '#888888', border: '#222222', glow: 'rgba(136,136,136,0.08)' },
  mixed:                { bg: '#1a1500', text: '#fbbf24', border: '#3a3000', glow: 'rgba(251,191,36,0.12)' },
};

const TIER_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  sec_filing:           { label: 'SEC Filing',      icon: '⚖️', color: '#d4af37' },
  earnings_transcript:  { label: 'Earnings Call',   icon: '🎙️', color: '#6b9bd2' },
  press_release:        { label: 'Press Release',   icon: '📰', color: '#5ec4a0' },
  analyst_report:       { label: 'Analyst Report',  icon: '📊', color: '#a78bfa' },
  market_data:          { label: 'Market Data',     icon: '📈', color: '#4ade80' },
  counter:              { label: 'Contradicting',   icon: '⚠️', color: '#f87171' },
};

const MUTATION_COLORS: Record<string, string> = {
  none: '#4ade80',
  slight: '#fbbf24',
  significant: '#fb923c',
  severe: '#f87171',
};

const STEP_ICONS: Record<string, string> = {
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

// ─── Agent Orchestration ──────────────────────────────────────────────────

interface AgentChip {
  id: string;
  service: string;
  task: string;
  label: string;
  color: string;
  status: 'pending' | 'active' | 'done';
}

const AGENT_BRAND_COLORS: Record<string, { color: string; label: string }> = {
  reasoning:   { color: '#e8c8a0', label: 'Reasoning' },
  filings:     { color: '#d4af37', label: 'Filings' },
  search:      { color: '#6bccc8', label: 'Search' },
  transcribe:  { color: '#a78bfa', label: 'Transcribe' },
};

const INITIAL_PIPELINE: Omit<AgentChip, 'status'>[] = [
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

// ─── Main Component ───────────────────────────────────────────────────────

const SynapsePage: React.FC = () => {
  // Input state
  const [inputValue, setInputValue] = useState('');
  const [inputMode, setInputMode] = useState<'url' | 'text'>('url');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestedText, setIngestedText] = useState('');
  const [ingestedTitle, setIngestedTitle] = useState('');
  const [sourceType, setSourceType] = useState('');

  // Claims state
  const [claims, setClaims] = useState<ExtractedClaim[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<'subclaims' | 'evidence' | 'contradictions' | 'consistency' | 'plausibility' | 'provenance' | 'correction' | 'risk_signals'>('subclaims');
  const [showTrace, setShowTrace] = useState(true);
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const [verdictExpanded, setVerdictExpanded] = useState(false);
  const [reasoningCollapsed, setReasoningCollapsed] = useState(false);

  // Share state
  const [shareToast, setShareToast] = useState('');
  const [reportId, setReportId] = useState<string | null>(null);

  // Agent orchestration state (per-claim)
  const [agentChips, setAgentChips] = useState<AgentChip[]>([]);
  const [pipelineStats, setPipelineStats] = useState({ steps: 0, apiCalls: 0, services: new Set<string>(), sources: 0, durationMs: 0 });

  // Reasoning feed
  const [reasoningMessages, setReasoningMessages] = useState<{ agent: string; stage: string; message: string; detail: string; ts: number }[]>([]);
  const reasoningRef = useRef<HTMLDivElement>(null);

  // Trace log
  const [traceLines, setTraceLines] = useState<{ text: string; type: string; indent: number; badge?: string }[]>([]);
  const traceRef = useRef<HTMLDivElement>(null);

  // File inputs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Auto-ingest from ?url= query param (Chrome extension support)
  const autoIngestDone = useRef(false);
  useEffect(() => {
    if (autoIngestDone.current) return;
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url');
    if (urlParam) {
      autoIngestDone.current = true;
      setInputValue(urlParam);
      setInputMode('url');
      // Trigger ingest after state updates
      setTimeout(() => {
        const btn = document.querySelector('[data-ingest-btn]') as HTMLButtonElement;
        if (btn) btn.click();
      }, 300);
    }
  }, []);

  // Auto-scroll trace
  useEffect(() => {
    if (traceRef.current) {
      traceRef.current.scrollTop = traceRef.current.scrollHeight;
    }
  }, [traceLines]);

  const addTrace = useCallback((text: string, type: string = 'info', indent: number = 0, badge?: string) => {
    setTraceLines(prev => [...prev, { text, type, indent, badge }]);
  }, []);

  // Agent chip helpers
  const activateChip = useCallback((chipId: string) => {
    setAgentChips(prev => prev.map(c => c.id === chipId ? { ...c, status: 'active' as const } : c));
    setPipelineStats(prev => ({ ...prev, steps: prev.steps + 1 }));
  }, []);

  const completeChip = useCallback((chipId: string) => {
    setAgentChips(prev => prev.map(c => c.id === chipId ? { ...c, status: 'done' as const } : c));
  }, []);

  const bumpApiCalls = useCallback((service: string) => {
    setPipelineStats(prev => {
      const s = new Set(prev.services);
      s.add(service);
      return { ...prev, apiCalls: prev.apiCalls + 1, services: s };
    });
  }, []);

  // ─── Share Report ───────────────────────────────────────────────────

  const shareReport = useCallback(async () => {
    const doneClaims = claims.filter(c => c.status === 'done');
    if (doneClaims.length === 0) return;
    try {
      const reportData = {
        title: ingestedTitle || 'Verification Report',
        url: inputValue.startsWith('http') ? inputValue : undefined,
        source_type: sourceType || 'text',
        claims: claims.map(c => ({
          id: c.id, original: c.original, normalized: c.normalized,
          type: c.type, status: c.status, verification: c.verification,
        })),
        analyzed_at: new Date().toISOString(),
      };

      // Try backend first, fall back to client-generated ID
      let id: string | null = null;
      try {
        const resp = await fetch(`${API_BASE}/api/reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reportData),
        });
        if (resp.ok) {
          const data = await resp.json();
          id = data.id;
        }
      } catch {}

      // Generate client-side ID if backend didn't return one
      if (!id) id = Math.random().toString(36).slice(2, 10);

      // Always persist to localStorage so ReportPage can retrieve it
      const fullReport = { id, ...reportData, created_at: new Date().toISOString() };
      localStorage.setItem(`synapse-report-${id}`, JSON.stringify(fullReport));

      setReportId(id);
      const url = `${window.location.origin}/report/${id}`;
      await navigator.clipboard.writeText(url);
      setShareToast('Report link copied!');
      setTimeout(() => setShareToast(''), 3000);
    } catch (e) {
      setShareToast('Failed to save report');
      setTimeout(() => setShareToast(''), 3000);
    }
  }, [claims, ingestedTitle, inputValue, sourceType]);

  // ─── Trending Tweets (live from X API) ─────────────────────────────

  const [financialClaims, setFinancialClaims] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/financial-claims-feed`)
      .then(r => r.json())
      .then(data => {
        if (data.claims?.length) setFinancialClaims(data.claims);
      })
      .catch(() => {});
  }, []);

  // ─── Preloaded Examples ────────────────────────────────────────────

  const PRELOADED_EXAMPLES = [
    { claim: "Apple's gross margin was 46.2% in Q4 2024", verdict: 'supported', source: '10-K FY2024', tag: 'VERIFIED' },
    { claim: "Company X acquired Company Y in 2023 for $500M", verdict: 'contradicted', source: 'No 8-K found', tag: 'HALLUCINATION' },
    { claim: "Nvidia's data center revenue grew 409% YoY", verdict: 'exaggerated', source: '10-K FY2024', tag: 'EXAGGERATED' },
    { claim: "SaaS market will grow 15% per Gartner 2021", verdict: 'exaggerated', source: 'Revised 2024', tag: 'STALE' },
    { claim: "Management expects profitability by Q3 2026", verdict: 'partially_supported', source: 'CIM vs 10-K', tag: 'UNVERIFIABLE' },
    { claim: "95% customer retention (CIM) vs churn risk (10-K)", verdict: 'mixed', source: 'Cross-doc', tag: 'INCONSISTENT' },
  ];

  // ─── Ingest ──────────────────────────────────────────────────────────

  const handleIngest = useCallback(async () => {
    if (!inputValue.trim()) return;
    setIsIngesting(true);
    setClaims([]);
    setSelectedClaimId(null);
    setTraceLines([]);
    setIngestedText('');
    setIngestedTitle('');

    addTrace('Ingesting content...', 'step');

    try {
      const isUrl = inputValue.startsWith('http://') || inputValue.startsWith('https://');
      const body = isUrl ? { url: inputValue } : { text: inputValue };

      const resp = await fetch(`${API_BASE}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Unknown error' }));
        addTrace(`Ingestion failed: ${err.detail}`, 'error');
        setIsIngesting(false);
        return;
      }

      const data = await resp.json();
      setIngestedText(data.text);
      setIngestedTitle(data.title);
      setSourceType(data.source_type);
      addTrace(`Ingested: "${data.title}" (${data.source_type})`, 'success');
      addTrace(`${data.text.split(/\s+/).length} words extracted`, 'info', 1);

      // Auto-extract claims
      await extractClaims(data.text);
      setInputCollapsed(true);
    } catch (e) {
      addTrace(`Network error: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
    setIsIngesting(false);
  }, [inputValue, addTrace]);

  // ─── Extract Claims ──────────────────────────────────────────────────

  const extractClaims = useCallback(async (text: string) => {
    setIsExtracting(true);
    // Initialize pipeline with just the extract chip active
    setAgentChips(INITIAL_PIPELINE.map(c => ({ ...c, status: c.id === 'extract' ? 'active' as const : 'pending' as const })));
    setPipelineStats({ steps: 1, apiCalls: 1, services: new Set(['search']), sources: 0, durationMs: 0 });
    addTrace('Extracting claims...', 'step', 0, 'reasoning');

    try {
      const resp = await fetch(`${API_BASE}/api/extract-claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!resp.ok) {
        addTrace('Claim extraction failed', 'error');
        setIsExtracting(false);
        return;
      }

      const data = await resp.json();
      const extracted: ExtractedClaim[] = (data.claims || []).map((c: any) => ({
        ...c,
        status: 'pending' as const,
      }));
      setClaims(extracted);
      completeChip('extract');
      addTrace(`${extracted.length} verifiable claims extracted`, 'success', 0, 'reasoning');
      extracted.forEach((c, i) => {
        addTrace(`Claim ${i + 1}: "${c.original.slice(0, 80)}${c.original.length > 80 ? '...' : ''}"`, 'info', 1);
      });
    } catch (e) {
      addTrace(`Error: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
    setIsExtracting(false);
  }, [addTrace, completeChip]);

  // ─── Verify Single Claim (SSE) ──────────────────────────────────────

  const verifyClaim = useCallback(async (claimId: string) => {
    const claim = claims.find(c => c.id === claimId);
    if (!claim) return;

    setSelectedClaimId(claimId);
    setVerdictExpanded(false);
    setReasoningMessages([]);
    setReasoningCollapsed(false);

    // Initialize agent pipeline — extract already done, decompose starts
    setAgentChips(INITIAL_PIPELINE.map(c => ({
      ...c,
      status: c.id === 'extract' ? 'done' as const : 'pending' as const,
    })));
    setPipelineStats({ steps: 1, apiCalls: 1, services: new Set(['search']), sources: 0, durationMs: 0 });

    // Update claim status
    setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'verifying' as const, verification: {
      subclaims: [], evidence: [], contradictions: [], consistencyIssues: [], authorityConflicts: [], provenanceNodes: [], provenanceEdges: [],
      currentStep: '', stepLabel: '', completedSteps: [],
    }} : c));

    addTrace('', 'divider');
    addTrace(`Verifying: "${claim.original.slice(0, 100)}"`, 'step');

    try {
      const resp = await fetch(`${API_BASE}/api/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim: claim.normalized || claim.original }),
      });

      if (!resp.ok) {
        addTrace('Verification failed', 'error');
        setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'error' as const } : c));
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            const { type, data } = payload;

            // Process each event type
            setClaims(prev => prev.map(c => {
              if (c.id !== claimId) return c;
              const v: VerificationState = { ...(c.verification || {
                subclaims: [], evidence: [], contradictions: [], consistencyIssues: [], authorityConflicts: [],
                provenanceNodes: [], provenanceEdges: [],
                currentStep: '', stepLabel: '', completedSteps: [],
              })};

              switch (type) {
                case 'step_start':
                  v.currentStep = data.step;
                  v.stepLabel = data.label;
                  break;
                case 'subclaim':
                  v.subclaims = [...v.subclaims, { id: data.id, text: data.text, type: data.type }];
                  break;
                case 'evidence_found':
                  v.evidence = [...v.evidence, {
                    id: data.id, subclaim_id: data.subclaim_id, title: data.title,
                    snippet: data.snippet, tier: data.tier, source: data.source,
                    year: data.year, citations: data.citations,
                    filing_type: data.filing_type, accession_number: data.accession_number,
                    filing_date: data.filing_date, company_ticker: data.company_ticker,
                    verified_against: data.verified_against,
                    xbrl_match: data.xbrl_match, xbrl_claimed: data.xbrl_claimed,
                    xbrl_actual: data.xbrl_actual, xbrl_discrepancy: data.xbrl_discrepancy,
                    xbrl_computation: data.xbrl_computation,
                  }];
                  break;
                case 'evidence_scored':
                  v.evidence = v.evidence.map(e => e.id === data.id ? {
                    ...e, quality_score: data.quality_score, study_type: data.study_type,
                    supports_claim: data.supports_claim, assessment: data.assessment,
                  } : e);
                  break;
                case 'subclaim_verdict':
                  v.subclaims = v.subclaims.map(sc => sc.id === data.subclaim_id ? {
                    ...sc, verdict: data.verdict, confidence: data.confidence, confidence_score: data.confidence_score, confidence_breakdown: data.confidence_breakdown, summary: data.summary,
                  } : sc);
                  break;
                case 'overall_verdict':
                  v.overallVerdict = { verdict: data.verdict, confidence: data.confidence, confidence_score: data.confidence_score, confidence_breakdown: data.confidence_breakdown, summary: data.summary, detail: data.detail, reconciled: data.reconciled };
                  break;
                case 'reconciliation':
                  v.reconciliation = data as Reconciliation;
                  break;
                case 'provenance_node':
                  v.provenanceNodes = [...v.provenanceNodes, data as ProvenanceNode];
                  break;
                case 'provenance_edge':
                  v.provenanceEdges = [...v.provenanceEdges, data as ProvenanceEdge];
                  break;
                case 'provenance_complete':
                  v.provenanceAnalysis = data.analysis;
                  break;
                case 'contradiction_detected':
                  v.contradictions = [...v.contradictions, data as ContradictionItem];
                  break;
                case 'contradictions_complete':
                  break;
                case 'consistency_issue':
                  v.consistencyIssues = [...v.consistencyIssues, data as ConsistencyIssue];
                  break;
                case 'plausibility_assessment':
                  v.plausibility = data as PlausibilityAssessment;
                  break;
                case 'entity_resolution':
                  v.entityResolution = data as EntityResolution;
                  break;
                case 'normalization':
                  v.normalization = data as Normalization;
                  break;
                case 'materiality':
                  v.materiality = data as MaterialityAssessment;
                  break;
                case 'authority_conflict':
                  v.authorityConflicts = [...v.authorityConflicts, data as AuthorityConflict];
                  break;
                case 'risk_signals':
                  v.riskSignals = data as RiskSignals;
                  break;
                case 'corrected_claim':
                  v.correctedClaim = data as CorrectedClaim;
                  break;
                case 'numerical_facts':
                  v.numericalFacts = data.facts as NumericalFact[];
                  break;
                case 'intra_consistency_issue':
                  v.intraConsistencyIssues = [...(v.intraConsistencyIssues || []), data as IntraConsistencyIssue];
                  break;
                case 'methodology_issue':
                  v.methodologyIssues = [...(v.methodologyIssues || []), data as IntraConsistencyIssue];
                  break;
                case 'number_dependencies':
                  v.numberDependencies = data.dependencies;
                  break;
                case 'temporal_xbrl':
                  v.temporalXbrl = data;
                  break;
                case 'restatement_detected':
                  v.restatements = [...(v.restatements || []), data];
                  break;
                case 'growth_verification':
                  v.growthVerifications = [...(v.growthVerifications || []), data];
                  break;
                case 'staleness_finding':
                  v.stalenessFindings = [...(v.stalenessFindings || []), data];
                  break;
                case 'citation_verified':
                  v.citationResults = [...(v.citationResults || []), data];
                  break;
                case 'step_complete':
                  v.completedSteps = [...v.completedSteps, data.step];
                  v.totalDurationMs = data.duration_ms || data.total_duration_ms;
                  if (data.total_sources) v.totalSources = data.total_sources;
                  break;
                case 'verification_complete':
                  v.totalDurationMs = data.total_duration_ms;
                  v.totalSources = data.total_sources;
                  break;
              }

              return { ...c, verification: v as VerificationState };
            }));

            // --- Agent chip state transitions ---
            switch (type) {
              case 'step_start': {
                const chipMap: Record<string, string> = {
                  decomposition: 'decompose', entity_resolution: 'decompose', normalization: 'decompose',
                  numerical_grounding: 'numground',
                  staleness: 'staleness', citation_verification: 'citations',
                  evaluation: 'evaluate', contradictions: 'sonar_counter', consistency: 'sonar_counter',
                  plausibility: 'evaluate',
                  temporal_xbrl: 'temporal',
                  synthesis: 'synthesize', provenance: 'provenance', correction: 'correct',
                  reconciliation: 'correct', risk_signals: 'synthesize',
                };
                const chipId = chipMap[data.step];
                if (chipId) { activateChip(chipId); bumpApiCalls(data.step === 'provenance' ? 'search' : (data.step === 'temporal_xbrl' || data.step === 'staleness') ? 'filings' : 'reasoning'); }
                if (data.step === 'evidence_retrieval') {
                  activateChip('edgar'); activateChip('sonar_web');
                  bumpApiCalls('filings'); bumpApiCalls('search');
                }
                break;
              }
              case 'step_complete': {
                const completeMap: Record<string, string[]> = {
                  decomposition: ['decompose'], entity_resolution: ['decompose'], normalization: ['decompose'],
                  numerical_grounding: ['numground'],
                  staleness: ['staleness'], citation_verification: ['citations'],
                  evaluation: ['evaluate'], contradictions: ['sonar_counter'], consistency: ['sonar_counter'],
                  plausibility: ['evaluate'],
                  temporal_xbrl: ['temporal'],
                  synthesis: ['synthesize'], provenance: ['provenance'], correction: ['correct'],
                  reconciliation: ['correct'], risk_signals: ['synthesize'],
                  evidence_retrieval: ['edgar', 'sonar_web'],
                };
                (completeMap[data.step] || []).forEach(id => completeChip(id));
                if (data.total_sources) setPipelineStats(prev => ({ ...prev, sources: data.total_sources }));
                break;
              }
              case 'evidence_found':
                bumpApiCalls(data.tier === 'sec_filing' ? 'filings' : 'search');
                setPipelineStats(prev => ({ ...prev, sources: prev.sources + 1 }));
                break;
              case 'verification_complete':
                setPipelineStats(prev => ({ ...prev, durationMs: data.total_duration_ms, sources: data.total_sources || prev.sources }));
                break;
            }

            // --- Reasoning feed ---
            if (type === 'agent_reasoning') {
              setReasoningMessages(prev => [...prev, {
                agent: data.agent, stage: data.stage, message: data.message, detail: data.detail || '', ts: Date.now(),
              }]);
              setTimeout(() => reasoningRef.current?.scrollTo({ top: reasoningRef.current.scrollHeight, behavior: 'smooth' }), 50);
            }

            // --- Add to trace with API badges ---
            switch (type) {
              case 'step_start': {
                const badgeMap: Record<string, string> = {
                  decomposition: 'reasoning', entity_resolution: 'reasoning', normalization: 'reasoning',
                  numerical_grounding: 'reasoning', temporal_xbrl: 'filings',
                  staleness: 'filings', citation_verification: 'reasoning',
                  evaluation: 'reasoning', contradictions: 'reasoning', consistency: 'reasoning',
                  plausibility: 'reasoning',
                  synthesis: 'reasoning', correction: 'reasoning', reconciliation: 'reasoning',
                  provenance: 'search', risk_signals: 'reasoning',
                  evidence_retrieval: 'filings',
                };
                addTrace(`${STEP_ICONS[data.step] || '▸'} ${data.label}`, 'step', 0, badgeMap[data.step]);
                break;
              }
              case 'subclaim':
                addTrace(`Sub-claim: "${data.text}"`, 'info', 1);
                break;
              case 'search_start':
                addTrace(`Searching for: "${(data.subclaim || '').slice(0, 60)}..."`, 'info', 1, 'filings');
                break;
              case 'evidence_found': {
                const evBadge = data.tier === 'sec_filing' ? 'filings' : data.tier === 'counter' ? 'reasoning' : 'search';
                addTrace(`Found: ${data.title?.slice(0, 50)} [${data.tier}]`, 'info', 2, evBadge);
                break;
              }
              case 'contradiction_detected':
                addTrace(`Contradiction: ${data.explanation?.slice(0, 80)}...`, 'info', 1, 'reasoning');
                break;
              case 'evidence_scored':
                addTrace(`Scored ${data.id}: ${data.quality_score}/100 (${data.study_type || '?'})`, 'info', 2, 'reasoning');
                break;
              case 'subclaim_verdict': {
                const icon = data.verdict === 'supported' ? '✅' : data.verdict === 'contradicted' ? '❌' : data.verdict === 'exaggerated' ? '⚠️' : '🔶';
                addTrace(`${icon} "${data.text?.slice(0, 50)}..." → ${data.verdict} (${data.confidence})`, 'verdict', 0, 'reasoning');
                break;
              }
              case 'overall_verdict': {
                const icon = data.verdict === 'supported' ? '✅' : data.verdict === 'contradicted' ? '❌' : '⚠️';
                addTrace(`${icon} OVERALL: ${data.verdict.toUpperCase()} (${data.confidence})`, 'verdict', 0, 'reasoning');
                addTrace(data.summary, 'info', 1);
                break;
              }
              case 'provenance_node':
                addTrace(`${data.source_type}: "${data.text?.slice(0, 60)}..." (${data.date || '?'})`, 'info', 1, 'search');
                break;
              case 'consistency_issue': {
                const sevIcon = data.severity === 'high' ? '🔴' : data.severity === 'medium' ? '🟡' : '🟢';
                addTrace(`${sevIcon} Consistency: ${data.description?.slice(0, 80)}...`, 'info', 1, 'reasoning');
                break;
              }
              case 'plausibility_assessment':
                addTrace(`🎯 Plausibility: ${data.plausibility_level} (${data.plausibility_score}/100) — ${data.assessment?.slice(0, 80)}...`, 'info', 1, 'reasoning');
                break;
              case 'reconciliation': {
                const accIcon = data.accuracy_level === 'true' ? '✅' : data.accuracy_level === 'essentially_true' ? '✅' : data.accuracy_level === 'misleading' ? '⚠️' : '❌';
                addTrace(`${accIcon} Reconciliation: ${data.accuracy_level?.replace('_', ' ')} — ${data.explanation?.slice(0, 100)}`, 'verdict', 0, 'reasoning');
                if (data.override_mechanical) addTrace(`Verdict overridden → ${data.reconciled_verdict}`, 'success', 1, 'reasoning');
                break;
              }
              case 'entity_resolution':
                addTrace(`Entities resolved: ${(data.entities || []).length} entities, ${(data.resolutions || []).length} mappings`, 'info', 1, 'reasoning');
                break;
              case 'normalization':
                addTrace(`Normalized: ${(data.normalizations || []).length} expressions, ${(data.comparison_warnings || []).length} warnings`, 'info', 1, 'reasoning');
                break;
              case 'materiality':
                addTrace(`Materiality: ${data.materiality_level?.toUpperCase()} (${data.materiality_score}/100) — ${data.category}`, 'info', 1, 'reasoning');
                break;
              case 'authority_conflict':
                addTrace(`Authority conflict [${data.severity}]: ${data.implication?.slice(0, 80)}...`, 'info', 1, 'reasoning');
                break;
              case 'risk_signals': {
                const riskIcon = data.risk_level === 'critical' ? '🔴' : data.risk_level === 'high' ? '🟠' : data.risk_level === 'medium' ? '🟡' : '🟢';
                addTrace(`${riskIcon} Risk: ${data.risk_level?.toUpperCase()} — ${data.headline}`, 'verdict', 0, 'reasoning');
                break;
              }
              case 'corrected_claim':
                addTrace(`Corrected: "${data.corrected?.slice(0, 80)}..."`, 'success', 1, 'reasoning');
                break;
              case 'numerical_facts':
                addTrace(`🔢 Extracted ${data.count} numerical facts (deterministic)`, 'info', 1, 'reasoning');
                break;
              case 'intra_consistency_issue': {
                const ciIcon = data.severity === 'critical' ? '🔴' : data.severity === 'high' ? '🟠' : '🟡';
                addTrace(`${ciIcon} Math: ${data.description?.slice(0, 100)}`, 'info', 1, 'reasoning');
                break;
              }
              case 'methodology_issue': {
                const miIcon = data.severity === 'high' ? '🟠' : '🟡';
                addTrace(`${miIcon} Methodology: ${data.description?.slice(0, 100)}`, 'info', 1, 'reasoning');
                break;
              }
              case 'temporal_xbrl':
                addTrace(`📅 XBRL: ${data.metrics_tracked} metrics, ${data.total_data_points} data points, ${data.restatements_found} restatements`, 'info', 1, 'filings');
                break;
              case 'restatement_detected':
                addTrace(`🔴 RESTATEMENT: ${data.metric} (${data.period}) — ${data.assessment?.slice(0, 80)}`, 'info', 1, 'filings');
                break;
              case 'growth_verification': {
                const gvMatch = data.comparison?.match_level;
                const gvIcon = gvMatch === 'significant' ? '🔴' : gvMatch === 'notable' ? '🟠' : '✅';
                addTrace(`${gvIcon} Growth: claimed ${data.claimed_growth_pct}% vs actual ${data.actual_growth_pct}% (${data.metric_key})`, 'info', 1, 'filings');
                break;
              }
              case 'staleness_finding': {
                const staleIcon = data.severity === 'high' ? '🟠' : '🟡';
                addTrace(`${staleIcon} Stale: ${data.description?.slice(0, 100)}`, 'info', 1, 'filings');
                break;
              }
              case 'citation_verified': {
                const citeIcon = data.verification_status === 'verified' ? '✅' : data.verification_status === 'contradicted' ? '🔴' : data.verification_status === 'imprecise' ? '🟠' : '⚪';
                addTrace(`${citeIcon} Citation "${data.source_cited}": ${data.verification_status} — ${data.assessment?.slice(0, 80)}`, 'info', 1, 'reasoning');
                break;
              }
              case 'verification_complete':
                addTrace(`Done in ${(data.total_duration_ms / 1000).toFixed(1)}s — ${data.total_sources} sources`, 'success');
                break;
            }
          } catch { /* skip malformed events */ }
        }
      }

      // Mark claim as done
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'done' as const } : c));

    } catch (e) {
      addTrace(`Error: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'error' as const } : c));
    }
  }, [claims, addTrace, activateChip, completeChip, bumpApiCalls]);

  // ─── Verify All Claims ───────────────────────────────────────────────

  const verifyAll = useCallback(async () => {
    await Promise.all(
      claims
        .filter(c => c.status === 'pending')
        .map(c => verifyClaim(c.id))
    );
  }, [claims, verifyClaim]);

  // ─── Audio Upload ────────────────────────────────────────────────────

  const handleFileUpload = useCallback(async (file: File) => {
    setIsIngesting(true);
    setClaims([]);
    setTraceLines([]);
    addTrace(`Uploading: ${file.name}...`, 'step');

    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch(`${API_BASE}/api/ingest-audio`, { method: 'POST', body: formData });
      if (!resp.ok) {
        addTrace('Audio ingestion failed', 'error');
        setIsIngesting(false);
        return;
      }
      const data = await resp.json();
      setIngestedText(data.text);
      setIngestedTitle(data.title);
      setSourceType('audio');
      addTrace(`Transcribed: "${data.title}"`, 'success');
      await extractClaims(data.text);
    } catch (e) {
      addTrace(`Error: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
    setIsIngesting(false);
  }, [addTrace, extractClaims]);

  // ─── Document Upload (PDF, PPTX, DOCX) ─────────────────────────────

  const handleDocUpload = useCallback(async (file: File) => {
    setIsIngesting(true);
    setClaims([]);
    setTraceLines([]);
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const typeLabel = ext === 'pdf' ? 'PDF' : ext === 'pptx' ? 'PowerPoint' : ext === 'docx' ? 'Word' : 'Document';
    addTrace(`Uploading ${typeLabel}: ${file.name}...`, 'step');

    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch(`${API_BASE}/api/ingest-file`, { method: 'POST', body: formData });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Unknown error' }));
        addTrace(`${typeLabel} ingestion failed: ${err.detail}`, 'error');
        setIsIngesting(false);
        return;
      }
      const data = await resp.json();
      setIngestedText(data.text);
      setIngestedTitle(data.title);
      setSourceType(data.source_type || ext);
      addTrace(`Parsed ${typeLabel}: "${data.title}" (${data.text.split(/\s+/).length} words)`, 'success');
      await extractClaims(data.text);
    } catch (e) {
      addTrace(`Error: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
    setIsIngesting(false);
  }, [addTrace, extractClaims]);

  // ─── Selected claim data ─────────────────────────────────────────────

  const selectedClaim = claims.find(c => c.id === selectedClaimId);
  const v = selectedClaim?.verification;

  // ─── Computed: summary counts ────────────────────────────────────────

  const verdictCounts = claims.reduce((acc, c) => {
    const v = c.verification?.overallVerdict?.verdict;
    if (v) acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const doneClaims = claims.filter(c => c.status === 'done').length;
  const hasSummary = doneClaims > 0;

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div style={{
      height: '100vh', backgroundColor: '#000000', color: '#e0e0e0',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideInH { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes glow { 0%, 100% { box-shadow: 0 0 8px rgba(255,255,255,0.2); } 50% { box-shadow: 0 0 20px rgba(255,255,255,0.4); } }
        @keyframes verdictPop { 0% { transform: scale(0.8); opacity: 0; } 50% { transform: scale(1.05); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes agentPulse {
          0% { box-shadow: 0 0 0 0 var(--agent-glow); }
          50% { box-shadow: 0 0 12px 4px var(--agent-glow); }
          100% { box-shadow: 0 0 0 0 var(--agent-glow); }
        }
        @keyframes ghostFloat {
          0%, 100% { opacity: 0.04; transform: translateY(0); }
          50% { opacity: 0.08; transform: translateY(-2px); }
        }
        @keyframes ghostShimmer {
          0% { opacity: 0.03; }
          30% { opacity: 0.07; }
          60% { opacity: 0.04; }
          100% { opacity: 0.03; }
        }
        @keyframes scroll-ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .scroll-ticker-wrap:hover > div { animation-play-state: paused; }
        ::selection { background: rgba(255,255,255,0.2); }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #222222; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #333333; }
      `}</style>

      {/* ═══ Header ═══════════════════════════════════════════════════════ */}
      <header style={{
        padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #1a1a1a', flexShrink: 0, backgroundColor: '#000000',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/synapse-logo.svg" alt="Synapse" style={{ width: '24px', height: '24px', opacity: 0.9 }} />
          <div>
            <div style={{ fontSize: '15px', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.5px' }}>SYNAPSE</div>
            <div style={{ fontSize: '9px', fontWeight: 600, color: '#555555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
              Independent Verification Infrastructure
            </div>
          </div>
          <div style={{ marginLeft: '12px', padding: '2px 8px', borderRadius: '2px', border: '1px solid #222', background: 'transparent', fontSize: '9px', fontWeight: 600, color: '#555', letterSpacing: '0.8px' }}>
            v2.0
          </div>
        </div>

        {/* Summary bar */}
        {hasSummary && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', animation: 'fadeIn 0.4s ease' }}>
            <span style={{ fontSize: '11px', color: '#666666' }}>{claims.length} claims analyzed:</span>
            {Object.entries(verdictCounts).map(([verdict, count]) => {
              const vc = VERDICT_COLORS[verdict] || VERDICT_COLORS.unsupported;
              return (
                <div key={verdict} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: vc.text }} />
                  <span style={{ fontSize: '11px', fontWeight: 700, color: vc.text }}>
                    {count} {verdict.replace('_', ' ')}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Trace toggle */}
        <button onClick={() => setShowTrace(p => !p)}
          style={{
            padding: '4px 10px', borderRadius: '6px', border: '1px solid',
            borderColor: showTrace ? '#333333' : '#1a1a1a',
            backgroundColor: showTrace ? '#111111' : 'transparent',
            color: showTrace ? '#ffffff' : '#555555',
            fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', gap: '5px',
          }}>
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: traceLines.length > 0 ? '#ffffff' : '#555555', animation: selectedClaim?.status === 'verifying' ? 'pulse 1s ease-in-out infinite' : 'none' }} />
          TRACE {traceLines.length > 0 && `(${traceLines.length})`}
        </button>
      </header>

      {/* ═══ Input Bar (collapsible) ══════════════════════════════════════ */}
      {!inputCollapsed ? (
        <div style={{
          padding: claims.length ? '12px 24px' : '24px 32px', borderBottom: '1px solid #1a1a1a',
          background: '#000000',
          transition: 'padding 0.3s ease', flexShrink: 0,
        }}>
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            {!claims.length && !isIngesting && !isExtracting && (
              <div style={{ marginBottom: '24px', animation: 'fadeIn 0.5s ease' }}>
                {/* Hero */}
                <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                  <h1 style={{ fontSize: '28px', fontWeight: 300, color: '#ffffff', marginBottom: '12px', letterSpacing: '-0.3px', lineHeight: 1.35 }}>
                    Independent verification for every<br />
                    claim in financial AI output
                  </h1>
                  <p style={{ fontSize: '13px', color: '#555', maxWidth: '480px', margin: '0 auto', lineHeight: 1.7, fontWeight: 400 }}>
                    12-stage pipeline. Entity resolution. Financial normalization.
                    Peer benchmarking. Materiality scoring. Risk signal extraction.
                  </p>
                </div>

                {/* Pipeline — two rows, minimal */}
                <div style={{
                  maxWidth: '700px', margin: '0 auto 28px', padding: '16px 20px',
                  border: '1px solid #141414', borderRadius: '2px', backgroundColor: '#050505',
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 0' }}>
                    {[
                      'ingest', 'extract', 'resolve', 'normalize', 'retrieve', 'evaluate',
                      'contradict', 'consistency', 'plausibility', 'synthesize', 'trace', 'risk',
                    ].map((step, i, arr) => (
                      <React.Fragment key={step}>
                        <div style={{ fontSize: '8px', fontWeight: 600, color: '#555', letterSpacing: '0.3px' }}>{step}</div>
                        {i < arr.length - 1 && (
                          <div style={{ color: '#1a1a1a', fontSize: '7px', flexShrink: 0, padding: '0 1px' }}>{'\u2192'}</div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                  <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #111', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '8px', color: '#2a2a2a' }}>SEC EDGAR &middot; XBRL &middot; Earnings &middot; FRED &middot; Market Data &middot; Adversarial Search</span>
                    <span style={{ fontSize: '8px', color: '#2a2a2a' }}>materiality &middot; authority hierarchy &middot; peer benchmarks</span>
                  </div>
                </div>

                {/* Input area — clean, no emoji */}
                <div style={{ maxWidth: '600px', margin: '0 auto', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', gap: '0', marginBottom: '6px' }}>
                    {(['url', 'text'] as const).map(mode => (
                      <button key={mode} onClick={() => setInputMode(mode)}
                        style={{
                          padding: '5px 16px', border: '1px solid',
                          borderColor: inputMode === mode ? '#333' : '#141414',
                          borderRadius: mode === 'url' ? '2px 0 0 2px' : '0 2px 2px 0',
                          backgroundColor: inputMode === mode ? '#111' : 'transparent',
                          color: inputMode === mode ? '#ccc' : '#444',
                          fontSize: '10px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                          letterSpacing: '0.5px', textTransform: 'uppercase',
                        }}>
                        {mode}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '0', alignItems: 'stretch' }}>
                    {inputMode === 'url' ? (
                      <input value={inputValue} onChange={e => setInputValue(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleIngest()}
                        placeholder="SEC filing URL, earnings call, analyst report, news article..."
                        style={{
                          flex: 1, padding: '11px 14px', backgroundColor: '#080808', border: '1px solid #1a1a1a',
                          borderRadius: '2px 0 0 2px', color: '#ccc', fontSize: '12px', outline: 'none',
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace", transition: 'border-color 0.2s',
                        }}
                        onFocus={e => e.currentTarget.style.borderColor = '#333'}
                        onBlur={e => e.currentTarget.style.borderColor = '#1a1a1a'}
                      />
                    ) : (
                      <textarea value={inputValue} onChange={e => setInputValue(e.target.value)}
                        placeholder="Paste financial text, earnings commentary, CIM excerpt, or claims to verify..."
                        rows={3}
                        style={{
                          flex: 1, padding: '11px 14px', backgroundColor: '#080808', border: '1px solid #1a1a1a',
                          borderRadius: '2px 0 0 2px', color: '#ccc', fontSize: '12px', outline: 'none', resize: 'vertical',
                          fontFamily: "'Inter', sans-serif", lineHeight: 1.6, transition: 'border-color 0.2s',
                        }}
                        onFocus={e => e.currentTarget.style.borderColor = '#333'}
                        onBlur={e => e.currentTarget.style.borderColor = '#1a1a1a'}
                      />
                    )}
                    <button data-ingest-btn onClick={handleIngest} disabled={isIngesting || isExtracting || !inputValue.trim()}
                      style={{
                        padding: '11px 20px', borderRadius: '0 2px 2px 0',
                        border: '1px solid #333', borderLeft: 'none',
                        backgroundColor: '#ffffff', color: '#000000',
                        fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                        opacity: (isIngesting || isExtracting || !inputValue.trim()) ? 0.3 : 1,
                        letterSpacing: '0.5px', textTransform: 'uppercase',
                      }}>
                      {isIngesting ? '...' : 'Verify'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '8px', justifyContent: 'center' }}>
                    <button onClick={() => docInputRef.current?.click()}
                      style={{
                        padding: '5px 12px', borderRadius: '2px',
                        border: '1px solid #1a1a1a', backgroundColor: 'transparent', color: '#444',
                        fontSize: '10px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                        letterSpacing: '0.3px',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#888'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.color = '#444'; }}
                    >
                      Upload PDF / PPTX / DOCX
                    </button>
                  </div>
                </div>

                {/* Example claims — monochrome table */}
                <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                  <div style={{ fontSize: '9px', fontWeight: 600, color: '#333', letterSpacing: '1.5px', marginBottom: '8px', textTransform: 'uppercase' }}>
                    Sample verifications
                  </div>
                  <div style={{ border: '1px solid #141414', borderRadius: '2px', overflow: 'hidden' }}>
                    {PRELOADED_EXAMPLES.map((ex, i) => {
                      const statusColor = ex.verdict === 'supported' ? '#4ade80'
                        : ex.verdict === 'contradicted' ? '#ef4444'
                        : ex.verdict === 'mixed' ? '#888' : '#666';
                      return (
                        <button key={i} onClick={() => { setInputMode('text'); setInputValue(ex.claim); }}
                          style={{
                            width: '100%', padding: '8px 14px',
                            borderBottom: i < PRELOADED_EXAMPLES.length - 1 ? '1px solid #111' : 'none',
                            background: 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s',
                            display: 'flex', alignItems: 'center', gap: '12px',
                            border: 'none',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#0a0a0a'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <div style={{
                            width: '6px', height: '6px', borderRadius: '50%', backgroundColor: statusColor,
                            flexShrink: 0, opacity: 0.8,
                          }} />
                          <div style={{ flex: 1, fontSize: '11px', color: '#777', lineHeight: 1.4, minWidth: 0 }}>
                            {ex.claim}
                          </div>
                          <div style={{
                            fontSize: '8px', fontWeight: 700, color: '#444', letterSpacing: '0.5px',
                            textTransform: 'uppercase', flexShrink: 0, fontFamily: "'JetBrains Mono', monospace",
                          }}>{ex.tag}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {/* Compact input bar when claims are already loaded */}
            {(claims.length > 0 || isIngesting || isExtracting) && (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                  <button onClick={() => setInputMode('url')}
                    style={{
                      flex: 1, padding: '6px 10px', border: '1px solid', borderRadius: '2px 0 0 0',
                      borderColor: inputMode === 'url' ? '#ffffff' : '#1a1a1a',
                      backgroundColor: inputMode === 'url' ? 'rgba(255,255,255,0.05)' : 'transparent',
                      color: inputMode === 'url' ? '#ffffff' : '#555555',
                      fontSize: '10px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                    }}>URL</button>
                  <button onClick={() => setInputMode('text')}
                    style={{
                      flex: 1, padding: '6px 10px', border: '1px solid', borderRadius: '0 0 0 2px',
                      borderColor: inputMode === 'text' ? '#ffffff' : '#1a1a1a',
                      backgroundColor: inputMode === 'text' ? 'rgba(255,255,255,0.05)' : 'transparent',
                      color: inputMode === 'text' ? '#ffffff' : '#555555',
                      fontSize: '10px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                    }}>TEXT</button>
                </div>
                {inputMode === 'url' ? (
                  <input value={inputValue} onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleIngest()}
                    placeholder="Paste a URL..."
                    style={{
                      flex: 1, padding: '10px 14px', backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a',
                      borderRadius: '0', color: '#ffffff', fontSize: '13px', outline: 'none',
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace", transition: 'border-color 0.15s',
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = '#333333'}
                    onBlur={e => e.currentTarget.style.borderColor = '#1a1a1a'}
                  />
                ) : (
                  <textarea value={inputValue} onChange={e => setInputValue(e.target.value)}
                    placeholder="Paste text containing claims..."
                    rows={2}
                    style={{
                      flex: 1, padding: '10px 14px', backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a',
                      borderRadius: '0', color: '#ffffff', fontSize: '13px', outline: 'none', resize: 'vertical',
                      fontFamily: "'Inter', sans-serif", lineHeight: 1.5, transition: 'border-color 0.15s',
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = '#333333'}
                    onBlur={e => e.currentTarget.style.borderColor = '#1a1a1a'}
                  />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                  <button data-ingest-btn onClick={handleIngest} disabled={isIngesting || isExtracting || !inputValue.trim()}
                    style={{
                      flex: 1, padding: '10px 18px', borderRadius: '0 2px 0 0',
                      border: '1px solid #333', backgroundColor: '#ffffff', color: '#000000',
                      fontSize: '12px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                      opacity: (isIngesting || isExtracting || !inputValue.trim()) ? 0.4 : 1,
                    }}>
                    {isIngesting ? '...' : 'Verify'}
                  </button>
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <button onClick={() => docInputRef.current?.click()}
                      style={{
                        flex: 1, padding: '6px 10px', borderRadius: '0 0 0 0',
                        border: '1px solid #1a1a1a', backgroundColor: 'transparent', color: '#555555',
                        fontSize: '10px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#aaa'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.color = '#555'; }}
                    >File</button>
                  </div>
                </div>
              </div>
            )}
            <input ref={docInputRef} type="file" accept=".pdf,.pptx,.docx,.doc"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleDocUpload(f); e.target.value = ''; }}
            />
          </div>
        </div>
      ) : (
        <>
        {/* Collapsed input bar */}
        <div style={{
          padding: '6px 24px', borderBottom: '1px solid #1a1a1a', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: '#0a0a0a',
        }}>
          <span style={{ fontSize: '11px', color: '#555555' }}>Analyzing:</span>
          <span style={{ fontSize: '11px', color: '#999999', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ingestedTitle || inputValue.slice(0, 80)}
          </span>
          <button onClick={() => { setInputCollapsed(false); setClaims([]); setSelectedClaimId(null); setTraceLines([]); setReportId(null); }}
            style={{
              padding: '3px 10px', borderRadius: '4px', border: '1px solid #1a1a1a',
              backgroundColor: 'transparent', color: '#555555', fontSize: '10px', fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>New Analysis</button>
        </div>
        {/* Action bar — shown when at least one claim is verified */}
        {doneClaims > 0 && (
          <div style={{
            padding: '8px 24px', borderBottom: '1px solid #1a1a1a', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#050505',
            animation: 'fadeIn 0.3s ease',
          }}>
            <span style={{ fontSize: '10px', color: '#555555', fontWeight: 600 }}>
              ✅ {doneClaims} claims · {pipelineStats.apiCalls} API calls · {pipelineStats.services.size} services
              {pipelineStats.durationMs > 0 && ` · ${(pipelineStats.durationMs / 1000).toFixed(0)}s`}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={shareReport}
              style={{
                padding: '5px 14px', borderRadius: '5px', border: '1px solid #ffffff',
                backgroundColor: '#ffffff', color: '#000000',
                fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
              📤 Share Report
            </button>
            <button onClick={async () => {
              try {
                const reportData = {
                  title: ingestedTitle || 'Verification Report',
                  url: inputValue.startsWith('http') ? inputValue : undefined,
                  claims: claims.map(c => ({
                    id: c.id, original: c.original, normalized: c.normalized,
                    type: c.type, status: c.status, verification: c.verification,
                  })),
                  analyzed_at: new Date().toISOString(),
                };
                const resp = await fetch(`${API_BASE}/api/export-audit-log`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(reportData),
                });
                if (resp.ok) {
                  const audit = await resp.json();
                  const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = `synapse-audit-${new Date().toISOString().slice(0,10)}.json`;
                  a.click(); URL.revokeObjectURL(url);
                }
              } catch {}
            }}
              style={{
                padding: '5px 14px', borderRadius: '5px', border: '1px solid #1a5a1a',
                backgroundColor: '#0a2a0a', color: '#4ade80',
                fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
              📋 Export Audit Log
            </button>
            {reportId && (
              <button onClick={() => {
                const text = `I just verified "${ingestedTitle || 'this article'}" with Synapse. ${doneClaims} claims analyzed. See the full breakdown:`;
                const url = `${window.location.origin}/report/${reportId}`;
                window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
              }}
                style={{
                  padding: '5px 10px', borderRadius: '5px', border: '1px solid #1a1a1a',
                  backgroundColor: 'transparent', color: '#555555',
                  fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                }}>
                𝕏 Share
              </button>
            )}
            {reportId && (
              <button onClick={() => window.open(`/report/${reportId}`, '_blank')}
                style={{
                  padding: '5px 10px', borderRadius: '5px', border: '1px solid #1a1a1a',
                  backgroundColor: 'transparent', color: '#555555',
                  fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                }}>
                View Report ↗
              </button>
            )}
          </div>
        )}
        </>
      )}

      {/* ═══ Main Content ═════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ─── Left: Claims List ──────────────────────────────────────── */}
        <div style={{
          width: '320px', flexShrink: 0, borderRight: '1px solid #1a1a1a',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 12px', borderBottom: '1px solid #1a1a1a',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#888888', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Claims {claims.length > 0 && `(${claims.length})`}
            </div>
            {claims.length > 0 && claims.some(c => c.status === 'pending') && (
              <button onClick={verifyAll}
                style={{
                  padding: '3px 10px', borderRadius: '5px', border: '1px solid #ffffff',
                  backgroundColor: 'rgba(255,255,255,0.05)', color: '#ffffff',
                  fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                }}>
                Verify All
              </button>
            )}
            {claims.length > 0 && doneClaims > 0 && (
              <button onClick={shareReport}
                style={{
                  padding: '3px 10px', borderRadius: '5px', border: '1px solid #ffffff',
                  backgroundColor: '#ffffff', color: '#000000',
                  fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                📤 Share
              </button>
            )}
          </div>

          {/* Summary stats card */}
          {doneClaims > 0 && !claims.some(c => c.status === 'verifying') && (
            <div style={{
              margin: '6px', padding: '10px 12px', borderRadius: '8px',
              border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a',
              animation: 'fadeIn 0.3s ease',
            }}>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#ffffff', marginBottom: '6px' }}>
                {doneClaims} claim{doneClaims !== 1 ? 's' : ''} verified
              </div>
              {/* Stacked bar */}
              <div style={{ display: 'flex', height: '4px', borderRadius: '2px', overflow: 'hidden', backgroundColor: '#1a1a1a', marginBottom: '8px' }}>
                {Object.entries(verdictCounts).map(([v, count]) => {
                  const vc = VERDICT_COLORS[v] || VERDICT_COLORS.unsupported;
                  return <div key={v} style={{ flex: count, backgroundColor: vc.text, transition: 'flex 0.5s' }} />;
                })}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {Object.entries(verdictCounts).map(([v, count]) => {
                  const vc = VERDICT_COLORS[v] || VERDICT_COLORS.unsupported;
                  return (
                    <div key={v} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: vc.text }} />
                      <span style={{ color: vc.text, fontWeight: 600 }}>{count}</span>
                      <span style={{ color: '#555555' }}>{v.replace('_', ' ')}</span>
                    </div>
                  );
                })}
              </div>
              {pipelineStats.sources > 0 && (
                <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #1a1a1a', display: 'flex', gap: '8px', fontSize: '9px', color: '#444444', fontFamily: "'JetBrains Mono', monospace" }}>
                  <span>{pipelineStats.sources} sources</span>
                  {pipelineStats.durationMs > 0 && <span>{(pipelineStats.durationMs / 1000).toFixed(1)}s</span>}
                </div>
              )}
            </div>
          )}

          <div style={{ flex: 1, overflow: 'auto', padding: '6px' }}>
            {isExtracting && (
              <div style={{ padding: '32px', textAlign: 'center', animation: 'fadeIn 0.3s ease' }}>
                <div style={{ width: '20px', height: '20px', border: '2px solid #1a1a1a', borderTopColor: '#ffffff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
                <div style={{ fontSize: '11px', color: '#555555' }}>Extracting claims...</div>
              </div>
            )}

            {claims.map((claim, i) => {
              const isSelected = claim.id === selectedClaimId;
              const vc = claim.verification?.overallVerdict
                ? VERDICT_COLORS[claim.verification.overallVerdict.verdict] || VERDICT_COLORS.unsupported
                : null;

              return (
                <div key={claim.id}
                  onClick={() => {
                    setSelectedClaimId(claim.id);
                    if (claim.status === 'pending') verifyClaim(claim.id);
                  }}
                  style={{
                    padding: '10px 12px', marginBottom: '4px', borderRadius: '8px', cursor: 'pointer',
                    borderLeft: `3px solid ${vc?.text || (claim.status === 'verifying' ? '#ffffff' : '#1a1a1a')}`,
                    borderTop: '1px solid', borderRight: '1px solid', borderBottom: '1px solid',
                    borderTopColor: isSelected ? (vc?.border || '#333333') : '#1a1a1a',
                    borderRightColor: isSelected ? (vc?.border || '#333333') : '#1a1a1a',
                    borderBottomColor: isSelected ? (vc?.border || '#333333') : '#1a1a1a',
                    backgroundColor: isSelected ? (vc?.bg || '#111111') : vc ? `${vc.bg}` : '#0a0a0a',
                    boxShadow: isSelected ? `0 0 16px ${vc?.glow || 'rgba(0,0,0,0.3)'}` : 'none',
                    transition: 'all 0.2s',
                    animation: `slideIn 0.3s ease ${i * 0.05}s both`,
                  }}
                  onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.borderTopColor = '#2a2a2a'; e.currentTarget.style.borderRightColor = '#2a2a2a'; e.currentTarget.style.borderBottomColor = '#2a2a2a'; }}}
                  onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.borderTopColor = '#1a1a1a'; e.currentTarget.style.borderRightColor = '#1a1a1a'; e.currentTarget.style.borderBottomColor = '#1a1a1a'; }}}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    {claim.status === 'verifying' && (
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ffffff', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
                    )}
                    {(() => {
                      const typeConfig: Record<string, { color: string; label: string }> = {
                        financial_metric: { color: '#4ade80', label: 'Metric' },
                        valuation: { color: '#a78bfa', label: 'Valuation' },
                        transaction: { color: '#6b9bd2', label: 'Transaction' },
                        regulatory: { color: '#d4af37', label: 'Regulatory' },
                        guidance: { color: '#fbbf24', label: 'Guidance' },
                      };
                      const tc = typeConfig[claim.type] || { color: '#555555', label: claim.type };
                      return (
                        <span style={{ fontSize: '8px', fontWeight: 700, color: tc.color, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '1px 5px', borderRadius: '3px', backgroundColor: `${tc.color}15`, border: `1px solid ${tc.color}30` }}>
                          {tc.label}
                        </span>
                      );
                    })()}
                    {claim.verification?.overallVerdict && (
                      <span style={{
                        marginLeft: 'auto', fontSize: '9px', fontWeight: 800, padding: '2px 7px', borderRadius: '3px',
                        backgroundColor: vc?.bg, color: vc?.text, border: `1px solid ${vc?.border}`,
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                      }}>
                        {claim.verification.overallVerdict.verdict.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: '#cccccc', lineHeight: 1.45 }}>
                    {claim.original.length > 120 ? claim.original.slice(0, 120) + '...' : claim.original}
                  </div>
                  {claim.status === 'pending' && (
                    <div style={{ fontSize: '9px', color: '#555555', marginTop: '4px' }}>Click to verify</div>
                  )}
                </div>
              );
            })}

            {!claims.length && !isExtracting && !isIngesting && (
              <div style={{ padding: '12px 6px' }}>
                {/* Counter */}
                <div style={{ textAlign: 'center', marginBottom: '16px', padding: '8px' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a', letterSpacing: '-1px' }}>0</div>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: '#333333', textTransform: 'uppercase', letterSpacing: '1px' }}>claims extracted</div>
                </div>
                {/* Ghost claims */}
                {[
                  { w: '85%', delay: '0s', dur: '4s' },
                  { w: '70%', delay: '1.2s', dur: '5s' },
                  { w: '90%', delay: '2.4s', dur: '4.5s' },
                ].map((g, i) => (
                  <div key={i} style={{
                    padding: '10px 12px', marginBottom: '4px', borderRadius: '8px',
                    borderLeft: '3px solid #1a1a1a', border: '1px solid #111111',
                    backgroundColor: '#0a0a0a',
                    animation: `ghostFloat ${g.dur} ease-in-out ${g.delay} infinite`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <div style={{ width: '40px', height: '6px', borderRadius: '3px', backgroundColor: '#151515' }} />
                      <div style={{ marginLeft: 'auto', width: '55px', height: '6px', borderRadius: '3px', backgroundColor: '#151515' }} />
                    </div>
                    <div style={{ width: g.w, height: '8px', borderRadius: '4px', backgroundColor: '#111111', marginBottom: '4px' }} />
                    <div style={{ width: '50%', height: '8px', borderRadius: '4px', backgroundColor: '#0d0d0d' }} />
                  </div>
                ))}
                <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '10px', color: '#2a2a2a' }}>
                  Claims will appear here
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Center: Verification Detail (tabbed) ──────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {selectedClaim && v ? (
            <>
              {/* Sticky claim header + verdict */}
              <div style={{
                flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid #1a1a1a',
                backgroundColor: '#000000',
              }}>
                {/* Claim text */}
                <div style={{ fontSize: '14px', color: '#ffffff', lineHeight: 1.5, fontWeight: 500, marginBottom: '10px' }}>
                  "{selectedClaim.original}"
                </div>

                {/* Verdict banner */}
                {v.overallVerdict ? (() => {
                  const vc = VERDICT_COLORS[v.overallVerdict!.verdict] || VERDICT_COLORS.unsupported;
                  return (
                    <div
                      onClick={() => setVerdictExpanded(!verdictExpanded)}
                      style={{
                        padding: '12px 16px',
                        borderRadius: '10px', border: `1px solid ${vc.border}`, backgroundColor: vc.bg,
                        boxShadow: `0 0 20px ${vc.glow}`, animation: 'verdictPop 0.4s ease',
                        cursor: 'pointer', transition: 'all 0.2s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <span style={{
                          fontSize: '20px', fontWeight: 900, color: vc.text, textTransform: 'uppercase',
                          letterSpacing: '1.5px', flexShrink: 0,
                        }}>
                          {v.overallVerdict!.verdict.replace('_', ' ')}
                        </span>
                        <span style={{
                          fontSize: '10px', fontWeight: 700,
                          color: v.overallVerdict!.confidence_score != null
                            ? (v.overallVerdict!.confidence_score >= 70 ? '#4ade80' : v.overallVerdict!.confidence_score >= 40 ? '#fbbf24' : '#f87171')
                            : '#888888',
                          textTransform: 'uppercase',
                          padding: '2px 8px', borderRadius: '4px', border: '1px solid #333333', flexShrink: 0,
                          display: 'flex', alignItems: 'center', gap: '4px',
                        }}>
                          {v.overallVerdict!.confidence_score != null && (
                            <span style={{ fontWeight: 900, fontSize: '11px' }}>{v.overallVerdict!.confidence_score}</span>
                          )}
                          {v.overallVerdict!.confidence}
                        </span>
                        <span style={{ fontSize: '12px', color: '#cccccc', flex: 1 }}>
                          {!verdictExpanded && v.overallVerdict!.summary.length > 120
                            ? v.overallVerdict!.summary.slice(0, 120) + '...'
                            : v.overallVerdict!.summary}
                        </span>
                        <span style={{ fontSize: '10px', color: '#555', flexShrink: 0, transition: 'transform 0.2s', transform: verdictExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                      </div>
                      {verdictExpanded && (
                        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${vc.border}`, animation: 'fadeIn 0.2s ease' }}>
                          {v.overallVerdict!.detail && (
                            <div style={{ fontSize: '12px', color: '#aaaaaa', lineHeight: 1.6, marginBottom: '12px' }}>
                              {v.overallVerdict!.detail}
                            </div>
                          )}
                          {v.overallVerdict!.confidence_breakdown && (() => {
                            const bd = v.overallVerdict!.confidence_breakdown!;
                            const bars: { label: string; score: number; detail: string; color: string }[] = [
                              { label: 'Sources', score: bd.source_count.score, detail: `${bd.source_count.value} independent sources`, color: '#6b9bd2' },
                              { label: 'Tier Quality', score: bd.tier_quality.score, detail: `Avg authority: ${bd.tier_quality.value}${bd.tier_quality.has_sec_filing ? ' · SEC filing ✓' : ''}`, color: '#d4af37' },
                              { label: 'Agreement', score: bd.agreement_ratio.score, detail: `${bd.agreement_ratio.supporting}/${bd.agreement_ratio.total_scored} support · ${bd.agreement_ratio.opposing} oppose`, color: '#4ade80' },
                              { label: 'Recency', score: bd.recency.score, detail: bd.recency.value ? `Newest: ${bd.recency.value}` : 'Unknown', color: '#a78bfa' },
                            ];
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ fontSize: '9px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>
                                  Calibrated Confidence Breakdown
                                </div>
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
                          {/* Reconciliation assessment */}
                          {v.reconciliation && (
                            <div style={{
                              marginTop: '12px', padding: '10px 14px', borderRadius: '8px',
                              border: `1px solid ${v.reconciliation.accuracy_level === 'true' || v.reconciliation.accuracy_level === 'essentially_true' ? '#1a3a1a' : '#3a2a1a'}`,
                              backgroundColor: v.reconciliation.accuracy_level === 'true' || v.reconciliation.accuracy_level === 'essentially_true' ? '#0a1a0a' : '#1a1008',
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#888' }}>
                                  Final Assessment
                                </span>
                                {v.overallVerdict?.reconciled && (
                                  <span style={{ fontSize: '8px', fontWeight: 700, padding: '1px 6px', borderRadius: '3px', backgroundColor: '#1a3a1a', color: '#4ade80', border: '1px solid #2a4a2a' }}>
                                    RECONCILED
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '12px', color: '#cccccc', lineHeight: 1.6 }}>
                                {v.reconciliation.explanation}
                              </div>
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
                  );
                })() : (
                  /* Pipeline progress when still verifying */
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {['decomposition', 'entity_resolution', 'normalization', 'evidence_retrieval', 'evaluation', 'contradictions', 'consistency', 'plausibility', 'synthesis', 'provenance', 'correction', 'reconciliation', 'risk_signals'].map(step => {
                      const isDone = v.completedSteps.includes(step);
                      const isCurrent = v.currentStep === step && !isDone;
                      return (
                        <div key={step} style={{
                          padding: '3px 8px', borderRadius: '5px', fontSize: '9px', fontWeight: 600,
                          border: '1px solid',
                          borderColor: isDone ? '#1a3a1a' : isCurrent ? '#333333' : '#1a1a1a',
                          backgroundColor: isDone ? '#0a1a0a' : isCurrent ? '#111111' : 'transparent',
                          color: isDone ? '#4ade80' : isCurrent ? '#ffffff' : '#444444',
                          display: 'flex', alignItems: 'center', gap: '3px', transition: 'all 0.3s',
                        }}>
                          {isCurrent && <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#ffffff', animation: 'pulse 1s ease-in-out infinite' }} />}
                          {isDone && <span>✓</span>}
                          {STEP_ICONS[step]} {step.replace('_', ' ')}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ═══ Agent Orchestration Bar ═══════════════════════════ */}
                {agentChips.length > 0 && (
                  <div style={{
                    marginTop: '10px', display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center',
                    animation: 'fadeIn 0.3s ease',
                  }}>
                    {agentChips.map((chip, i) => {
                      const isDone = chip.status === 'done';
                      const isActive = chip.status === 'active';
                      const isPending = chip.status === 'pending';
                      return (
                        <React.Fragment key={chip.id}>
                          <div
                            style={{
                              padding: '3px 8px', borderRadius: '5px', fontSize: '9px', fontWeight: 700,
                              display: 'flex', alignItems: 'center', gap: '4px',
                              border: `1px solid ${isDone ? `${chip.color}50` : isActive ? chip.color : '#1a1a1a'}`,
                              backgroundColor: isDone ? `${chip.color}15` : isActive ? `${chip.color}20` : 'transparent',
                              color: isDone ? `${chip.color}` : isActive ? chip.color : '#444444',
                              opacity: isPending ? 0.35 : isDone ? 0.75 : 1,
                              transition: 'all 0.3s ease',
                              animation: isActive ? 'agentPulse 1.5s ease-in-out infinite' : 'none',
                              // @ts-ignore -- CSS custom property for the pulse keyframe
                              '--agent-glow': `${chip.color}60`,
                            } as React.CSSProperties}
                          >
                            {isDone && <span style={{ fontSize: '8px' }}>✓</span>}
                            {isActive && <span style={{
                              width: '5px', height: '5px', borderRadius: '50%',
                              backgroundColor: chip.color,
                              animation: 'pulse 0.8s ease-in-out infinite',
                              flexShrink: 0,
                            }} />}
                            {chip.label}
                          </div>
                          {i < agentChips.length - 1 && (
                            <span style={{ fontSize: '8px', color: '#333333' }}>→</span>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}

                {/* Pipeline Stats */}
                {(pipelineStats.steps > 0 || pipelineStats.durationMs > 0) && (
                  <div style={{
                    marginTop: '8px', fontSize: '9px', color: '#555555', fontWeight: 600,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    display: 'flex', gap: '10px', flexWrap: 'wrap',
                    animation: 'fadeIn 0.3s ease',
                  }}>
                    <span>{pipelineStats.steps} agent steps</span>
                    <span style={{ color: '#333333' }}>·</span>
                    <span>{pipelineStats.apiCalls} API calls</span>
                    <span style={{ color: '#333333' }}>·</span>
                    <span>{pipelineStats.services.size} services</span>
                    <span style={{ color: '#333333' }}>·</span>
                    <span>{pipelineStats.sources} sources evaluated</span>
                    {pipelineStats.durationMs > 0 && (
                      <>
                        <span style={{ color: '#333333' }}>·</span>
                        <span>{(pipelineStats.durationMs / 1000).toFixed(1)}s</span>
                      </>
                    )}
                  </div>
                )}

                {/* ═══ Action Bar ════════════════════════════════════════ */}
                {v.completedSteps.includes('correction') && (
                  <div style={{
                    marginTop: '10px', padding: '10px 14px', borderRadius: '8px',
                    border: '1px solid #1a1a1a', backgroundColor: '#050505',
                    display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center',
                    animation: 'fadeIn 0.4s ease',
                  }}>
                    <span style={{ fontSize: '9px', fontWeight: 700, color: '#333', textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: '4px' }}>Actions</span>

                    {/* Copy report */}
                    <button
                      onClick={() => {
                        const verdict = v.overallVerdict;
                        const lines = [
                          `SYNAPSE VERIFICATION REPORT`,
                          `Claim: ${selectedClaim?.original || ''}`,
                          `Verdict: ${verdict?.verdict?.toUpperCase().replace('_', ' ') || 'UNKNOWN'} (${verdict?.confidence || '?'} confidence)`,
                          `Summary: ${verdict?.summary || ''}`,
                          verdict?.reconciled ? `Final Assessment: ${v.reconciliation?.explanation || ''}` : '',
                          ``,
                          `Sub-claims: ${v.subclaims.length} · Evidence: ${v.evidence.length} · Contradictions: ${v.contradictions.length}`,
                          v.correctedClaim?.corrected ? `\nCorrected Claim: ${v.correctedClaim.corrected}` : '',
                          v.riskSignals?.red_flags?.length ? `\nRed Flags:\n${v.riskSignals.red_flags.map(f => `• ${f}`).join('\n')}` : '',
                          v.riskSignals?.recommended_actions?.length ? `\nRecommended Actions:\n${v.riskSignals.recommended_actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}` : '',
                        ].filter(Boolean).join('\n');
                        navigator.clipboard.writeText(lines);
                      }}
                      style={{
                        padding: '4px 12px', borderRadius: '5px', border: '1px solid #222',
                        backgroundColor: 'transparent', color: '#888', fontSize: '10px', fontWeight: 600,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#444'; (e.currentTarget as HTMLButtonElement).style.color = '#fff'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#222'; (e.currentTarget as HTMLButtonElement).style.color = '#888'; }}
                    >
                      📋 Copy Report
                    </button>

                    {/* Export JSON */}
                    <button
                      onClick={() => {
                        const payload = {
                          claim: selectedClaim?.original,
                          verdict: v.overallVerdict,
                          reconciliation: v.reconciliation,
                          subclaims: v.subclaims,
                          evidence: v.evidence,
                          contradictions: v.contradictions,
                          consistencyIssues: v.consistencyIssues,
                          correctedClaim: v.correctedClaim,
                          riskSignals: v.riskSignals,
                          materiality: v.materiality,
                          exportedAt: new Date().toISOString(),
                        };
                        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = 'synapse-verification.json'; a.click();
                        URL.revokeObjectURL(url);
                      }}
                      style={{
                        padding: '4px 12px', borderRadius: '5px', border: '1px solid #222',
                        backgroundColor: 'transparent', color: '#888', fontSize: '10px', fontWeight: 600,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#444'; (e.currentTarget as HTMLButtonElement).style.color = '#fff'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#222'; (e.currentTarget as HTMLButtonElement).style.color = '#888'; }}
                    >
                      ↓ Export JSON
                    </button>

                    {/* Dig deeper */}
                    {v.overallVerdict?.verdict !== 'supported' && (
                      <button
                        onClick={() => {
                          const topContradiction = v.contradictions[0];
                          const topIssue = v.consistencyIssues[0];
                          const hint = topContradiction
                            ? `Dig deeper: "${topContradiction.explanation?.slice(0, 120)}"`
                            : topIssue
                            ? `Investigate: "${topIssue.description?.slice(0, 120)}"`
                            : `Verify: "${selectedClaim?.original?.slice(0, 120)}"`;
                          navigator.clipboard.writeText(hint);
                        }}
                        style={{
                          padding: '4px 12px', borderRadius: '5px', border: '1px solid #222',
                          backgroundColor: 'transparent', color: '#888', fontSize: '10px', fontWeight: 600,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#444'; (e.currentTarget as HTMLButtonElement).style.color = '#fff'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#222'; (e.currentTarget as HTMLButtonElement).style.color = '#888'; }}
                      >
                        🔍 Copy Follow-up
                      </button>
                    )}

                    {/* Flag for review */}
                    {(v.overallVerdict?.verdict === 'contradicted' || v.overallVerdict?.verdict === 'exaggerated' || (v.contradictions.length > 0)) && (
                      <button
                        onClick={() => {
                          const flag = [
                            `[FLAGGED FOR REVIEW]`,
                            `Claim: ${selectedClaim?.original}`,
                            `Verdict: ${v.overallVerdict?.verdict}`,
                            `Reason: ${v.contradictions[0]?.explanation || v.overallVerdict?.summary}`,
                            `Flagged at: ${new Date().toLocaleString()}`,
                          ].join('\n');
                          navigator.clipboard.writeText(flag);
                        }}
                        style={{
                          padding: '4px 12px', borderRadius: '5px', border: '1px solid #3a1a1a',
                          backgroundColor: 'transparent', color: '#f87171', fontSize: '10px', fontWeight: 600,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1a0808'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
                      >
                        🚩 Flag for Review
                      </button>
                    )}

                    {/* Generate rebuttal */}
                    {v.correctedClaim?.corrected && (
                      <button
                        onClick={() => {
                          const rebuttal = [
                            `REBUTTAL`,
                            `Original claim: "${selectedClaim?.original}"`,
                            ``,
                            `This claim is ${v.reconciliation?.accuracy_level?.replace('_', ' ') || v.overallVerdict?.verdict}.`,
                            ``,
                            v.reconciliation?.explanation || v.overallVerdict?.summary || '',
                            ``,
                            `More accurate version: "${v.correctedClaim?.corrected}"`,
                            v.correctedClaim?.caveats?.length ? `\nCaveats:\n${v.correctedClaim.caveats.map((c: string) => `• ${c}`).join('\n')}` : '',
                          ].filter(Boolean).join('\n');
                          navigator.clipboard.writeText(rebuttal);
                        }}
                        style={{
                          padding: '4px 12px', borderRadius: '5px', border: '1px solid #1a2a1a',
                          backgroundColor: 'transparent', color: '#4ade80', fontSize: '10px', fontWeight: 600,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#081208'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
                      >
                        ✍ Copy Rebuttal
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* ═══ Reasoning Feed ═══════════════════════════════════ */}
              {reasoningMessages.length > 0 && (
                <div style={{
                  flexShrink: 0, borderBottom: '1px solid #1a1a1a', backgroundColor: '#030303',
                  maxHeight: reasoningCollapsed ? '32px' : (selectedClaim?.status === 'verifying' ? '280px' : '180px'),
                  overflow: 'hidden', transition: 'max-height 0.3s ease',
                }}>
                  {/* Feed header */}
                  <div
                    onClick={() => setReasoningCollapsed(p => !p)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 20px',
                      cursor: 'pointer', borderBottom: reasoningCollapsed ? 'none' : '1px solid #111',
                      userSelect: 'none',
                    }}
                  >
                    <span style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      backgroundColor: selectedClaim?.status === 'verifying' ? '#fff' : '#333',
                      animation: selectedClaim?.status === 'verifying' ? 'pulse 1.2s ease-in-out infinite' : 'none',
                      flexShrink: 0,
                    }} />
                    <span style={{
                      fontSize: '9px', fontWeight: 700, color: '#444', textTransform: 'uppercase',
                      letterSpacing: '1.2px', fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    }}>
                      REASONING TRACE
                    </span>
                    <span style={{ fontSize: '9px', color: '#333', fontFamily: "'JetBrains Mono', monospace" }}>
                      {reasoningMessages.length}
                    </span>
                    <span style={{
                      marginLeft: 'auto', fontSize: '8px', color: '#333',
                      transform: reasoningCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                      transition: 'transform 0.2s',
                    }}>▼</span>
                  </div>

                  {/* Feed messages */}
                  {!reasoningCollapsed && (
                    <div
                      ref={reasoningRef}
                      style={{
                        overflow: 'auto', padding: '6px 0',
                        maxHeight: selectedClaim?.status === 'verifying' ? '245px' : '145px',
                      }}
                    >
                      {reasoningMessages.map((msg, i) => {
                        const agentColors: Record<string, string> = {
                          resolver: '#6bccc8', decomposer: '#6bccc8', normalizer: '#6b9bd2',
                          numerical_engine: '#60a5fa', temporal_analyst: '#d4af37',
                          staleness_detector: '#fbbf24', citation_verifier: '#f0abfc',
                          retriever: '#6bccc8', evaluator: '#e8c8a0', contradiction_detector: '#f87171',
                          consistency_analyzer: '#fbbf24', plausibility_assessor: '#a78bfa',
                          synthesizer: '#e8c8a0', provenance_tracer: '#6bccc8', reconciler: '#4ade80',
                          risk_analyst: '#f87171',
                        };
                        const color = agentColors[msg.agent] || '#555';
                        const isLatest = i === reasoningMessages.length - 1 && selectedClaim?.status === 'verifying';
                        return (
                          <div
                            key={i}
                            style={{
                              padding: '4px 20px', display: 'flex', gap: '8px', alignItems: 'flex-start',
                              opacity: isLatest ? 1 : 0.65,
                              animation: isLatest ? 'fadeIn 0.3s ease' : 'none',
                            }}
                          >
                            {/* Timestamp gutter */}
                            <span style={{
                              fontSize: '8px', color: '#222', fontFamily: "'JetBrains Mono', monospace",
                              minWidth: '32px', flexShrink: 0, paddingTop: '2px', textAlign: 'right',
                            }}>
                              {new Date(msg.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>

                            {/* Agent label */}
                            <span style={{
                              fontSize: '8px', fontWeight: 700, color, minWidth: '80px', flexShrink: 0,
                              fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase',
                              letterSpacing: '0.3px', paddingTop: '2px',
                            }}>
                              {msg.agent.replace(/_/g, ' ').slice(0, 12)}
                            </span>

                            {/* Message + detail */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                fontSize: '10px', color: '#999', fontFamily: "'JetBrains Mono', monospace",
                                lineHeight: 1.4, wordBreak: 'break-word',
                              }}>
                                {msg.message}
                              </div>
                              {msg.detail && (
                                <div style={{
                                  fontSize: '9px', color: '#444', fontFamily: "'JetBrains Mono', monospace",
                                  lineHeight: 1.4, marginTop: '1px', wordBreak: 'break-word',
                                }}>
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

              {/* Tabs */}
              <div style={{
                flexShrink: 0, display: 'flex', borderBottom: '1px solid #1a1a1a',
                backgroundColor: '#0a0a0a',
              }}>
                {([
                  { key: 'subclaims' as const, label: 'Sub-Claims', icon: '🔬', count: v.subclaims.length },
                  { key: 'evidence' as const, label: 'Evidence', icon: '📄', count: v.evidence.length },
                  { key: 'contradictions' as const, label: 'Contradictions', icon: '⚡', count: v.contradictions.length },
                  ...(v.consistencyIssues.length > 0 ? [{ key: 'consistency' as const, label: 'Consistency', icon: '🔍', count: v.consistencyIssues.length }] : []),
                  ...(v.plausibility ? [{ key: 'plausibility' as const, label: 'Plausibility', icon: '🎯', count: 1 }] : []),
                  { key: 'provenance' as const, label: 'Provenance', icon: '🔗', count: v.provenanceNodes.length },
                  { key: 'correction' as const, label: 'Correction', icon: '✏️', count: v.correctedClaim ? 1 : 0 },
                  ...(v.riskSignals ? [{ key: 'risk_signals' as const, label: 'Risk', icon: '🚨', count: (v.riskSignals.red_flags || []).length }] : []),
                ]).map(tab => {
                  const isActive = activeTab === tab.key;
                  return (
                    <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                      style={{
                        flex: 1, padding: '10px 8px', border: 'none', borderBottom: `2px solid ${isActive ? '#ffffff' : 'transparent'}`,
                        backgroundColor: 'transparent', color: isActive ? '#ffffff' : '#555555',
                        fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                      }}>
                      <span>{tab.icon}</span>
                      {tab.label}
                      {tab.count > 0 && (
                        <span style={{
                          fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                          backgroundColor: isActive ? 'rgba(255,255,255,0.1)' : '#1a1a1a',
                          color: isActive ? '#ffffff' : '#444444',
                        }}>{tab.count}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>

                {/* ── Sub-Claims Tab ──────────────────────────────────── */}
                {activeTab === 'subclaims' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', animation: 'fadeIn 0.2s ease' }}>
                    {v.subclaims.map((sc, i) => {
                      const scColor = sc.verdict ? (VERDICT_COLORS[sc.verdict] || VERDICT_COLORS.unsupported) : null;
                      return (
                        <div key={sc.id} style={{
                          padding: '14px 16px', borderRadius: '10px',
                          borderLeft: `3px solid ${scColor?.text || '#444444'}`,
                          border: `1px solid ${scColor?.border || '#1a1a1a'}`,
                          borderLeftWidth: '3px', borderLeftColor: scColor?.text || '#444444',
                          backgroundColor: scColor?.bg || '#0a0a0a',
                          animation: `slideIn 0.3s ease ${i * 0.08}s both`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <span style={{
                              width: '8px', height: '8px', borderRadius: '50%',
                              backgroundColor: scColor?.text || '#444444',
                              animation: !sc.verdict ? 'pulse 1.2s ease-in-out infinite' : 'none',
                            }} />
                            <span style={{ fontSize: '10px', fontWeight: 600, color: '#555555', textTransform: 'uppercase' }}>
                              {sc.type}
                            </span>
                            {sc.verdict && (
                              <span style={{
                                marginLeft: 'auto', fontSize: '10px', fontWeight: 800, color: scColor?.text,
                                textTransform: 'uppercase', letterSpacing: '0.5px',
                              }}>
                                {sc.verdict.replace('_', ' ')}
                              </span>
                            )}
                            {sc.confidence && (
                              <span style={{ fontSize: '9px', color: '#555555', fontWeight: 600 }}>
                                {sc.confidence}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '13px', color: '#dddddd', lineHeight: 1.55 }}>
                            {sc.text}
                          </div>
                          {sc.summary && (
                            <div style={{ fontSize: '11px', color: '#888888', marginTop: '6px', lineHeight: 1.5, paddingTop: '6px', borderTop: '1px solid #1a1a1a' }}>
                              {sc.summary}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {v.subclaims.length === 0 && selectedClaim.status === 'verifying' && (
                      <div style={{ textAlign: 'center', padding: '40px' }}>
                        <div style={{ width: '24px', height: '24px', border: '2px solid #1a1a1a', borderTopColor: '#ffffff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
                        <div style={{ fontSize: '12px', color: '#ffffff' }}>Decomposing claim...</div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Evidence Tab ─────────────────────────────────────── */}
                {activeTab === 'evidence' && (
                  <div style={{ animation: 'fadeIn 0.2s ease' }}>
                    {/* Group by sub-claim */}
                    {v.subclaims.map(sc => {
                      const scEvidence = v.evidence.filter(e => e.subclaim_id === sc.id);
                      if (scEvidence.length === 0) return null;
                      const scColor = sc.verdict ? (VERDICT_COLORS[sc.verdict] || VERDICT_COLORS.unsupported) : null;
                      return (
                        <div key={sc.id} style={{ marginBottom: '20px' }}>
                          <div style={{
                            fontSize: '11px', fontWeight: 700, color: scColor?.text || '#888888', marginBottom: '8px',
                            display: 'flex', alignItems: 'center', gap: '6px',
                          }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: scColor?.text || '#444444' }} />
                            {sc.text.slice(0, 80)}{sc.text.length > 80 ? '...' : ''}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {scEvidence.map((ev, i) => {
                              const tierInfo = TIER_LABELS[ev.tier] || { label: ev.tier, icon: '📋', color: '#94a3b8' };
                              const qScore = ev.quality_score ?? 0;
                              const qColor = qScore >= 70 ? '#4ade80' : qScore >= 40 ? '#fbbf24' : '#94a3b8';
                              return (
                                <div key={ev.id} style={{
                                  padding: '10px 12px', borderRadius: '8px',
                                  border: `1px solid ${ev.tier === 'counter' ? '#3a1a1a' : '#1a1a1a'}`,
                                  backgroundColor: ev.tier === 'counter' ? '#1a0a0a' : '#0a0a0a',
                                  animation: `slideIn 0.2s ease ${i * 0.04}s both`,
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '11px' }}>{tierInfo.icon}</span>
                                    <span style={{ fontSize: '9px', fontWeight: 700, color: tierInfo.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                      {tierInfo.label}
                                    </span>
                                    {ev.study_type && (
                                      <span style={{ fontSize: '9px', color: '#555555', fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: '#1a1a1a' }}>
                                        {ev.study_type}
                                      </span>
                                    )}
                                    {/* Quality gauge */}
                                    {ev.quality_score != null && (
                                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <div style={{ width: '40px', height: '4px', borderRadius: '2px', backgroundColor: '#1a1a1a', overflow: 'hidden' }}>
                                          <div style={{ width: `${qScore}%`, height: '100%', borderRadius: '2px', backgroundColor: qColor, transition: 'width 0.5s ease' }} />
                                        </div>
                                        <span style={{ fontSize: '9px', fontWeight: 700, color: qColor }}>{qScore}</span>
                                      </div>
                                    )}
                                    {ev.supports_claim != null && (
                                      <span style={{
                                        fontSize: '8px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                                        backgroundColor: ev.supports_claim === true ? '#0a1a0a' : ev.supports_claim === false ? '#1a0a0a' : '#1a1500',
                                        color: ev.supports_claim === true ? '#4ade80' : ev.supports_claim === false ? '#f87171' : '#fbbf24',
                                        border: `1px solid ${ev.supports_claim === true ? '#1a3a1a' : ev.supports_claim === false ? '#3a1a1a' : '#3a3000'}`,
                                      }}>
                                        {ev.supports_claim === true ? 'SUPPORTS' : ev.supports_claim === false ? 'OPPOSES' : 'PARTIAL'}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#dddddd', marginBottom: '3px' }}>
                                    {ev.title}
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#888888', lineHeight: 1.5 }}>
                                    {ev.snippet?.slice(0, 180)}{(ev.snippet?.length || 0) > 180 ? '...' : ''}
                                  </div>
                                  {/* XBRL Ground Truth Comparison */}
                                  {ev.xbrl_match && (
                                    <div style={{
                                      marginTop: '8px', padding: '8px 10px', borderRadius: '6px',
                                      backgroundColor: ev.xbrl_match === 'exact' ? '#0a1a0a' : ev.xbrl_match === 'close' ? '#1a1500' : '#1a0a0a',
                                      border: `1px solid ${ev.xbrl_match === 'exact' ? '#1a3a1a' : ev.xbrl_match === 'close' ? '#3a3000' : '#3a1a1a'}`,
                                    }}>
                                      <div style={{ fontSize: '9px', fontWeight: 800, color: '#d4af37', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        ⚖️ XBRL Ground Truth
                                        <span style={{
                                          fontSize: '8px', padding: '1px 5px', borderRadius: '3px',
                                          backgroundColor: ev.xbrl_match === 'exact' ? '#4ade8020' : ev.xbrl_match === 'close' ? '#fbbf2420' : '#f8717120',
                                          color: ev.xbrl_match === 'exact' ? '#4ade80' : ev.xbrl_match === 'close' ? '#fbbf24' : '#f87171',
                                          border: `1px solid ${ev.xbrl_match === 'exact' ? '#4ade8040' : ev.xbrl_match === 'close' ? '#fbbf2440' : '#f8717140'}`,
                                        }}>{ev.xbrl_match?.toUpperCase()} MATCH</span>
                                      </div>
                                      <div style={{ display: 'flex', gap: '12px', fontSize: '11px' }}>
                                        {ev.xbrl_claimed && (
                                          <div>
                                            <span style={{ color: '#888', fontSize: '9px', fontWeight: 600 }}>CLAIMED: </span>
                                            <span style={{ color: '#fff', fontWeight: 700 }}>{ev.xbrl_claimed}</span>
                                          </div>
                                        )}
                                        {ev.xbrl_actual && (
                                          <div>
                                            <span style={{ color: '#888', fontSize: '9px', fontWeight: 600 }}>ACTUAL: </span>
                                            <span style={{ color: '#d4af37', fontWeight: 700 }}>{ev.xbrl_actual}</span>
                                          </div>
                                        )}
                                      </div>
                                      {ev.xbrl_computation && (
                                        <div style={{ fontSize: '10px', color: '#888', marginTop: '4px', fontFamily: "'JetBrains Mono', monospace" }}>
                                          {ev.xbrl_computation}
                                        </div>
                                      )}
                                      {ev.xbrl_discrepancy && ev.xbrl_match !== 'exact' && (
                                        <div style={{ fontSize: '10px', color: ev.xbrl_match === 'close' ? '#fbbf24' : '#f87171', marginTop: '4px' }}>
                                          {ev.xbrl_discrepancy}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '9px', color: '#555555' }}>
                                    {ev.verified_against && <span style={{ color: '#d4af37', fontWeight: 600 }}>{ev.verified_against}</span>}
                                    {ev.year && <span>{ev.year}</span>}
                                    {ev.citations != null && <span>{ev.citations} cit.</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {/* Ungrouped evidence */}
                    {v.evidence.filter(e => !e.subclaim_id || !v.subclaims.find(sc => sc.id === e.subclaim_id)).length > 0 && (
                      <div style={{ marginBottom: '20px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#555555', marginBottom: '8px' }}>Other Sources</div>
                        {v.evidence.filter(e => !e.subclaim_id || !v.subclaims.find(sc => sc.id === e.subclaim_id)).map((ev, i) => {
                          const tierInfo = TIER_LABELS[ev.tier] || { label: ev.tier, icon: '📋', color: '#94a3b8' };
                          return (
                            <div key={ev.id} style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a', marginBottom: '4px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '10px' }}>{tierInfo.icon}</span>
                                <span style={{ fontSize: '11px', fontWeight: 600, color: '#dddddd' }}>{ev.title}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {v.evidence.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#555555', fontSize: '12px' }}>
                        {selectedClaim.status === 'verifying' ? 'Searching for evidence...' : 'No evidence collected yet'}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Contradictions Tab ──────────────────────────────── */}
                {activeTab === 'contradictions' && (
                  <div style={{ animation: 'fadeIn 0.2s ease' }}>
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
                              animation: `slideIn 0.3s ease ${i * 0.08}s both`,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                <span style={{
                                  fontSize: '9px', fontWeight: 800, padding: '2px 8px', borderRadius: '3px',
                                  backgroundColor: `${sev.text}20`, color: sev.text, border: `1px solid ${sev.text}40`,
                                  textTransform: 'uppercase', letterSpacing: '0.5px',
                                }}>{c.severity} severity</span>
                              </div>
                              <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                                {/* Source A */}
                                <div style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
                                  <div style={{ fontSize: '9px', fontWeight: 700, color: '#d4af37', textTransform: 'uppercase', marginBottom: '4px' }}>
                                    {c.source_a?.type || 'Source A'}
                                  </div>
                                  <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>{c.source_a?.name}</div>
                                  <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.5, fontStyle: 'italic' }}>
                                    "{c.source_a?.text}"
                                  </div>
                                </div>
                                {/* VS divider */}
                                <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                  <span style={{ fontSize: '10px', fontWeight: 800, color: sev.text }}>VS</span>
                                </div>
                                {/* Source B */}
                                <div style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
                                  <div style={{ fontSize: '9px', fontWeight: 700, color: '#6b9bd2', textTransform: 'uppercase', marginBottom: '4px' }}>
                                    {c.source_b?.type || 'Source B'}
                                  </div>
                                  <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>{c.source_b?.name}</div>
                                  <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.5, fontStyle: 'italic' }}>
                                    "{c.source_b?.text}"
                                  </div>
                                </div>
                              </div>
                              <div style={{ fontSize: '12px', color: '#aaa', lineHeight: 1.5, paddingTop: '10px', borderTop: `1px solid ${sev.border}` }}>
                                {c.explanation}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#555555', fontSize: '12px' }}>
                        {selectedClaim.status === 'verifying' ? 'Checking for contradictions...' : 'No contradictions detected between sources'}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Consistency Issues Tab ─────────────────────────── */}
                {activeTab === 'consistency' && (
                  <div style={{ animation: 'fadeIn 0.2s ease' }}>
                    {v.consistencyIssues.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ fontSize: '11px', color: '#777', lineHeight: 1.5, marginBottom: '4px' }}>
                          Cross-document consistency analysis detected subtle tensions between sources — beyond direct contradictions.
                        </div>
                        {v.consistencyIssues.map((ci, i) => {
                          const typeColors: Record<string, { bg: string; border: string; text: string; label: string }> = {
                            narrative_drift:        { bg: '#1a0a1a', border: '#3a1a3a', text: '#c084fc', label: 'Narrative Drift' },
                            metric_inconsistency:   { bg: '#1a0a0a', border: '#3a1a1a', text: '#f87171', label: 'Metric Inconsistency' },
                            temporal_inconsistency: { bg: '#1a1500', border: '#3a3000', text: '#fbbf24', label: 'Temporal Issue' },
                            omission_flag:          { bg: '#0a1a1a', border: '#1a3a3a', text: '#6bccc8', label: 'Omission Flag' },
                            risk_factor_tension:    { bg: '#1a1000', border: '#3a2000', text: '#fb923c', label: 'Risk Factor Tension' },
                          };
                          const tc = typeColors[ci.type] || typeColors.omission_flag;
                          const sevColors: Record<string, string> = { low: '#fbbf24', medium: '#fb923c', high: '#f87171' };
                          return (
                            <div key={ci.id || i} style={{
                              padding: '16px', borderRadius: '10px',
                              border: `1px solid ${tc.border}`, backgroundColor: tc.bg,
                              animation: `slideIn 0.3s ease ${i * 0.08}s both`,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                                <span style={{
                                  fontSize: '9px', fontWeight: 800, padding: '2px 8px', borderRadius: '3px',
                                  backgroundColor: `${tc.text}20`, color: tc.text, border: `1px solid ${tc.text}40`,
                                  textTransform: 'uppercase', letterSpacing: '0.5px',
                                }}>{tc.label}</span>
                                <span style={{
                                  fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                                  color: sevColors[ci.severity] || '#888',
                                  border: `1px solid ${(sevColors[ci.severity] || '#888')}40`,
                                  textTransform: 'uppercase',
                                }}>{ci.severity}</span>
                                {ci.sources_involved?.length > 0 && (
                                  <span style={{ fontSize: '9px', color: '#555', marginLeft: 'auto' }}>
                                    Sources: {ci.sources_involved.join(', ')}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.6, marginBottom: '8px' }}>
                                {ci.description}
                              </div>
                              {ci.implication && (
                                <div style={{
                                  fontSize: '11px', color: '#999', lineHeight: 1.5, paddingTop: '8px',
                                  borderTop: `1px solid ${tc.border}`, fontStyle: 'italic',
                                }}>
                                  Implication: {ci.implication}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#555555', fontSize: '12px' }}>
                        No cross-document consistency issues detected
                      </div>
                    )}
                  </div>
                )}

                {/* ── Plausibility Tab ─────────────────────────────────── */}
                {activeTab === 'plausibility' && v.plausibility && (
                  <div style={{ animation: 'fadeIn 0.2s ease' }}>
                    {/* Plausibility Score Header */}
                    <div style={{
                      padding: '20px', borderRadius: '12px', marginBottom: '16px',
                      border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a',
                      textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '8px' }}>
                        Forward-Looking Plausibility
                      </div>
                      <div style={{
                        fontSize: '48px', fontWeight: 800, letterSpacing: '-2px',
                        color: v.plausibility.plausibility_score >= 70 ? '#4ade80'
                          : v.plausibility.plausibility_score >= 40 ? '#fbbf24' : '#f87171',
                      }}>
                        {v.plausibility.plausibility_score}
                      </div>
                      <div style={{
                        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px',
                        color: v.plausibility.plausibility_score >= 70 ? '#4ade80'
                          : v.plausibility.plausibility_score >= 40 ? '#fbbf24' : '#f87171',
                        marginBottom: '12px',
                      }}>
                        {v.plausibility.plausibility_level?.replace(/_/g, ' ')}
                      </div>
                      <div style={{ fontSize: '13px', color: '#aaa', lineHeight: 1.6, maxWidth: '500px', margin: '0 auto' }}>
                        {v.plausibility.assessment}
                      </div>
                    </div>

                    {/* Projection vs Current */}
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                      <div style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid #1a3a1a', backgroundColor: '#0a1a0a' }}>
                        <div style={{ fontSize: '9px', fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                          Projection
                        </div>
                        <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.6 }}>
                          <div><span style={{ color: '#666' }}>Target:</span> {v.plausibility.projection?.target_metric}</div>
                          <div><span style={{ color: '#666' }}>Value:</span> {v.plausibility.projection?.target_value}</div>
                          <div><span style={{ color: '#666' }}>By:</span> {v.plausibility.projection?.target_date}</div>
                          <div><span style={{ color: '#666' }}>Requires:</span> {v.plausibility.projection?.implied_growth_rate}</div>
                        </div>
                      </div>
                      <div style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid #1a1a3a', backgroundColor: '#0a0a1a' }}>
                        <div style={{ fontSize: '9px', fontWeight: 700, color: '#6b9bd2', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                          Current Trajectory
                        </div>
                        <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.6 }}>
                          <div><span style={{ color: '#666' }}>Current:</span> {v.plausibility.current_trajectory?.current_value}</div>
                          <div><span style={{ color: '#666' }}>Trend:</span> {v.plausibility.current_trajectory?.trend?.replace(/_/g, ' ')}</div>
                          <div><span style={{ color: '#666' }}>Historical:</span> {v.plausibility.current_trajectory?.historical_growth_rate}</div>
                        </div>
                      </div>
                    </div>

                    {/* Risks and Assumptions */}
                    <div style={{ display: 'flex', gap: '12px' }}>
                      {v.plausibility.key_risks?.length > 0 && (
                        <div style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid #3a1a1a', backgroundColor: '#1a0a0a' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                            Key Risks
                          </div>
                          {v.plausibility.key_risks.map((r, i) => (
                            <div key={i} style={{ fontSize: '11px', color: '#bbb', lineHeight: 1.5, marginBottom: '4px', paddingLeft: '10px', borderLeft: '2px solid #3a1a1a' }}>
                              {r}
                            </div>
                          ))}
                        </div>
                      )}
                      {v.plausibility.key_assumptions?.length > 0 && (
                        <div style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid #1a1a3a', backgroundColor: '#0a0a1a' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                            Key Assumptions
                          </div>
                          {v.plausibility.key_assumptions.map((a, i) => (
                            <div key={i} style={{ fontSize: '11px', color: '#bbb', lineHeight: 1.5, marginBottom: '4px', paddingLeft: '10px', borderLeft: '2px solid #1a1a3a' }}>
                              {a}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Provenance Tab (horizontal tree) ────────────────── */}
                {activeTab === 'provenance' && (
                  <div style={{ animation: 'fadeIn 0.2s ease' }}>
                    {v.provenanceNodes.length > 0 ? (
                      <>
                        {/* Section header */}
                        <div style={{ padding: '12px 0 4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>Claim Origin Timeline</span>
                          <div style={{ flex: 1, height: '1px', background: '#1a1a1a' }} />
                          <span style={{ fontSize: '10px', color: '#444' }}>{v.provenanceNodes.length} sources traced</span>
                        </div>
                        {/* Horizontal provenance tree */}
                        <div style={{
                          overflowX: 'auto', overflowY: 'hidden', padding: '28px 12px 20px',
                          display: 'flex', alignItems: 'stretch', gap: '0',
                          minHeight: '240px',
                        }}>
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
                                  borderRadius: '12px', border: `1px solid ${mutColor}50`,
                                  backgroundColor: '#080808',
                                  boxShadow: `0 0 20px ${mutColor}20, inset 0 1px 0 ${mutColor}10`,
                                  animation: `slideInH 0.4s ease ${i * 0.15}s both`,
                                  position: 'relative',
                                  display: 'flex', flexDirection: 'column',
                                }}>
                                  {/* Glow dot */}
                                  <div style={{
                                    position: 'absolute', top: '-6px', left: '50%', transform: 'translateX(-50%)',
                                    width: '12px', height: '12px', borderRadius: '50%',
                                    backgroundColor: mutColor, border: '2px solid #000000',
                                    boxShadow: `0 0 12px ${mutColor}80`,
                                  }} />
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                    <span style={{ fontSize: '16px' }}>{sourceIcons[node.source_type] || '📋'}</span>
                                    <span style={{ fontSize: '11px', fontWeight: 800, color: mutColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                      {node.source_type}
                                    </span>
                                    {node.date && <span style={{ fontSize: '11px', color: '#555555', marginLeft: 'auto', fontWeight: 600 }}>{node.date}</span>}
                                  </div>
                                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#999999', marginBottom: '6px', lineHeight: 1.4 }}>
                                    {node.source_name}
                                  </div>
                                  <div style={{ fontSize: '13px', color: '#dddddd', lineHeight: 1.55, fontStyle: 'italic', flex: 1 }}>
                                    "{node.text.length > 140 ? node.text.slice(0, 140) + '...' : node.text}"
                                  </div>
                                  {node.mutation_severity !== 'none' && (
                                    <div style={{
                                      marginTop: '10px', fontSize: '10px', fontWeight: 700, color: mutColor,
                                      padding: '3px 8px', borderRadius: '4px', backgroundColor: `${mutColor}15`,
                                      display: 'inline-block', border: `1px solid ${mutColor}30`,
                                    }}>
                                      {node.mutation_severity} mutation
                                    </div>
                                  )}
                                </div>
                                {/* Connecting arrow */}
                                {i < v.provenanceNodes.length - 1 && (
                                  <div style={{
                                    flexShrink: 0, width: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    animation: `fadeIn 0.3s ease ${i * 0.15 + 0.1}s both`,
                                  }}>
                                    <svg width="48" height="24" viewBox="0 0 48 24">
                                      <defs>
                                        <linearGradient id={`grad-${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
                                          <stop offset="0%" stopColor={mutColor} />
                                          <stop offset="100%" stopColor={nextColor} />
                                        </linearGradient>
                                      </defs>
                                      <line x1="0" y1="12" x2="36" y2="12" stroke={`url(#grad-${i})`} strokeWidth="2.5" />
                                      <polygon points="36,6 48,12 36,18" fill={nextColor} opacity="0.9" />
                                    </svg>
                                  </div>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>
                        {/* Analysis */}
                        {v.provenanceAnalysis && (
                          <div style={{
                            marginTop: '8px', padding: '14px 16px', borderRadius: '10px',
                            backgroundColor: '#080808', border: '1px solid #1a1a1a',
                            fontSize: '13px', color: '#999999', lineHeight: 1.65,
                          }}>
                            <span style={{ fontWeight: 700, color: '#ffffff', marginRight: '6px' }}>Analysis:</span>
                            {v.provenanceAnalysis}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#555555', fontSize: '12px' }}>
                        {selectedClaim.status === 'verifying' ? 'Tracing claim origins...' : 'No provenance data yet'}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Correction Tab ───────────────────────────────────── */}
                {activeTab === 'correction' && (
                  <div style={{ animation: 'fadeIn 0.2s ease' }}>
                    {v.correctedClaim ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #3a1a1a', backgroundColor: '#1a0a0a' }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#f87171', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Original</div>
                          <div style={{ fontSize: '14px', color: '#fca5a5', lineHeight: 1.6, textDecoration: 'line-through', textDecorationColor: '#f8717140' }}>
                            {v.correctedClaim.original}
                          </div>
                        </div>
                        <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #1a3a1a', backgroundColor: '#0a1a0a' }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#4ade80', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Corrected</div>
                          <div style={{ fontSize: '14px', color: '#bbf7d0', lineHeight: 1.6 }}>
                            {v.correctedClaim.corrected}
                          </div>
                        </div>
                        <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #222233', backgroundColor: '#0a0a15' }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#a0a0cc', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Steel-manned</div>
                          <div style={{ fontSize: '14px', color: '#c7d2fe', lineHeight: 1.6 }}>
                            {v.correctedClaim.steelmanned}
                          </div>
                        </div>
                        <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #2a2a1a', backgroundColor: '#111108' }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#cccc88', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>One-sentence summary</div>
                          <div style={{ fontSize: '13px', color: '#eeeebb', lineHeight: 1.6 }}>
                            {v.correctedClaim.one_sentence}
                          </div>
                        </div>
                        {v.correctedClaim.caveats.length > 0 && (
                          <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a' }}>
                            <div style={{ fontSize: '10px', fontWeight: 700, color: '#ffffff', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Key Caveats</div>
                            {v.correctedClaim.caveats.map((c, i) => (
                              <div key={i} style={{ fontSize: '12px', color: '#888888', lineHeight: 1.5, padding: '3px 0', display: 'flex', gap: '8px' }}>
                                <span style={{ color: '#ffffff', flexShrink: 0 }}>⚠</span> {c}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#555555', fontSize: '12px' }}>
                        {selectedClaim.status === 'verifying' ? 'Generating corrected claim...' : 'No correction generated yet'}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Risk Signals Tab ────────────────────────────────── */}
                {activeTab === 'risk_signals' && (
                  <div style={{ animation: 'fadeIn 0.2s ease' }}>
                    {v.riskSignals ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {/* Risk headline */}
                        <div style={{
                          padding: '16px', borderRadius: '10px',
                          border: `1px solid ${v.riskSignals.risk_level === 'critical' ? '#5c1a1a' : v.riskSignals.risk_level === 'high' ? '#4a2a0a' : '#1a1a2a'}`,
                          backgroundColor: v.riskSignals.risk_level === 'critical' ? '#1a0808' : v.riskSignals.risk_level === 'high' ? '#1a1008' : '#0a0a12',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                            <div style={{
                              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                              color: v.riskSignals.risk_level === 'critical' ? '#f87171' : v.riskSignals.risk_level === 'high' ? '#fb923c' : v.riskSignals.risk_level === 'medium' ? '#fbbf24' : '#4ade80',
                            }}>
                              Risk: {v.riskSignals.risk_level} ({v.riskSignals.risk_score}/100)
                            </div>
                          </div>
                          <div style={{ fontSize: '14px', color: '#e0e0e0', lineHeight: 1.6, fontWeight: 600 }}>
                            {v.riskSignals.headline}
                          </div>
                          <div style={{ fontSize: '12px', color: '#888', lineHeight: 1.6, marginTop: '8px' }}>
                            {v.riskSignals.risk_narrative}
                          </div>
                        </div>

                        {/* Patterns detected */}
                        {v.riskSignals.patterns_detected.length > 0 && (
                          <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a' }}>
                            <div style={{ fontSize: '10px', fontWeight: 700, color: '#ffffff', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Patterns Detected</div>
                            {v.riskSignals.patterns_detected.map((p, i) => (
                              <div key={i} style={{ padding: '10px 0', borderBottom: i < v.riskSignals!.patterns_detected.length - 1 ? '1px solid #111' : 'none' }}>
                                <div style={{ fontSize: '12px', color: '#e0e0e0', fontWeight: 600, marginBottom: '4px' }}>{p.pattern}</div>
                                <div style={{ fontSize: '11px', color: '#777', lineHeight: 1.5 }}>{p.evidence}</div>
                                <div style={{ fontSize: '10px', color: '#555', marginTop: '4px' }}>{p.frequency}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Red flags */}
                        {v.riskSignals.red_flags.length > 0 && (
                          <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #3a1a1a', backgroundColor: '#1a0a0a' }}>
                            <div style={{ fontSize: '10px', fontWeight: 700, color: '#f87171', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Red Flags</div>
                            {v.riskSignals.red_flags.map((f, i) => (
                              <div key={i} style={{ fontSize: '12px', color: '#fca5a5', lineHeight: 1.5, padding: '3px 0', display: 'flex', gap: '8px' }}>
                                <span style={{ color: '#f87171', flexShrink: 0 }}>●</span> {f}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Recommended actions */}
                        {v.riskSignals.recommended_actions.length > 0 && (
                          <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #1a2a1a', backgroundColor: '#0a1a0a' }}>
                            <div style={{ fontSize: '10px', fontWeight: 700, color: '#4ade80', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Recommended Actions</div>
                            {v.riskSignals.recommended_actions.map((a, i) => (
                              <div key={i} style={{ fontSize: '12px', color: '#bbf7d0', lineHeight: 1.5, padding: '3px 0', display: 'flex', gap: '8px' }}>
                                <span style={{ color: '#4ade80', flexShrink: 0 }}>{i + 1}.</span> {a}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Materiality + Authority conflicts summary */}
                        {(v.materiality || v.authorityConflicts.length > 0) && (
                          <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a' }}>
                            {v.materiality && (
                              <div style={{ marginBottom: v.authorityConflicts.length > 0 ? '12px' : '0' }}>
                                <div style={{ fontSize: '10px', fontWeight: 700, color: '#ffffff', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Materiality</div>
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
                                <div style={{ fontSize: '10px', fontWeight: 700, color: '#ffffff', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Source Authority Conflicts</div>
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
                      <div style={{ textAlign: 'center', padding: '40px', color: '#555555', fontSize: '12px' }}>
                        {selectedClaim.status === 'verifying' ? 'Extracting risk signals...' : 'No risk signals generated yet'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ─── Ghost Preview ─── */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
              {/* Overlay prompt */}
              <div style={{
                position: 'absolute', inset: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 70%, transparent 100%)',
                pointerEvents: 'none',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <img src="/synapse-logo.svg" alt="" style={{ width: '36px', height: '36px', opacity: 0.4, margin: '0 auto 10px' }} />
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#555555' }}>Submit a URL to see the full verification</div>
                </div>
              </div>

              {/* Ghost: sticky header with verdict */}
              <div style={{ flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid #111111' }}>
                <div style={{ width: '80%', height: '10px', borderRadius: '5px', backgroundColor: '#0d0d0d', marginBottom: '12px', animation: 'ghostShimmer 5s ease infinite' }} />
                {/* Ghost verdict banner */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 16px',
                  borderRadius: '10px', border: '1px solid #111111', backgroundColor: '#080808',
                  animation: 'ghostShimmer 6s ease 0.5s infinite',
                }}>
                  <div style={{ width: '120px', height: '16px', borderRadius: '4px', backgroundColor: '#0f0f0f' }} />
                  <div style={{ width: '50px', height: '12px', borderRadius: '4px', backgroundColor: '#0d0d0d' }} />
                  <div style={{ flex: 1, height: '10px', borderRadius: '4px', backgroundColor: '#0a0a0a' }} />
                </div>
                {/* Ghost agent bar */}
                <div style={{ marginTop: '10px', display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {['#6bccc8','#e8c8a0','#6b9bd2','#6bccc8','#6bccc8','#e8c8a0','#e8c8a0','#6bccc8','#e8c8a0'].map((c, i) => (
                    <React.Fragment key={i}>
                      <div style={{
                        width: `${50 + Math.random() * 40}px`, height: '16px', borderRadius: '5px',
                        border: `1px solid ${c}10`, backgroundColor: `${c}05`,
                        animation: `ghostShimmer ${4 + i * 0.3}s ease ${i * 0.2}s infinite`,
                      }} />
                      {i < 8 && <span style={{ fontSize: '8px', color: '#111111' }}>→</span>}
                    </React.Fragment>
                  ))}
                </div>
                {/* Ghost stats */}
                <div style={{ marginTop: '8px', display: 'flex', gap: '10px' }}>
                  {[60, 50, 45, 80, 35].map((w, i) => (
                    <div key={i} style={{ width: `${w}px`, height: '8px', borderRadius: '4px', backgroundColor: '#0a0a0a', animation: `ghostShimmer 5s ease ${i * 0.4}s infinite` }} />
                  ))}
                </div>
              </div>

              {/* Ghost tabs */}
              <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid #111111', backgroundColor: '#050505' }}>
                {['Sub-Claims', 'Evidence', 'Consistency', 'Plausibility', 'Provenance', 'Risk'].map((t, i) => (
                  <div key={t} style={{
                    flex: 1, padding: '10px 8px', textAlign: 'center',
                    borderBottom: i === 2 ? '2px solid #1a1a1a' : '2px solid transparent',
                    fontSize: '11px', fontWeight: 700, color: '#151515',
                  }}>{t}</div>
                ))}
              </div>

              {/* Ghost provenance tree (the hero visual) */}
              <div style={{ flex: 1, overflow: 'hidden', padding: '24px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0', overflowX: 'hidden', minHeight: '140px' }}>
                  {[
                    { icon: '📄', sev: '#4ade80', w: 180 },
                    { icon: '📰', sev: '#fbbf24', w: 170 },
                    { icon: '📱', sev: '#fb923c', w: 160 },
                    { icon: '💻', sev: '#f87171', w: 175 },
                  ].map((node, i, arr) => (
                    <React.Fragment key={i}>
                      <div style={{
                        flexShrink: 0, width: `${node.w}px`, padding: '14px',
                        borderRadius: '10px', border: `1px solid ${node.sev}08`,
                        backgroundColor: '#080808', position: 'relative',
                        animation: `ghostShimmer ${5 + i * 0.5}s ease ${i * 0.8}s infinite`,
                      }}>
                        <div style={{
                          position: 'absolute', top: '-5px', left: '50%', transform: 'translateX(-50%)',
                          width: '10px', height: '10px', borderRadius: '50%',
                          backgroundColor: node.sev, border: '2px solid #000000', opacity: 0.08,
                        }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
                          <span style={{ fontSize: '12px', opacity: 0.06 }}>{node.icon}</span>
                          <div style={{ width: '50px', height: '6px', borderRadius: '3px', backgroundColor: '#0d0d0d' }} />
                          <div style={{ marginLeft: 'auto', width: '30px', height: '6px', borderRadius: '3px', backgroundColor: '#0a0a0a' }} />
                        </div>
                        <div style={{ width: '70%', height: '7px', borderRadius: '3px', backgroundColor: '#0a0a0a', marginBottom: '4px' }} />
                        <div style={{ width: '90%', height: '7px', borderRadius: '3px', backgroundColor: '#080808', marginBottom: '4px' }} />
                        <div style={{ width: '40%', height: '7px', borderRadius: '3px', backgroundColor: '#080808' }} />
                      </div>
                      {i < arr.length - 1 && (
                        <div style={{ flexShrink: 0, width: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="40" height="20" viewBox="0 0 40 20" style={{ opacity: 0.06 }}>
                            <defs>
                              <linearGradient id={`ghost-grad-${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor={node.sev} />
                                <stop offset="100%" stopColor={arr[i + 1].sev} />
                              </linearGradient>
                            </defs>
                            <line x1="0" y1="10" x2="30" y2="10" stroke={`url(#ghost-grad-${i})`} strokeWidth="2" />
                            <polygon points="30,5 40,10 30,15" fill={arr[i + 1].sev} />
                          </svg>
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
                {/* Ghost analysis box */}
                <div style={{
                  marginTop: '16px', padding: '12px 14px', borderRadius: '8px',
                  backgroundColor: '#060606', border: '1px solid #0d0d0d',
                  animation: 'ghostShimmer 6s ease 1s infinite',
                }}>
                  <div style={{ width: '60px', height: '7px', borderRadius: '3px', backgroundColor: '#0d0d0d', marginBottom: '8px' }} />
                  <div style={{ width: '100%', height: '7px', borderRadius: '3px', backgroundColor: '#0a0a0a', marginBottom: '4px' }} />
                  <div style={{ width: '85%', height: '7px', borderRadius: '3px', backgroundColor: '#080808' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── Right: Agent Trace (collapsible) ──────────────────────── */}
        {showTrace && traceLines.length > 0 && (
          <div style={{
            width: '300px', flexShrink: 0, borderLeft: '1px solid #1a1a1a',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            backgroundColor: '#050505',
          }}>
            <div style={{
              padding: '8px 12px', borderBottom: '1px solid #1a1a1a',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ffffff', animation: selectedClaim?.status === 'verifying' ? 'pulse 1s ease-in-out infinite' : 'none' }} />
                <span style={{ fontSize: '10px', fontWeight: 700, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Mission Control
                </span>
              </div>
              <span style={{ fontSize: '9px', color: '#555555' }}>{traceLines.length} events</span>
            </div>
            <div ref={traceRef} style={{
              flex: 1, overflow: 'auto', padding: '8px 10px',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              fontSize: '10px', lineHeight: 1.7,
            }}>
              {traceLines.map((line, i) => {
                if (line.type === 'divider') {
                  return <div key={i} style={{ borderTop: '1px solid #1a1a1a', margin: '6px 0' }} />;
                }
                const typeConfig: Record<string, { color: string; icon: string }> = {
                  step: { color: '#ffffff', icon: '▸' },
                  success: { color: '#4ade80', icon: '✓' },
                  error: { color: '#f87171', icon: '✗' },
                  verdict: { color: '#cccccc', icon: '◆' },
                  info: { color: '#666666', icon: '·' },
                };
                const cfg = typeConfig[line.type] || typeConfig.info;
                const badgeInfo = line.badge ? AGENT_BRAND_COLORS[line.badge] : null;
                return (
                  <div key={i} style={{
                    color: cfg.color, paddingLeft: `${line.indent * 12}px`,
                    animation: 'fadeIn 0.15s ease', display: 'flex', gap: '5px', alignItems: 'flex-start',
                  }}>
                    <span style={{ flexShrink: 0, opacity: 0.6 }}>{line.indent > 0 ? '│' : cfg.icon}</span>
                    <span style={{ wordBreak: 'break-word', flex: 1 }}>{line.text}</span>
                    {badgeInfo && (
                      <span style={{
                        flexShrink: 0, fontSize: '7px', fontWeight: 800, padding: '1px 5px',
                        borderRadius: '3px', backgroundColor: `${badgeInfo.color}20`,
                        color: badgeInfo.color, border: `1px solid ${badgeInfo.color}40`,
                        letterSpacing: '0.3px', whiteSpace: 'nowrap', marginTop: '1px',
                      }}>{badgeInfo.label}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ═══ Share Toast ═══════════════════════════════════════════════════ */}
      {shareToast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          padding: '10px 20px', borderRadius: '8px', backgroundColor: '#ffffff', color: '#000000',
          fontSize: '12px', fontWeight: 700, zIndex: 100, animation: 'fadeIn 0.2s ease',
          boxShadow: '0 4px 20px rgba(255,255,255,0.15)',
        }}>
          {shareToast}
        </div>
      )}

      {/* ═══ Powered By Footer ═══════════════════════════════════════════ */}
      <div style={{
        flexShrink: 0, padding: '6px 24px', borderTop: '1px solid #111111',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px',
        backgroundColor: '#000000',
      }}>
        <span style={{ fontSize: '9px', color: '#333333', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pipeline</span>
        {[
          { label: 'Reasoning', color: '#e8c8a0' },
          { label: 'Evidence Search', color: '#6bccc8' },
          { label: 'SEC Filings', color: '#d4af37' },
          { label: 'Transcription', color: '#a78bfa' },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: s.color, opacity: 0.6 }} />
            <span style={{ fontSize: '9px', color: '#333333', fontWeight: 600 }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SynapsePage;
