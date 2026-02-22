import React, { useRef } from 'react';
import { API_BASE, PRELOADED_EXAMPLES } from './constants';

interface PipelineStats {
  steps: number;
  apiCalls: number;
  services: Set<string>;
  sources: number;
  durationMs: number;
}

interface InputBarProps {
  inputValue: string;
  setInputValue: (v: string) => void;
  inputMode: 'url' | 'text';
  setInputMode: (m: 'url' | 'text') => void;
  isIngesting: boolean;
  isExtracting: boolean;
  hasClaims: boolean;
  inputCollapsed: boolean;
  ingestedTitle: string;
  inputRef: string;
  onIngest: () => void;
  onDocUpload: (file: File) => void;
  onNewAnalysis: () => void;
  onShareReport: () => void;
  onExportAudit: () => void;
  doneClaims: number;
  pipelineStats: PipelineStats;
  reportId: string | null;
  onShareTwitter: () => void;
  onViewReport: () => void;
  financialClaims: any[];
}

const InputBar: React.FC<InputBarProps> = ({
  inputValue, setInputValue, inputMode, setInputMode,
  isIngesting, isExtracting, hasClaims, inputCollapsed,
  ingestedTitle, inputRef, onIngest, onDocUpload, onNewAnalysis,
  onShareReport, onExportAudit, doneClaims, pipelineStats,
  reportId, onShareTwitter, onViewReport, financialClaims,
}) => {
  const docInputRef = useRef<HTMLInputElement>(null);

  if (inputCollapsed) {
    return (
      <>
        <div style={{
          padding: '4px 16px', borderBottom: '1px solid #1a1a1a', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: '#0a0a0a',
        }}>
          <span style={{ fontSize: '11px', color: '#555' }}>Analyzing:</span>
          <span style={{ fontSize: '11px', color: '#999', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ingestedTitle || inputRef.slice(0, 80)}
          </span>
          <button className="syn-btn-ghost" onClick={onNewAnalysis}
            style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '10px', fontWeight: 600 }}>
            New Analysis
          </button>
        </div>

        {doneClaims > 0 && (
          <div style={{
            padding: '4px 16px', borderBottom: '1px solid #1a1a1a', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#050505',
          }} className="syn-fade">
            <span className="syn-mono" style={{ fontSize: '10px', color: '#555', fontWeight: 600 }}>
              {doneClaims} claims · {pipelineStats.apiCalls} API calls · {pipelineStats.services.size} services
              {pipelineStats.durationMs > 0 && ` · ${(pipelineStats.durationMs / 1000).toFixed(0)}s`}
            </span>
            <div style={{ flex: 1 }} />
            <button className="syn-btn-primary" onClick={onShareReport}
              style={{ padding: '5px 14px', borderRadius: '5px', fontSize: '10px' }}>
              Share Report
            </button>
            <button className="syn-btn-success" onClick={onExportAudit}
              style={{ padding: '5px 14px', borderRadius: '5px', fontSize: '10px' }}>
              Export Audit Log
            </button>
            {reportId && (
              <button className="syn-btn-ghost" onClick={onShareTwitter}
                style={{ padding: '5px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 700 }}>
                Share
              </button>
            )}
            {reportId && (
              <button className="syn-btn-ghost" onClick={onViewReport}
                style={{ padding: '5px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 700 }}>
                View Report
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  const showHero = !hasClaims && !isIngesting && !isExtracting;

  return (
    <div style={{
      padding: hasClaims ? '12px 24px' : '24px 32px',
      borderBottom: '1px solid #1a1a1a', background: '#000',
      transition: 'padding 0.3s ease', flexShrink: 0,
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        {showHero && (
          <div style={{ marginBottom: '24px' }} className="syn-fade">
            {/* Hero */}
            <div style={{ textAlign: 'center', marginBottom: '28px' }}>
              <h1 style={{ fontSize: '28px', fontWeight: 300, color: '#fff', marginBottom: '12px', letterSpacing: '-0.3px', lineHeight: 1.35 }}>
                Independent verification for every<br />
                claim in financial AI output
              </h1>
              <p style={{ fontSize: '13px', color: '#555', maxWidth: '480px', margin: '0 auto', lineHeight: 1.7, fontWeight: 400 }}>
                12-stage pipeline. Entity resolution. Financial normalization.
                Peer benchmarking. Materiality scoring. Risk signal extraction.
              </p>
            </div>

            {/* Pipeline strip */}
            <div className="syn-mono" style={{
              maxWidth: '700px', margin: '0 auto 28px', padding: '16px 20px',
              border: '1px solid #141414', borderRadius: '2px', backgroundColor: '#050505',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 0' }}>
                {['ingest', 'extract', 'resolve', 'normalize', 'retrieve', 'evaluate',
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
                <span style={{ fontSize: '8px', color: '#2a2a2a' }}>SEC EDGAR · XBRL · Earnings · FRED · Market Data · Adversarial Search</span>
                <span style={{ fontSize: '8px', color: '#2a2a2a' }}>materiality · authority hierarchy · peer benchmarks</span>
              </div>
            </div>

            {/* Input area */}
            <div style={{ maxWidth: '600px', margin: '0 auto', marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '0', marginBottom: '6px' }}>
                {(['url', 'text'] as const).map(mode => (
                  <button key={mode} onClick={() => setInputMode(mode)}
                    className={`syn-mode-btn ${inputMode === mode ? 'active' : ''}`}>
                    {mode}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0', alignItems: 'stretch' }}>
                {inputMode === 'url' ? (
                  <input value={inputValue} onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && onIngest()}
                    placeholder="SEC filing URL, earnings call, analyst report, news article..."
                    className="syn-input syn-mono"
                    style={{ borderRadius: '2px 0 0 2px' }}
                  />
                ) : (
                  <textarea value={inputValue} onChange={e => setInputValue(e.target.value)}
                    placeholder="Paste financial text, earnings commentary, CIM excerpt, or claims to verify..."
                    rows={3}
                    className="syn-textarea"
                    style={{ borderRadius: '2px 0 0 2px' }}
                  />
                )}
                <button data-ingest-btn onClick={onIngest} disabled={isIngesting || isExtracting || !inputValue.trim()}
                  className="syn-btn-primary"
                  style={{
                    padding: '11px 20px', borderRadius: '0 2px 2px 0', borderLeft: 'none',
                    fontSize: '11px', letterSpacing: '0.5px', textTransform: 'uppercase',
                  }}>
                  {isIngesting ? '...' : 'Verify'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px', justifyContent: 'center' }}>
                <button className="syn-btn-ghost" onClick={() => docInputRef.current?.click()}
                  style={{ padding: '5px 12px', borderRadius: '2px', letterSpacing: '0.3px' }}>
                  Upload PDF / PPTX / DOCX
                </button>
              </div>
            </div>

            {/* Example claims */}
            <div style={{ maxWidth: '600px', margin: '0 auto' }}>
              <div className="syn-section-header" style={{ marginBottom: '8px', letterSpacing: '1.5px' }}>
                Sample verifications
              </div>
              <div style={{ border: '1px solid #141414', borderRadius: '2px', overflow: 'hidden' }}>
                {PRELOADED_EXAMPLES.map((ex, i) => {
                  const statusColor = ex.verdict === 'supported' ? '#4ade80'
                    : ex.verdict === 'contradicted' ? '#ef4444'
                    : ex.verdict === 'mixed' ? '#888' : '#666';
                  return (
                    <button key={i} onClick={() => { setInputMode('text'); setInputValue(ex.claim); }}
                      className="syn-example-row"
                      style={{ borderBottom: i < PRELOADED_EXAMPLES.length - 1 ? '1px solid #111' : 'none' }}
                    >
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: statusColor, flexShrink: 0, opacity: 0.8 }} />
                      <div style={{ flex: 1, fontSize: '11px', color: '#777', lineHeight: 1.4, minWidth: 0 }}>
                        {ex.claim}
                      </div>
                      <div className="syn-mono" style={{ fontSize: '8px', fontWeight: 700, color: '#444', letterSpacing: '0.5px', textTransform: 'uppercase', flexShrink: 0 }}>
                        {ex.tag}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Compact input bar when claims are loaded */}
        {(hasClaims || isIngesting || isExtracting) && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
              {(['url', 'text'] as const).map((mode, idx) => (
                <button key={mode} onClick={() => setInputMode(mode)}
                  className={`syn-mode-btn ${inputMode === mode ? 'active' : ''}`}
                  style={{
                    flex: 1, padding: '6px 10px',
                    borderRadius: idx === 0 ? '2px 0 0 0' : '0 0 0 2px',
                    borderColor: inputMode === mode ? '#fff' : '#1a1a1a',
                    backgroundColor: inputMode === mode ? 'rgba(255,255,255,0.05)' : 'transparent',
                    color: inputMode === mode ? '#fff' : '#555',
                  }}>
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
            {inputMode === 'url' ? (
              <input value={inputValue} onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onIngest()}
                placeholder="Paste a URL..."
                className="syn-input syn-mono"
                style={{ padding: '10px 14px', borderRadius: '0', color: '#fff', fontSize: '13px' }}
              />
            ) : (
              <textarea value={inputValue} onChange={e => setInputValue(e.target.value)}
                placeholder="Paste text containing claims..."
                rows={2}
                className="syn-textarea"
                style={{ padding: '10px 14px', borderRadius: '0', color: '#fff', fontSize: '13px' }}
              />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
              <button data-ingest-btn onClick={onIngest} disabled={isIngesting || isExtracting || !inputValue.trim()}
                className="syn-btn-primary"
                style={{ flex: 1, padding: '10px 18px', borderRadius: '0 2px 0 0', fontSize: '12px' }}>
                {isIngesting ? '...' : 'Verify'}
              </button>
              <button className="syn-btn-ghost" onClick={() => docInputRef.current?.click()}
                style={{ padding: '6px 10px', borderRadius: '0', fontSize: '10px', fontWeight: 600 }}>
                File
              </button>
            </div>
          </div>
        )}

        <input ref={docInputRef} type="file" accept=".pdf,.pptx,.docx,.doc"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onDocUpload(f); e.target.value = ''; }}
        />
      </div>
    </div>
  );
};

export default React.memo(InputBar);
