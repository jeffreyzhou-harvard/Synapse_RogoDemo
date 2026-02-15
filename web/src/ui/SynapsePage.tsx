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

  // Trace log
  const [traceLines, setTraceLines] = useState<{ text: string; type: string; indent: number }[]>([]);
  const traceRef = useRef<HTMLDivElement>(null);

  // File input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll trace
  useEffect(() => {
    if (traceRef.current) {
      traceRef.current.scrollTop = traceRef.current.scrollHeight;
    }
  }, [traceLines]);

  const addTrace = useCallback((text: string, type: string = 'info', indent: number = 0) => {
    setTraceLines(prev => [...prev, { text, type, indent }]);
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
    } catch (e) {
      addTrace(`Network error: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
    setIsIngesting(false);
  }, [inputValue, addTrace]);

  // ─── Extract Claims ──────────────────────────────────────────────────

  const extractClaims = useCallback(async (text: string) => {
    setIsExtracting(true);
    addTrace('Extracting claims...', 'step');

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
      addTrace(`${extracted.length} verifiable claims extracted`, 'success');
      extracted.forEach((c, i) => {
        addTrace(`Claim ${i + 1}: "${c.original.slice(0, 80)}${c.original.length > 80 ? '...' : ''}"`, 'info', 1);
      });
    } catch (e) {
      addTrace(`Error: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
    setIsExtracting(false);
  }, [addTrace]);

  // ─── Verify Single Claim (SSE) ──────────────────────────────────────

  const verifyClaim = useCallback(async (claimId: string) => {
    const claim = claims.find(c => c.id === claimId);
    if (!claim) return;

    setSelectedClaimId(claimId);

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

            // Add to trace
            switch (type) {
              case 'step_start':
                addTrace(`${STEP_ICONS[data.step] || '▸'} ${data.label}`, 'step');
                break;
              case 'subclaim':
                addTrace(`Sub-claim: "${data.text}"`, 'info', 1);
                break;
              case 'search_start':
                addTrace(`Searching for: "${(data.subclaim || '').slice(0, 60)}..."`, 'info', 1);
                break;
              case 'evidence_found':
                addTrace(`Found: ${data.title?.slice(0, 50)} [${data.tier}]`, 'info', 2);
                break;
              case 'evidence_scored':
                addTrace(`Scored ${data.id}: ${data.quality_score}/100 (${data.study_type || '?'})`, 'info', 2);
                break;
              case 'subclaim_verdict': {
                const icon = data.verdict === 'supported' ? '✅' : data.verdict === 'contradicted' ? '❌' : data.verdict === 'exaggerated' ? '⚠️' : '🔶';
                addTrace(`${icon} "${data.text?.slice(0, 50)}..." → ${data.verdict} (${data.confidence})`, 'verdict');
                break;
              }
              case 'overall_verdict': {
                const icon = data.verdict === 'supported' ? '✅' : data.verdict === 'contradicted' ? '❌' : '⚠️';
                addTrace(`${icon} OVERALL: ${data.verdict.toUpperCase()} (${data.confidence})`, 'verdict');
                addTrace(data.summary, 'info', 1);
                break;
              }
              case 'provenance_node':
                addTrace(`${data.source_type}: "${data.text?.slice(0, 60)}..." (${data.date || '?'})`, 'info', 1);
                break;
              case 'corrected_claim':
                addTrace(`Corrected: "${data.corrected?.slice(0, 80)}..."`, 'success', 1);
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
  }, [claims, addTrace]);

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

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: '#0a0f1a', color: '#e2e8f0',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      display: 'flex', flexDirection: 'column',
    }}>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes glow { 0%, 100% { box-shadow: 0 0 8px rgba(251,191,36,0.3); } 50% { box-shadow: 0 0 20px rgba(251,191,36,0.6); } }
        @keyframes typeIn { from { width: 0; } to { width: 100%; } }
        ::selection { background: rgba(251,191,36,0.3); }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #334155; }
      `}</style>

      {/* ═══ Header ═══════════════════════════════════════════════════════ */}
      <header style={{
        padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #1e293b', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '24px' }}>🧠</div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.5px' }}>SYNAPSE</div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#fbbf24', letterSpacing: '2px', textTransform: 'uppercase' }}>
              Every claim, interrogated
            </div>
          </div>
        </div>
        <div style={{ fontSize: '11px', color: '#475569' }}>
          Claim Verification Engine v1.0
        </div>
      </header>

      {/* ═══ Input Bar ════════════════════════════════════════════════════ */}
      <div style={{
        padding: '24px 32px', borderBottom: '1px solid #1e293b',
        background: 'linear-gradient(180deg, #0f172a 0%, #0a0f1a 100%)',
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          {!claims.length && !isIngesting && !isExtracting && (
            <div style={{ textAlign: 'center', marginBottom: '24px', animation: 'fadeIn 0.5s ease' }}>
              <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#f8fafc', marginBottom: '8px', letterSpacing: '-0.5px' }}>
                X-ray any claim
              </h1>
              <p style={{ fontSize: '14px', color: '#64748b', maxWidth: '500px', margin: '0 auto' }}>
                Paste a URL, article text, or drop an audio file. Synapse extracts every factual claim and runs deep multi-step verification.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
            {/* Mode toggle */}
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0,
            }}>
              <button onClick={() => setInputMode('url')}
                style={{
                  flex: 1, padding: '8px 12px', border: '1px solid', borderRadius: '8px 0 0 0',
                  borderColor: inputMode === 'url' ? '#fbbf24' : '#1e293b',
                  backgroundColor: inputMode === 'url' ? 'rgba(251,191,36,0.1)' : 'transparent',
                  color: inputMode === 'url' ? '#fbbf24' : '#64748b',
                  fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                }}>🔗 URL</button>
              <button onClick={() => setInputMode('text')}
                style={{
                  flex: 1, padding: '8px 12px', border: '1px solid', borderRadius: '0 0 0 8px',
                  borderColor: inputMode === 'text' ? '#fbbf24' : '#1e293b',
                  backgroundColor: inputMode === 'text' ? 'rgba(251,191,36,0.1)' : 'transparent',
                  color: inputMode === 'text' ? '#fbbf24' : '#64748b',
                  fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                }}>📝 Text</button>
            </div>

            {/* Input field */}
            {inputMode === 'url' ? (
              <input
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleIngest()}
                placeholder="Paste a URL — article, blog, YouTube, tweet..."
                style={{
                  flex: 1, padding: '14px 16px', backgroundColor: '#0f172a', border: '1px solid #1e293b',
                  borderRadius: '0', color: '#f8fafc', fontSize: '14px', outline: 'none',
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.currentTarget.style.borderColor = '#334155'}
                onBlur={e => e.currentTarget.style.borderColor = '#1e293b'}
              />
            ) : (
              <textarea
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder="Paste text containing claims to verify..."
                rows={3}
                style={{
                  flex: 1, padding: '14px 16px', backgroundColor: '#0f172a', border: '1px solid #1e293b',
                  borderRadius: '0', color: '#f8fafc', fontSize: '14px', outline: 'none', resize: 'vertical',
                  fontFamily: "'Inter', sans-serif", lineHeight: 1.6,
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.currentTarget.style.borderColor = '#334155'}
                onBlur={e => e.currentTarget.style.borderColor = '#1e293b'}
              />
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
              <button onClick={handleIngest}
                disabled={isIngesting || isExtracting || !inputValue.trim()}
                style={{
                  flex: 1, padding: '12px 20px', borderRadius: '0 8px 0 0',
                  border: '1px solid #fbbf24', backgroundColor: '#fbbf24', color: '#0a0f1a',
                  fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                  opacity: (isIngesting || isExtracting || !inputValue.trim()) ? 0.5 : 1,
                }}>
                {isIngesting ? '...' : 'Analyze'}
              </button>
              <button onClick={() => fileInputRef.current?.click()}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: '0 0 8px 0',
                  border: '1px solid #1e293b', backgroundColor: 'transparent', color: '#64748b',
                  fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                }}>🎙️ Audio</button>
            </div>
          </div>

          <input ref={fileInputRef} type="file" accept="audio/*,video/*,.mp3,.wav,.mp4,.m4a,.webm"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ''; }}
          />
        </div>
      </div>

      {/* ═══ Main Content ═════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ─── Left: Claims List ──────────────────────────────────────── */}
        <div style={{
          width: '380px', flexShrink: 0, borderRight: '1px solid #1e293b',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Claims header */}
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid #1e293b',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Claims {claims.length > 0 && `(${claims.length})`}
            </div>
            {claims.length > 0 && claims.some(c => c.status === 'pending') && (
              <button onClick={verifyAll}
                style={{
                  padding: '4px 12px', borderRadius: '6px', border: '1px solid #fbbf24',
                  backgroundColor: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                  fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                }}>
                Verify All
              </button>
            )}
          </div>

          {/* Claims list */}
          <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
            {isExtracting && (
              <div style={{ padding: '32px', textAlign: 'center', animation: 'fadeIn 0.3s ease' }}>
                <div style={{ width: '24px', height: '24px', border: '2px solid #1e293b', borderTopColor: '#fbbf24', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
                <div style={{ fontSize: '12px', color: '#64748b' }}>Extracting claims...</div>
              </div>
            )}

            {claims.map((claim, i) => {
              const isSelected = claim.id === selectedClaimId;
              const verdictColor = claim.verification?.overallVerdict
                ? VERDICT_COLORS[claim.verification.overallVerdict.verdict] || VERDICT_COLORS.unsupported
                : null;

              return (
                <div key={claim.id}
                  onClick={() => {
                    setSelectedClaimId(claim.id);
                    if (claim.status === 'pending') verifyClaim(claim.id);
                  }}
                  style={{
                    padding: '12px 14px', marginBottom: '6px', borderRadius: '10px', cursor: 'pointer',
                    border: '1px solid',
                    borderColor: isSelected ? (verdictColor?.border || '#334155') : '#1e293b',
                    backgroundColor: isSelected ? (verdictColor?.bg || '#0f172a') : '#0f172a',
                    boxShadow: isSelected ? `0 0 12px ${verdictColor?.glow || 'rgba(0,0,0,0.2)'}` : 'none',
                    transition: 'all 0.2s',
                    animation: `slideIn 0.3s ease ${i * 0.05}s both`,
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = '#334155'; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = '#1e293b'; }}
                >
                  {/* Status indicator */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    {claim.status === 'pending' && (
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#475569', flexShrink: 0 }} />
                    )}
                    {claim.status === 'verifying' && (
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#fbbf24', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
                    )}
                    {claim.status === 'done' && verdictColor && (
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: verdictColor.text, flexShrink: 0 }} />
                    )}
                    {claim.status === 'error' && (
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444', flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {claim.type}
                    </span>
                    {claim.verification?.overallVerdict && (
                      <span style={{
                        marginLeft: 'auto', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px',
                        backgroundColor: verdictColor?.bg, color: verdictColor?.text, border: `1px solid ${verdictColor?.border}`,
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                      }}>
                        {claim.verification.overallVerdict.verdict.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.5 }}>
                    {claim.original}
                  </div>
                  {claim.status === 'pending' && (
                    <div style={{ fontSize: '10px', color: '#475569', marginTop: '6px' }}>
                      Click to verify →
                    </div>
                  )}
                </div>
              );
            })}

            {!claims.length && !isExtracting && !isIngesting && (
              <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>🔍</div>
                <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.6 }}>
                  Paste a URL or text above to extract claims for verification
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Right: Verification Detail + Trace ────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Verification Panel */}
          {selectedClaim && v ? (
            <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
              {/* Claim header */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                  Verifying
                </div>
                <div style={{ fontSize: '16px', color: '#f8fafc', lineHeight: 1.6, fontWeight: 500 }}>
                  "{selectedClaim.original}"
                </div>
              </div>

              {/* Pipeline progress */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', flexWrap: 'wrap' }}>
                {['decomposition', 'evidence_retrieval', 'evaluation', 'synthesis', 'provenance', 'correction'].map(step => {
                  const isDone = v.completedSteps.includes(step);
                  const isCurrent = v.currentStep === step && !isDone;
                  return (
                    <div key={step} style={{
                      padding: '4px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 600,
                      border: '1px solid',
                      borderColor: isDone ? '#166534' : isCurrent ? '#854d0e' : '#1e293b',
                      backgroundColor: isDone ? '#052e16' : isCurrent ? '#1c1917' : 'transparent',
                      color: isDone ? '#4ade80' : isCurrent ? '#fbbf24' : '#475569',
                      display: 'flex', alignItems: 'center', gap: '4px',
                      transition: 'all 0.3s',
                    }}>
                      {isCurrent && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fbbf24', animation: 'pulse 1s ease-in-out infinite' }} />}
                      {isDone && <span>✓</span>}
                      {STEP_ICONS[step]} {step.replace('_', ' ')}
                    </div>
                  );
                })}
              </div>

              {/* Overall Verdict */}
              {v.overallVerdict && (() => {
                const vc = VERDICT_COLORS[v.overallVerdict!.verdict] || VERDICT_COLORS.unsupported;
                return (
                  <div style={{
                    padding: '20px', borderRadius: '12px', marginBottom: '24px',
                    border: `1px solid ${vc.border}`, backgroundColor: vc.bg,
                    boxShadow: `0 0 24px ${vc.glow}`,
                    animation: 'slideIn 0.4s ease',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                      <span style={{
                        fontSize: '14px', fontWeight: 800, color: vc.text, textTransform: 'uppercase',
                        letterSpacing: '1px', padding: '4px 12px', borderRadius: '6px',
                        border: `1px solid ${vc.border}`,
                      }}>
                        {v.overallVerdict!.verdict.replace('_', ' ')}
                      </span>
                      <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
                        {v.overallVerdict!.confidence} confidence
                      </span>
                    </div>
                    <div style={{ fontSize: '14px', color: '#cbd5e1', lineHeight: 1.7 }}>
                      {v.overallVerdict!.summary}
                    </div>
                    {v.overallVerdict!.detail && (
                      <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6, marginTop: '8px' }}>
                        {v.overallVerdict!.detail}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Sub-claims */}
              {v.subclaims.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
                    Sub-claims ({v.subclaims.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {v.subclaims.map((sc, i) => {
                      const scColor = sc.verdict ? (VERDICT_COLORS[sc.verdict] || VERDICT_COLORS.unsupported) : null;
                      return (
                        <div key={sc.id} style={{
                          padding: '12px 14px', borderRadius: '8px',
                          border: `1px solid ${scColor?.border || '#1e293b'}`,
                          backgroundColor: scColor?.bg || '#0f172a',
                          animation: `slideIn 0.3s ease ${i * 0.1}s both`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span style={{
                              width: '6px', height: '6px', borderRadius: '50%',
                              backgroundColor: scColor?.text || '#475569',
                              animation: !sc.verdict ? 'pulse 1.2s ease-in-out infinite' : 'none',
                            }} />
                            <span style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                              {sc.type}
                            </span>
                            {sc.verdict && (
                              <span style={{
                                marginLeft: 'auto', fontSize: '10px', fontWeight: 700, color: scColor?.text,
                                textTransform: 'uppercase',
                              }}>
                                {sc.verdict.replace('_', ' ')}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.5 }}>
                            {sc.text}
                          </div>
                          {sc.summary && (
                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', lineHeight: 1.5 }}>
                              {sc.summary}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Evidence */}
              {v.evidence.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
                    Evidence ({v.evidence.length} sources)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {v.evidence.map((ev, i) => {
                      const tierInfo = TIER_LABELS[ev.tier] || { label: ev.tier, icon: '📋', color: '#94a3b8' };
                      const supportColor = ev.supports_claim === true ? '#4ade80' : ev.supports_claim === false ? '#f87171' : '#fbbf24';
                      return (
                        <div key={ev.id} style={{
                          padding: '10px 12px', borderRadius: '8px', border: '1px solid #1e293b',
                          backgroundColor: '#0f172a', animation: `slideIn 0.2s ease ${i * 0.03}s both`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '12px' }}>{tierInfo.icon}</span>
                            <span style={{ fontSize: '10px', fontWeight: 700, color: tierInfo.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              {tierInfo.label}
                            </span>
                            {ev.quality_score != null && (
                              <span style={{
                                marginLeft: 'auto', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px',
                                backgroundColor: ev.quality_score >= 70 ? '#052e16' : ev.quality_score >= 40 ? '#1c1917' : '#1a1a2e',
                                color: ev.quality_score >= 70 ? '#4ade80' : ev.quality_score >= 40 ? '#fbbf24' : '#94a3b8',
                                border: `1px solid ${ev.quality_score >= 70 ? '#166534' : ev.quality_score >= 40 ? '#854d0e' : '#334155'}`,
                              }}>
                                {ev.quality_score}/100
                              </span>
                            )}
                            {ev.supports_claim != null && (
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: supportColor }} />
                            )}
                          </div>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0', marginBottom: '2px' }}>
                            {ev.title}
                          </div>
                          <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                            {ev.snippet?.slice(0, 200)}{(ev.snippet?.length || 0) > 200 ? '...' : ''}
                          </div>
                          <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '10px', color: '#475569' }}>
                            {ev.year && <span>{ev.year}</span>}
                            {ev.citations != null && <span>{ev.citations} citations</span>}
                            {ev.study_type && <span>{ev.study_type}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Provenance */}
              {v.provenanceNodes.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
                    🔗 Provenance Chain
                  </div>
                  <div style={{ position: 'relative', paddingLeft: '24px' }}>
                    {/* Vertical line */}
                    <div style={{
                      position: 'absolute', left: '11px', top: '8px', bottom: '8px', width: '2px',
                      background: 'linear-gradient(180deg, #4ade80, #fbbf24, #fb923c, #f87171)',
                      borderRadius: '1px',
                    }} />
                    {v.provenanceNodes.map((node, i) => {
                      const mutColor = MUTATION_COLORS[node.mutation_severity] || '#94a3b8';
                      return (
                        <div key={node.id} style={{
                          position: 'relative', padding: '10px 14px', marginBottom: '8px',
                          borderRadius: '8px', border: '1px solid #1e293b', backgroundColor: '#0f172a',
                          animation: `slideIn 0.3s ease ${i * 0.15}s both`,
                        }}>
                          {/* Node dot */}
                          <div style={{
                            position: 'absolute', left: '-19px', top: '14px',
                            width: '10px', height: '10px', borderRadius: '50%',
                            backgroundColor: mutColor, border: '2px solid #0a0f1a',
                          }} />
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '10px', fontWeight: 700, color: mutColor, textTransform: 'uppercase' }}>
                              {node.source_type}
                            </span>
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>{node.source_name}</span>
                            {node.date && <span style={{ fontSize: '10px', color: '#475569', marginLeft: 'auto' }}>{node.date}</span>}
                          </div>
                          <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5, fontStyle: 'italic' }}>
                            "{node.text}"
                          </div>
                          {node.mutation_severity !== 'none' && (
                            <div style={{ fontSize: '10px', color: mutColor, marginTop: '4px', fontWeight: 600 }}>
                              Mutation: {node.mutation_severity}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {v.provenanceAnalysis && (
                    <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6, marginTop: '8px', padding: '10px 14px', borderRadius: '8px', backgroundColor: '#0f172a', border: '1px solid #1e293b' }}>
                      {v.provenanceAnalysis}
                    </div>
                  )}
                </div>
              )}

              {/* Corrected Claim */}
              {v.correctedClaim && (
                <div style={{ marginBottom: '24px', animation: 'slideIn 0.4s ease' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
                    ✏️ Corrected Claim
                  </div>
                  <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid #1e293b', backgroundColor: '#0f172a' }}>
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: '#f87171', marginBottom: '4px' }}>ORIGINAL</div>
                      <div style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.6, textDecoration: 'line-through', textDecorationColor: '#f8717140' }}>
                        {v.correctedClaim.original}
                      </div>
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: '#4ade80', marginBottom: '4px' }}>CORRECTED</div>
                      <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.6 }}>
                        {v.correctedClaim.corrected}
                      </div>
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: '#818cf8', marginBottom: '4px' }}>STEEL-MANNED</div>
                      <div style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.6 }}>
                        {v.correctedClaim.steelmanned}
                      </div>
                    </div>
                    {v.correctedClaim.caveats.length > 0 && (
                      <div>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: '#fbbf24', marginBottom: '4px' }}>CAVEATS</div>
                        {v.correctedClaim.caveats.map((c, i) => (
                          <div key={i} style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5, padding: '2px 0', display: 'flex', gap: '6px' }}>
                            <span style={{ color: '#fbbf24', flexShrink: 0 }}>•</span> {c}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Loading state */}
              {selectedClaim.status === 'verifying' && !v.overallVerdict && (
                <div style={{ textAlign: 'center', padding: '32px' }}>
                  <div style={{ width: '32px', height: '32px', border: '2px solid #1e293b', borderTopColor: '#fbbf24', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
                  <div style={{ fontSize: '13px', color: '#fbbf24', fontWeight: 600 }}>{v.stepLabel || 'Processing...'}</div>
                </div>
              )}
            </div>
          ) : (
            /* Empty state */
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', maxWidth: '400px', padding: '48px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.2 }}>🧠</div>
                <div style={{ fontSize: '15px', color: '#475569', lineHeight: 1.6 }}>
                  Select a claim from the left panel to see the full verification breakdown — sub-claims, evidence, verdicts, provenance, and corrections.
                </div>
              </div>
            </div>
          )}

          {/* ─── Reasoning Trace ──────────────────────────────────────── */}
          {traceLines.length > 0 && (
            <div style={{
              height: '200px', flexShrink: 0, borderTop: '1px solid #1e293b',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{
                padding: '8px 16px', borderBottom: '1px solid #1e293b',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Agent Trace
                </span>
                <span style={{ fontSize: '10px', color: '#475569' }}>{traceLines.length} events</span>
              </div>
              <div ref={traceRef} style={{
                flex: 1, overflow: 'auto', padding: '8px 16px',
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                fontSize: '11px', lineHeight: 1.8,
              }}>
                {traceLines.map((line, i) => {
                  if (line.type === 'divider') {
                    return <div key={i} style={{ borderTop: '1px solid #1e293b', margin: '4px 0' }} />;
                  }
                  const color = line.type === 'step' ? '#fbbf24' : line.type === 'success' ? '#4ade80' : line.type === 'error' ? '#f87171' : line.type === 'verdict' ? '#818cf8' : '#64748b';
                  return (
                    <div key={i} style={{
                      color, paddingLeft: `${line.indent * 16}px`,
                      animation: `fadeIn 0.15s ease`,
                    }}>
                      {line.indent > 0 && <span style={{ color: '#334155' }}>{'│ '.repeat(line.indent)}</span>}
                      {line.text}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SynapsePage;
