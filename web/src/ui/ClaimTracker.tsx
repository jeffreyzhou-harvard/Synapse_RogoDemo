import React, { useMemo } from 'react';
import { parseSections } from './sectionUtils';
import { EvidenceResult } from './CitationsPanel';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TrackedClaim {
  text: string;
  section: string;
  status: 'verified' | 'challenged' | 'unverified';
  hasFootnote: boolean;
}

interface ClaimTrackerProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  citationResults: EvidenceResult[];
  footnotes: string[];
  onFindEvidence: (claim: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Sections where claims need citations
const CLAIM_SECTIONS = ['introduction', 'literature review', 'results', 'discussion', 'background', 'analysis'];

function extractClaims(content: string): TrackedClaim[] {
  const sections = parseSections(content);
  const claims: TrackedClaim[] = [];

  // Collect all verified/challenged claims from evidence results
  // (we'll match later)

  for (const section of sections) {
    const sectionLower = section.heading.toLowerCase();
    const isClaimSection = CLAIM_SECTIONS.some(s => sectionLower.includes(s));
    if (!isClaimSection || !section.text.trim()) continue;

    // Split into sentences
    const sentences = section.text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 30); // ignore very short fragments

    for (const sentence of sentences) {
      // Check if it has a footnote marker [N]
      const hasFootnote = /\[\d+\]/.test(sentence);
      // Check if it has an inline citation (Author, Year) or (Author Year)
      const hasInlineCite = /\([A-Z][a-z]+.*?\d{4}\)/.test(sentence) || /\([A-Z][a-z]+\)/.test(sentence);

      if (hasFootnote || hasInlineCite) {
        claims.push({ text: sentence, section: section.heading, status: 'verified', hasFootnote });
      } else {
        // It's a claim-like statement without citation
        claims.push({ text: sentence, section: section.heading, status: 'unverified', hasFootnote: false });
      }
    }
  }

  return claims;
}

// ── Component ────────────────────────────────────────────────────────────────

const ClaimTracker: React.FC<ClaimTrackerProps> = ({
  isOpen, onClose, content, citationResults, footnotes, onFindEvidence,
}) => {
  const claims = useMemo(() => extractClaims(content), [content]);

  // Mark challenged claims
  const challengedTexts = useMemo(() => {
    const set = new Set<string>();
    citationResults.forEach(r => {
      if (r.verdict === 'weak' || r.verdict === 'unsupported' || r.verdict === 'debated') {
        set.add(r.highlightedText.slice(0, 50));
      }
    });
    return set;
  }, [citationResults]);

  // Update claim statuses based on evidence results
  const enrichedClaims = useMemo(() => {
    return claims.map(c => {
      // Check if this claim was challenged
      for (const key of challengedTexts) {
        if (c.text.includes(key) || key.includes(c.text.slice(0, 40))) {
          return { ...c, status: 'challenged' as const };
        }
      }
      return c;
    });
  }, [claims, challengedTexts]);

  const verified = enrichedClaims.filter(c => c.status === 'verified');
  const unverified = enrichedClaims.filter(c => c.status === 'unverified');
  const challenged = enrichedClaims.filter(c => c.status === 'challenged');

  const totalClaims = enrichedClaims.length;
  const verifiedPct = totalClaims > 0 ? Math.round((verified.length / totalClaims) * 100) : 0;

  const statusConfig = {
    verified:   { color: '#059669', bg: '#ecfdf5', icon: '✓', label: 'Cited' },
    challenged: { color: '#dc2626', bg: '#fef2f2', icon: '⚠', label: 'Challenged' },
    unverified: { color: '#d97706', bg: '#fffbeb', icon: '○', label: 'Needs Citation' },
  };

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, width: '320px', height: '100vh',
      backgroundColor: '#fff', borderLeft: '1px solid #e5e7eb', zIndex: 45,
      display: 'flex', flexDirection: 'column',
      transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.25s ease',
      boxShadow: isOpen ? '-4px 0 24px rgba(0,0,0,0.06)' : 'none',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>📋</span>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a202c' }}>Claim Tracker</span>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', color: '#9ca3af', padding: '2px 6px', borderRadius: '4px' }}>×</button>
        </div>

        {/* Progress bar */}
        {totalClaims > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
              <span>{verified.length} of {totalClaims} claims cited</span>
              <span>{verifiedPct}%</span>
            </div>
            <div style={{ height: '6px', backgroundColor: '#f3f4f6', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${verifiedPct}%`, backgroundColor: '#059669', borderRadius: '3px', transition: 'width 0.3s ease' }} />
            </div>
            {/* Summary pills */}
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
              <span style={{ fontSize: '11px', color: '#059669', backgroundColor: '#ecfdf5', padding: '2px 8px', borderRadius: '4px', fontWeight: 500 }}>
                ✓ {verified.length} cited
              </span>
              {unverified.length > 0 && (
                <span style={{ fontSize: '11px', color: '#d97706', backgroundColor: '#fffbeb', padding: '2px 8px', borderRadius: '4px', fontWeight: 500 }}>
                  ○ {unverified.length} need citation
                </span>
              )}
              {challenged.length > 0 && (
                <span style={{ fontSize: '11px', color: '#dc2626', backgroundColor: '#fef2f2', padding: '2px 8px', borderRadius: '4px', fontWeight: 500 }}>
                  ⚠ {challenged.length} challenged
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Claims list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
        {totalClaims === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: '#9ca3af' }}>
            <div style={{ fontSize: '28px', marginBottom: '10px', opacity: 0.5 }}>📋</div>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#6b7280', marginBottom: '4px' }}>No claims detected</div>
            <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
              Write content in your paper sections (Introduction, Literature Review, etc.) and claims will be tracked here.
            </div>
          </div>
        ) : (
          <>
            {/* Unverified first */}
            {unverified.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', padding: '0 4px' }}>
                  Needs Citation ({unverified.length})
                </div>
                {unverified.map((claim, i) => (
                  <ClaimCard key={`u-${i}`} claim={claim} config={statusConfig[claim.status]} onFindEvidence={onFindEvidence} />
                ))}
              </div>
            )}

            {/* Challenged */}
            {challenged.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', padding: '0 4px' }}>
                  Challenged ({challenged.length})
                </div>
                {challenged.map((claim, i) => (
                  <ClaimCard key={`c-${i}`} claim={claim} config={statusConfig[claim.status]} onFindEvidence={onFindEvidence} />
                ))}
              </div>
            )}

            {/* Verified */}
            {verified.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', padding: '0 4px' }}>
                  Cited ({verified.length})
                </div>
                {verified.map((claim, i) => (
                  <ClaimCard key={`v-${i}`} claim={claim} config={statusConfig[claim.status]} onFindEvidence={onFindEvidence} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ── Claim Card ───────────────────────────────────────────────────────────────

const ClaimCard: React.FC<{
  claim: TrackedClaim;
  config: { color: string; bg: string; icon: string; label: string };
  onFindEvidence: (text: string) => void;
}> = ({ claim, config, onFindEvidence }) => (
  <div style={{
    padding: '8px 10px', marginBottom: '4px', borderRadius: '6px',
    border: '1px solid #f0f0f0', backgroundColor: '#fff', fontSize: '12px',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
      <span style={{ fontSize: '11px', fontWeight: 600, color: config.color, backgroundColor: config.bg, padding: '1px 6px', borderRadius: '3px' }}>
        {config.icon} {config.label}
      </span>
      <span style={{ fontSize: '10px', color: '#c4c4c4' }}>{claim.section}</span>
    </div>
    <div style={{ color: '#374151', lineHeight: 1.4, marginBottom: '4px' }}>
      {claim.text.length > 120 ? claim.text.slice(0, 120) + '...' : claim.text}
    </div>
    {claim.status !== 'verified' && (
      <button
        onClick={() => onFindEvidence(claim.text)}
        style={{
          fontSize: '10px', padding: '2px 8px', border: '1px solid #3b82f6',
          borderRadius: '4px', backgroundColor: '#eff6ff', color: '#1d4ed8',
          cursor: 'pointer', fontWeight: 500,
        }}
      >
        🔍 Find Evidence
      </button>
    )}
  </div>
);

export default ClaimTracker;
