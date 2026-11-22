'use client';

import { useRef, useState } from 'react';

interface Props {
  address: string;
  symbol: string;
  club: string;
  line: string; // the best-stat sentence
  pageUrl: string;
  /** Your own ticket only: your scout link (tropaclub.xyz/j/<code>), put in the share text. */
  scoutLink?: string | null;
}
type Made = { landscape: string; portrait: string };

/** Share a ticket. The picture is made once, when Share is tapped, and stored as a plain file. */
export default function ShareBar({ address, symbol, club, line, pageUrl, scoutLink }: Props) {
  const [state, setState] = useState<'idle' | 'busy' | 'ready' | 'failed'>('idle');
  const [made, setMade] = useState<Made | null>(null);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Tear the stub: the ticket block shows the stub pulled away once the ticket has been shared.
  const tear = () => root.current?.closest('.ticket-block')?.setAttribute('data-shared', '1');

  const text = `My ticket for the ${club}: ${line.charAt(0).toLowerCase()}${line.slice(1)}. ${scoutLink ? `Join me: ${scoutLink}` : 'Check yours.'} #StocksMaxxing via @tropaclubxyz`;
  const enc = encodeURIComponent;
  const targets = [
    { label: 'Post on X', href: `https://x.com/intent/post?text=${enc(text)}&url=${enc(pageUrl)}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${enc(`${text} ${pageUrl}`)}` },
    { label: 'Telegram', href: `https://t.me/share/url?url=${enc(pageUrl)}&text=${enc(text)}` },
  ];

  async function make() {
    setState('busy');
    try {
      const res = await fetch('/api/card', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, symbol }), signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as Made;
      setMade(j);
      setState('ready');
      tear();
    } catch {
      setState('failed');
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', pageUrl);
    }
  }

  if (state === 'idle' || state === 'busy') {
    return (
      <div className="share" ref={root}>
        <button type="button" className="btn btn-accent" onClick={make} disabled={state === 'busy'}>
          {state === 'busy' ? 'Making the picture…' : 'Share ticket'}
        </button>
        <span className="share-note">Makes a picture of this ticket and a link that previews it.{scoutLink ? ' The post carries your referral (scout) link.' : ''}</span>
      </div>
    );
  }
  return (
    <div className="share share-open" ref={root}>
      {state === 'failed' && <p className="share-warn" role="status">The picture could not be made just now. The link still works, and you can try again.</p>}
      <div className="share-row">
        <button type="button" className="btn" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
        {targets.map((t) => (
          <a key={t.label} className="btn" href={t.href} target="_blank" rel="noopener noreferrer">{t.label}</a>
        ))}
        {state === 'failed' && <button type="button" className="btn" onClick={make}>Try the picture again</button>}
      </div>
      {made && (
        <p className="share-files">
          Picture: <a href={made.landscape} target="_blank" rel="noopener noreferrer">wide, 1200 × 630</a>
          <a href={made.portrait} target="_blank" rel="noopener noreferrer">tall, 1080 × 1350</a>
        </p>
      )}
    </div>
  );
}
