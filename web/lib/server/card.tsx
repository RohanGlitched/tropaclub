// Share pictures, drawn with next/og (satori). Flex layout only; nested SVGs go in as images.
import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TokenSummary, WalletTokenEntry } from '@shared/types';
import { A, B, RC, PITCH_A, PITCH_B, buildLayout, tifo } from '../stadium';
import { clubName, kitFor, PALETTE as C, type Kit } from '../clubs';
import { fmtDate, fmtInt, shortAddr } from '../format';
import { barcode, barcodeWidth, seatIndexFor, statSentence } from '../ticket';
import { seatLabel } from '../stadium';

const ASSETS = path.join(process.cwd(), 'assets');
let fontsP: Promise<{ name: string; data: Buffer; weight: 500 | 600 | 700; style: 'normal' }[]> | null = null;
export function cardFonts() {
  return (fontsP ??= Promise.all(
    ([500, 600, 700] as const).map(async (weight) => ({ name: 'BSC', data: await readFile(path.join(ASSETS, 'fonts', `bsc-${weight}.woff`)), weight, style: 'normal' as const })),
  ));
}
let lockupP: Promise<string> | null = null;
function lockup(color: string) {
  return (lockupP ??= readFile(path.join(ASSETS, 'logo-lockup.svg'), 'utf8')).then((s) => uri(s.replace(/#121037/g, color)));
}
const uri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

/** The ground as an SVG string: bowl, pitch, a sample of ghosts, every fan, and one marked seat. */
export function groundSvg(total: number, realFans: number, kit: Kit, focus: number | null, bg: string): string {
  const L = buildLayout(total);
  const w = L.halfW + 8;
  const h = L.halfH + 8;
  const q = Math.max(L.s * 0.66, 1.6);
  const fans = Math.min(realFans, L.n);
  const step = Math.max(1, Math.ceil((L.n - fans) / 5000));
  let ghosts = '';
  for (let i = fans; i < L.n; i += step) ghosts += `M${(L.x[i] - q / 2).toFixed(1)} ${(L.y[i] - q / 2).toFixed(1)}h${q.toFixed(1)}v${q.toFixed(1)}h-${q.toFixed(1)}z`;
  const tone = ['', ''];
  const qf = Math.max(L.s * 0.8, 2.4);
  for (let i = 0; i < fans; i++) tone[tifo(kit.pattern, L, i)] += `M${(L.x[i] - qf / 2).toFixed(1)} ${(L.y[i] - qf / 2).toFixed(1)}h${qf.toFixed(1)}v${qf.toFixed(1)}h-${qf.toFixed(1)}z`;
  let stripes = '';
  const sw = (PITCH_A * 2) / 12;
  for (let i = 0; i < 12; i++) stripes += `<rect x="${-PITCH_A + i * sw}" y="${-PITCH_B}" width="${sw + 0.5}" height="${PITCH_B * 2}" fill="${C.pitch}" opacity="${i % 2 ? 0.2 : 0.145}"/>`;
  let mark = '';
  if (focus != null && focus >= 0 && focus < L.n) {
    const fx = L.x[focus];
    const fy = L.y[focus];
    mark = `<circle cx="${fx}" cy="${fy}" r="20" fill="none" stroke="${C.marigold}" stroke-width="3.5"/><rect x="${fx - 7}" y="${fy - 7}" width="14" height="14" fill="${C.marigold}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-w} ${-h} ${w * 2} ${h * 2}">
<rect x="${-w}" y="${-h}" width="${w * 2}" height="${h * 2}" fill="${bg}"/>
<rect x="${-L.halfW - 3}" y="${-L.halfH - 3}" width="${(L.halfW + 3) * 2}" height="${(L.halfH + 3) * 2}" rx="${RC + (L.halfW + 3 - A)}" fill="#1B1A52" stroke="#34327F" stroke-width="1.5"/>
<rect x="${-A - 3}" y="${-B - 3}" width="${(A + 3) * 2}" height="${(B + 3) * 2}" rx="${RC}" fill="${bg}"/>
${stripes}
<g fill="none" stroke="${C.chalk}" stroke-opacity="0.45" stroke-width="1.6"><rect x="${-PITCH_A}" y="${-PITCH_B}" width="${PITCH_A * 2}" height="${PITCH_B * 2}"/><path d="M0 ${-PITCH_B}V${PITCH_B}"/><circle r="41"/><rect x="${-PITCH_A}" y="-91" width="74" height="182"/><rect x="${PITCH_A - 74}" y="-91" width="74" height="182"/></g>
<path d="${ghosts}" fill="${C.label}" fill-opacity="0.3"/>
<path d="${tone[0]}" fill="${kit.primary}"/>
<path d="${tone[1]}" fill="${kit.secondary}"/>
${mark}
</svg>`;
}

function pennantSvg(kit: Kit): string {
  const { primary: p, secondary: s, pattern } = kit;
  const pat =
    pattern === 'hoops' ? `<rect y="10.6" width="42" height="10.6" fill="${s}"/><rect y="31.8" width="42" height="10.6" fill="${s}"/>`
    : pattern === 'halves' ? `<rect x="21" width="21" height="53" fill="${s}"/>`
    : pattern === 'sash' ? `<path d="M-4 30L30 -4H46L-4 46Z" fill="${s}"/>`
    : pattern === 'chevron' ? `<path d="M0 6L21 22L42 6V18L21 34L0 18Z" fill="${s}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 53"><defs><clipPath id="c"><path d="M0 0H42V53L21 35.4L0 53Z"/></clipPath></defs><g clip-path="url(#c)"><rect width="42" height="53" fill="${p}"/>${pat}</g><path d="M0 0H42V53L21 35.4L0 53Z" fill="none" stroke="${C.midnight}" stroke-width="1.5"/></svg>`;
}

function barsSvg(address: string): string {
  const bars = barcode(address);
  const w = barcodeWidth(bars);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 40" preserveAspectRatio="none">${bars.map((b) => `<rect x="${b.x}" width="${b.w}" height="40" fill="${C.midnight}"/>`).join('')}</svg>`;
}

export interface CardInput {
  address: string;
  entry: WalletTokenEntry;
  token: TokenSummary;
  asOf?: string;
  stamp?: string | null;
  badge?: string | null;
}

/** The "Played GW0" stamp: an inked box, slightly turned, like a turnstile stamp. */
function Stamp({ stamp, badge, size }: { stamp: string; badge?: string | null; size: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', border: `${Math.round(size / 8)}px solid ${C.pitch}`, color: C.pitch, padding: `${Math.round(size / 3)}px ${Math.round(size / 1.6)}px`, transform: 'rotate(-6deg)', borderRadius: 6 }}>
      <div style={{ fontSize: size, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', lineHeight: 1 }}>{stamp}</div>
      {badge ? <div style={{ fontSize: size * 0.5, fontWeight: 600, marginTop: 6, lineHeight: 1 }}>{badge}</div> : null}
    </div>
  );
}

const label = { fontSize: 19, fontWeight: 600, letterSpacing: 2.4, textTransform: 'uppercase' as const, opacity: 0.72 };

function SeatCells({ entry, token, address, big }: CardInput & { big: number }) {
  const seat = seatLabel(token.holdersTotal, seatIndexFor(address, entry, token));
  const cells: [string, string][] = [
    ['Block', String(seat?.block ?? '—')],
    ['Row', String(seat?.row ?? '—')],
    ['Seat', String(seat?.seat ?? '—')],
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
      {cells.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'column', marginRight: 44 }}>
          <div style={label}>{k}</div>
          <div style={{ fontSize: big, fontWeight: 700, lineHeight: 1.05 }}>{v}</div>
        </div>
      ))}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={label}>Real fan</div>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <div style={{ fontSize: big, fontWeight: 700, lineHeight: 1.05 }}>{entry.rank != null ? fmtInt(entry.rank) : '—'}</div>
          <div style={{ fontSize: big * 0.42, fontWeight: 600, marginLeft: 10, opacity: 0.72 }}>{`of ${fmtInt(entry.of || token.realFans)}`}</div>
        </div>
      </div>
    </div>
  );
}

export async function ticketCard(input: CardInput, variant: 'landscape' | 'portrait') {
  const { address, entry, token, asOf, stamp, badge } = input;
  const kit = kitFor(token.symbol);
  const idx = seatIndexFor(address, entry, token);
  const logo = await lockup(C.chalk);
  const pennant = uri(pennantSvg(kit));
  const bars = uri(barsSvg(address));
  const stat = statSentence(entry.bestStat);
  const fine = `${token.symbol} is a stock token that tracks the share price. Past performance · not advice.`;

  if (variant === 'landscape') {
    const plan = uri(groundSvg(token.holdersTotal, token.realFans, kit, idx, C.midnight));
    return (
      <div style={{ width: 1200, height: 630, display: 'flex', flexDirection: 'column', background: C.midnight, color: C.chalk, fontFamily: 'BSC', padding: '40px 52px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={173} height={48} alt="" />
          <div style={{ fontSize: 22, fontWeight: 600, color: C.label }}>{`Matchday ticket, as of ${fmtDate(asOf)}`}</div>
        </div>
        <div style={{ display: 'flex', marginTop: 28, height: 418 }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, background: C.chalk, color: C.midnight, padding: '30px 36px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pennant} width={50} height={63} alt="" />
              <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 20 }}>
                <div style={{ fontSize: 62, fontWeight: 700, lineHeight: 1, letterSpacing: -0.6 }}>{clubName(token.name)}</div>
                <div style={{ fontSize: 22, fontWeight: 500, marginTop: 6, opacity: 0.75 }}>{`Home ground of ${token.symbol} holders on Base`}</div>
              </div>
            </div>
            <SeatCells {...input} big={68} />
            <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
              <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.1 }}>{stat}</div>
              <div style={{ fontSize: 17, fontWeight: 500, marginTop: 8, opacity: 0.72 }}>{fine}</div>
              {stamp ? (
                <div style={{ display: 'flex', position: 'absolute', right: 0, top: -262 }}>
                  <Stamp stamp={stamp} badge={badge} size={30} />
                </div>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', width: 330, background: C.marigold, color: C.midnight, padding: '24px 26px', borderLeft: `4px dashed ${C.midnight}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={plan} width={278} height={224} alt="" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bars} width={278} height={70} alt="" />
            <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: 1 }}>{shortAddr(address)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, fontSize: 22, fontWeight: 600, color: C.label }}>
          <div>tropaclub.xyz</div>
          <div>{`${fmtInt(token.holdersTotal)} tickets sold. ${fmtInt(token.realFans)} fans showed up.`}</div>
        </div>
      </div>
    );
  }

  const plan = uri(groundSvg(token.holdersTotal, token.realFans, kit, idx, C.midnight));
  return (
    <div style={{ width: 1080, height: 1350, display: 'flex', flexDirection: 'column', background: C.midnight, color: C.chalk, fontFamily: 'BSC', padding: '48px 56px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={202} height={56} alt="" />
        <div style={{ fontSize: 24, fontWeight: 600, color: C.label }}>{`As of ${fmtDate(asOf)}`}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={plan} width={968} height={782} alt="" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 20, flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, background: C.chalk, color: C.midnight, padding: '26px 34px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pennant} width={44} height={56} alt="" />
            <div style={{ fontSize: 58, fontWeight: 700, lineHeight: 1, marginLeft: 18, letterSpacing: -0.6 }}>{clubName(token.name)}</div>
          </div>
          <SeatCells {...input} big={60} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>{stat}</div>
            {stamp ? <Stamp stamp={stamp} badge={badge} size={24} /> : null}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.marigold, color: C.midnight, padding: '16px 34px', borderTop: `4px dashed ${C.midnight}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bars} width={520} height={52} alt="" />
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: 1 }}>{shortAddr(address)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, fontSize: 20, fontWeight: 600, color: C.label }}>
        <div>tropaclub.xyz</div>
        <div>{fine}</div>
      </div>
    </div>
  );
}

/** The default share picture for every page without its own. */
export async function defaultCard(token: TokenSummary) {
  const kit = kitFor(token.symbol);
  const logo = await lockup(C.chalk);
  const plan = uri(groundSvg(token.holdersTotal, token.realFans, kit, null, C.midnight));
  return (
    <div style={{ width: 1200, height: 630, display: 'flex', background: C.midnight, color: C.chalk, fontFamily: 'BSC', padding: '48px 56px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 520 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={202} height={56} alt="" />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 30, fontWeight: 600, color: C.label }}>{`${clubName(token.name)} sold`}</div>
          <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.04, letterSpacing: -0.8 }}>{`${fmtInt(token.holdersTotal)} tickets.`}</div>
          <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.04, letterSpacing: -0.8, color: C.marigold, marginTop: 6 }}>{`${fmtInt(token.realFans)} fans showed up.`}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 24, fontWeight: 500, color: C.label, lineHeight: 1.3 }}>
          <div>Every stock token on Base is a club.</div>
          <div>Every wallet is a seat. Find yours at tropaclub.xyz</div>
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={plan} width={572} height={462} alt="" />
      </div>
    </div>
  );
}
