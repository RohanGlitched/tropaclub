// Line glyphs for the navigation, drawn on a 20-unit grid in currentColor. Decorative only:
// every control that uses one carries its own accessible name.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

export type Glyph = 'search' | 'map' | 'home' | 'seat' | 'clubs' | 'league' | 'up' | 'ext' | 'page' | 'ticket' | 'recent' | 'stats' | 'about' | 'statement';

export function Icon({ name, size = 20 }: { name: Glyph; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" focusable="false" style={{ display: 'block', flex: 'none' }}>
      {name === 'search' && (
        <g {...S}>
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="M12.6 12.6L17 17" />
        </g>
      )}
      {/* a stadium seen from above: bowl, pitch, halfway line */}
      {name === 'map' && (
        <g {...S}>
          <rect x="1.8" y="3.5" width="16.4" height="13" rx="5" />
          <rect x="5.6" y="6.6" width="8.8" height="6.8" rx="0.6" />
          <path d="M10 6.6v6.8" />
        </g>
      )}
      {/* a turnstile gate */}
      {name === 'home' && (
        <g {...S}>
          <path d="M3 17V7.5L10 3l7 4.5V17" />
          <path d="M7.5 17v-5h5v5" />
        </g>
      )}
      {/* a stadium seat with its backrest */}
      {name === 'seat' && (
        <g {...S}>
          <path d="M5.5 3.5h9v7h-9z" />
          <path d="M3.5 10.5h13v3h-13z" />
          <path d="M5.5 13.5V17M14.5 13.5V17" />
        </g>
      )}
      {/* a pennant on its rail */}
      {name === 'clubs' && (
        <g {...S}>
          <path d="M3.5 3h13" />
          <path d="M5.5 6h9v11l-4.5-3.7L5.5 17z" />
        </g>
      )}
      {name === 'league' && (
        <g {...S}>
          <path d="M3 4.5h14M3 8.5h14M3 12.5h14M3 16.5h14" />
          <path d="M6.5 4.5v12" />
        </g>
      )}
      {name === 'stats' && (
        <g {...S}>
          <path d="M3.5 17V10M8 17V5M12.5 17v-8M17 17V3" />
        </g>
      )}
      {name === 'about' && (
        <g {...S}>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 9v5M10 6.2v.1" />
        </g>
      )}
      {name === 'statement' && (
        <g {...S}>
          <path d="M5 2.5h10v15H5z" />
          <path d="M7.5 6h5M7.5 9h5M7.5 12h3" />
        </g>
      )}
      {name === 'up' && (
        <g {...S}>
          <path d="M10 16V4.5M5 9.5l5-5 5 5" />
        </g>
      )}
      {name === 'ext' && (
        <g {...S}>
          <path d="M8 4H4v12h12v-4" />
          <path d="M11 3h6v6M17 3l-8 8" />
        </g>
      )}
      {name === 'page' && (
        <g {...S}>
          <path d="M4 10h11M11 6l4 4-4 4" />
        </g>
      )}
      {name === 'ticket' && (
        <g {...S}>
          <path d="M2.5 5.5h15v3a1.5 1.5 0 0 0 0 3v3h-15v-3a1.5 1.5 0 0 0 0-3z" />
          <path d="M12.5 5.5v9" strokeDasharray="1.5 1.6" />
        </g>
      )}
      {name === 'recent' && (
        <g {...S}>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6v4l2.8 1.8" />
        </g>
      )}
    </svg>
  );
}
