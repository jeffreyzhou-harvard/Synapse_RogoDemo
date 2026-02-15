import React, { useState, useRef, useCallback, useEffect } from 'react';

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
  supported:            { bg: '#052e16', text: '#4ade80', border: '#166534', glow: 'rgba(74,222,128,0.15)' },
  partially_supported:  { bg: '#1c1917', text: '#fbbf24', border: '#854d0e', glow: 'rgba(251,191,36,0.15)' },
  exaggerated:          { bg: '#1c1917', text: '#fb923c', border: '#9a3412', glow: 'rgba(251,146,60,0.15)' },
  contradicted:         { bg: '#1c0a0a', text: '#f87171', border: '#991b1b', glow: 'rgba(248,113,113,0.15)' },
  unsupported:          { bg: '#1a1a2e', text: '#94a3b8', border: '#334155', glow: 'rgba(148,163,184,0.1)' },
  mixed:                { bg: '#1c1917', text: '#fbbf24', border: '#854d0e', glow: 'rgba(251,191,36,0.15)' },
};

const TIER_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  academic:      { label: 'Academic',      icon: '📄', color: '#818cf8' },
  institutional: { label: 'Institutional', icon: '🏛️', color: '#60a5fa' },
  journalism:    { label: 'Journalism',    icon: '📰', color: '#34d399' },
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
  claude:    { color: '#D4A574', label: 'Claude' },
  sscholar:  { color: '#1857B6', label: 'S.Scholar' },
  pubmed:    { color: '#0D9F6E', label: 'PubMed' },
  sonar:     { color: '#20B2AA', label: 'Sonar' },
  deepgram:  { color: '#7C3AED', label: 'Deepgram' },
};

const INITIAL_PIPELINE: Omit<AgentChip, 'status'>[] = [
  { id: 'extract',    service: 'sonar',    task: 'Extract',    label: 'Sonar · Extract',            color: '#20B2AA' },
  { id: 'decompose',  service: 'claude',   task: 'Decompose',  label: 'Claude · Decompose',         color: '#D4A574' },
  { id: 'sscholar',   service: 'sscholar', task: 'Papers',     label: 'S.Scholar · Papers',         color: '#1857B6' },
  { id: 'sonar_web',  service: 'sonar',    task: 'Web',        label: 'Sonar · Web',                color: '#20B2AA' },
  { id: 'sonar_counter', service: 'sonar', task: 'Counter',    label: 'Sonar · Counter',            color: '#20B2AA' },
  { id: 'evaluate',   service: 'claude',   task: 'Evaluate',   label: 'Claude · Evaluate',          color: '#D4A574' },
  { id: 'synthesize', service: 'claude',   task: 'Synthesize', label: 'Claude · Synthesize',        color: '#D4A574' },
  { id: 'provenance', service: 'sonar',    task: 'Provenance', label: 'Sonar+Claude · Provenance',  color: '#20B2AA' },
  { id: 'correct',    service: 'claude',   task: 'Correct',    label: 'Claude · Correct',           color: '#D4A574' },
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

  // Agent orchestration state (per-claim)
  const [agentChips, setAgentChips] = useState<AgentChip[]>([]);
  const [pipelineStats, setPipelineStats] = useState({ steps: 0, apiCalls: 0, services: new Set<string>(), sources: 0, durationMs: 0 });

  // Trace log
  const [traceLines, setTraceLines] = useState<{ text: string; type: string; indent: number; badge?: string }[]>([]);
  const traceRef = useRef<HTMLDivElement>(null);

  // File input
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      const resp = await fetch('/api/ingest', {
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
      const resp = await fetch('/api/extract-claims', {
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
      const resp = await fetch('/api/verify', {
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
      const resp = await fetch('/api/ingest-audio', { method: 'POST', body: formData });
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
      height: '100vh', backgroundColor: '#0a0f1a', color: '#e2e8f0',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideInH { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes glow { 0%, 100% { box-shadow: 0 0 8px rgba(251,191,36,0.3); } 50% { box-shadow: 0 0 20px rgba(251,191,36,0.6); } }
        @keyframes verdictPop { 0% { transform: scale(0.8); opacity: 0; } 50% { transform: scale(1.05); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes agentPulse {
          0% { box-shadow: 0 0 0 0 var(--agent-glow); }
          50% { box-shadow: 0 0 12px 4px var(--agent-glow); }
          100% { box-shadow: 0 0 0 0 var(--agent-glow); }
        }
        ::selection { background: rgba(251,191,36,0.3); }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #334155; }
      `}</style>

      {/* ═══ Header ═══════════════════════════════════════════════════════ */}
      <header style={{
        padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #1e293b', flexShrink: 0, backgroundColor: '#0a0f1a',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ fontSize: '20px' }}>🧠</div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.5px' }}>SYNAPSE</div>
            <div style={{ fontSize: '9px', fontWeight: 600, color: '#fbbf24', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
              Every claim, interrogated
            </div>
          </div>
        </div>

        {/* Summary bar */}
        {hasSummary && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', animation: 'fadeIn 0.4s ease' }}>
            <span style={{ fontSize: '11px', color: '#64748b' }}>{claims.length} claims analyzed:</span>
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
            borderColor: showTrace ? '#334155' : '#1e293b',
            backgroundColor: showTrace ? '#0f172a' : 'transparent',
            color: showTrace ? '#fbbf24' : '#475569',
            fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', gap: '5px',
          }}>
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: traceLines.length > 0 ? '#fbbf24' : '#475569', animation: selectedClaim?.status === 'verifying' ? 'pulse 1s ease-in-out infinite' : 'none' }} />
          TRACE {traceLines.length > 0 && `(${traceLines.length})`}
        </button>
      </header>

      {/* ═══ Input Bar (collapsible) ══════════════════════════════════════ */}
      {!inputCollapsed ? (
        <div style={{
          padding: claims.length ? '12px 24px' : '24px 32px', borderBottom: '1px solid #1e293b',
          background: 'linear-gradient(180deg, #0f172a 0%, #0a0f1a 100%)',
          transition: 'padding 0.3s ease', flexShrink: 0,
        }}>
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            {!claims.length && !isIngesting && !isExtracting && (
              <div style={{ textAlign: 'center', marginBottom: '20px', animation: 'fadeIn 0.5s ease' }}>
                <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#f8fafc', marginBottom: '6px', letterSpacing: '-0.5px' }}>
                  X-ray any claim
                </h1>
                <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '480px', margin: '0 auto' }}>
                  Paste a URL, article text, or drop an audio file. Synapse extracts every factual claim and runs deep multi-step verification.
                </p>
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                <button onClick={() => setInputMode('url')}
                  style={{
                    flex: 1, padding: '6px 10px', border: '1px solid', borderRadius: '6px 0 0 0',
                    borderColor: inputMode === 'url' ? '#fbbf24' : '#1e293b',
                    backgroundColor: inputMode === 'url' ? 'rgba(251,191,36,0.1)' : 'transparent',
                    color: inputMode === 'url' ? '#fbbf24' : '#64748b',
                    fontSize: '10px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                  }}>🔗 URL</button>
                <button onClick={() => setInputMode('text')}
                  style={{
                    flex: 1, padding: '6px 10px', border: '1px solid', borderRadius: '0 0 0 6px',
                    borderColor: inputMode === 'text' ? '#fbbf24' : '#1e293b',
                    backgroundColor: inputMode === 'text' ? 'rgba(251,191,36,0.1)' : 'transparent',
                    color: inputMode === 'text' ? '#fbbf24' : '#64748b',
                    fontSize: '10px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                  }}>📝 Text</button>
              </div>
              {inputMode === 'url' ? (
                <input value={inputValue} onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleIngest()}
                  placeholder="Paste a URL — article, blog, YouTube, tweet..."
                  style={{
                    flex: 1, padding: '10px 14px', backgroundColor: '#0f172a', border: '1px solid #1e293b',
                    borderRadius: '0', color: '#f8fafc', fontSize: '13px', outline: 'none',
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace", transition: 'border-color 0.15s',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = '#334155'}
                  onBlur={e => e.currentTarget.style.borderColor = '#1e293b'}
                />
              ) : (
                <textarea value={inputValue} onChange={e => setInputValue(e.target.value)}
                  placeholder="Paste text containing claims to verify..."
                  rows={2}
                  style={{
                    flex: 1, padding: '10px 14px', backgroundColor: '#0f172a', border: '1px solid #1e293b',
                    borderRadius: '0', color: '#f8fafc', fontSize: '13px', outline: 'none', resize: 'vertical',
                    fontFamily: "'Inter', sans-serif", lineHeight: 1.5, transition: 'border-color 0.15s',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = '#334155'}
                  onBlur={e => e.currentTarget.style.borderColor = '#1e293b'}
                />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                <button onClick={handleIngest} disabled={isIngesting || isExtracting || !inputValue.trim()}
                  style={{
                    flex: 1, padding: '10px 18px', borderRadius: '0 6px 0 0',
                    border: '1px solid #fbbf24', backgroundColor: '#fbbf24', color: '#0a0f1a',
                    fontSize: '12px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                    opacity: (isIngesting || isExtracting || !inputValue.trim()) ? 0.5 : 1,
                  }}>
                  {isIngesting ? '...' : 'Analyze'}
                </button>
                <button onClick={() => fileInputRef.current?.click()}
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: '0 0 6px 0',
                    border: '1px solid #1e293b', backgroundColor: 'transparent', color: '#64748b',
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
        /* Collapsed input bar */
        <div style={{
          padding: '6px 24px', borderBottom: '1px solid #1e293b', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: '#0f172a',
        }}>
          <span style={{ fontSize: '11px', color: '#64748b' }}>Analyzing:</span>
          <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ingestedTitle || inputValue.slice(0, 80)}
          </span>
          <button onClick={() => { setInputCollapsed(false); setClaims([]); setSelectedClaimId(null); setTraceLines([]); }}
            style={{
              padding: '3px 10px', borderRadius: '4px', border: '1px solid #1e293b',
              backgroundColor: 'transparent', color: '#64748b', fontSize: '10px', fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>New Analysis</button>
        </div>
      )}

      {/* ═══ Main Content ═════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ─── Left: Claims List ──────────────────────────────────────── */}
        <div style={{
          width: '320px', flexShrink: 0, borderRight: '1px solid #1e293b',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 12px', borderBottom: '1px solid #1e293b',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Claims {claims.length > 0 && `(${claims.length})`}
            </div>
            {claims.length > 0 && claims.some(c => c.status === 'pending') && (
              <button onClick={verifyAll}
                style={{
                  padding: '3px 10px', borderRadius: '5px', border: '1px solid #fbbf24',
                  backgroundColor: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                  fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                }}>
                Verify All
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '6px' }}>
            {isExtracting && (
              <div style={{ padding: '32px', textAlign: 'center', animation: 'fadeIn 0.3s ease' }}>
                <div style={{ width: '20px', height: '20px', border: '2px solid #1e293b', borderTopColor: '#fbbf24', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
                <div style={{ fontSize: '11px', color: '#64748b' }}>Extracting claims...</div>
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
                    borderLeft: `3px solid ${vc?.text || (claim.status === 'verifying' ? '#fbbf24' : '#1e293b')}`,
                    borderTop: '1px solid', borderRight: '1px solid', borderBottom: '1px solid',
                    borderTopColor: isSelected ? (vc?.border || '#334155') : '#1e293b',
                    borderRightColor: isSelected ? (vc?.border || '#334155') : '#1e293b',
                    borderBottomColor: isSelected ? (vc?.border || '#334155') : '#1e293b',
                    backgroundColor: isSelected ? (vc?.bg || '#0f172a') : vc ? `${vc.bg}` : '#0c1220',
                    boxShadow: isSelected ? `0 0 16px ${vc?.glow || 'rgba(0,0,0,0.3)'}` : 'none',
                    transition: 'all 0.2s',
                    animation: `slideIn 0.3s ease ${i * 0.05}s both`,
                  }}
                  onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.borderTopColor = '#334155'; e.currentTarget.style.borderRightColor = '#334155'; e.currentTarget.style.borderBottomColor = '#334155'; }}}
                  onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.borderTopColor = '#1e293b'; e.currentTarget.style.borderRightColor = '#1e293b'; e.currentTarget.style.borderBottomColor = '#1e293b'; }}}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    {claim.status === 'verifying' && (
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fbbf24', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: '9px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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
                  <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.45 }}>
                    {claim.original.length > 120 ? claim.original.slice(0, 120) + '...' : claim.original}
                  </div>
                  {claim.status === 'pending' && (
                    <div style={{ fontSize: '9px', color: '#475569', marginTop: '4px' }}>Click to verify</div>
                  )}
                </div>
              );
            })}

            {!claims.length && !isExtracting && !isIngesting && (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: '28px', marginBottom: '10px', opacity: 0.2 }}>🔍</div>
                <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5 }}>
                  Paste a URL or text above to extract claims
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
                flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid #1e293b',
                backgroundColor: '#0a0f1a',
              }}>
                {/* Claim text */}
                <div style={{ fontSize: '14px', color: '#f8fafc', lineHeight: 1.5, fontWeight: 500, marginBottom: '10px' }}>
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
                        fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
                        padding: '2px 8px', borderRadius: '4px', border: '1px solid #334155',
                      }}>
                        {v.overallVerdict!.confidence}
                      </span>
                      <span style={{ fontSize: '12px', color: '#cbd5e1', flex: 1 }}>
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
                          borderColor: isDone ? '#166534' : isCurrent ? '#854d0e' : '#1e293b',
                          backgroundColor: isDone ? '#052e16' : isCurrent ? '#1c1917' : 'transparent',
                          color: isDone ? '#4ade80' : isCurrent ? '#fbbf24' : '#475569',
                          display: 'flex', alignItems: 'center', gap: '3px', transition: 'all 0.3s',
                        }}>
                          {isCurrent && <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#fbbf24', animation: 'pulse 1s ease-in-out infinite' }} />}
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
                              border: `1px solid ${isDone ? `${chip.color}50` : isActive ? chip.color : '#1e293b'}`,
                              backgroundColor: isDone ? `${chip.color}15` : isActive ? `${chip.color}20` : 'transparent',
                              color: isDone ? `${chip.color}` : isActive ? chip.color : '#475569',
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
                            <span style={{ fontSize: '8px', color: '#334155' }}>→</span>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}

                {/* Pipeline Stats */}
                {(pipelineStats.steps > 0 || pipelineStats.durationMs > 0) && (
                  <div style={{
                    marginTop: '8px', fontSize: '9px', color: '#475569', fontWeight: 600,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    display: 'flex', gap: '10px', flexWrap: 'wrap',
                    animation: 'fadeIn 0.3s ease',
                  }}>
                    <span>{pipelineStats.steps} agent steps</span>
                    <span style={{ color: '#334155' }}>·</span>
                    <span>{pipelineStats.apiCalls} API calls</span>
                    <span style={{ color: '#334155' }}>·</span>
                    <span>{pipelineStats.services.size} services</span>
                    <span style={{ color: '#334155' }}>·</span>
                    <span>{pipelineStats.sources} sources evaluated</span>
                    {pipelineStats.durationMs > 0 && (
                      <>
                        <span style={{ color: '#334155' }}>·</span>
                        <span>{(pipelineStats.durationMs / 1000).toFixed(1)}s</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div style={{
                flexShrink: 0, display: 'flex', borderBottom: '1px solid #1e293b',
                backgroundColor: '#0c1220',
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
                        flex: 1, padding: '10px 8px', border: 'none', borderBottom: `2px solid ${isActive ? '#fbbf24' : 'transparent'}`,
                        backgroundColor: 'transparent', color: isActive ? '#fbbf24' : '#64748b',
                        fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                      }}>
                      <span>{tab.icon}</span>
                      {tab.label}
                      {tab.count > 0 && (
                        <span style={{
                          fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                          backgroundColor: isActive ? 'rgba(251,191,36,0.15)' : '#1e293b',
                          color: isActive ? '#fbbf24' : '#475569',
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
                          borderLeft: `3px solid ${scColor?.text || '#475569'}`,
                          border: `1px solid ${scColor?.border || '#1e293b'}`,
                          borderLeftWidth: '3px', borderLeftColor: scColor?.text || '#475569',
                          backgroundColor: scColor?.bg || '#0f172a',
                          animation: `slideIn 0.3s ease ${i * 0.08}s both`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <span style={{
                              width: '8px', height: '8px', borderRadius: '50%',
                              backgroundColor: scColor?.text || '#475569',
                              animation: !sc.verdict ? 'pulse 1.2s ease-in-out infinite' : 'none',
                            }} />
                            <span style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
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
                              <span style={{ fontSize: '9px', color: '#475569', fontWeight: 600 }}>
                                {sc.confidence}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.55 }}>
                            {sc.text}
                          </div>
                          {sc.summary && (
                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px', lineHeight: 1.5, paddingTop: '6px', borderTop: '1px solid #1e293b' }}>
                              {sc.summary}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {v.subclaims.length === 0 && selectedClaim.status === 'verifying' && (
                      <div style={{ textAlign: 'center', padding: '40px' }}>
                        <div style={{ width: '24px', height: '24px', border: '2px solid #1e293b', borderTopColor: '#fbbf24', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
                        <div style={{ fontSize: '12px', color: '#fbbf24' }}>Decomposing claim...</div>
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
                            fontSize: '11px', fontWeight: 700, color: scColor?.text || '#94a3b8', marginBottom: '8px',
                            display: 'flex', alignItems: 'center', gap: '6px',
                          }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: scColor?.text || '#475569' }} />
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
                                  border: `1px solid ${ev.tier === 'counter' ? '#991b1b30' : '#1e293b'}`,
                                  backgroundColor: ev.tier === 'counter' ? '#1c0a0a' : '#0f172a',
                                  animation: `slideIn 0.2s ease ${i * 0.04}s both`,
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '11px' }}>{tierInfo.icon}</span>
                                    <span style={{ fontSize: '9px', fontWeight: 700, color: tierInfo.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                      {tierInfo.label}
                                    </span>
                                    {ev.study_type && (
                                      <span style={{ fontSize: '9px', color: '#475569', fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: '#1e293b' }}>
                                        {ev.study_type}
                                      </span>
                                    )}
                                    {/* Quality gauge */}
                                    {ev.quality_score != null && (
                                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <div style={{ width: '40px', height: '4px', borderRadius: '2px', backgroundColor: '#1e293b', overflow: 'hidden' }}>
                                          <div style={{ width: `${qScore}%`, height: '100%', borderRadius: '2px', backgroundColor: qColor, transition: 'width 0.5s ease' }} />
                                        </div>
                                        <span style={{ fontSize: '9px', fontWeight: 700, color: qColor }}>{qScore}</span>
                                      </div>
                                    )}
                                    {ev.supports_claim != null && (
                                      <span style={{
                                        fontSize: '8px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                                        backgroundColor: ev.supports_claim === true ? '#052e16' : ev.supports_claim === false ? '#1c0a0a' : '#1c1917',
                                        color: ev.supports_claim === true ? '#4ade80' : ev.supports_claim === false ? '#f87171' : '#fbbf24',
                                        border: `1px solid ${ev.supports_claim === true ? '#166534' : ev.supports_claim === false ? '#991b1b' : '#854d0e'}`,
                                      }}>
                                        {ev.supports_claim === true ? 'SUPPORTS' : ev.supports_claim === false ? 'OPPOSES' : 'PARTIAL'}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0', marginBottom: '3px' }}>
                                    {ev.title}
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                                    {ev.snippet?.slice(0, 180)}{(ev.snippet?.length || 0) > 180 ? '...' : ''}
                                  </div>
                                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '9px', color: '#475569' }}>
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
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: '8px' }}>Other Sources</div>
                        {v.evidence.filter(e => !e.subclaim_id || !v.subclaims.find(sc => sc.id === e.subclaim_id)).map((ev, i) => {
                          const tierInfo = TIER_LABELS[ev.tier] || { label: ev.tier, icon: '📋', color: '#94a3b8' };
                          return (
                            <div key={ev.id} style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #1e293b', backgroundColor: '#0f172a', marginBottom: '4px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '10px' }}>{tierInfo.icon}</span>
                                <span style={{ fontSize: '11px', fontWeight: 600, color: '#e2e8f0' }}>{ev.title}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {v.evidence.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#475569', fontSize: '12px' }}>
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
                                  backgroundColor: '#0f172a',
                                  boxShadow: `0 0 12px ${mutColor}15`,
                                  animation: `slideInH 0.4s ease ${i * 0.15}s both`,
                                  position: 'relative',
                                }}>
                                  {/* Glow dot */}
                                  <div style={{
                                    position: 'absolute', top: '-5px', left: '50%', transform: 'translateX(-50%)',
                                    width: '10px', height: '10px', borderRadius: '50%',
                                    backgroundColor: mutColor, border: '2px solid #0a0f1a',
                                    boxShadow: `0 0 8px ${mutColor}60`,
                                  }} />
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '14px' }}>{sourceIcons[node.source_type] || '📋'}</span>
                                    <span style={{ fontSize: '9px', fontWeight: 700, color: mutColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                      {node.source_type}
                                    </span>
                                    {node.date && <span style={{ fontSize: '9px', color: '#475569', marginLeft: 'auto' }}>{node.date}</span>}
                                  </div>
                                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                                    {node.source_name}
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#cbd5e1', lineHeight: 1.45, fontStyle: 'italic' }}>
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
                            backgroundColor: '#0f172a', border: '1px solid #1e293b',
                            fontSize: '12px', color: '#94a3b8', lineHeight: 1.6,
                          }}>
                            <span style={{ fontWeight: 700, color: '#fbbf24', marginRight: '6px' }}>Analysis:</span>
                            {v.provenanceAnalysis}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#475569', fontSize: '12px' }}>
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
                        <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #991b1b30', backgroundColor: '#1c0a0a' }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#f87171', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Original</div>
                          <div style={{ fontSize: '14px', color: '#fca5a5', lineHeight: 1.6, textDecoration: 'line-through', textDecorationColor: '#f8717140' }}>
                            {v.correctedClaim.original}
                          </div>
                        </div>
                        <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #16653430', backgroundColor: '#052e16' }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#4ade80', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Corrected</div>
                          <div style={{ fontSize: '14px', color: '#bbf7d0', lineHeight: 1.6 }}>
                            {v.correctedClaim.corrected}
                          </div>
                        </div>
                        <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #312e8130', backgroundColor: '#0f0f2e' }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#818cf8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Steel-manned</div>
                          <div style={{ fontSize: '14px', color: '#c7d2fe', lineHeight: 1.6 }}>
                            {v.correctedClaim.steelmanned}
                          </div>
                        </div>
                        <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #854d0e30', backgroundColor: '#1c1917' }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#fbbf24', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>One-sentence summary</div>
                          <div style={{ fontSize: '13px', color: '#fde68a', lineHeight: 1.6 }}>
                            {v.correctedClaim.one_sentence}
                          </div>
                        </div>
                        {v.correctedClaim.caveats.length > 0 && (
                          <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #1e293b', backgroundColor: '#0f172a' }}>
                            <div style={{ fontSize: '10px', fontWeight: 700, color: '#fbbf24', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Key Caveats</div>
                            {v.correctedClaim.caveats.map((c, i) => (
                              <div key={i} style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5, padding: '3px 0', display: 'flex', gap: '8px' }}>
                                <span style={{ color: '#fbbf24', flexShrink: 0 }}>⚠</span> {c}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#475569', fontSize: '12px' }}>
                        {selectedClaim.status === 'verifying' ? 'Generating corrected claim...' : 'No correction generated yet'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', maxWidth: '360px', padding: '48px' }}>
                <div style={{ fontSize: '48px', marginBottom: '14px', opacity: 0.15 }}>🧠</div>
                <div style={{ fontSize: '14px', color: '#475569', lineHeight: 1.6 }}>
                  Select a claim to see the full verification breakdown
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── Right: Agent Trace (collapsible) ──────────────────────── */}
        {showTrace && traceLines.length > 0 && (
          <div style={{
            width: '300px', flexShrink: 0, borderLeft: '1px solid #1e293b',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            backgroundColor: '#080c14',
          }}>
            <div style={{
              padding: '8px 12px', borderBottom: '1px solid #1e293b',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fbbf24', animation: selectedClaim?.status === 'verifying' ? 'pulse 1s ease-in-out infinite' : 'none' }} />
                <span style={{ fontSize: '10px', fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Mission Control
                </span>
              </div>
              <span style={{ fontSize: '9px', color: '#475569' }}>{traceLines.length} events</span>
            </div>
            <div ref={traceRef} style={{
              flex: 1, overflow: 'auto', padding: '8px 10px',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              fontSize: '10px', lineHeight: 1.7,
            }}>
              {traceLines.map((line, i) => {
                if (line.type === 'divider') {
                  return <div key={i} style={{ borderTop: '1px solid #1e293b', margin: '6px 0' }} />;
                }
                const typeConfig: Record<string, { color: string; icon: string }> = {
                  step: { color: '#fbbf24', icon: '▸' },
                  success: { color: '#4ade80', icon: '✓' },
                  error: { color: '#f87171', icon: '✗' },
                  verdict: { color: '#818cf8', icon: '◆' },
                  info: { color: '#64748b', icon: '·' },
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
    </div>
  );
};

export default SynapsePage;
