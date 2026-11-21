'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import ConnectButton from '@/components/wallet/ConnectButton';
import { useSession } from '@/components/wallet/WalletProvider';
import TeamSheet, { type Member } from '@/components/ds/TeamSheet';
import { Crest, type CrestRecipe } from '@/components/ds/Pennant';

async function post<T>(url: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: j as T } : { ok: false, error: j.error || 'That did not work. Try again.' };
  } catch {
    return { ok: false, error: 'The request did not get through. Check your connection and try again.' };
  }
}

/** Connected and signed in? If not, the connect button stands in for the action and says why. */
function useGate() {
  const { isConnected } = useAccount();
  const s = useSession();
  return { ready: isConnected && s.signedIn };
}

function ShareLinks({ text, url, whatsapp, telegram, x }: { text: string; url: string; whatsapp?: string; telegram?: string; x?: string }) {
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent;
  return (
    <div className="share-row">
      <button
        type="button"
        className="btn btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            window.prompt('Copy this link', url);
          }
        }}
      >
        {copied ? 'Link copied' : 'Copy link'}
      </button>
      <a className="btn btn-sm" href={whatsapp ?? `https://wa.me/?text=${enc(`${text} ${url}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <a className="btn btn-sm" href={telegram ?? `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`} target="_blank" rel="noopener noreferrer">Telegram</a>
      <a className="btn btn-sm" href={x ?? `https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`} target="_blank" rel="noopener noreferrer">X</a>
    </div>
  );
}

export function InviteBox({ url, club }: { url: string; club: string }) {
  return (
    <div className="invite">
      <p className="invite-url num">{url.replace(/^https?:\/\//, '')}</p>
      <ShareLinks url={url} text={`Join ${club} on Tropa Club: $10 a week in stocks with the group chat. Take a seat on the Bench, it is free.`} />
    </div>
  );
}

/** Start a club: name it, the crest is cut, the invite link is ready to send. */
export function StartClub() {
  const gate = useGate();
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState('');
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [made, setMade] = useState<{ id: string; name: string; crest: CrestRecipe; inviteUrl: string } | null>(null);
  const step = made ? 3 : name.trim().length >= 3 ? 2 : 1;

  if (made) {
    return (
      <div className="start start-done">
        <Crest recipe={made.crest} width={72} raise title={`Crest of ${made.name}`} />
        <div>
          <h3>{made.name} is founded</h3>
          <p>Your crest is cut and you hold the first seat on the Bench. Send the invite to the group chat.</p>
          <InviteBox url={made.inviteUrl} club={made.name} />
          <p><button type="button" className="btn btn-accent" onClick={() => router.push(`/club/${made.id}`)}>Open the club</button></p>
        </div>
      </div>
    );
  }
  return (
    <form
      className="start"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!gate.ready) return;
        setBusy(true);
        setErr('');
        const r = await post<{ club: { id: string; name: string; crest: CrestRecipe }; inviteUrl: string }>('/api/clubs', { name, nickname: nick || null });
        setBusy(false);
        if (!r.ok) return setErr(r.error);
        setMade({ ...r.data.club, inviteUrl: r.data.inviteUrl });
        router.refresh();
      }}
    >
      <ol className="start-steps" aria-label="Steps">
        <li data-on={step >= 1}>Name</li>
        <li data-on={step >= 2}>Crest</li>
        <li data-on={step >= 3}>Invite</li>
      </ol>
      <label htmlFor={`${id}-n`}>Club name</label>
      <input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunday League Tropa" maxLength={40} autoComplete="off" required minLength={3} />
      <label htmlFor={`${id}-k`}>Your name on the team sheet <span className="muted">(optional)</span></label>
      <input id={`${id}-k`} value={nick} onChange={(e) => setNick(e.target.value)} placeholder="Ana" maxLength={20} autoComplete="off" />
      <p className="find-note">The crest is drawn for the club when it is made: two colours, a kit pattern and an emblem. Starting a club is free and needs no buy.</p>
      <div className="start-go">
        {gate.ready ? (
          <button type="submit" className="btn btn-accent" disabled={busy || name.trim().length < 3}>{busy ? 'Founding…' : 'Found the club'}</button>
        ) : (
          <ConnectButton prompt="Connect to found a club" />
        )}
        {gate.ready && name.trim().length < 3 && <span className="buy-why">Give the club a name of three letters or more.</span>}
      </div>
      {err && <p className="buy-error" role="alert">{err}</p>}
    </form>
  );
}

export function InviteCodeForm() {
  const router = useRouter();
  const id = useId();
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  return (
    <form
      className="find"
      onSubmit={(e) => {
        e.preventDefault();
        const code = (v.trim().match(/([A-Za-z0-9]{6,12})\/?$/)?.[1] ?? '').toUpperCase();
        if (!code) return setErr('Paste the invite link or the code at the end of it.');
        router.push(`/join/${code}`);
      }}
    >
      <label htmlFor={id}>Have an invite?</label>
      <div className="find-row">
        <input id={id} value={v} onChange={(e) => setV(e.target.value)} placeholder="Invite link or code" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        <button type="submit" className="btn">Open invite</button>
      </div>
      <p className="find-status tone-warn" role="status">{err}</p>
    </form>
  );
}

export function JoinButton({ inviteCode, clubId, label = 'Take a seat on the Bench' }: { inviteCode?: string; clubId?: string; label?: string }) {
  const gate = useGate();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!gate.ready) return <ConnectButton prompt="Connect to join" />;
  return (
    <div className="act">
      <button
        type="button"
        className="btn btn-accent"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr('');
          const r = await post<{ clubId: string }>('/api/clubs/join', { inviteCode, clubId });
          if (!r.ok) {
            setBusy(false);
            return setErr(r.error);
          }
          router.push(`/club/${r.data.clubId}?joined=1`);
          router.refresh();
        }}
      >
        {busy ? 'Joining…' : label}
      </button>
      {err && <p className="buy-error" role="alert">{err}</p>}
    </div>
  );
}

export function PickupButton() {
  const gate = useGate();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (!gate.ready) return <ConnectButton prompt="Connect to be matched" />;
  return (
    <div className="act">
      <button
        type="button"
        className="btn btn-accent"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg('');
          const r = await post<{ queued: boolean; club: { id: string; name: string } | null }>('/api/clubs/pickup');
          setBusy(false);
          if (!r.ok) return setMsg(r.error);
          if (r.data.club) {
            router.push(`/club/${r.data.club.id}?joined=1`);
            router.refresh();
          } else setMsg('You are in the queue. You will be seated as soon as enough players from your part of the world are waiting. Check back here.');
        }}
      >
        {busy ? 'Finding a club…' : 'Find me a pick-up club'}
      </button>
      {msg && <p className="act-msg" role="status">{msg}</p>}
    </div>
  );
}

interface Share { text: string; url: string; whatsapp: string; telegram: string; x: string }

/** The team sheet with call-ups: tap a benched teammate, get the message to send them. */
export function Roster({ clubId, clubName, members, crest, callUpOff, playingLabel, benchLabel, joined }: { clubId: string; clubName: string; members: Member[]; crest: CrestRecipe; callUpOff?: string; playingLabel?: string; benchLabel?: string; joined?: boolean }) {
  const [list, setList] = useState(() => (joined ? members.map((m) => (m.you ? { ...m, fresh: true } : m)) : members));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [share, setShare] = useState<(Share & { who: string }) | null>(null);
  const [err, setErr] = useState('');
  const onCallUp = async (id: string) => {
    setBusyId(id);
    setErr('');
    const r = await post<Share>('/api/clubs/callup', { clubId, to: id });
    setBusyId(null);
    if (!r.ok) return setErr(r.error);
    setList((l) => l.map((m) => (m.id === id ? { ...m, calledUp: true } : m)));
    setShare({ ...r.data, who: list.find((m) => m.id === id)?.name ?? 'your teammate' });
  };
  return (
    <div>
      <TeamSheet members={list} kit={crest} onCallUp={list.some((m) => m.canCallUp) ? onCallUp : undefined} callUpOff={callUpOff} playingLabel={playingLabel} benchLabel={benchLabel} busyId={busyId} />
      {err && <p className="buy-error" role="alert">{err}</p>}
      {share && (
        <div className="callup" role="status">
          <h4>Send {share.who} the call-up</h4>
          <p className="callup-text">{share.text}</p>
          <ShareLinks text={share.text} url={share.url} whatsapp={share.whatsapp} telegram={share.telegram} x={share.x} />
          <p className="muted small">One call-up per teammate each gameweek. {clubName} needs 80% of the team playing for the bonus point.</p>
        </div>
      )}
    </div>
  );
}

export function CsvButton({ address }: { address: string }) {
  const { address: connected } = useAccount();
  const s = useSession();
  const mine = connected?.toLowerCase() === address.toLowerCase();
  if (!mine) return <p className="muted small">The CSV download is for the owner of this wallet. Connect it to download.</p>;
  if (!s.signedIn) return <ConnectButton prompt="Sign in to download" />;
  return <a className="btn" href={`/api/statement/${address}/csv`}>Download CSV</a>;
}
