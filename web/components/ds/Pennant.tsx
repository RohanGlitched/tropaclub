import { useId } from 'react';
import type { Kit } from '@/lib/clubs';

export type Emblem = 'star' | 'bolt' | 'wave' | 'peak' | 'sun' | 'leaf' | 'anchor' | 'crown';
/** What @tropaclub/clubs crestFromSeed() returns. Structural, so this file stays free of server code. */
export interface CrestRecipe {
  primary: string;
  secondary: string;
  pattern: Kit['pattern'];
  emblem?: Emblem | string;
  stripes?: number;
}

const EMBLEMS: Record<string, string> = {
  star: 'M21 8l2.9 6.2 6.6.8-4.9 4.6 1.3 6.6L21 23l-5.9 3.2 1.3-6.6-4.9-4.6 6.6-.8z',
  bolt: 'M24 7l-9 11h5l-3 9 10-12h-5z',
  wave: 'M11 15c3.3-4 6.7-4 10 0s6.7 4 10 0v5c-3.3 4-6.7 4-10 0s-6.7-4-10 0z',
  peak: 'M11 26l7-14 4 7 2.5-4L31 26z',
  sun: 'M21 10a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z',
  leaf: 'M13 25c0-9 6-15 16-16 0 10-6 16-16 16zm0 0l9-9',
  anchor: 'M21 8a2.6 2.6 0 0 1 1.2 4.9V15h4v2.6h-4v6.3c2.6-.5 4.5-2.3 5-4.9l2.6.6c-.9 4.2-4.5 7-8.8 7s-7.9-2.8-8.8-7l2.6-.6c.5 2.6 2.4 4.4 5 4.9v-6.3h-4V15h4v-2.1A2.6 2.6 0 0 1 21 8z',
  crown: 'M11 25V12l5 5 5-8 5 8 5-5v13z',
};
const DARK = '#121037';
const LIGHT = '#F4F1E8';
const inkOn = (fill: string) => (/^#(121037|ff5c4d|12a874)$/i.test(fill) ? LIGHT : DARK);

/** A club pennant: swallowtail in the Banner T's stem proportion, filled with the club's kit. */
export function Pennant({ kit, width = 28, rail = false, className, title, emblem }: { kit: Kit | CrestRecipe; width?: number; rail?: boolean; className?: string; title?: string; emblem?: string }) {
  const id = useId().replace(/[:«»]/g, '');
  const top = rail ? 12 : 0;
  const h = 53 + top;
  const { primary: p, secondary: s, pattern } = kit;
  const mark = emblem ?? ('emblem' in kit ? kit.emblem : undefined);
  const path = mark ? EMBLEMS[mark] : undefined;
  return (
    <svg className={className} viewBox={`0 0 42 ${h}`} width={width} height={(width * h) / 42} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={{ display: 'block', flex: 'none' }}>
      <defs>
        <clipPath id={id}>
          <path d="M0 0H42V53L21 35.4L0 53Z" />
        </clipPath>
      </defs>
      {rail && <rect x="0" y="0" width="42" height="7" fill="currentColor" />}
      <g clipPath={`url(#${id})`} transform={`translate(0 ${top})`}>
        <rect width="42" height="53" fill={p} />
        {pattern === 'hoops' && [1, 3].map((i) => <rect key={i} y={i * 10.6} width="42" height="10.6" fill={s} />)}
        {pattern === 'halves' && <rect x="21" width="21" height="53" fill={s} />}
        {pattern === 'sash' && <path d="M-4 30L30 -4H46L-4 46Z" fill={s} />}
        {pattern === 'chevron' && <path d="M0 6L21 22L42 6V18L21 34L0 18Z" fill={s} />}
        {pattern === 'quarters' && <path d="M21 0H42V20H21ZM0 20H21V53H0Z" fill={s} />}
        {path && (
          <>
            <circle cx="21" cy="18" r="12.5" fill={p} />
            <path d={path} fill={mark === 'leaf' ? 'none' : inkOn(p)} stroke={mark === 'leaf' ? inkOn(p) : undefined} strokeWidth={mark === 'leaf' ? 2.4 : undefined} strokeLinejoin="round" />
            {mark === 'leaf' && <path d="M13 25c0-9 6-15 16-16 0 10-6 16-16 16z" fill={inkOn(p)} />}
          </>
        )}
      </g>
      <path d={`M0.6 ${top + 0.6}H41.4V${top + 51.7}L21 ${top + 34.6}L0.6 ${top + 51.7}Z`} fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.2" />
    </svg>
  );
}

/** A club crest: the pennant with its emblem, hung from a rail. */
export function Crest({ recipe, width = 56, title, raise }: { recipe: CrestRecipe; width?: number; title?: string; raise?: boolean }) {
  return (
    <span className={`crest${raise ? ' raise' : ''}`}>
      <Pennant kit={recipe} width={width} rail title={title} />
    </span>
  );
}
