import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── API Base URL ────────────────────────────────────────────────────────
const API_BASE = window.location.hostname === 'localhost' ? '' : 'https://web-production-d3011.up.railway.app';

// ─── Types ───────────────────────────────────────────────────────────────

type Severity = 'critical' | 'high' | 'medium' | 'low';
type IssueType = 'citation_mismatch' | 'math_error' | 'stale_source' | 'methodology_inconsistency' | 'quote_inaccuracy' | 'material_omission' | 'exaggeration' | 'unsupported_claim';
type AuditPhase = 'idle' | 'uploading' | 'extracting' | 'verifying' | 'analyzing' | 'complete' | 'error';

interface Finding {
  id: string;
  severity: Severity;
  issueType: IssueType;
  summary: string;
  location: string;
  documentSays: string;
  sourceSays: string;
  delta?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  claimId?: string;
  confidence: 'high' | 'medium' | 'low';
  downstreamEffects?: { label: string; location: string }[];
  // Deep dive data
  fullContext?: string;
  fullEvidence?: string;
  calculationSteps?: { step: string; value: string; correct: boolean }[];
  oldSourceDate?: string;
  newSourceDate?: string;
  reconciliation?: { accuracy_level: string; explanation: string };
}

interface AuditStats {
  totalClaims: number;
  verified: number;
  supported: number;
  issues: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  stale: number;
  mathErrors: number;
  citationMismatches: number;
  omissions: number;
}

interface DocumentAuditState {
  phase: AuditPhase;
  documentTitle: string;
  documentText: string;
  trustScore: number;
  stats: AuditStats;
  findings: Finding[];
  progress: { step: string; label: string; current: number; total: number };
  error?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<Severity, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: '#f87171', bg: '#1a0808', border: '#5c1a1a', label: 'CRITICAL' },
  high: { color: '#fb923c', bg: '#1a1008', border: '#4a2a0a', label: 'HIGH' },
  medium: { color: '#fbbf24', bg: '#1a1808', border: '#3a3010', label: 'MEDIUM' },
  low: { color: '#888888', bg: '#0a0a0a', border: '#1a1a1a', label: 'LOW' },
};

const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  citation_mismatch: 'CITATION MISMATCH',
  math_error: 'MATH ERROR',
  stale_source: 'STALE SOURCE',
  methodology_inconsistency: 'METHODOLOGY',
  quote_inaccuracy: 'QUOTE INACCURACY',
  material_omission: 'MATERIAL OMISSION',
  exaggeration: 'EXAGGERATION',
  unsupported_claim: 'UNSUPPORTED',
};

const EMPTY_STATS: AuditStats = {
  totalClaims: 0, verified: 0, supported: 0, issues: 0,
  critical: 0, high: 0, medium: 0, low: 0,
  stale: 0, mathErrors: 0, citationMismatches: 0, omissions: 0,
};

// ─── Helper: classify a verification result into a Finding ───────────────

function classifyFinding(
  claimIdx: number,
  claimText: string,
  verification: any,
): Finding | null {
  const v = verification;
  if (!v) return null;

  const verdict = v.overallVerdict?.verdict || v.reconciliation?.reconciled_verdict;
  if (verdict === 'supported' && !v.reconciliation?.override_mechanical) return null;

  // Determine issue type and severity
  let issueType: IssueType = 'unsupported_claim';
  let severity: Severity = 'medium';
  let summary = v.overallVerdict?.summary || 'Verification issue detected';
  let documentSays = claimText;
  let sourceSays = '';
  let delta = '';
  let sourceUrl = '';
  let sourceLabel = '';
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  let calculationSteps: Finding['calculationSteps'] = undefined;
  let downstreamEffects: Finding['downstreamEffects'] = undefined;

  // Check for XBRL/math discrepancies
  const xbrlEvidence = (v.evidence || []).find((e: any) => e.xbrl_discrepancy && e.xbrl_discrepancy !== 'none');
  if (xbrlEvidence) {
    issueType = 'math_error';
    severity = 'critical';
    documentSays = xbrlEvidence.xbrl_claimed || claimText;
    sourceSays = `${xbrlEvidence.xbrl_actual} (XBRL verified)`;
    delta = xbrlEvidence.xbrl_discrepancy || '';
    sourceLabel = `SEC EDGAR — ${xbrlEvidence.company_ticker || ''}`;
    sourceUrl = xbrlEvidence.source || '';
    confidence = 'high';
    summary = `Numerical discrepancy: document states ${xbrlEvidence.xbrl_claimed}, but SEC filing shows ${xbrlEvidence.xbrl_actual}`;
    if (xbrlEvidence.xbrl_computation) {
      calculationSteps = [
        { step: 'Document value', value: xbrlEvidence.xbrl_claimed || '', correct: false },
        { step: 'XBRL actual', value: xbrlEvidence.xbrl_actual || '', correct: true },
        { step: 'Computation', value: xbrlEvidence.xbrl_computation || '', correct: true },
      ];
    }
  }

  // Check for contradictions → citation mismatch
  if (!xbrlEvidence && (v.contradictions || []).length > 0) {
    const topContradiction = v.contradictions[0];
    issueType = 'citation_mismatch';
    severity = topContradiction.severity === 'high' ? 'high' : 'medium';
    documentSays = topContradiction.source_a?.text || claimText;
    sourceSays = topContradiction.source_b?.text || '';
    summary = topContradiction.explanation || summary;
    sourceLabel = topContradiction.source_b?.name || '';
  }

  // Check for consistency issues → methodology inconsistency or stale
  if ((v.consistencyIssues || []).length > 0) {
    const topIssue = v.consistencyIssues[0];
    if (topIssue.type === 'temporal_inconsistency' || topIssue.type === 'restatement') {
      issueType = 'stale_source';
      severity = topIssue.severity === 'high' ? 'high' : 'medium';
    } else if (topIssue.type === 'omission_flag') {
      issueType = 'material_omission';
      severity = topIssue.severity === 'high' ? 'critical' : 'high';
    } else {
      issueType = 'methodology_inconsistency';
      severity = topIssue.severity === 'high' ? 'high' : 'medium';
    }
    if (!xbrlEvidence && (v.contradictions || []).length === 0) {
      summary = topIssue.description || summary;
      sourceSays = topIssue.implication || '';
    }
  }

  // Check for exaggeration
  if (verdict === 'exaggerated' && issueType === 'unsupported_claim') {
    issueType = 'exaggeration';
    severity = 'high';
  }

  // Materiality override
  if (v.materiality) {
    if (v.materiality.materiality_level === 'critical') severity = 'critical';
    else if (v.materiality.materiality_level === 'high' && severity !== 'critical') severity = 'high';
  }

  // If reconciled as true/essentially_true, downgrade
  if (v.reconciliation?.accuracy_level === 'true' || v.reconciliation?.accuracy_level === 'essentially_true') {
    if (severity === 'critical') severity = 'medium';
    else if (severity === 'high') severity = 'low';
    else severity = 'low';
  }

  // If still "supported" after all checks, skip
  if (verdict === 'supported' && severity === 'low' && issueType === 'unsupported_claim') return null;

  // Confidence from evidence tiers
  const secEvidence = (v.evidence || []).some((e: any) => e.tier === 'sec_filing' || e.tier === 'xbrl');
  confidence = secEvidence ? 'high' : (v.evidence || []).length >= 3 ? 'medium' : 'low';

  // Best source URL
  const bestSource = (v.evidence || []).find((e: any) => e.source && e.supports_claim !== true);
  if (!sourceUrl && bestSource) {
    sourceUrl = bestSource.source || '';
    sourceLabel = sourceLabel || bestSource.title || '';
  }

  // Corrected claim as sourceSays fallback
  if (!sourceSays && v.correctedClaim?.corrected) {
    sourceSays = v.correctedClaim.corrected;
  }

  return {
    id: `finding-${claimIdx}`,
    severity,
    issueType,
    summary,
    location: `Claim ${claimIdx + 1}`,
    documentSays,
    sourceSays,
    delta,
    sourceUrl,
    sourceLabel,
    claimId: `claim-${claimIdx}`,
    confidence,
    downstreamEffects,
    calculationSteps,
    reconciliation: v.reconciliation ? { accuracy_level: v.reconciliation.accuracy_level, explanation: v.reconciliation.explanation } : undefined,
    fullContext: claimText,
    fullEvidence: (v.evidence || []).slice(0, 3).map((e: any) => `[${e.tier}] ${e.title}: ${e.snippet}`).join('\n\n'),
  };
}

function computeTrustScore(stats: AuditStats): number {
  if (stats.totalClaims === 0) return 100;
  const base = 100;
  const penalties = stats.critical * 15 + stats.high * 8 + stats.medium * 3 + stats.low * 1;
  const maxPenalty = stats.totalClaims * 15;
  const score = Math.max(0, Math.min(100, base - (penalties / maxPenalty) * 100));
  return Math.round(score);
}

// ─── Component ───────────────────────────────────────────────────────────

const DocumentAuditPage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputMode, setInputMode] = useState<'file' | 'text'>('file');
  const [pastedText, setPastedText] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const [audit, setAudit] = useState<DocumentAuditState>({
    phase: 'idle',
    documentTitle: '',
    documentText: '',
    trustScore: 0,
    stats: { ...EMPTY_STATS },
    findings: [],
    progress: { step: '', label: '', current: 0, total: 0 },
  });

  // UI state
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<IssueType | 'all'>('all');
  const [showTrace, setShowTrace] = useState(false);
  const [traceLines, setTraceLines] = useState<{ text: string; type: string }[]>([]);
  const traceEndRef = useRef<HTMLDivElement>(null);

  const addTrace = useCallback((text: string, type: string = 'info') => {
    setTraceLines(prev => [...prev, { text, type }]);
  }, []);

  useEffect(() => {
    if (traceEndRef.current) traceEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [traceLines]);

  // ─── Document Upload + Verification Pipeline ────────────────────────

  const runAudit = useCallback(async (title: string, text: string) => {
    setAudit(prev => ({ ...prev, phase: 'extracting', documentTitle: title, documentText: text, findings: [], stats: { ...EMPTY_STATS }, progress: { step: 'extract', label: 'Extracting claims...', current: 0, total: 0 } }));
    addTrace(`Document loaded: "${title}" (${text.length.toLocaleString()} chars)`, 'step');
    addTrace('Extracting verifiable claims...', 'step');

    try {
      // Step 1: Extract claims
      const extractResp = await fetch(`${API_BASE}/api/extract-claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!extractResp.ok) throw new Error(`Extraction failed: ${extractResp.status}`);
      const extractData = await extractResp.json();
      const claims: { id: string; original: string; normalized: string; type: string }[] = extractData.claims || [];

      if (claims.length === 0) {
        setAudit(prev => ({ ...prev, phase: 'error', error: 'No verifiable claims found in this document.' }));
        return;
      }

      addTrace(`Found ${claims.length} verifiable claims`, 'success');
      setAudit(prev => ({
        ...prev,
        phase: 'verifying',
        stats: { ...prev.stats, totalClaims: claims.length },
        progress: { step: 'verify', label: `Verifying claim 1 of ${claims.length}...`, current: 0, total: claims.length },
      }));

      // Step 2: Verify each claim via SSE
      const allVerifications: any[] = [];

      for (let i = 0; i < claims.length; i++) {
        const claim = claims[i];
        setAudit(prev => ({
          ...prev,
          progress: { step: 'verify', label: `Verifying claim ${i + 1} of ${claims.length}...`, current: i, total: claims.length },
        }));
        addTrace(`▸ Verifying: "${claim.original.slice(0, 80)}..."`, 'info');

        try {
          const resp = await fetch(`${API_BASE}/api/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ claim: claim.original }),
          });

          if (!resp.ok || !resp.body) {
            allVerifications.push(null);
            addTrace(`  ✗ Failed to verify claim ${i + 1}`, 'error');
            continue;
          }

          // Read SSE stream to completion
          const verification: any = {
            subclaims: [], evidence: [], contradictions: [], consistencyIssues: [], authorityConflicts: [],
            provenanceNodes: [], provenanceEdges: [],
            overallVerdict: null, correctedClaim: null, reconciliation: null, materiality: null, riskSignals: null,
          };

          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const { type, data } = JSON.parse(line.slice(6));
                switch (type) {
                  case 'subclaim': verification.subclaims.push(data); break;
                  case 'evidence_found': verification.evidence.push(data); break;
                  case 'evidence_scored':
                    verification.evidence = verification.evidence.map((e: any) => e.id === data.id ? { ...e, ...data } : e);
                    break;
                  case 'contradiction_detected': verification.contradictions.push(data); break;
                  case 'consistency_issue': verification.consistencyIssues.push(data); break;
                  case 'overall_verdict': verification.overallVerdict = data; break;
                  case 'corrected_claim': verification.correctedClaim = data; break;
                  case 'reconciliation': verification.reconciliation = data; break;
                  case 'materiality': verification.materiality = data; break;
                  case 'authority_conflict': verification.authorityConflicts.push(data); break;
                  case 'risk_signals': verification.riskSignals = data; break;
                  case 'plausibility_assessment': verification.plausibility = data; break;
                }
              } catch { /* skip malformed */ }
            }
          }

          allVerifications.push(verification);

          const vd = verification.overallVerdict?.verdict || 'unknown';
          const icon = vd === 'supported' ? '✓' : vd === 'contradicted' ? '✗' : '⚠';
          addTrace(`  ${icon} ${vd} (${(verification.evidence || []).length} sources)`, vd === 'supported' ? 'success' : 'warning');

        } catch (err) {
          allVerifications.push(null);
          addTrace(`  ✗ Error: ${err instanceof Error ? err.message : 'Unknown'}`, 'error');
        }
      }

      // Step 3: Analyze results → build findings
      addTrace('Analyzing results...', 'step');
      setAudit(prev => ({ ...prev, phase: 'analyzing', progress: { step: 'analyze', label: 'Building report...', current: claims.length, total: claims.length } }));

      const findings: Finding[] = [];
      let supported = 0;
      let verified = 0;
      const issueCounters = { critical: 0, high: 0, medium: 0, low: 0, stale: 0, mathErrors: 0, citationMismatches: 0, omissions: 0 };

      for (let i = 0; i < claims.length; i++) {
        const v = allVerifications[i];
        if (!v) continue;
        verified++;

        const vd = v.reconciliation?.reconciled_verdict || v.overallVerdict?.verdict;
        if (vd === 'supported') { supported++; continue; }

        const finding = classifyFinding(i, claims[i].original, v);
        if (finding) {
          findings.push(finding);
          issueCounters[finding.severity]++;
          if (finding.issueType === 'stale_source') issueCounters.stale++;
          if (finding.issueType === 'math_error') issueCounters.mathErrors++;
          if (finding.issueType === 'citation_mismatch') issueCounters.citationMismatches++;
          if (finding.issueType === 'material_omission') issueCounters.omissions++;
        } else {
          supported++;
        }
      }

      // Sort by severity
      const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

      const stats: AuditStats = {
        totalClaims: claims.length,
        verified,
        supported,
        issues: findings.length,
        ...issueCounters,
      };

      const trustScore = computeTrustScore(stats);

      setAudit({
        phase: 'complete',
        documentTitle: title,
        documentText: text,
        trustScore,
        stats,
        findings,
        progress: { step: 'done', label: 'Complete', current: claims.length, total: claims.length },
      });

      addTrace(`Audit complete: Trust Score ${trustScore}/100 — ${findings.length} findings`, 'success');

    } catch (err) {
      setAudit(prev => ({ ...prev, phase: 'error', error: err instanceof Error ? err.message : 'Unknown error' }));
      addTrace(`Error: ${err instanceof Error ? err.message : 'Unknown'}`, 'error');
    }
  }, [addTrace]);

  const handleFileUpload = useCallback(async (file: File) => {
    setAudit(prev => ({ ...prev, phase: 'uploading', progress: { step: 'upload', label: 'Uploading document...', current: 0, total: 1 } }));
    addTrace(`Uploading: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`, 'step');

    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch(`${API_BASE}/api/ingest-file`, { method: 'POST', body: formData });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(err.detail || 'Upload failed');
      }
      const data = await resp.json();
      await runAudit(data.title || file.name, data.text);
    } catch (err) {
      setAudit(prev => ({ ...prev, phase: 'error', error: err instanceof Error ? err.message : 'Upload failed' }));
      addTrace(`Upload error: ${err instanceof Error ? err.message : 'Unknown'}`, 'error');
    }
  }, [addTrace, runAudit]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const handleTextSubmit = useCallback(() => {
    if (!pastedText.trim()) return;
    runAudit('Pasted Document', pastedText);
  }, [pastedText, runAudit]);

  // ─── Filtered findings ─────────────────────────────────────────────

  const filteredFindings = audit.findings.filter(f => {
    if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
    if (typeFilter !== 'all' && f.issueType !== typeFilter) return false;
    return true;
  });

  // ─── Render ────────────────────────────────────────────────────────

  const isWorking = ['uploading', 'extracting', 'verifying', 'analyzing'].includes(audit.phase);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#000000', color: '#ffffff', fontFamily: "'Inter', -apple-system, sans-serif", overflow: 'hidden' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes scoreReveal { from { stroke-dashoffset: 283; } }
        @keyframes barGrow { from { width: 0; } }
        ::selection { background: rgba(255,255,255,0.2); }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #222222; border-radius: 3px; }
      `}</style>

      {/* ═══ Header ═══════════════════════════════════════════════════════ */}
      <header style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid #111111',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/synapse-logo.svg" alt="Synapse" style={{ width: '22px', height: '22px' }} />
          <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.3px' }}>Synapse</span>
          {/* Mode toggle */}
          <div style={{ display: 'flex', marginLeft: '16px', borderRadius: '6px', border: '1px solid #1a1a1a', overflow: 'hidden' }}>
            <button onClick={() => navigate('/')} style={{
              padding: '4px 12px', border: 'none', fontSize: '10px', fontWeight: 700, cursor: 'pointer',
              backgroundColor: 'transparent', color: '#555',
            }}>
              Claim Verification
            </button>
            <button style={{
              padding: '4px 12px', border: 'none', fontSize: '10px', fontWeight: 700, cursor: 'pointer',
              backgroundColor: '#111', color: '#fff',
            }}>
              Document Audit
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isWorking && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: '#888' }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#fff', animation: 'pulse 1s ease-in-out infinite' }} />
              {audit.progress.label}
            </div>
          )}
          {audit.phase === 'complete' && (
            <span style={{ fontSize: '10px', color: '#555' }}>{audit.stats.totalClaims} claims · {audit.stats.verified} verified</span>
          )}
          <button onClick={() => setShowTrace(p => !p)} style={{
            padding: '4px 10px', borderRadius: '6px', border: '1px solid',
            borderColor: showTrace ? '#333' : '#1a1a1a',
            backgroundColor: showTrace ? '#111' : 'transparent',
            color: showTrace ? '#fff' : '#555',
            fontSize: '10px', fontWeight: 700, cursor: 'pointer',
          }}>
            TRACE {traceLines.length > 0 && `(${traceLines.length})`}
          </button>
        </div>
      </header>

      {/* ═══ Main Content ═════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ─── Left: Main Panel ─── */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>

          {/* ═══ Idle State: Upload ═══════════════════════════════════════ */}
          {audit.phase === 'idle' && (
            <div style={{ maxWidth: '640px', margin: '0 auto', animation: 'fadeIn 0.4s ease' }}>
              <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                <h1 style={{ fontSize: '28px', fontWeight: 300, color: '#fff', marginBottom: '12px', letterSpacing: '-0.3px', lineHeight: 1.35 }}>
                  Document Verification Audit
                </h1>
                <p style={{ fontSize: '13px', color: '#555', maxWidth: '440px', margin: '0 auto', lineHeight: 1.7 }}>
                  Upload a financial document — CIM, pitch deck, research memo, earnings report —
                  and get a trust score with every discrepancy ranked by severity.
                </p>
              </div>

              {/* Mode tabs */}
              <div style={{ display: 'flex', gap: '0', marginBottom: '12px' }}>
                {(['file', 'text'] as const).map(mode => (
                  <button key={mode} onClick={() => setInputMode(mode)} style={{
                    padding: '5px 16px', border: '1px solid',
                    borderColor: inputMode === mode ? '#333' : '#1a1a1a',
                    backgroundColor: inputMode === mode ? '#111' : 'transparent',
                    color: inputMode === mode ? '#fff' : '#555',
                    fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                    borderRadius: mode === 'file' ? '2px 0 0 2px' : '0 2px 2px 0',
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                  }}>
                    {mode === 'file' ? 'Upload File' : 'Paste Text'}
                  </button>
                ))}
              </div>

              {inputMode === 'file' ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: '48px 24px', borderRadius: '2px',
                    border: `2px dashed ${dragOver ? '#555' : '#1a1a1a'}`,
                    backgroundColor: dragOver ? '#0a0a0a' : '#030303',
                    cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
                  }}
                >
                  <div style={{ fontSize: '13px', color: '#555', marginBottom: '8px' }}>
                    Drop a file here or click to browse
                  </div>
                  <div style={{ fontSize: '10px', color: '#333' }}>
                    PDF, DOCX, PPTX — up to 100 MB
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.doc,.pptx"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                  />
                </div>
              ) : (
                <div>
                  <textarea
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder="Paste the full document text here..."
                    style={{
                      width: '100%', height: '200px', padding: '14px', borderRadius: '2px',
                      border: '1px solid #1a1a1a', backgroundColor: '#050505', color: '#ccc',
                      fontSize: '12px', fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                    }}
                  />
                  <button onClick={handleTextSubmit} disabled={!pastedText.trim()} style={{
                    marginTop: '8px', padding: '8px 24px', borderRadius: '2px',
                    border: '1px solid #333', backgroundColor: pastedText.trim() ? '#fff' : '#111',
                    color: pastedText.trim() ? '#000' : '#555',
                    fontSize: '11px', fontWeight: 700, cursor: pastedText.trim() ? 'pointer' : 'not-allowed',
                  }}>
                    Run Audit
                  </button>
                </div>
              )}

              {/* Pipeline info */}
              <div style={{
                marginTop: '24px', padding: '14px 18px', borderRadius: '2px',
                border: '1px solid #111', backgroundColor: '#030303',
                fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                  {['extract', 'resolve', 'normalize', 'retrieve', 'evaluate', 'contradict', 'consistency', 'synthesize', 'reconcile', 'report'].map((s, i, arr) => (
                    <React.Fragment key={s}>
                      <span style={{ fontSize: '8px', fontWeight: 600, color: '#333' }}>{s}</span>
                      {i < arr.length - 1 && <span style={{ fontSize: '7px', color: '#1a1a1a' }}>→</span>}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══ Working State: Progress ══════════════════════════════════ */}
          {isWorking && (
            <div style={{ maxWidth: '640px', margin: '0 auto', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 300, color: '#fff', marginBottom: '8px' }}>
                  Auditing: {audit.documentTitle}
                </h2>
                <p style={{ fontSize: '12px', color: '#555' }}>{audit.progress.label}</p>
              </div>

              {/* Progress bar */}
              {audit.progress.total > 0 && (
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '10px', color: '#555' }}>{audit.progress.step}</span>
                    <span style={{ fontSize: '10px', color: '#555' }}>{audit.progress.current}/{audit.progress.total}</span>
                  </div>
                  <div style={{ height: '4px', backgroundColor: '#111', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', backgroundColor: '#fff', borderRadius: '2px',
                      width: `${(audit.progress.current / audit.progress.total) * 100}%`,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>
              )}

              {/* Stats so far */}
              {audit.stats.totalClaims > 0 && (
                <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Claims', value: audit.stats.totalClaims },
                    { label: 'Verified', value: audit.stats.verified },
                    { label: 'Issues', value: audit.findings.length },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '20px', fontWeight: 700, color: '#fff' }}>{s.value}</div>
                      <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ Error State ══════════════════════════════════════════════ */}
          {audit.phase === 'error' && (
            <div style={{ maxWidth: '500px', margin: '60px auto', textAlign: 'center', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ fontSize: '14px', color: '#f87171', marginBottom: '12px' }}>{audit.error || 'An error occurred'}</div>
              <button onClick={() => setAudit(prev => ({ ...prev, phase: 'idle', error: undefined }))} style={{
                padding: '8px 20px', borderRadius: '2px', border: '1px solid #333',
                backgroundColor: '#111', color: '#fff', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
              }}>
                Try Again
              </button>
            </div>
          )}

          {/* ═══ Complete: Report View ════════════════════════════════════ */}
          {audit.phase === 'complete' && (
            <div style={{ maxWidth: '800px', margin: '0 auto', animation: 'fadeIn 0.4s ease' }}>

              {/* ── Trust Score + Stats ─── */}
              <div style={{ display: 'flex', gap: '32px', alignItems: 'center', marginBottom: '32px' }}>
                {/* Trust Score Gauge */}
                <div style={{ flexShrink: 0, position: 'relative', width: '120px', height: '120px' }}>
                  <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                    <circle cx="50" cy="50" r="45" fill="none" stroke="#111" strokeWidth="6" />
                    <circle
                      cx="50" cy="50" r="45" fill="none"
                      stroke={audit.trustScore >= 80 ? '#4ade80' : audit.trustScore >= 60 ? '#fbbf24' : audit.trustScore >= 40 ? '#fb923c' : '#f87171'}
                      strokeWidth="6" strokeLinecap="round"
                      strokeDasharray="283"
                      strokeDashoffset={283 - (283 * audit.trustScore / 100)}
                      style={{ animation: 'scoreReveal 1s ease forwards' }}
                    />
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{
                      fontSize: '28px', fontWeight: 900, letterSpacing: '-1px',
                      color: audit.trustScore >= 80 ? '#4ade80' : audit.trustScore >= 60 ? '#fbbf24' : audit.trustScore >= 40 ? '#fb923c' : '#f87171',
                    }}>
                      {audit.trustScore}
                    </div>
                    <div style={{ fontSize: '8px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>Trust Score</div>
                  </div>
                </div>

                {/* Stats bar */}
                <div style={{ flex: 1 }}>
                  <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', marginBottom: '6px' }}>{audit.documentTitle}</h2>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: '11px', color: '#888', lineHeight: 1.8 }}>
                    <span><strong style={{ color: '#fff' }}>{audit.stats.totalClaims}</strong> claims extracted</span>
                    <span>·</span>
                    <span><strong style={{ color: '#4ade80' }}>{audit.stats.supported}</strong> verified</span>
                    {audit.stats.critical > 0 && <><span>·</span><span><strong style={{ color: '#f87171' }}>{audit.stats.critical}</strong> critical</span></>}
                    {audit.stats.high > 0 && <><span>·</span><span><strong style={{ color: '#fb923c' }}>{audit.stats.high}</strong> high</span></>}
                    {audit.stats.stale > 0 && <><span>·</span><span>{audit.stats.stale} stale</span></>}
                    {audit.stats.mathErrors > 0 && <><span>·</span><span>{audit.stats.mathErrors} math errors</span></>}
                    {audit.stats.citationMismatches > 0 && <><span>·</span><span>{audit.stats.citationMismatches} citation mismatches</span></>}
                    {audit.stats.omissions > 0 && <><span>·</span><span>{audit.stats.omissions} omissions</span></>}
                  </div>
                  {/* Severity bar chart */}
                  <div style={{ display: 'flex', gap: '3px', marginTop: '10px', height: '6px', borderRadius: '3px', overflow: 'hidden', backgroundColor: '#111' }}>
                    {audit.stats.supported > 0 && <div style={{ flex: audit.stats.supported, backgroundColor: '#4ade80', animation: 'barGrow 0.6s ease' }} />}
                    {audit.stats.low > 0 && <div style={{ flex: audit.stats.low, backgroundColor: '#888', animation: 'barGrow 0.6s ease 0.1s both' }} />}
                    {audit.stats.medium > 0 && <div style={{ flex: audit.stats.medium, backgroundColor: '#fbbf24', animation: 'barGrow 0.6s ease 0.2s both' }} />}
                    {audit.stats.high > 0 && <div style={{ flex: audit.stats.high, backgroundColor: '#fb923c', animation: 'barGrow 0.6s ease 0.3s both' }} />}
                    {audit.stats.critical > 0 && <div style={{ flex: audit.stats.critical, backgroundColor: '#f87171', animation: 'barGrow 0.6s ease 0.4s both' }} />}
                  </div>
                </div>
              </div>

              {/* ── Filters ─── */}
              {audit.findings.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', color: '#555', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Filter:</span>
                  {/* Severity filters */}
                  {(['all', 'critical', 'high', 'medium', 'low'] as const).map(sev => {
                    const isActive = severityFilter === sev;
                    const count = sev === 'all' ? audit.findings.length : audit.findings.filter(f => f.severity === sev).length;
                    if (sev !== 'all' && count === 0) return null;
                    return (
                      <button key={sev} onClick={() => setSeverityFilter(sev)} style={{
                        padding: '3px 10px', borderRadius: '3px', border: '1px solid',
                        borderColor: isActive ? (sev === 'all' ? '#333' : SEVERITY_CONFIG[sev as Severity]?.border || '#333') : '#1a1a1a',
                        backgroundColor: isActive ? '#111' : 'transparent',
                        color: isActive ? (sev === 'all' ? '#fff' : SEVERITY_CONFIG[sev as Severity]?.color || '#fff') : '#555',
                        fontSize: '9px', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase',
                      }}>
                        {sev === 'all' ? `All (${count})` : `${sev} (${count})`}
                      </button>
                    );
                  })}
                  <span style={{ color: '#1a1a1a' }}>|</span>
                  {/* Type filters */}
                  {(['all', ...Object.keys(ISSUE_TYPE_LABELS)] as const).map(t => {
                    const isActive = typeFilter === t;
                    const count = t === 'all' ? audit.findings.length : audit.findings.filter(f => f.issueType === t).length;
                    if (t !== 'all' && count === 0) return null;
                    return (
                      <button key={t} onClick={() => setTypeFilter(t as any)} style={{
                        padding: '3px 8px', borderRadius: '3px', border: '1px solid',
                        borderColor: isActive ? '#333' : '#1a1a1a',
                        backgroundColor: isActive ? '#111' : 'transparent',
                        color: isActive ? '#fff' : '#444',
                        fontSize: '8px', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.3px',
                      }}>
                        {t === 'all' ? 'All Types' : ISSUE_TYPE_LABELS[t as IssueType]} {t !== 'all' && `(${count})`}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ── Findings List ─── */}
              {filteredFindings.length === 0 && audit.findings.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px', color: '#4ade80', fontSize: '14px', fontWeight: 600 }}>
                  No issues found. All claims verified.
                </div>
              )}

              {filteredFindings.length === 0 && audit.findings.length > 0 && (
                <div style={{ textAlign: 'center', padding: '40px', color: '#555', fontSize: '12px' }}>
                  No findings match the current filters.
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filteredFindings.map((finding, idx) => {
                  const sev = SEVERITY_CONFIG[finding.severity];
                  const isExpanded = expandedFinding === finding.id;

                  return (
                    <div
                      key={finding.id}
                      onClick={() => setExpandedFinding(isExpanded ? null : finding.id)}
                      style={{
                        padding: '14px 18px', borderRadius: '6px',
                        border: `1px solid ${sev.border}`,
                        backgroundColor: sev.bg,
                        cursor: 'pointer', transition: 'all 0.15s',
                        animation: `fadeIn 0.3s ease ${idx * 0.05}s both`,
                      }}
                    >
                      {/* Compact view */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                        {/* Severity badge */}
                        <span style={{
                          flexShrink: 0, padding: '2px 8px', borderRadius: '3px',
                          fontSize: '9px', fontWeight: 900, letterSpacing: '0.5px',
                          color: sev.color, border: `1px solid ${sev.border}`,
                          backgroundColor: 'rgba(0,0,0,0.3)',
                        }}>
                          {sev.label}
                        </span>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* Summary line */}
                          <div style={{ fontSize: '12px', color: '#e0e0e0', lineHeight: 1.5, marginBottom: '4px' }}>
                            {finding.summary}
                          </div>
                          {/* Meta line */}
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '9px', color: '#555', fontWeight: 600 }}>{finding.location}</span>
                            <span style={{
                              fontSize: '8px', fontWeight: 700, padding: '1px 6px', borderRadius: '2px',
                              backgroundColor: '#111', color: '#666', border: '1px solid #1a1a1a',
                              textTransform: 'uppercase', letterSpacing: '0.3px',
                            }}>
                              {ISSUE_TYPE_LABELS[finding.issueType]}
                            </span>
                            {finding.confidence && (
                              <span style={{
                                fontSize: '8px', fontWeight: 700,
                                color: finding.confidence === 'high' ? '#4ade80' : finding.confidence === 'medium' ? '#fbbf24' : '#888',
                              }}>
                                {finding.confidence} confidence
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Expand arrow */}
                        <span style={{ fontSize: '10px', color: '#333', flexShrink: 0, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                      </div>

                      {/* Side-by-side comparison (always visible if we have data) */}
                      {finding.documentSays && finding.sourceSays && !isExpanded && (
                        <div style={{ display: 'flex', gap: '12px', marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${sev.border}` }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '8px', fontWeight: 700, color: '#f87171', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Document says</div>
                            <div style={{ fontSize: '11px', color: '#aaa', lineHeight: 1.5 }}>{finding.documentSays.slice(0, 120)}{finding.documentSays.length > 120 ? '...' : ''}</div>
                          </div>
                          <div style={{ width: '1px', backgroundColor: sev.border, flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '8px', fontWeight: 700, color: '#4ade80', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Source says</div>
                            <div style={{ fontSize: '11px', color: '#aaa', lineHeight: 1.5 }}>{finding.sourceSays.slice(0, 120)}{finding.sourceSays.length > 120 ? '...' : ''}</div>
                          </div>
                        </div>
                      )}

                      {finding.delta && !isExpanded && (
                        <div style={{ marginTop: '6px', fontSize: '10px', color: sev.color, fontWeight: 600 }}>
                          Delta: {finding.delta}
                        </div>
                      )}

                      {/* ── Expanded: Deep Dive ─── */}
                      {isExpanded && (
                        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${sev.border}`, animation: 'fadeIn 0.2s ease' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Full side-by-side */}
                          <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                            <div style={{ flex: 1, padding: '12px', borderRadius: '4px', border: '1px solid #3a1a1a', backgroundColor: '#120808' }}>
                              <div style={{ fontSize: '9px', fontWeight: 700, color: '#f87171', marginBottom: '6px', textTransform: 'uppercase' }}>Document says</div>
                              <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.6 }}>{finding.documentSays}</div>
                            </div>
                            <div style={{ flex: 1, padding: '12px', borderRadius: '4px', border: '1px solid #1a3a1a', backgroundColor: '#081208' }}>
                              <div style={{ fontSize: '9px', fontWeight: 700, color: '#4ade80', marginBottom: '6px', textTransform: 'uppercase' }}>Source says</div>
                              <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.6 }}>{finding.sourceSays || 'No direct source quote available'}</div>
                            </div>
                          </div>

                          {finding.delta && (
                            <div style={{ padding: '10px 14px', borderRadius: '4px', border: `1px solid ${sev.border}`, backgroundColor: 'rgba(0,0,0,0.3)', marginBottom: '14px' }}>
                              <span style={{ fontSize: '9px', fontWeight: 700, color: sev.color, textTransform: 'uppercase' }}>Discrepancy: </span>
                              <span style={{ fontSize: '12px', color: '#ccc' }}>{finding.delta}</span>
                            </div>
                          )}

                          {/* Calculation steps for math errors */}
                          {finding.calculationSteps && finding.calculationSteps.length > 0 && (
                            <div style={{ padding: '12px', borderRadius: '4px', border: '1px solid #1a1a1a', backgroundColor: '#050505', marginBottom: '14px' }}>
                              <div style={{ fontSize: '9px', fontWeight: 700, color: '#fff', marginBottom: '8px', textTransform: 'uppercase' }}>Calculation Breakdown</div>
                              {finding.calculationSteps.map((s, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '11px' }}>
                                  <span style={{ color: s.correct ? '#4ade80' : '#f87171', fontWeight: 700, width: '14px' }}>{s.correct ? '✓' : '✗'}</span>
                                  <span style={{ color: '#888', width: '120px' }}>{s.step}</span>
                                  <span style={{ color: s.correct ? '#ccc' : '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Full evidence */}
                          {finding.fullEvidence && (
                            <div style={{ padding: '12px', borderRadius: '4px', border: '1px solid #1a1a1a', backgroundColor: '#050505', marginBottom: '14px' }}>
                              <div style={{ fontSize: '9px', fontWeight: 700, color: '#fff', marginBottom: '8px', textTransform: 'uppercase' }}>Evidence Sources</div>
                              <div style={{ fontSize: '11px', color: '#888', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{finding.fullEvidence}</div>
                            </div>
                          )}

                          {/* Reconciliation */}
                          {finding.reconciliation && (
                            <div style={{
                              padding: '10px 14px', borderRadius: '4px', marginBottom: '14px',
                              border: `1px solid ${finding.reconciliation.accuracy_level === 'true' || finding.reconciliation.accuracy_level === 'essentially_true' ? '#1a3a1a' : '#3a2a1a'}`,
                              backgroundColor: finding.reconciliation.accuracy_level === 'true' || finding.reconciliation.accuracy_level === 'essentially_true' ? '#081208' : '#120808',
                            }}>
                              <div style={{ fontSize: '9px', fontWeight: 700, color: '#888', marginBottom: '4px', textTransform: 'uppercase' }}>Final Assessment</div>
                              <div style={{ fontSize: '11px', color: '#ccc', lineHeight: 1.6 }}>{finding.reconciliation.explanation}</div>
                            </div>
                          )}

                          {/* Source link */}
                          {finding.sourceUrl && (
                            <a href={finding.sourceUrl} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: '10px', color: '#6b9bd2', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {finding.sourceLabel || 'View source'} →
                            </a>
                          )}

                          {/* Downstream effects */}
                          {finding.downstreamEffects && finding.downstreamEffects.length > 0 && (
                            <div style={{ marginTop: '14px', padding: '12px', borderRadius: '4px', border: '1px solid #1a1a1a', backgroundColor: '#050505' }}>
                              <div style={{ fontSize: '9px', fontWeight: 700, color: '#fff', marginBottom: '10px', textTransform: 'uppercase' }}>Downstream Effects</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '10px', fontWeight: 600, color: sev.color, padding: '3px 8px', borderRadius: '3px', border: `1px solid ${sev.border}`, backgroundColor: 'rgba(0,0,0,0.3)' }}>
                                  {finding.location}
                                </span>
                                {finding.downstreamEffects.map((de, i) => (
                                  <React.Fragment key={i}>
                                    <span style={{ fontSize: '10px', color: '#333' }}>→</span>
                                    <span style={{ fontSize: '10px', color: '#888', padding: '3px 8px', borderRadius: '3px', border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a' }}>
                                      {de.label} ({de.location})
                                    </span>
                                  </React.Fragment>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ── New Audit button ─── */}
              <div style={{ marginTop: '32px', textAlign: 'center' }}>
                <button onClick={() => {
                  setAudit({ phase: 'idle', documentTitle: '', documentText: '', trustScore: 0, stats: { ...EMPTY_STATS }, findings: [], progress: { step: '', label: '', current: 0, total: 0 } });
                  setTraceLines([]);
                  setExpandedFinding(null);
                  setSeverityFilter('all');
                  setTypeFilter('all');
                }} style={{
                  padding: '8px 24px', borderRadius: '2px', border: '1px solid #222',
                  backgroundColor: 'transparent', color: '#555', fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                }}>
                  New Audit
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ─── Right: Trace Panel (collapsible) ─── */}
        {showTrace && (
          <div style={{
            width: '320px', flexShrink: 0, borderLeft: '1px solid #111',
            backgroundColor: '#030303', display: 'flex', flexDirection: 'column', overflow: 'hidden',
            animation: 'fadeIn 0.2s ease',
          }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #111', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mission Control</span>
              <span style={{ fontSize: '9px', color: '#333' }}>{traceLines.length} events</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
              {traceLines.map((line, i) => (
                <div key={i} style={{
                  fontSize: '10px', lineHeight: 1.6, padding: '2px 0',
                  color: line.type === 'error' ? '#f87171' : line.type === 'success' ? '#4ade80' : line.type === 'step' ? '#fff' : line.type === 'warning' ? '#fbbf24' : '#555',
                  fontWeight: line.type === 'step' ? 600 : 400,
                  fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                }}>
                  {line.text}
                </div>
              ))}
              <div ref={traceEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentAuditPage;
