import React from 'react';
import type { ExtractedClaim } from './types';
import { VERDICT_COLORS } from './constants';

interface PipelineStats {
  steps: number;
  apiCalls: number;
  services: Set<string>;
  sources: number;
  durationMs: number;
}

interface ClaimsListProps {
  claims: ExtractedClaim[];
  selectedClaimId: string | null;
  isExtracting: boolean;
  doneClaims: number;
  verdictCounts: Record<string, number>;
  pipelineStats: PipelineStats;
  onSelectClaim: (id: string) => void;
  onVerifyClaim: (id: string) => void;
  onVerifyAll: () => void;
  onShareReport: () => void;
}

const CLAIM_TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  financial_metric: { color: '#6fad8e', label: 'Metric' },
  valuation:        { color: '#8a7ab5', label: 'Valuation' },
  transaction:      { color: '#7090aa', label: 'Transaction' },
  regulatory:       { color: '#a89050', label: 'Regulatory' },
  guidance:         { color: '#b09555', label: 'Guidance' },
};

const ClaimsList: React.FC<ClaimsListProps> = ({
  claims, selectedClaimId, isExtracting, doneClaims, verdictCounts,
  pipelineStats, onSelectClaim, onVerifyClaim, onVerifyAll, onShareReport,
}) => {
  const hasPending = claims.some(c => c.status === 'pending');

  return (
    <div style={{
      width: '320px', flexShrink: 0, borderRight: '1px solid #1a1a1a',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid #1a1a1a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Claims {claims.length > 0 && `(${claims.length})`}
        </div>
        {claims.length > 0 && hasPending && (
          <button className="syn-btn" onClick={onVerifyAll}
            style={{ padding: '3px 10px', borderRadius: '5px', borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.05)', color: '#fff', fontWeight: 700 }}>
            Verify All
          </button>
        )}
        {claims.length > 0 && doneClaims > 0 && (
          <button className="syn-btn-primary" onClick={onShareReport}
            style={{ padding: '3px 10px', borderRadius: '5px', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Share
          </button>
        )}
      </div>

      {/* Summary stats */}
      {doneClaims > 0 && !claims.some(c => c.status === 'verifying') && (
        <div style={{
          margin: '6px', padding: '10px 12px', borderRadius: '8px',
          border: '1px solid #1a1a1a', backgroundColor: '#0a0a0a',
        }} className="syn-fade">
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#fff', marginBottom: '6px' }}>
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
                  <span style={{ color: '#555' }}>{v.replace('_', ' ')}</span>
                </div>
              );
            })}
          </div>
          {pipelineStats.sources > 0 && (
            <div className="syn-mono" style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #1a1a1a', display: 'flex', gap: '8px', fontSize: '9px', color: '#444' }}>
              <span>{pipelineStats.sources} sources</span>
              {pipelineStats.durationMs > 0 && <span>{(pipelineStats.durationMs / 1000).toFixed(1)}s</span>}
            </div>
          )}
        </div>
      )}

      {/* Claim cards */}
      <div style={{ flex: 1, overflow: 'auto', padding: '6px' }}>
        {isExtracting && (
          <div style={{ padding: '32px', textAlign: 'center' }} className="syn-fade">
            <div className="syn-spinner" style={{ margin: '0 auto 10px' }} />
            <div style={{ fontSize: '11px', color: '#555' }}>Extracting claims...</div>
          </div>
        )}

        {claims.map((claim, i) => {
          const isSelected = claim.id === selectedClaimId;
          const vc = claim.verification?.overallVerdict
            ? VERDICT_COLORS[claim.verification.overallVerdict.verdict] || VERDICT_COLORS.unsupported
            : null;
          const tc = CLAIM_TYPE_CONFIG[claim.type] || { color: '#555', label: claim.type };

          return (
            <div key={claim.id}
              role="button"
              tabIndex={0}
              className={`syn-card ${isSelected ? 'selected' : ''}`}
              onClick={() => {
                onSelectClaim(claim.id);
                if (claim.status === 'pending') onVerifyClaim(claim.id);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectClaim(claim.id);
                  if (claim.status === 'pending') onVerifyClaim(claim.id);
                }
              }}
              style={{
                borderLeft: `3px solid ${vc?.text || (claim.status === 'verifying' ? '#fff' : '#1a1a1a')}`,
                borderColor: isSelected ? (vc?.border || '#333') : undefined,
                backgroundColor: isSelected ? (vc?.bg || '#111') : vc ? `${vc.bg}` : undefined,
                boxShadow: isSelected ? `0 0 16px ${vc?.glow || 'rgba(0,0,0,0.3)'}` : 'none',
                animation: `syn-slide-in 0.3s ease ${i * 0.05}s both`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                {claim.status === 'verifying' && <span className="syn-dot-pulse" />}
                <span style={{
                  fontSize: '8px', fontWeight: 700, color: tc.color, textTransform: 'uppercase',
                  letterSpacing: '0.5px', padding: '1px 5px', borderRadius: '3px',
                  backgroundColor: `${tc.color}15`, border: `1px solid ${tc.color}30`,
                }}>{tc.label}</span>
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
              <div style={{ fontSize: '12px', color: '#ccc', lineHeight: 1.45 }}>
                {claim.original.length > 120 ? claim.original.slice(0, 120) + '...' : claim.original}
              </div>
              {claim.location_str && (
                <div className="syn-mono" style={{ fontSize: '9px', color: '#555', marginTop: '4px' }}>
                  {claim.location_str}
                </div>
              )}
              {claim.status === 'pending' && (
                <div style={{ fontSize: '9px', color: '#555', marginTop: '4px' }}>Click to verify</div>
              )}
              {claim.status === 'error' && (
                <div style={{ fontSize: '9px', color: '#c47070', marginTop: '4px' }}>
                  Verification failed — click to retry
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(ClaimsList);
