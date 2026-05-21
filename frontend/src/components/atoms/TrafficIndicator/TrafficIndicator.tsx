import React from 'react';

export interface TrafficIndicatorProps {
  direction: 'rx' | 'tx';
  rate: number;
  active: boolean;
}

const TRAFFIC_THRESHOLD = 1024;

export const TrafficIndicator: React.FC<TrafficIndicatorProps> = ({ direction, rate, active }) => {
  const color = direction === 'rx' ? '0, 255, 136' : '0, 136, 255';
  const hasSignificantTraffic = rate > TRAFFIC_THRESHOLD;

  if (!active) {
    return (
      <div style={{ display: 'inline-flex', gap: '3px', marginRight: '8px' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ width: '18px', height: '18px', borderRadius: '3px', opacity: 0.2, backgroundColor: '#555' }} />
        ))}
      </div>
    );
  }

  if (!hasSignificantTraffic) {
    return (
      <div style={{ display: 'inline-flex', gap: '3px', marginRight: '8px' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ width: '18px', height: '18px', borderRadius: '3px', opacity: 0.6, backgroundColor: `rgb(${color})`, boxShadow: `0 0 4px rgba(${color}, 0.3)` }} />
        ))}
      </div>
    );
  }

  const duration = rate > 10_000_000 ? 600 : rate > 1_000_000 ? 1000 : 1600;
  const scale = rate > 10_000_000 ? 1.6 : rate > 1_000_000 ? 1.4 : 1.2;
  const delays = [0, duration * 0.25, duration * 0.5, duration * 0.75];

  return (
    <div style={{ display: 'inline-flex', gap: '3px', marginRight: '8px' }}>
      {delays.map((delay, i) => (
        <div key={i} style={{
          width: '18px', height: '18px', borderRadius: '3px',
          backgroundColor: `rgb(${color})`, boxShadow: `0 0 6px rgba(${color}, 0.4)`,
          animation: `pulse ${duration}ms ease-in-out infinite`, animationDelay: `${delay}ms`,
          '--scale': scale.toString()
        } as React.CSSProperties} />
      ))}
    </div>
  );
};
