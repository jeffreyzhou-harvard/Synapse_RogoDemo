import React, { useState, useRef, useCallback, useEffect } from 'react';
import type {
  ExtractedClaim, VerificationState, AgentChip,
  ContradictionItem, ProvenanceNode, ProvenanceEdge, ConsistencyIssue,
  PlausibilityAssessment, EntityResolution, Normalization, MaterialityAssessment,
  AuthorityConflict, RiskSignals, Reconciliation, CorrectedClaim,
  NumericalFact, IntraConsistencyIssue,
} from './synapse/types';
import {
  API_BASE, VERDICT_COLORS, STEP_ICONS,
  INITIAL_PIPELINE, STEP_TO_CHIP, STEP_COMPLETE_CHIPS, STEP_BADGE,
} from './synapse/constants';
import './synapse/synapse.css';

import InputBar from './synapse/InputBar';
import ClaimsList from './synapse/ClaimsList';
import VerificationDetail from './synapse/VerificationDetail';
import TraceFeed, { type TraceLine } from './synapse/TraceFeed';

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
  const [activeTab, setActiveTab] = useState<'subclaims' | 'evidence' | 'contradictions' | 'consistency' | 'plausibility' | 'provenance' | 'correction' | 'risk_signals' | 'reasoning'>('subclaims');
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(true);
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const [verdictExpanded, setVerdictExpanded] = useState(false);
  const [reasoningCollapsed, setReasoningCollapsed] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('synapse-theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; }
  });

  // Share state
  const [shareToast, setShareToast] = useState('');
  const [reportId, setReportId] = useState<string | null>(null);

  // Error toast state
  const [errorToast, setErrorToast] = useState('');
  const showError = useCallback((msg: string) => {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(''), 5000);
  }, []);

  // Agent orchestration state
  const [agentChips, setAgentChips] = useState<AgentChip[]>([]);
  const [pipelineStats, setPipelineStats] = useState({ steps: 0, apiCalls: 0, services: new Set<string>(), sources: 0, durationMs: 0 });

  // Reasoning feed
  const [reasoningMessages, setReasoningMessages] = useState<{ agent: string; stage: string; message: string; detail: string; ts: number }[]>([]);
  const reasoningRef = useRef<HTMLDivElement>(null);

  // Trace log
  const [traceLines, setTraceLines] = useState<TraceLine[]>([]);
  const traceRef = useRef<HTMLDivElement>(null);

  // File inputs
  const docInputRef = useRef<HTMLInputElement>(null);

  // Auto-ingest from ?url= query param
  const autoIngestDone = useRef(false);
  useEffect(() => {
    if (autoIngestDone.current) return;
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url');
    if (urlParam) {
      autoIngestDone.current = true;
      setInputValue(urlParam);
      setInputMode('url');
      setTimeout(() => {
        const btn = document.querySelector('[data-ingest-btn]') as HTMLButtonElement;
        if (btn) btn.click();
      }, 300);
    }
  }, []);

  // Auto-scroll trace
  useEffect(() => {
    if (traceRef.current) traceRef.current.scrollTop = traceRef.current.scrollHeight;
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
    setPipelineStats(prev => { const s = new Set(prev.services); s.add(service); return { ...prev, apiCalls: prev.apiCalls + 1, services: s }; });
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
      let id: string | null = null;
      try {
        const resp = await fetch(`${API_BASE}/api/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reportData) });
        if (resp.ok) { const data = await resp.json(); id = data.id; }
      } catch {}
      if (!id) id = Math.random().toString(36).slice(2, 10);
      const fullReport = { id, ...reportData, created_at: new Date().toISOString() };
      localStorage.setItem(`synapse-report-${id}`, JSON.stringify(fullReport));
      setReportId(id);
      const url = `${window.location.origin}/report/${id}`;
      await navigator.clipboard.writeText(url);
      setShareToast('Report link copied!');
      setTimeout(() => setShareToast(''), 3000);
    } catch {
      setShareToast('Failed to save report');
      setTimeout(() => setShareToast(''), 3000);
    }
  }, [claims, ingestedTitle, inputValue, sourceType]);

  // ─── Financial Claims Feed ──────────────────────────────────────────

  const [financialClaims, setFinancialClaims] = useState<any[]>([]);
  useEffect(() => {
    fetch(`${API_BASE}/api/financial-claims-feed`).then(r => r.json())
      .then(data => { if (data.claims?.length) setFinancialClaims(data.claims); })
      .catch(() => {});
  }, []);

  // ─── Ingest ──────────────────────────────────────────────────────────

  const handleIngest = useCallback(async () => {
    if (!inputValue.trim()) return;
    setIsIngesting(true);
    setClaims([]); setSelectedClaimId(null); setTraceLines([]); setIngestedText(''); setIngestedTitle('');
    addTrace('Ingesting content...', 'step');
    try {
      const isUrl = inputValue.startsWith('http://') || inputValue.startsWith('https://');
      const body = isUrl ? { url: inputValue } : { text: inputValue };
      const resp = await fetch(`${API_BASE}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Unknown error' }));
        addTrace(`Ingestion failed: ${err.detail}`, 'error');
        showError(`Ingestion failed: ${err.detail}`);
        setIsIngesting(false); return;
      }
      const data = await resp.json();
      setIngestedText(data.text); setIngestedTitle(data.title); setSourceType(data.source_type);
      addTrace(`Ingested: "${data.title}" (${data.source_type})`, 'success');
      addTrace(`${data.text.split(/\s+/).length} words extracted`, 'info', 1);
      await extractClaims(data.text);
      setInputCollapsed(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown network error';
      addTrace(`Network error: ${msg}`, 'error');
      showError(`Network error: ${msg}`);
    }
    setIsIngesting(false);
  }, [inputValue, addTrace, showError]);

  // ─── Extract Claims ──────────────────────────────────────────────────

  const extractClaims = useCallback(async (text: string) => {
    setIsExtracting(true);
    setAgentChips(INITIAL_PIPELINE.map(c => ({ ...c, status: c.id === 'extract' ? 'active' as const : 'pending' as const })));
    setPipelineStats({ steps: 1, apiCalls: 1, services: new Set(['search']), sources: 0, durationMs: 0 });
    addTrace('Extracting claims...', 'step', 0, 'reasoning');
    try {
      const resp = await fetch(`${API_BASE}/api/extract-claims`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!resp.ok) { addTrace('Claim extraction failed', 'error'); showError('Claim extraction failed — try again'); setIsExtracting(false); return; }
      const data = await resp.json();
      const extracted: ExtractedClaim[] = (data.claims || []).map((c: any) => ({ ...c, status: 'pending' as const }));
      setClaims(extracted);
      completeChip('extract');
      addTrace(`${extracted.length} verifiable claims extracted`, 'success', 0, 'reasoning');
      extracted.forEach((c, i) => addTrace(`Claim ${i + 1}: "${c.original.slice(0, 80)}${c.original.length > 80 ? '...' : ''}"`, 'info', 1));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      addTrace(`Error: ${msg}`, 'error');
      showError(`Extraction error: ${msg}`);
    }
    setIsExtracting(false);
  }, [addTrace, completeChip, showError]);

  // ─── Verify Single Claim (SSE) ──────────────────────────────────────

  const verifyClaim = useCallback(async (claimId: string) => {
    const claim = claims.find(c => c.id === claimId);
    if (!claim) return;
    setSelectedClaimId(claimId);
    setVerdictExpanded(false); setReasoningMessages([]); setReasoningCollapsed(false);
    setAgentChips(INITIAL_PIPELINE.map(c => ({ ...c, status: c.id === 'extract' ? 'done' as const : 'pending' as const })));
    setPipelineStats({ steps: 1, apiCalls: 1, services: new Set(['search']), sources: 0, durationMs: 0 });

    setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'verifying' as const, verification: {
      subclaims: [], evidence: [], contradictions: [], consistencyIssues: [], authorityConflicts: [], provenanceNodes: [], provenanceEdges: [],
      symbolicPredicates: [], symbolicRuleFireings: [], symbolicProofTree: [],
      currentStep: '', stepLabel: '', completedSteps: [],
    }} : c));

    addTrace('', 'divider');
    addTrace(`Verifying: "${claim.original.slice(0, 100)}"`, 'step');

    try {
      const resp = await fetch(`${API_BASE}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim: claim.normalized || claim.original }) });
      if (!resp.ok) { addTrace('Verification failed', 'error'); showError('Verification failed — click claim to retry'); setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'error' as const } : c)); return; }

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

            // Update verification state
            setClaims(prev => prev.map(c => {
              if (c.id !== claimId) return c;
              const v: VerificationState = { ...(c.verification || {
                subclaims: [], evidence: [], contradictions: [], consistencyIssues: [], authorityConflicts: [],
                provenanceNodes: [], provenanceEdges: [],
                symbolicPredicates: [], symbolicRuleFireings: [], symbolicProofTree: [],
                currentStep: '', stepLabel: '', completedSteps: [],
              })};

              switch (type) {
                case 'step_start': v.currentStep = data.step; v.stepLabel = data.label; break;
                case 'subclaim': v.subclaims = [...v.subclaims, { id: data.id, text: data.text, type: data.type }]; break;
                case 'evidence_found':
                  v.evidence = [...v.evidence, {
                    id: data.id, subclaim_id: data.subclaim_id, title: data.title,
                    snippet: data.snippet, snippet_full: data.snippet_full || data.snippet,
                    tier: data.tier, source: data.source, year: data.year, citations: data.citations,
                    citations_urls: data.citations_urls || [],
                    filing_type: data.filing_type, accession_number: data.accession_number,
                    filing_date: data.filing_date, company_ticker: data.company_ticker,
                    verified_against: data.verified_against,
                    xbrl_match: data.xbrl_match, xbrl_claimed: data.xbrl_claimed,
                    xbrl_actual: data.xbrl_actual, xbrl_discrepancy: data.xbrl_discrepancy,
                    xbrl_computation: data.xbrl_computation,
                  }]; break;
                case 'evidence_scored': v.evidence = v.evidence.map(e => e.id === data.id ? { ...e, quality_score: data.quality_score, study_type: data.study_type, supports_claim: data.supports_claim, assessment: data.assessment } : e); break;
                case 'subclaim_verdict': v.subclaims = v.subclaims.map(sc => sc.id === data.subclaim_id ? { ...sc, verdict: data.verdict, confidence: data.confidence, confidence_score: data.confidence_score, confidence_breakdown: data.confidence_breakdown, summary: data.summary } : sc); break;
                case 'overall_verdict': v.overallVerdict = { verdict: data.verdict, confidence: data.confidence, confidence_score: data.confidence_score, confidence_breakdown: data.confidence_breakdown, summary: data.summary, detail: data.detail, reconciled: data.reconciled }; break;
                case 'reconciliation': v.reconciliation = data as Reconciliation; break;
                case 'provenance_node': v.provenanceNodes = [...v.provenanceNodes, data as ProvenanceNode]; break;
                case 'provenance_edge': v.provenanceEdges = [...v.provenanceEdges, data as ProvenanceEdge]; break;
                case 'provenance_complete': v.provenanceAnalysis = data.analysis; break;
                case 'contradiction_detected': v.contradictions = [...v.contradictions, data as ContradictionItem]; break;
                case 'consistency_issue': v.consistencyIssues = [...v.consistencyIssues, data as ConsistencyIssue]; break;
                case 'plausibility_assessment': v.plausibility = data as PlausibilityAssessment; break;
                case 'entity_resolution': v.entityResolution = data as EntityResolution; break;
                case 'normalization': v.normalization = data as Normalization; break;
                case 'materiality': v.materiality = data as MaterialityAssessment; break;
                case 'authority_conflict': v.authorityConflicts = [...v.authorityConflicts, data as AuthorityConflict]; break;
                case 'risk_signals': v.riskSignals = data as RiskSignals; break;
                case 'corrected_claim': v.correctedClaim = data as CorrectedClaim; break;
                case 'numerical_facts': v.numericalFacts = data.facts as NumericalFact[]; break;
                case 'intra_consistency_issue': v.intraConsistencyIssues = [...(v.intraConsistencyIssues || []), data as IntraConsistencyIssue]; break;
                case 'methodology_issue': v.methodologyIssues = [...(v.methodologyIssues || []), data as IntraConsistencyIssue]; break;
                case 'number_dependencies': v.numberDependencies = data.dependencies; break;
                case 'temporal_xbrl': v.temporalXbrl = data; break;
                case 'restatement_detected': v.restatements = [...(v.restatements || []), data]; break;
                case 'growth_verification': v.growthVerifications = [...(v.growthVerifications || []), data]; break;
                case 'staleness_finding': v.stalenessFindings = [...(v.stalenessFindings || []), data]; break;
                case 'citation_verified': v.citationResults = [...(v.citationResults || []), data]; break;
                case 'symbolic_predicate': v.symbolicPredicates = [...v.symbolicPredicates, data]; break;
                case 'symbolic_rule_firing': v.symbolicRuleFireings = [...v.symbolicRuleFireings, data]; break;
                case 'symbolic_proof_tree': v.symbolicProofTree = data.nodes || []; break;
                case 'symbolic_confidence': v.symbolicConfidence = data; setActiveTab('reasoning'); break;
                case 'symbolic_verdict_override': v.symbolicVerdictOverride = data; break;
                case 'step_complete':
                  v.completedSteps = [...v.completedSteps, data.step];
                  v.totalDurationMs = data.duration_ms || data.total_duration_ms;
                  if (data.total_sources) v.totalSources = data.total_sources;
                  break;
                case 'verification_complete': v.totalDurationMs = data.total_duration_ms; v.totalSources = data.total_sources; break;
              }
              return { ...c, verification: v as VerificationState };
            }));

            // Agent chip transitions
            switch (type) {
              case 'step_start': {
                const chipId = STEP_TO_CHIP[data.step];
                if (chipId) { activateChip(chipId); bumpApiCalls(STEP_BADGE[data.step] || 'reasoning'); }
                if (data.step === 'evidence_retrieval') { activateChip('edgar'); activateChip('sonar_web'); bumpApiCalls('filings'); bumpApiCalls('search'); }
                break;
              }
              case 'step_complete': (STEP_COMPLETE_CHIPS[data.step] || []).forEach(id => completeChip(id)); if (data.total_sources) setPipelineStats(prev => ({ ...prev, sources: data.total_sources })); break;
              case 'evidence_found': bumpApiCalls(data.tier === 'sec_filing' ? 'filings' : 'search'); setPipelineStats(prev => ({ ...prev, sources: prev.sources + 1 })); break;
              case 'verification_complete': setPipelineStats(prev => ({ ...prev, durationMs: data.total_duration_ms, sources: data.total_sources || prev.sources })); break;
            }

            // Reasoning feed
            if (type === 'agent_reasoning') {
              setReasoningMessages(prev => [...prev, { agent: data.agent, stage: data.stage, message: data.message, detail: data.detail || '', ts: Date.now() }]);
              setTimeout(() => reasoningRef.current?.scrollTo({ top: reasoningRef.current.scrollHeight, behavior: 'smooth' }), 50);
            }

            // Trace log
            switch (type) {
              case 'step_start': addTrace(`${STEP_ICONS[data.step] || '▸'} ${data.label}`, 'step', 0, STEP_BADGE[data.step]); break;
              case 'subclaim': addTrace(`Sub-claim: "${data.text}"`, 'info', 1); break;
              case 'search_start': addTrace(`Searching for: "${(data.subclaim || '').slice(0, 60)}..."`, 'info', 1, 'filings'); break;
              case 'evidence_found': { const evBadge = data.tier === 'sec_filing' ? 'filings' : data.tier === 'counter' ? 'reasoning' : 'search'; addTrace(`Found: ${data.title?.slice(0, 50)} [${data.tier}]`, 'info', 2, evBadge); break; }
              case 'contradiction_detected': addTrace(`Contradiction: ${data.explanation?.slice(0, 80)}...`, 'info', 1, 'reasoning'); break;
              case 'evidence_scored': addTrace(`Scored ${data.id}: ${data.quality_score}/100 (${data.study_type || '?'})`, 'info', 2, 'reasoning'); break;
              case 'subclaim_verdict': { const icon = data.verdict === 'supported' ? '✅' : data.verdict === 'contradicted' ? '❌' : data.verdict === 'exaggerated' ? '⚠️' : '🔶'; addTrace(`${icon} "${data.text?.slice(0, 50)}..." → ${data.verdict} (${data.confidence})`, 'verdict', 0, 'reasoning'); break; }
              case 'overall_verdict': { const icon = data.verdict === 'supported' ? '✅' : data.verdict === 'contradicted' ? '❌' : '⚠️'; addTrace(`${icon} OVERALL: ${data.verdict.toUpperCase()} (${data.confidence})`, 'verdict', 0, 'reasoning'); addTrace(data.summary, 'info', 1); break; }
              case 'provenance_node': addTrace(`${data.source_type}: "${data.text?.slice(0, 60)}..." (${data.date || '?'})`, 'info', 1, 'search'); break;
              case 'consistency_issue': { const sevIcon = data.severity === 'high' ? '🔴' : data.severity === 'medium' ? '🟡' : '🟢'; addTrace(`${sevIcon} Consistency: ${data.description?.slice(0, 80)}...`, 'info', 1, 'reasoning'); break; }
              case 'plausibility_assessment': addTrace(`🎯 Plausibility: ${data.plausibility_level} (${data.plausibility_score}/100) — ${data.assessment?.slice(0, 80)}...`, 'info', 1, 'reasoning'); break;
              case 'reconciliation': { const accIcon = data.accuracy_level === 'true' ? '✅' : data.accuracy_level === 'essentially_true' ? '✅' : data.accuracy_level === 'misleading' ? '⚠️' : '❌'; addTrace(`${accIcon} Reconciliation: ${data.accuracy_level?.replace('_', ' ')} — ${data.explanation?.slice(0, 100)}`, 'verdict', 0, 'reasoning'); if (data.override_mechanical) addTrace(`Verdict overridden → ${data.reconciled_verdict}`, 'success', 1, 'reasoning'); break; }
              case 'entity_resolution': addTrace(`Entities resolved: ${(data.entities || []).length} entities, ${(data.resolutions || []).length} mappings`, 'info', 1, 'reasoning'); break;
              case 'normalization': addTrace(`Normalized: ${(data.normalizations || []).length} expressions, ${(data.comparison_warnings || []).length} warnings`, 'info', 1, 'reasoning'); break;
              case 'materiality': addTrace(`Materiality: ${data.materiality_level?.toUpperCase()} (${data.materiality_score}/100) — ${data.category}`, 'info', 1, 'reasoning'); break;
              case 'authority_conflict': addTrace(`Authority conflict [${data.severity}]: ${data.implication?.slice(0, 80)}...`, 'info', 1, 'reasoning'); break;
              case 'risk_signals': { const riskIcon = data.risk_level === 'critical' ? '🔴' : data.risk_level === 'high' ? '🟠' : data.risk_level === 'medium' ? '🟡' : '🟢'; addTrace(`${riskIcon} Risk: ${data.risk_level?.toUpperCase()} — ${data.headline}`, 'verdict', 0, 'reasoning'); break; }
              case 'corrected_claim': addTrace(`Corrected: "${data.corrected?.slice(0, 80)}..."`, 'success', 1, 'reasoning'); break;
              case 'numerical_facts': addTrace(`Extracted ${data.count} numerical facts (deterministic)`, 'info', 1, 'reasoning'); break;
              case 'intra_consistency_issue': { const ciIcon = data.severity === 'critical' ? '🔴' : data.severity === 'high' ? '🟠' : '🟡'; addTrace(`${ciIcon} Math: ${data.description?.slice(0, 100)}`, 'info', 1, 'reasoning'); break; }
              case 'methodology_issue': { const miIcon = data.severity === 'high' ? '🟠' : '🟡'; addTrace(`${miIcon} Methodology: ${data.description?.slice(0, 100)}`, 'info', 1, 'reasoning'); break; }
              case 'temporal_xbrl': addTrace(`XBRL: ${data.metrics_tracked} metrics, ${data.total_data_points} data points, ${data.restatements_found} restatements`, 'info', 1, 'filings'); break;
              case 'restatement_detected': addTrace(`RESTATEMENT: ${data.metric} (${data.period}) — ${data.assessment?.slice(0, 80)}`, 'info', 1, 'filings'); break;
              case 'growth_verification': { const gvMatch = data.comparison?.match_level; const gvIcon = gvMatch === 'significant' ? '🔴' : gvMatch === 'notable' ? '🟠' : '✅'; addTrace(`${gvIcon} Growth: claimed ${data.claimed_growth_pct}% vs actual ${data.actual_growth_pct}% (${data.metric_key})`, 'info', 1, 'filings'); break; }
              case 'staleness_finding': { const staleIcon = data.severity === 'high' ? '🟠' : '🟡'; addTrace(`${staleIcon} Stale: ${data.description?.slice(0, 100)}`, 'info', 1, 'filings'); break; }
              case 'citation_verified': { const citeIcon = data.verification_status === 'verified' ? '✅' : data.verification_status === 'contradicted' ? '🔴' : data.verification_status === 'imprecise' ? '🟠' : '⚪'; addTrace(`${citeIcon} Citation "${data.source_cited}": ${data.verification_status} — ${data.assessment?.slice(0, 80)}`, 'info', 1, 'reasoning'); break; }
              case 'symbolic_predicate': addTrace(`🔣 ${data.type.toUpperCase()}(${Object.values(data.args || {}).slice(0, 3).join(', ')}) ${data.grounded ? '✓' : '?'}`, 'info', 1, 'reasoning'); break;
              case 'symbolic_rule_firing': { const rfIcon = data.severity === 'override' ? '🔴' : data.severity === 'warning' ? '🟡' : '🟢'; addTrace(`${rfIcon} RULE ${data.rule_name}: ${data.conclusion?.slice(0, 80)}`, 'info', 1, 'reasoning'); break; }
              case 'symbolic_proof_tree': addTrace(`🌳 Proof tree: ${(data.nodes || []).length} nodes`, 'info', 1, 'reasoning'); break;
              case 'symbolic_confidence': addTrace(`🧮 Bayesian confidence: ${data.bayesian_score}/100 (${data.bayesian_level}) — ${data.grounded_predicates}/${data.total_predicates} grounded, ${data.rules_fired} rules`, 'verdict', 0, 'reasoning'); break;
              case 'symbolic_verdict_override': { if (data.should_override) addTrace(`🔴 SYMBOLIC OVERRIDE: ${data.original_verdict.toUpperCase()} → ${data.new_verdict.toUpperCase()} (Bayesian: ${data.new_confidence_score}/100)`, 'verdict', 0, 'reasoning'); break; }
              case 'verification_complete': addTrace(`Done in ${(data.total_duration_ms / 1000).toFixed(1)}s — ${data.total_sources} sources`, 'success'); break;
            }
          } catch { /* skip malformed events */ }
        }
      }
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'done' as const } : c));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      addTrace(`Error: ${msg}`, 'error');
      showError(`Verification error: ${msg}`);
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'error' as const } : c));
    }
  }, [claims, addTrace, showError, activateChip, completeChip, bumpApiCalls]);

  // ─── Verify All ─────────────────────────────────────────────────────

  const verifyAll = useCallback(async () => {
    const pending = claims.filter(c => c.status === 'pending');
    const MAX_CONCURRENT = 3;

    // Process in batches to avoid overwhelming the backend and hitting rate limits
    for (let i = 0; i < pending.length; i += MAX_CONCURRENT) {
      const batch = pending.slice(i, i + MAX_CONCURRENT);
      await Promise.all(batch.map(c => verifyClaim(c.id)));
    }
  }, [claims, verifyClaim]);

  // ─── File Uploads ───────────────────────────────────────────────────

  const handleDocUpload = useCallback(async (file: File) => {
    setIsIngesting(true); setClaims([]); setTraceLines([]);
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const typeLabel = ext === 'pdf' ? 'PDF' : ext === 'pptx' ? 'PowerPoint' : ext === 'docx' ? 'Word' : 'Document';
    addTrace(`Uploading ${typeLabel}: ${file.name}...`, 'step');
    try {
      const formData = new FormData(); formData.append('file', file);
      const resp = await fetch(`${API_BASE}/api/ingest-file`, { method: 'POST', body: formData });
      if (!resp.ok) { const err = await resp.json().catch(() => ({ detail: 'Unknown error' })); addTrace(`${typeLabel} ingestion failed: ${err.detail}`, 'error'); setIsIngesting(false); return; }
      const data = await resp.json();
      setIngestedText(data.text); setIngestedTitle(data.title); setSourceType(data.source_type || ext);
      addTrace(`Parsed ${typeLabel}: "${data.title}" (${data.text.split(/\s+/).length} words)`, 'success');
      await extractClaims(data.text);
    } catch (e) { addTrace(`Error: ${e instanceof Error ? e.message : 'Unknown'}`, 'error'); }
    setIsIngesting(false);
  }, [addTrace, extractClaims]);

  // ─── Computed ───────────────────────────────────────────────────────

  const selectedClaim = claims.find(c => c.id === selectedClaimId);
  const v = selectedClaim?.verification;
  const verdictCounts = claims.reduce((acc, c) => { const v = c.verification?.overallVerdict?.verdict; if (v) acc[v] = (acc[v] || 0) + 1; return acc; }, {} as Record<string, number>);
  const doneClaims = claims.filter(c => c.status === 'done').length;
  const hasSummary = doneClaims > 0;

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className={`syn-root ${theme === 'light' ? 'syn-light' : ''}`}>

      {/* ═══ Header ═══════════════════════════════════════════════════════ */}
      <header style={{
        padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--syn-border)', flexShrink: 0, backgroundColor: 'var(--syn-bg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/synapse-logo.svg" alt="Synapse" style={{ width: '24px', height: '24px', opacity: 0.9 }} />
          <div>
            <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--syn-text-heading)', letterSpacing: '-0.5px' }}>SYNAPSE</div>
            <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--syn-text-muted)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
              Independent Verification Infrastructure
            </div>
          </div>
          <div className="syn-mono" style={{ marginLeft: '12px', padding: '2px 8px', borderRadius: '2px', border: '1px solid var(--syn-border)', fontSize: '9px', fontWeight: 600, color: 'var(--syn-text-muted)', letterSpacing: '0.8px' }}>v2.0</div>
        </div>

        {hasSummary && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }} className="syn-fade">
            <span style={{ fontSize: '11px', color: 'var(--syn-text-tertiary)' }}>{claims.length} claims analyzed:</span>
            {Object.entries(verdictCounts).map(([verdict, count]) => {
              const vc = VERDICT_COLORS[verdict] || VERDICT_COLORS.unsupported;
              return (
                <div key={verdict} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: vc.text }} />
                  <span style={{ fontSize: '11px', fontWeight: 700, color: vc.text }}>{count} {verdict.replace('_', ' ')}</span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className="syn-theme-toggle"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            onClick={() => {
              const next = theme === 'dark' ? 'light' : 'dark';
              setTheme(next);
              try { localStorage.setItem('synapse-theme', next); } catch {}
            }}
          />
          <button className="syn-btn" onClick={() => setShowTrace(p => !p)}
            style={{
              padding: '4px 10px', borderRadius: '6px',
              borderColor: showTrace ? 'var(--syn-border-strong)' : 'var(--syn-border)',
              backgroundColor: showTrace ? 'var(--syn-bg-hover)' : 'transparent',
              color: showTrace ? 'var(--syn-text-heading)' : 'var(--syn-text-muted)',
              fontSize: '10px', fontWeight: 700,
            }}>
            <span className={selectedClaim?.status === 'verifying' ? 'syn-dot-pulse' : undefined}
              style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: traceLines.length > 0 ? 'var(--syn-text-heading)' : 'var(--syn-text-muted)' }} />
            TRACE {traceLines.length > 0 && `(${traceLines.length})`}
          </button>
        </div>
      </header>

      {/* ═══ Input Bar ════════════════════════════════════════════════════ */}
      <InputBar
        inputValue={inputValue} setInputValue={setInputValue}
        inputMode={inputMode} setInputMode={setInputMode}
        isIngesting={isIngesting} isExtracting={isExtracting}
        hasClaims={claims.length > 0}
        inputCollapsed={inputCollapsed}
        ingestedTitle={ingestedTitle}
        inputRef={inputValue}
        onIngest={handleIngest}
        onDocUpload={handleDocUpload}
        onNewAnalysis={() => { setInputCollapsed(false); setClaims([]); setSelectedClaimId(null); setTraceLines([]); setReportId(null); }}
        onShareReport={shareReport}
        onExportAudit={async () => {
          try {
            const reportData = {
              title: ingestedTitle || 'Verification Report',
              url: inputValue.startsWith('http') ? inputValue : undefined,
              claims: claims.map(c => ({ id: c.id, original: c.original, normalized: c.normalized, type: c.type, status: c.status, verification: c.verification })),
              analyzed_at: new Date().toISOString(),
            };
            const resp = await fetch(`${API_BASE}/api/export-audit-log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reportData) });
            if (resp.ok) {
              const audit = await resp.json();
              const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `synapse-audit-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
            }
          } catch {}
        }}
        doneClaims={doneClaims}
        pipelineStats={pipelineStats}
        reportId={reportId}
        onShareTwitter={() => {
          const text = `I just verified "${ingestedTitle || 'this article'}" with Synapse. ${doneClaims} claims analyzed. See the full breakdown:`;
          const url = `${window.location.origin}/report/${reportId}`;
          window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
        }}
        onViewReport={() => window.open(`/report/${reportId}`, '_blank')}
        financialClaims={financialClaims}
      />

      {/* ═══ Main Content ════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ─── Left: Claims List ────────────────────────────────────── */}
        {(claims.length > 0 || isExtracting || isIngesting) && (
          <ClaimsList
            claims={claims}
            selectedClaimId={selectedClaimId}
            isExtracting={isExtracting}
            doneClaims={doneClaims}
            verdictCounts={verdictCounts}
            pipelineStats={pipelineStats}
            onSelectClaim={setSelectedClaimId}
            onVerifyClaim={(id) => verifyClaim(id)}
            onVerifyAll={verifyAll}
            onShareReport={shareReport}
          />
        )}

        {/* ─── Center: Verification Detail ──────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <VerificationDetail
            selectedClaim={selectedClaim || null}
            v={v}
            activeTab={activeTab} setActiveTab={setActiveTab}
            expandedEvidenceId={expandedEvidenceId} setExpandedEvidenceId={setExpandedEvidenceId}
            verdictExpanded={verdictExpanded} setVerdictExpanded={setVerdictExpanded}
            reasoningCollapsed={reasoningCollapsed} setReasoningCollapsed={setReasoningCollapsed}
            agentChips={agentChips}
            pipelineStats={pipelineStats}
            reasoningMessages={reasoningMessages}
            reasoningRef={reasoningRef}
            hasClaims={claims.length > 0}
            isIngesting={isIngesting}
            isExtracting={isExtracting}
          />
        </div>

        {/* ─── Right: Trace Feed ───────────────────────────────────── */}
        {showTrace && traceLines.length > 0 && (
          <TraceFeed
            traceLines={traceLines}
            isVerifying={selectedClaim?.status === 'verifying'}
            traceRef={traceRef}
          />
        )}
      </div>

      {/* ═══ Toasts ═══════════════════════════════════════════════════════ */}
      {shareToast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          padding: '10px 20px', borderRadius: '8px',
          backgroundColor: 'var(--syn-btn-primary-bg)', color: 'var(--syn-btn-primary-text)',
          fontSize: '12px', fontWeight: 700, zIndex: 100,
          boxShadow: '0 4px 20px var(--syn-shadow)',
        }} className="syn-fade">
          {shareToast}
        </div>
      )}
      {errorToast && (
        <div
          role="alert"
          onClick={() => setErrorToast('')}
          style={{
            position: 'fixed', top: '16px', right: '16px', zIndex: 200,
            padding: '12px 20px', borderRadius: '8px', maxWidth: '400px',
            backgroundColor: 'var(--syn-red-bg)', border: '1px solid var(--syn-red-border)', color: '#c47070',
            fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 4px 24px var(--syn-shadow)',
            display: 'flex', alignItems: 'center', gap: '10px',
          }} className="syn-fade">
          <span style={{ fontSize: '14px', flexShrink: 0 }}>!</span>
          <span>{errorToast}</span>
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--syn-text-muted)', flexShrink: 0 }}>dismiss</span>
        </div>
      )}
    </div>
  );
};

export default SynapsePage;
