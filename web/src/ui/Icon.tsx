import React from 'react';

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}

const Icon: React.FC<IconProps> = ({ name, size = 16, color = 'currentColor', style }) => {
  return (
    <img
      src={`/icon-${name}.svg`}
      alt={name}
      width={size}
      height={size}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        color: color,
        ...style
      }}
      onError={(e) => {
        console.error(`Failed to load icon: icon-${name}.svg`);
        // Fallback to a simple colored square if icon fails to load
        const target = e.target as HTMLImageElement;
        target.style.display = 'none';
        const fallback = document.createElement('div');
        fallback.style.width = `${size}px`;
        fallback.style.height = `${size}px`;
        fallback.style.backgroundColor = color === 'currentColor' ? '#666' : color;
        fallback.style.display = 'inline-block';
        fallback.style.borderRadius = '2px';
        target.parentNode?.insertBefore(fallback, target);
      }}
    />
  );
};

export default Icon;