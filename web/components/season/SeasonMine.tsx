'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import type { SeasonStanding } from '@tropaclub/clubs';
import { useSession } from '@/components/wallet/WalletProvider';
import { resolveInput } from '@/lib/client';
import { fmtInt, shortAddr } from '@/lib/format';
import { PLAY_USD } from '@/lib/site';

type Load = { status: 'idle' } | { status: 'loading'; wallet: string } | { status: 'ready'; s: SeasonStanding; name?: string } | { status: 'error'; message: string };

const caps2 = (n: number) => n.toFixed(2);

async function standingOf(wallet: string): Promise<{ ok: true; s: SeasonStanding } | { ok: false; message: string }> {
  try {
    const r = await fetch(`/api/season/wallet/${wallet}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, message: (j as { error?: string }).error || 'Caps are not available right now. Try again in a minute.' };
    return { ok: true, s: j as SeasonStanding };
  } catch {
    return { ok: false, message: 'The request did not get through. Check your connection and try again.' };
  }
}

const SOURCES: { key: keyof SeasonStanding['breakdown']; label: string }[] = [
  { key: 'played', label: 'Played a gameweek' },
  { key: 'held_d7', label: 'Still holding at day 7' },
  { key: 'scout', label: 'Credited friends' },
  { key: 'founder', label: 'Founder Cap' },
  { key: 'social', label: 'Social quests' },
];

const PROVISIONAL_WHY: Record<string, string> = {
  new_wallet: 'it was first seen less than 24 hours before its first verified buy',
  age_unknown: 'we could not find anything to date it by',
  age_unchecked: 'its age check has not run yet; it is retried on the next update',
};

/** One wallet's Season 1 card: Caps, rank, where they came from, and any provisional or excluded note. */
export function StandingCard({ s, mine, name }: { s: SeasonStanding; mine: boolean; name?: string }) {
  return (
    <div className="s1-card" aria-live="polite">
      <div className="s1-card-top">
        <p className="s1-card-who"><span className="num">{mine ? shortAddr(s.wallet) : name ?? shortAddr(s.wallet)}</span>{mine && <span className="tag tag-quiet">Signed in</span>}{s.provisional && <span className="tag tag-quiet">Provisional</span>}</p>
        <p className="s1-card-caps"><span className="num">{caps2(s.caps)}</span> <small>Caps</small></p>
        <p className="s1-card-rank">{s.excluded ? 'Not ranked: excluded' : s.rank ? <>Rank <b className="num">#{fmtInt(s.rank)}</b> of {fmtInt(s.of)} in Season 1</> : s.of ? `Not on the table yet. ${fmtInt(s.of)} ${s.of === 1 ? 'wallet has' : 'wallets have'} Caps.` : 'Not on the table yet.'}</p>
      </div>
      <table className="mini-table s1-break">
        <caption className="sr">{mine ? 'Where your Season 1 Caps came from' : 'Where this wallet’s Season 1 Caps came from'}</caption>
        <thead><tr><th scope="col">Source</th><th scope="col" className="r">Caps</th></tr></thead>
        <tbody>
          {SOURCES.map((r) => (
            <tr key={r.key}><th scope="row">{r.label}</th><td className="r num">{caps2(s.breakdown[r.key])}</td></tr>
          ))}
        </tbody>
      </table>
      <ul className="s1-notes">
        {s.excluded && <li>This wallet is on the public exclusion list (team, test and contest wallets), so it gets no allocation.</li>}
        {s.provisional && <li>Held as provisional until the snapshot: {PROVISIONAL_WHY[s.provisionalReason ?? ''] ?? 'its age could not be confirmed yet'}. Its Caps show here but are decided at the snapshot.</li>}
        {!s.hasSeasonBuy && !s.excluded && <li>No verified Season 1 buy yet. Buy ${PLAY_USD} or more through Tropa Club in a gameweek to earn the first Cap. Social Caps wait for that first buy.</li>}
        {s.hasSeasonBuy && !s.excluded && !s.provisional && <li>Counted so far. Holding at day 7 and friends are added on day 7, so the total can still grow before the snapshot.</li>}
      </ul>
      <p className="muted small"><Link href={`/ticket/${s.wallet}`} prefetch={false}>{mine ? 'Your ticket' : 'This wallet’s ticket'}</Link> · <Link href="/league?tab=caps" prefetch={false}>The Season 1 table</Link></p>
    </div>
  );
}

/**
 * "Your Caps": the signed-in wallet's standing, or a paste-a-wallet box when signed out (any wallet's
 * standing is public, like the league table).
 */
export default function SeasonMine() {
  const session = useSession();
  const id = useId();
  const [mine, setMine] = useState<Load>({ status: 'idle' });
  const [other, setOther] = useState<Load>({ status: 'idle' });
  const [value, setValue] = useState('');

  useEffect(() => {
    const w = session.wallet;
    if (!w) {
      setMine({ status: 'idle' });
      return;
    }
    let live = true;
    setMine({ status: 'loading', wallet: w });
    standingOf(w).then((r) => live && setMine(r.ok ? { status: 'ready', s: r.s } : { status: 'error', message: r.message }));
    return () => {
      live = false;
    };
  }, [session.wallet]);

  const look = async () => {
    setOther({ status: 'loading', wallet: value });
    const r = await resolveInput(value);
    if (!r.ok) return setOther({ status: 'error', message: r.message });
    const s = await standingOf(r.address);
    setOther(s.ok ? { status: 'ready', s: s.s, name: r.name } : { status: 'error', message: s.message });
  };

  return (
    <div className="s1-mine">
      {session.wallet && (
        <div className="s1-mine-own">
          {mine.status === 'ready' ? (
            <StandingCard s={mine.s} mine />
          ) : mine.status === 'error' ? (
            <p className="notice">{mine.message}</p>
          ) : (
            <div className="s1-card s1-card-wait" aria-busy="true"><span className="skeleton-text" aria-hidden="true" /><span className="sr">Loading your Caps</span></div>
          )}
        </div>
      )}
      <form
        className="find s1-find"
        onSubmit={(e) => {
          e.preventDefault();
          void look();
        }}
      >
        <label htmlFor={id}>{session.wallet ? 'Check another wallet' : 'Paste a wallet to see its Season 1 Caps'}</label>
        <div className="find-row">
          <input id={id} name="wallet" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0x… or yourname.base.eth" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={other.status === 'error' ? true : undefined} aria-describedby={`${id}-s`} />
          <button className="btn btn-accent" type="submit" disabled={other.status === 'loading'}>{other.status === 'loading' ? 'Looking…' : 'See Caps'}</button>
        </div>
        <p id={`${id}-s`} className="find-status tone-warn" role="status" aria-live="polite">{other.status === 'error' ? other.message : ''}</p>
        <p className="find-note">Read-only. Any wallet&rsquo;s Caps are public, like the table. Nothing to connect or sign.</p>
      </form>
      {other.status === 'ready' && <StandingCard s={other.s} mine={!!session.wallet && other.s.wallet === session.wallet} name={other.name} />}
    </div>
  );
}
