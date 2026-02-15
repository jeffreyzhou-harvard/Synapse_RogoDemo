import React, { useRef, useState } from 'react';

export type SelectionAction = 'evidence' | 'challenge' | 'eli5' | 'steelman' | 'socratic' | 'connect' | 'deep-dive';

interface AgentDef {
  id: SelectionAction;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
  color: string;
}

const AGENTS: AgentDef[] = [
  { id: 'evidence',  label: 'Find Evidence', shortLabel: 'Evidence',  icon: '🔍', description: 'Find supporting & contradicting evidence', color: '#4299e1' },
  { id: 'challenge', label: 'Challenge',     shortLabel: 'Challenge', icon: '⚔️',  description: "Devil's advocate — attack this idea",      color: '#e53e3e' },
  { id: 'eli5',      label: 'Simplify',      shortLabel: 'Simplify',  icon: '💡', description: 'Explain like I\'m 5',                      color: '#ecc94b' },
  { id: 'steelman',  label: 'Steelman',      shortLabel: 'Steelman', icon: '🛡️',  description: 'Make this argument stronger',              color: '#48bb78' },
  { id: 'socratic',  label: 'Ask Me',        shortLabel: 'Ask Me',   icon: '🤔', description: 'Socratic questions — no answers, just Qs', color: '#9f7aea' },
  { id: 'connect',   label: 'Connect',       shortLabel: 'Connect',  icon: '🔗', description: 'Analyze relationship between two blocks',  color: '#ed8936' },
  { id: 'deep-dive', label: 'Deep Dive',     shortLabel: 'Deep Dive', icon: '🔬', description: 'Multi-step research — papers, gaps, synthesis', color: '#7c3aed' },
];

interface SelectionToolbarProps {
  selectedText: string;
  position: { top: number; left: number } | null;
  onAction: (action: SelectionAction, text: string) => void;
  onDismiss: () => void;
  hasSecondSelection?: boolean;
}

const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  selectedText,
  position,
  onAction,
  onDismiss,
  hasSecondSelection = false,
}) => {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (!position || !selectedText) return null;

  return (
    <div
      ref={toolbarRef}
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: '0',
        padding: '3px 4px',
        backgroundColor: '#111827',
        borderRadius: '10px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08)',
        animation: 'toolbarFadeIn 0.15s ease-out',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <style>{`
        @keyframes toolbarFadeIn {
          from { opacity: 0; transform: translateY(4px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      {AGENTS.map((agent, idx) => {
        const isHovered = hoveredId === agent.id;

        return (
          <div key={agent.id} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            {idx > 0 && <div style={{ width: '1px', height: '16px', backgroundColor: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />}
            <button
              onClick={() => {
                onAction(agent.id, selectedText);
                onDismiss();
              }}
              onMouseEnter={() => setHoveredId(agent.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 10px',
                border: 'none',
                backgroundColor: isHovered ? '#1f2937' : 'transparent',
                color: isHovered ? agent.color : '#d1d5db',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                borderRadius: '7px',
                transition: 'all 0.12s ease',
                whiteSpace: 'nowrap',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              <span style={{ fontSize: '13px', lineHeight: 1 }}>{agent.icon}</span>
              <span>{agent.id === 'connect' && hasSecondSelection ? 'Connect!' : agent.shortLabel}</span>
            </button>
            {/* Tooltip */}
            {isHovered && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: '6px',
                  padding: '5px 10px',
                  backgroundColor: '#1f2937',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: '#9ca3af',
                  fontSize: '11px',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  zIndex: 1001,
                  animation: 'toolbarFadeIn 0.1s ease-out',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
              >
                {agent.description}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SelectionToolbar;
