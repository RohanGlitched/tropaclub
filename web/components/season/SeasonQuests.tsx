'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import type { SocialState } from '@tropaclub/clubs';
import ConnectButton from '@/components/wallet/ConnectButton';
import { useSession } from '@/components/wallet/WalletProvider';
import { SEASON1, SOCIAL_QUEST_CAPS, X_HANDLE, X_INTENTS, X_URL, ticketPostText, type SocialQuestId } from '@/lib/season';
import { shortAddr } from '@/lib/format';
import { utcWhen, type SeasonPhase } from '@/lib/site';

type Social = { signedIn: false; postId: string | null } | ({ signedIn: true; wallet: string; postId: string | null } & SocialState);
type Load = { status: 'loading' } | { status: 'ready'; d: Social } | { status: 'error'; message: string };

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
/** The same reading as the server (clubs cleanHandle): "@name", "name" or an x.com / twitter.com link. */
export function cleanHandleInput(raw: string): string | null {
  let s = raw.trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([^/?#\s]+)\/?(?:[?#].*)?$/i);
  if (m) s = m[1]!;
  s = s.replace(/^@/, '');
  return HANDLE_RE.test(s) ? s.toLowerCase() : null;
}

const caps2 = (n: number) => n.toFixed(2);

async function call<T>(url: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, body === undefined ? { cache: 'no-store', signal: AbortSignal.timeout(12000) } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const j = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: j as T } : { ok: false, error: (j as { error?: string }).error || 'That did not work. Try again.' };
  } catch {
    return { ok: false, error: 'The request did not get through. Check your connection and try again.' };
  }
}

const STATUS_TEXT: Record<SocialState['quests'][number]['status'], (caps: number) => string> = {
  open: () => 'Not claimed yet.',
  pending: () => 'Claimed, pending. It counts once your wallet has a verified Season 1 buy, and is spot-checked before the snapshot.',
  counted: (c) => `Counted: +${caps2(c)} Caps. Spot-checks run until the snapshot.`,
  removed: () => 'Removed: a spot-check could not confirm it.',
};
const STATUS_TAG: Record<SocialState['quests'][number]['status'], string> = { open: 'Open', pending: 'Pending', counted: 'Counted', removed: 'Removed' };

/**
 * The Season 1 social quests for the signed-in wallet: its X handle (once), then follow, like and
 * repost, and post your ticket. Self-reported; the server holds the Caps until the first verified buy.
 */
export default function SeasonQuests({ names, siteUrl, phase }: { names: Record<string, string>; siteUrl: string; phase: SeasonPhase }) {
  const session = useSession();
  const id = useId();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [ground, setGround] = useState('Tropa Club');
  const [handle, setHandle] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ at: string; message: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await call<Social>('/api/season/social');
    setLoad(r.ok ? { status: 'ready', d: r.data } : { status: 'error', message: r.error });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, session.wallet]);

  // the ticket post names the wallet's ground: its biggest holding, or Tropa Club
  const wallet = load.status === 'ready' && load.d.signedIn ? load.d.wallet : null;
  useEffect(() => {
    if (!wallet) return;
    let live = true;
    call<{ wallet: { tokens: { symbol: string; usd: number }[] } | null }>(`/api/wallet/${wallet}`).then((r) => {
      if (!live || !r.ok || !r.data.wallet?.tokens?.length) return;
      const top = [...r.data.wallet.tokens].sort((a, b) => b.usd - a.usd)[0];
      if (top && names[top.symbol]) setGround(names[top.symbol]);
    });
    return () => {
      live = false;
    };
  }, [wallet, names]);

  if (load.status === 'loading') return <div className="s1-quests-wait" aria-busy="true"><span className="skeleton-text" aria-hidden="true" /><span className="sr">Loading the quests</span></div>;
  if (load.status === 'error') return <p className="notice">{load.message} <button type="button" className="linklike" onClick={() => void refresh()}>Try again</button></p>;

  const d = load.d;
  const postId = d.postId;
  const open = phase === 'during';

  if (!d.signedIn) {
    return (
      <div className="s1-signin">
        <p>Sign in with your wallet to add your X handle and claim quests. One free signature proves the wallet is yours; it moves no funds. Each claim is tied to that wallet.</p>
        <ConnectButton prompt="Connect wallet to do the quests" />
      </div>
    );
  }

  const saveHandle = async () => {
    const h = cleanHandleInput(handle);
    if (!h) return setErr({ at: 'handle', message: 'That isn’t an X handle: 1 to 15 letters, numbers or underscores.' });
    setBusy('handle');
    setErr(null);
    const r = await call<{ handle: string }>('/api/season/handle', { handle: h });
    setBusy(null);
    if (!r.ok) return setErr({ at: 'handle', message: r.error });
    setEditing(false);
    setHandle('');
    await refresh();
  };

  const claim = async (quest: SocialQuestId) => {
    setBusy(quest);
    setErr(null);
    const r = await call<{ status: string }>('/api/season/claim', { quest });
    setBusy(null);
    if (!r.ok) return setErr({ at: quest, message: r.error });
    await refresh();
  };

  const statusOf = (q: SocialQuestId) => d.quests.find((x) => x.quest === q) ?? { quest: q, caps: SOCIAL_QUEST_CAPS[q], status: 'open' as const, claimedAt: null };
  const ticketUrl = `${siteUrl}/ticket/${d.wallet}`;
  const postText = ticketPostText(ground);
  const showForm = !d.handle || (editing && !d.locked);
  const handleLive = cleanHandleInput(handle);

  const cards: { q: SocialQuestId; title: string; body: React.ReactNode; actions: React.ReactNode; blocked?: string }[] = [
    {
      q: 'follow',
      title: `Follow @${X_HANDLE}`,
      body: <p>Follow the Tropa Club account on X. Season news, the snapshot and any change to the terms are posted there.</p>,
      actions: <a className="btn btn-sm" href={X_INTENTS.follow()} target="_blank" rel="noopener noreferrer">Follow on X</a>,
    },
    {
      q: 'like_repost',
      title: 'Like and repost the Season 1 post',
      body: postId ? <p>Like and repost the post that announces Season 1. Both are needed for this one.</p> : <p>Like and repost the post that announces Season 1. The post goes up soon; this quest opens when it does.</p>,
      actions: postId ? (
        <>
          <a className="btn btn-sm" href={X_INTENTS.like(postId)} target="_blank" rel="noopener noreferrer">Like on X</a>
          <a className="btn btn-sm" href={X_INTENTS.repost(postId)} target="_blank" rel="noopener noreferrer">Repost on X</a>
        </>
      ) : (
        <a className="btn btn-sm" href={X_URL} target="_blank" rel="noopener noreferrer">See @{X_HANDLE}</a>
      ),
      blocked: postId ? undefined : 'The post goes up soon.',
    },
    {
      q: 'post',
      title: 'Post your ticket on X',
      body: (
        <>
          <p>Share your ticket with a short post. It opens ready to edit; nothing is posted until you press Post on X.</p>
          <p className="s1-post-text"><span className="sr">The post reads: </span>{postText} <span className="num">{ticketUrl.replace(/^https?:\/\//, '')}</span></p>
        </>
      ),
      actions: <a className="btn btn-sm" href={X_INTENTS.post(postText, ticketUrl)} target="_blank" rel="noopener noreferrer">Write the post</a>,
    },
  ];

  return (
    <div className="s1-quests">
      <div className="s1-handle">
        <h3>1. Your X handle</h3>
        {showForm ? (
          <form
            className="find"
            onSubmit={(e) => {
              e.preventDefault();
              void saveHandle();
            }}
          >
            <label htmlFor={`${id}-h`}>X handle for {shortAddr(d.wallet)}</label>
            <div className="find-row s1-handle-row">
              <span className="s1-at" aria-hidden="true">@</span>
              <input id={`${id}-h`} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="yourname" maxLength={60} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={err?.at === 'handle' ? true : undefined} aria-describedby={`${id}-hs ${id}-hn`} />
              <button className="btn btn-accent" type="submit" disabled={busy === 'handle' || !handle.trim()}>{busy === 'handle' ? 'Saving…' : 'Save handle'}</button>
            </div>
            <p id={`${id}-hs`} className="find-status tone-warn" role="status" aria-live="polite">{err?.at === 'handle' ? err.message : handle.trim() && !handleLive ? '1 to 15 letters, numbers or underscores.' : handleLive ? `It will be saved as @${handleLive}.` : ''}</p>
            <p id={`${id}-hn`} className="find-note">One handle per wallet and one wallet per handle. You can change it until your first claim; after that it is fixed.{d.handle && <> <button type="button" className="linklike" onClick={() => setEditing(false)}>Keep @{d.handle}</button></>}</p>
          </form>
        ) : (
          <p className="s1-handle-set">
            <span className="s1-handle-name">@{d.handle}</span>
            {d.locked ? <span className="muted small">Fixed after your first claim.</span> : <button type="button" className="linklike" onClick={() => setEditing(true)}>Change</button>}
          </p>
        )}
      </div>

      <h3 className="s1-quests-h">2. The quests</h3>
      {!open && <p className="notice">{phase === 'before' ? `Claims open with Season 1, ${utcWhen(SEASON1.startAt)}. You can add your handle now.` : 'Season 1 has ended: claims are closed.'}</p>}
      <ul className="s1-quest-list">
        {cards.map((c) => {
          const st = statusOf(c.q);
          const can = open && !!d.handle && st.status === 'open' && !c.blocked;
          return (
            <li key={c.q} className="s1-quest" data-status={st.status}>
              <div className="s1-quest-head">
                <h4>{c.title}</h4>
                <span className="s1-quest-caps num">+{caps2(SOCIAL_QUEST_CAPS[c.q])}</span>
              </div>
              {c.body}
              <p className="s1-quest-status"><span className={`tag${st.status === 'counted' ? '' : ' tag-quiet'}`}>{STATUS_TAG[st.status]}</span>{STATUS_TEXT[st.status](st.caps)}</p>
              <div className="s1-quest-go">
                {c.actions}
                {st.status === 'open' && (
                  <button type="button" className="btn btn-sm btn-accent" disabled={!can || busy === c.q} onClick={() => void claim(c.q)} aria-describedby={!can ? `${id}-${c.q}-why` : undefined}>
                    {busy === c.q ? 'Saving…' : 'I did this'}
                  </button>
                )}
              </div>
              {st.status === 'open' && !can && (
                <p id={`${id}-${c.q}-why`} className="muted small">{!open ? (phase === 'before' ? 'Claims open with Season 1.' : 'Claims are closed.') : !d.handle ? 'Add your X handle first.' : c.blocked}</p>
              )}
              {err?.at === c.q && <p className="buy-error" role="alert">{err.message}</p>}
            </li>
          );
        })}
      </ul>
      <p className="s1-quest-total">
        Social Caps for this wallet: <b className="num">{caps2(d.countedCaps)}</b> counted, <b className="num">{caps2(d.pendingCaps)}</b> pending, at most <b className="num">{caps2(SEASON1.social.max)}</b> for the whole season.
      </p>
    </div>
  );
}
