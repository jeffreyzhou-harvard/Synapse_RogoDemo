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
  status: 'pending' | 'verifying' | 'done' | 'error';
  verification?: VerificationState;
}

interface SubClaim {
  id: string;
  text: string;
  type: string;
  verdict?: string;
  confidence?: string;
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

interface VerificationState {
  subclaims: SubClaim[];
  evidence: EvidenceItem[];
  overallVerdict?: { verdict: string; confidence: string; summary: string; detail?: string };
  provenanceNodes: ProvenanceNode[];
  provenanceEdges: ProvenanceEdge[];
  provenanceAnalysis?: string;
  correctedClaim?: CorrectedClaim;
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
  academic:      { label: 'Academic',      icon: '📄', color: '#a0a0a0' },
  institutional: { label: 'Institutional', icon: '🏛️', color: '#c0c0c0' },
  journalism:    { label: 'Journalism',    icon: '📰', color: '#b0b0b0' },
  counter:       { label: 'Counter',       icon: '⚔️', color: '#f87171' },
};

const MUTATION_COLORS: Record<string, string> = {
  none: '#4ade80',
  slight: '#fbbf24',
  significant: '#fb923c',
  severe: '#f87171',
};

const STEP_ICONS: Record<string, string> = {
  decomposition: '🔬',
  evidence_retrieval: '🔍',
  evaluation: '⚖️',
  synthesis: '🧠',
  provenance: '🔗',
  correction: '✏️',
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
  claude:    { color: '#e8c8a0', label: 'Claude' },
  sscholar:  { color: '#6b9bd2', label: 'S.Scholar' },
  pubmed:    { color: '#5ec4a0', label: 'PubMed' },
  sonar:     { color: '#6bccc8', label: 'Sonar' },
  deepgram:  { color: '#a78bfa', label: 'Deepgram' },
};

const INITIAL_PIPELINE: Omit<AgentChip, 'status'>[] = [
  { id: 'extract',    service: 'sonar',    task: 'Extract',    label: 'Sonar · Extract',            color: '#6bccc8' },
  { id: 'decompose',  service: 'claude',   task: 'Decompose',  label: 'Claude · Decompose',         color: '#e8c8a0' },
  { id: 'sscholar',   service: 'sscholar', task: 'Papers',     label: 'S.Scholar · Papers',         color: '#6b9bd2' },
  { id: 'sonar_web',  service: 'sonar',    task: 'Web',        label: 'Sonar · Web',                color: '#6bccc8' },
  { id: 'sonar_counter', service: 'sonar', task: 'Counter',    label: 'Sonar · Counter',            color: '#6bccc8' },
  { id: 'evaluate',   service: 'claude',   task: 'Evaluate',   label: 'Claude · Evaluate',          color: '#e8c8a0' },
  { id: 'synthesize', service: 'claude',   task: 'Synthesize', label: 'Claude · Synthesize',        color: '#e8c8a0' },
  { id: 'provenance', service: 'sonar',    task: 'Provenance', label: 'Sonar+Claude · Provenance',  color: '#6bccc8' },
  { id: 'correct',    service: 'claude',   task: 'Correct',    label: 'Claude · Correct',           color: '#e8c8a0' },
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
  const [activeTab, setActiveTab] = useState<'subclaims' | 'evidence' | 'provenance' | 'correction'>('subclaims');
  const [showTrace, setShowTrace] = useState(true);
  const [inputCollapsed, setInputCollapsed] = useState(false);

  // Share state
  const [shareToast, setShareToast] = useState('');
  const [reportId, setReportId] = useState<string | null>(null);

  // Agent orchestration state (per-claim)
  const [agentChips, setAgentChips] = useState<AgentChip[]>([]);
  const [pipelineStats, setPipelineStats] = useState({ steps: 0, apiCalls: 0, services: new Set<string>(), sources: 0, durationMs: 0 });

  // Trace log
  const [traceLines, setTraceLines] = useState<{ text: string; type: string; indent: number; badge?: string }[]>([]);
  const traceRef = useRef<HTMLDivElement>(null);

  // File input
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const resp = await fetch(`${API_BASE}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: ingestedTitle || 'Verification Report',
          url: inputValue.startsWith('http') ? inputValue : undefined,
          source_type: sourceType || 'text',
          claims: claims.map(c => ({
            id: c.id, original: c.original, normalized: c.normalized,
            type: c.type, status: c.status, verification: c.verification,
          })),
          analyzed_at: new Date().toISOString(),
        }),
      });
      if (resp.ok) {
        const { id } = await resp.json();
        setReportId(id);
        const url = `${window.location.origin}/report/${id}`;
        await navigator.clipboard.writeText(url);
        setShareToast('Report link copied!');
        setTimeout(() => setShareToast(''), 3000);
      }
    } catch (e) {
      setShareToast('Failed to save report');
      setTimeout(() => setShareToast(''), 3000);
    }
  }, [claims, ingestedTitle, inputValue, sourceType]);

  // ─── Trending Tweets (live from X API) ─────────────────────────────

  const [trendingTweets, setTrendingTweets] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/trending-tweets`)
      .then(r => r.json())
      .then(data => {
        if (data.tweets?.length) setTrendingTweets(data.tweets);
      })
      .catch(() => {});
  }, []);

  // ─── Preloaded Examples ────────────────────────────────────────────

  const PRELOADED_EXAMPLES = [
    { icon: '🏥', claim: 'Intermittent fasting reduces inflammation by 40%', verdict: 'exaggerated', source: 'Health Blog' },
    { icon: '🤖', claim: 'AI will replace 80% of jobs by 2030', verdict: 'unsupported', source: 'Tech Article' },
    { icon: '🌍', claim: 'Sea levels will rise 3 feet by 2050', verdict: 'partially_supported', source: 'Climate Report' },
    { icon: '💊', claim: 'Vitamin D prevents COVID infection', verdict: 'contradicted', source: 'Social Media' },
    { icon: '📈', claim: 'Remote workers are 13% more productive', verdict: 'exaggerated', source: 'Business Insider' },
    { icon: '🐘', claim: 'African elephants in captivity are getting fat', verdict: 'supported', source: 'UAB News' },
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
    setPipelineStats({ steps: 1, apiCalls: 1, services: new Set(['Sonar']), sources: 0, durationMs: 0 });
    addTrace('Extracting claims...', 'step', 0, 'sonar');

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
      addTrace(`${extracted.length} verifiable claims extracted`, 'success', 0, 'sonar');
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

    // Initialize agent pipeline — extract already done, decompose starts
    setAgentChips(INITIAL_PIPELINE.map(c => ({
      ...c,
      status: c.id === 'extract' ? 'done' as const : 'pending' as const,
    })));
    setPipelineStats({ steps: 1, apiCalls: 1, services: new Set(['Sonar']), sources: 0, durationMs: 0 });

    // Update claim status
    setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'verifying' as const, verification: {
      subclaims: [], evidence: [], provenanceNodes: [], provenanceEdges: [],
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
              const v = { ...(c.verification || {
                subclaims: [], evidence: [], provenanceNodes: [], provenanceEdges: [],
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
                    ...sc, verdict: data.verdict, confidence: data.confidence, summary: data.summary,
                  } : sc);
                  break;
                case 'overall_verdict':
                  v.overallVerdict = { verdict: data.verdict, confidence: data.confidence, summary: data.summary, detail: data.detail };
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
                case 'corrected_claim':
                  v.correctedClaim = data as CorrectedClaim;
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
                  decomposition: 'decompose', evaluation: 'evaluate',
                  synthesis: 'synthesize', provenance: 'provenance', correction: 'correct',
                };
                const chipId = chipMap[data.step];
                if (chipId) { activateChip(chipId); bumpApiCalls(data.step === 'provenance' ? 'Sonar' : 'Claude'); }
                if (data.step === 'evidence_retrieval') {
                  // Activate all search chips simultaneously
                  activateChip('sscholar'); activateChip('sonar_web'); activateChip('sonar_counter');
                  bumpApiCalls('Semantic Scholar'); bumpApiCalls('Sonar'); bumpApiCalls('Sonar');
                }
                break;
              }
              case 'step_complete': {
                const completeMap: Record<string, string[]> = {
                  decomposition: ['decompose'], evaluation: ['evaluate'],
                  synthesis: ['synthesize'], provenance: ['provenance'], correction: ['correct'],
                  evidence_retrieval: ['sscholar', 'sonar_web', 'sonar_counter'],
                };
                (completeMap[data.step] || []).forEach(id => completeChip(id));
                if (data.total_sources) setPipelineStats(prev => ({ ...prev, sources: data.total_sources }));
                break;
              }
              case 'evidence_found':
                bumpApiCalls(data.tier === 'academic' ? 'Semantic Scholar' : 'Sonar');
                setPipelineStats(prev => ({ ...prev, sources: prev.sources + 1 }));
                break;
              case 'verification_complete':
                setPipelineStats(prev => ({ ...prev, durationMs: data.total_duration_ms, sources: data.total_sources || prev.sources }));
                break;
            }

            // --- Add to trace with API badges ---
            switch (type) {
              case 'step_start': {
                const badgeMap: Record<string, string> = {
                  decomposition: 'claude', evaluation: 'claude',
                  synthesis: 'claude', correction: 'claude', provenance: 'sonar',
                  evidence_retrieval: 'sscholar',
                };
                addTrace(`${STEP_ICONS[data.step] || '▸'} ${data.label}`, 'step', 0, badgeMap[data.step]);
                break;
              }
              case 'subclaim':
                addTrace(`Sub-claim: "${data.text}"`, 'info', 1);
                break;
              case 'search_start':
                addTrace(`Searching for: "${(data.subclaim || '').slice(0, 60)}..."`, 'info', 1, 'sscholar');
                break;
              case 'evidence_found': {
                const evBadge = data.tier === 'academic' ? 'sscholar' : data.tier === 'counter' ? 'sonar' : 'sonar';
                addTrace(`Found: ${data.title?.slice(0, 50)} [${data.tier}]`, 'info', 2, evBadge);
                break;
              }
              case 'evidence_scored':
                addTrace(`Scored ${data.id}: ${data.quality_score}/100 (${data.study_type || '?'})`, 'info', 2, 'claude');
                break;
              case 'subclaim_verdict': {
                const icon = data.verdict === 'supported' ? '✅' : data.verdict === 'contradicted' ? '❌' : data.verdict === 'exaggerated' ? '⚠️' : '🔶';
                addTrace(`${icon} "${data.text?.slice(0, 50)}..." → ${data.verdict} (${data.confidence})`, 'verdict', 0, 'claude');
                break;
              }
              case 'overall_verdict': {
                const icon = data.verdict === 'supported' ? '✅' : data.verdict === 'contradicted' ? '❌' : '⚠️';
                addTrace(`${icon} OVERALL: ${data.verdict.toUpperCase()} (${data.confidence})`, 'verdict', 0, 'claude');
                addTrace(data.summary, 'info', 1);
                break;
              }
              case 'provenance_node':
                addTrace(`${data.source_type}: "${data.text?.slice(0, 60)}..." (${data.date || '?'})`, 'info', 1, 'sonar');
                break;
              case 'corrected_claim':
                addTrace(`Corrected: "${data.corrected?.slice(0, 80)}..."`, 'success', 1, 'claude');
                break;
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
    for (const claim of claims) {
      if (claim.status === 'pending') {
        await verifyClaim(claim.id);
      }
    }
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
            <div style={{ fontSize: '9px', fontWeight: 600, color: '#666666', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
              Every claim, interrogated
            </div>
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
              <div style={{ textAlign: 'center', marginBottom: '20px', animation: 'fadeIn 0.5s ease' }}>
                <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#ffffff', marginBottom: '6px', letterSpacing: '-0.5px' }}>
                  Don't trust. Verify.
                </h1>
                <p style={{ fontSize: '13px', color: '#666666', maxWidth: '520px', margin: '0 auto', marginBottom: '16px' }}>
                  Multi-agent verification pipeline: atomic claim decomposition, evidence retrieval from Semantic Scholar & Perplexity Sonar, source quality scoring, verdict synthesis with confidence levels, and full provenance tracing — streamed live.
                </p>
                {/* Try these — subtle inline examples */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', flexWrap: 'wrap', maxWidth: '600px', margin: '0 auto' }}>
                  <span style={{ fontSize: '10px', color: '#333', fontWeight: 600 }}>Try:</span>
                  {PRELOADED_EXAMPLES.map((ex, i) => (
                    <button key={i} onClick={() => { setInputMode('text'); setInputValue(ex.claim); }}
                      style={{
                        padding: '3px 8px', borderRadius: '4px', border: '1px solid #1a1a1a',
                        backgroundColor: 'transparent', color: '#555', fontSize: '10px', fontWeight: 500,
                        cursor: 'pointer', transition: 'all 0.15s',
                        animation: `fadeIn 0.3s ease ${i * 0.06}s both`,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#aaa'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.color = '#555'; }}
                    >
                      {ex.icon} {ex.claim.length > 35 ? ex.claim.slice(0, 35) + '...' : ex.claim}
                    </button>
                  ))}
                </div>

                {/* ─── Live Tweet Ticker ─────────────────────────────── */}
                {trendingTweets.length > 0 && (
                  <div style={{ marginTop: '24px', position: 'relative' }}>
                    <div style={{
                      width: '40px', height: '1px', background: '#222', margin: '0 auto 16px',
                    }} />
                    <div style={{ fontSize: '9px', fontWeight: 700, color: '#333', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s ease-in-out infinite' }} />
                      Live from 𝕏
                    </div>
                    <div className="scroll-ticker-wrap" style={{ position: 'relative', overflow: 'hidden', maskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)' }}>
                      <div style={{
                        display: 'flex', gap: '12px', width: 'max-content',
                        animation: `scroll-ticker ${Math.max(40, trendingTweets.length * 5)}s linear infinite`,
                      }}>
                        {[...trendingTweets, ...trendingTweets].map((tweet, i) => (
                          <button key={`${tweet.id}-${i}`}
                            onClick={() => { setInputMode('url'); setInputValue(tweet.url); }}
                            style={{
                              flexShrink: 0, width: '300px', padding: '12px 14px',
                              borderRadius: '10px', border: '1px solid #141414',
                              background: '#080808',
                              cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s',
                              display: 'flex', flexDirection: 'column', gap: '8px',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.background = '#0c0c0c'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = '#141414'; e.currentTarget.style.background = '#080808'; }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {tweet.avatar ? (
                                <img src={tweet.avatar} alt="" style={{ width: '22px', height: '22px', borderRadius: '50%' }} />
                              ) : (
                                <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#1a1a1a' }} />
                              )}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#bbb' }}>{tweet.author}</span>
                                <span style={{ fontSize: '10px', color: '#3a3a3a', marginLeft: '4px' }}>{tweet.handle}</span>
                              </div>
                              <span style={{ fontSize: '11px', color: '#1d9bf0' }}>𝕏</span>
                            </div>
                            <div style={{
                              fontSize: '12px', color: '#888', lineHeight: 1.5,
                              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as any,
                            }}>
                              {tweet.text}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '10px', color: '#333' }}>
                              <span>❤️ {tweet.likes > 999 ? `${(tweet.likes / 1000).toFixed(1)}k` : tweet.likes}</span>
                              <span>🔁 {tweet.retweets > 999 ? `${(tweet.retweets / 1000).toFixed(1)}k` : tweet.retweets}</span>
                              <div style={{ flex: 1 }} />
                              <span style={{
                                fontSize: '9px', fontWeight: 700, color: '#22c55e', textTransform: 'uppercase',
                                padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(34,197,94,0.15)', background: 'rgba(34,197,94,0.04)',
                              }}>Verify →</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                <button onClick={() => setInputMode('url')}
                  style={{
                    flex: 1, padding: '6px 10px', border: '1px solid', borderRadius: '6px 0 0 0',
                    borderColor: inputMode === 'url' ? '#ffffff' : '#1a1a1a',
                    backgroundColor: inputMode === 'url' ? 'rgba(255,255,255,0.05)' : 'transparent',
                    color: inputMode === 'url' ? '#ffffff' : '#555555',
                    fontSize: '10px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                  }}>🔗 URL</button>
                <button onClick={() => setInputMode('text')}
                  style={{
                    flex: 1, padding: '6px 10px', border: '1px solid', borderRadius: '0 0 0 6px',
                    borderColor: inputMode === 'text' ? '#ffffff' : '#1a1a1a',
                    backgroundColor: inputMode === 'text' ? 'rgba(255,255,255,0.05)' : 'transparent',
                    color: inputMode === 'text' ? '#ffffff' : '#555555',
                    fontSize: '10px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                  }}>📝 Text</button>
              </div>
              {inputMode === 'url' ? (
                <input value={inputValue} onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleIngest()}
                  placeholder="Paste a URL — article, blog, YouTube, tweet..."
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
                  placeholder="Paste text containing claims to verify..."
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
                    flex: 1, padding: '10px 18px', borderRadius: '0 6px 0 0',
                    border: '1px solid #ffffff', backgroundColor: '#ffffff', color: '#000000',
                    fontSize: '12px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                    opacity: (isIngesting || isExtracting || !inputValue.trim()) ? 0.5 : 1,
                  }}>
                  {isIngesting ? '...' : 'Analyze'}
                </button>
                <button onClick={() => fileInputRef.current?.click()}
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: '0 0 6px 0',
                    border: '1px solid #1a1a1a', backgroundColor: 'transparent', color: '#555555',
                    fontSize: '10px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                  }}>🎙️ Audio</button>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="audio/*,video/*,.mp3,.wav,.mp4,.m4a,.webm"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ''; }}
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
                    <span style={{ fontSize: '9px', fontWeight: 600, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {claim.type}
                    </span>
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
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 16px',
                      borderRadius: '10px', border: `1px solid ${vc.border}`, backgroundColor: vc.bg,
                      boxShadow: `0 0 20px ${vc.glow}`, animation: 'verdictPop 0.4s ease',
                    }}>
                      <span style={{
                        fontSize: '20px', fontWeight: 900, color: vc.text, textTransform: 'uppercase',
                        letterSpacing: '1.5px',
                      }}>
                        {v.overallVerdict!.verdict.replace('_', ' ')}
                      </span>
                      <span style={{
                        fontSize: '10px', fontWeight: 700, color: '#888888', textTransform: 'uppercase',
                        padding: '2px 8px', borderRadius: '4px', border: '1px solid #333333',
                      }}>
                        {v.overallVerdict!.confidence}
                      </span>
                      <span style={{ fontSize: '12px', color: '#cccccc', flex: 1 }}>
                        {v.overallVerdict!.summary.length > 120 ? v.overallVerdict!.summary.slice(0, 120) + '...' : v.overallVerdict!.summary}
                      </span>
                    </div>
                  );
                })() : (
                  /* Pipeline progress when still verifying */
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {['decomposition', 'evidence_retrieval', 'evaluation', 'synthesis', 'provenance', 'correction'].map(step => {
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
              </div>

              {/* Tabs */}
              <div style={{
                flexShrink: 0, display: 'flex', borderBottom: '1px solid #1a1a1a',
                backgroundColor: '#0a0a0a',
              }}>
                {([
                  { key: 'subclaims' as const, label: 'Sub-Claims', icon: '🔬', count: v.subclaims.length },
                  { key: 'evidence' as const, label: 'Evidence', icon: '📄', count: v.evidence.length },
                  { key: 'provenance' as const, label: 'Provenance', icon: '🔗', count: v.provenanceNodes.length },
                  { key: 'correction' as const, label: 'Correction', icon: '✏️', count: v.correctedClaim ? 1 : 0 },
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
                                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '9px', color: '#555555' }}>
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

                {/* ── Provenance Tab (horizontal tree) ────────────────── */}
                {activeTab === 'provenance' && (
                  <div style={{ animation: 'fadeIn 0.2s ease' }}>
                    {v.provenanceNodes.length > 0 ? (
                      <>
                        {/* Horizontal provenance tree */}
                        <div style={{
                          overflowX: 'auto', overflowY: 'hidden', padding: '20px 0',
                          display: 'flex', alignItems: 'center', gap: '0',
                          minHeight: '180px',
                        }}>
                          {v.provenanceNodes.map((node, i) => {
                            const mutColor = MUTATION_COLORS[node.mutation_severity] || '#94a3b8';
                            const nextNode = v.provenanceNodes[i + 1];
                            const nextColor = nextNode ? (MUTATION_COLORS[nextNode.mutation_severity] || '#94a3b8') : mutColor;
                            const sourceIcons: Record<string, string> = {
                              study: '📄', journalist: '📰', podcast: '🎙️', social: '📱', blog: '💻', claim: '💬',
                            };
                            return (
                              <React.Fragment key={node.id}>
                                <div style={{
                                  flexShrink: 0, width: '200px', padding: '14px',
                                  borderRadius: '10px', border: `1px solid ${mutColor}40`,
                                  backgroundColor: '#0a0a0a',
                                  boxShadow: `0 0 12px ${mutColor}15`,
                                  animation: `slideInH 0.4s ease ${i * 0.15}s both`,
                                  position: 'relative',
                                }}>
                                  {/* Glow dot */}
                                  <div style={{
                                    position: 'absolute', top: '-5px', left: '50%', transform: 'translateX(-50%)',
                                    width: '10px', height: '10px', borderRadius: '50%',
                                    backgroundColor: mutColor, border: '2px solid #000000',
                                    boxShadow: `0 0 8px ${mutColor}60`,
                                  }} />
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '14px' }}>{sourceIcons[node.source_type] || '📋'}</span>
                                    <span style={{ fontSize: '9px', fontWeight: 700, color: mutColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                      {node.source_type}
                                    </span>
                                    {node.date && <span style={{ fontSize: '9px', color: '#555555', marginLeft: 'auto' }}>{node.date}</span>}
                                  </div>
                                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#888888', marginBottom: '4px' }}>
                                    {node.source_name}
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#cccccc', lineHeight: 1.45, fontStyle: 'italic' }}>
                                    "{node.text.length > 100 ? node.text.slice(0, 100) + '...' : node.text}"
                                  </div>
                                  {node.mutation_severity !== 'none' && (
                                    <div style={{
                                      marginTop: '6px', fontSize: '9px', fontWeight: 700, color: mutColor,
                                      padding: '2px 6px', borderRadius: '3px', backgroundColor: `${mutColor}15`,
                                      display: 'inline-block',
                                    }}>
                                      {node.mutation_severity} mutation
                                    </div>
                                  )}
                                </div>
                                {/* Connecting arrow */}
                                {i < v.provenanceNodes.length - 1 && (
                                  <div style={{
                                    flexShrink: 0, width: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    animation: `fadeIn 0.3s ease ${i * 0.15 + 0.1}s both`,
                                  }}>
                                    <svg width="40" height="20" viewBox="0 0 40 20">
                                      <defs>
                                        <linearGradient id={`grad-${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
                                          <stop offset="0%" stopColor={mutColor} />
                                          <stop offset="100%" stopColor={nextColor} />
                                        </linearGradient>
                                      </defs>
                                      <line x1="0" y1="10" x2="30" y2="10" stroke={`url(#grad-${i})`} strokeWidth="2" />
                                      <polygon points="30,5 40,10 30,15" fill={nextColor} />
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
                            marginTop: '12px', padding: '12px 14px', borderRadius: '8px',
                            backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a',
                            fontSize: '12px', color: '#888888', lineHeight: 1.6,
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
                {['Sub-Claims', 'Evidence', 'Provenance', 'Correction'].map((t, i) => (
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
        <span style={{ fontSize: '9px', color: '#333333', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Powered by</span>
        {[
          { label: 'Claude Sonnet', color: '#e8c8a0' },
          { label: 'Perplexity Sonar', color: '#6bccc8' },
          { label: 'Semantic Scholar', color: '#6b9bd2' },
          { label: 'Deepgram', color: '#a78bfa' },
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
