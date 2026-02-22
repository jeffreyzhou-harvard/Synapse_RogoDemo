import React, { useRef, useMemo, useState, useEffect } from 'react';
import { API_BASE, PRELOADED_EXAMPLES } from './constants';

interface IndexData {
  symbol: string;
  name: string;
  short: string;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  sparkline: number[];
}

const Sparkline: React.FC<{ data: number[]; positive: boolean }> = ({ data, positive }) => {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 28;
  const w = 80;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  const color = positive ? '#6fad8e' : '#c47070';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ flexShrink: 0 }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

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
  const [marketData, setMarketData] = useState<IndexData[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/market-overview`)
      .then(r => r.json())
      .then(d => { if (d.indices?.length) setMarketData(d.indices); })
      .catch(() => {});
  }, []);

  if (inputCollapsed) {
    return (
      <>
        <div style={{
          padding: '4px 16px', borderBottom: '1px solid #1a1a1a', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: '#0a0a0a',
        }}>
          <span style={{ fontSize: '11px', color: 'var(--syn-text-muted)' }}>Analyzing:</span>
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
            display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--syn-bg-sunken)',
          }} className="syn-fade">
            <span className="syn-mono" style={{ fontSize: '10px', color: 'var(--syn-text-muted)', fontWeight: 600 }}>
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
              <p style={{ fontSize: '13px', color: 'var(--syn-text-muted)', maxWidth: '480px', margin: '0 auto', lineHeight: 1.7, fontWeight: 400 }}>
                12-stage pipeline. Entity resolution. Financial normalization.
                Peer benchmarking. Materiality scoring. Risk signal extraction.
              </p>
            </div>

            {/* Market Overview */}
            {marketData.length > 0 && (
              <div style={{
                maxWidth: '760px', margin: '0 auto 24px',
                display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap',
              }} className="syn-fade">
                <div className="syn-section-header" style={{
                  width: '100%', textAlign: 'center', marginBottom: '4px', letterSpacing: '1.5px',
                }}>Index Movement</div>
                {marketData.map(idx => {
                  const positive = (idx.change_pct ?? 0) >= 0;
                  return (
                    <div key={idx.symbol} style={{
                      flex: '1 1 140px', maxWidth: '180px',
                      padding: '10px 12px', borderRadius: '8px',
                      border: '1px solid var(--syn-border)',
                      backgroundColor: 'var(--syn-bg-raised)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--syn-text-secondary)' }}>{idx.short}</span>
                        <span style={{
                          fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '2px',
                          color: positive ? '#6fad8e' : '#c47070',
                        }}>
                          <span style={{ fontSize: '8px' }}>{positive ? '↗' : '↘'}</span>
                          {Math.abs(idx.change_pct ?? 0).toFixed(2)}%
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '6px' }}>
                        <div>
                          <div className="syn-mono" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--syn-text-heading)', lineHeight: 1.2 }}>
                            {idx.price != null ? idx.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                          </div>
                          <div className="syn-mono" style={{ fontSize: '9px', color: positive ? '#6fad8e' : '#c47070', marginTop: '2px' }}>
                            {positive ? '+' : ''}{idx.change != null ? idx.change.toFixed(2) : '—'}
                          </div>
                        </div>
                        <Sparkline data={idx.sparkline} positive={positive} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pipeline strip */}
            <div className="syn-mono" style={{
              maxWidth: '700px', margin: '0 auto 28px', padding: '16px 20px',
              border: '1px solid var(--syn-border-subtle)', borderRadius: '2px', backgroundColor: 'var(--syn-bg-sunken)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 0' }}>
                {['ingest', 'extract', 'resolve', 'normalize', 'retrieve', 'evaluate',
                  'contradict', 'consistency', 'plausibility', 'synthesize', 'trace', 'risk',
                ].map((step, i, arr) => (
                  <React.Fragment key={step}>
                    <div style={{ fontSize: '8px', fontWeight: 600, color: 'var(--syn-text-muted)', letterSpacing: '0.3px' }}>{step}</div>
                    {i < arr.length - 1 && (
                      <div style={{ color: 'var(--syn-border)', fontSize: '7px', flexShrink: 0, padding: '0 1px' }}>{'\u2192'}</div>
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
              <div style={{ border: '1px solid var(--syn-border-subtle)', borderRadius: '2px', overflow: 'hidden' }}>
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
