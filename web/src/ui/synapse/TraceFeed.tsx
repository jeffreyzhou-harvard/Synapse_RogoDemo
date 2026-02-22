import React from 'react';
import { AGENT_BRAND_COLORS } from './constants';

export interface TraceLine {
  text: string;
  type: string;
  indent: number;
  badge?: string;
}

interface TraceFeedProps {
  traceLines: TraceLine[];
  isVerifying: boolean;
  traceRef: React.RefObject<HTMLDivElement>;
}

const TYPE_CONFIG: Record<string, { color: string; icon: string }> = {
  step:    { color: 'var(--syn-text-heading)', icon: '▸' },
  success: { color: '#6fad8e', icon: '✓' },
  error:   { color: '#c47070', icon: '✗' },
  verdict: { color: 'var(--syn-text-secondary)', icon: '◆' },
  info:    { color: 'var(--syn-text-tertiary)', icon: '·' },
};

const TraceFeed: React.FC<TraceFeedProps> = ({ traceLines, isVerifying, traceRef }) => (
  <div style={{
    width: '300px', flexShrink: 0, borderLeft: '1px solid var(--syn-border)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    backgroundColor: 'var(--syn-bg-sunken)',
  }}>
    <div style={{
      padding: '8px 12px', borderBottom: '1px solid var(--syn-border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span className={isVerifying ? 'syn-dot-pulse' : undefined}
          style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: isVerifying ? 'var(--syn-text-heading)' : 'var(--syn-text-muted)' }}
        />
        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--syn-text-heading)', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Mission Control
        </span>
      </div>
      <span style={{ fontSize: '9px', color: 'var(--syn-text-muted)' }}>{traceLines.length} events</span>
    </div>

    <div ref={traceRef} style={{
      flex: 1, overflow: 'auto', padding: '8px 10px',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: '10px', lineHeight: 1.7,
    }}>
      {traceLines.map((line, i) => {
        if (line.type === 'divider') {
          return <div key={i} style={{ borderTop: '1px solid var(--syn-border)', margin: '6px 0' }} />;
        }
        const cfg = TYPE_CONFIG[line.type] || TYPE_CONFIG.info;
        const badgeInfo = line.badge ? AGENT_BRAND_COLORS[line.badge] : null;
        return (
          <div key={i} className="syn-trace-line"
            style={{ color: cfg.color, paddingLeft: `${line.indent * 12}px` }}
          >
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
);

export default React.memo(TraceFeed);
