'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useSession } from './WalletProvider';
import { shortAddr } from '@/lib/format';

const LABELS: Record<string, { name: string; note: string }> = {
  coinbaseWalletSDK: { name: 'Base Account', note: 'Smart wallet with a passkey. Nothing to install.' },
  injected: { name: 'Browser wallet', note: 'MetaMask, Rabby or another wallet in this browser.' },
};

/**
 * Connect, then sign in. Shows which step is next and why.
 * `header`: the header's one action. Signed out it reads "Check my wallet" (the read-only lookup);
 * once a wallet is connected it shows the short address, and signing in moves into its menu.
 */
export default function ConnectButton({ compact = false, prompt, header = false }: { compact?: boolean; prompt?: string; header?: boolean }) {
  const { address, isConnected } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  // the one control this instance shows (connect, sign in, or the address): focus lands on it after a step
  const main = useRef<HTMLElement | null>(null);
  const setMain = (el: HTMLElement | null) => {
    main.current = el;
  };
  const [focusNext, setFocusNext] = useState<'connected' | 'signedIn' | null>(null);
  const uid = useId();

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const connected = mounted && isConnected && !!address;
  const hasInjected = mounted && typeof window !== 'undefined' && !!(window as unknown as { ethereum?: unknown }).ethereum;
  const list = connectors.filter((c) => c.id === 'coinbaseWalletSDK' || (c.id === 'injected' && hasInjected));

  // after a connect or a sign-in made here, focus moves to the control that took the old one's place
  useEffect(() => {
    if (!focusNext) return;
    if ((focusNext === 'connected' && connected) || (focusNext === 'signedIn' && session.signedIn)) {
      setFocusNext(null);
      main.current?.focus();
    }
  }, [focusNext, connected, session.signedIn]);

  async function signIn() {
    const w = await session.signIn(uid);
    if (w) {
      setOpen(false);
      setFocusNext('signedIn');
    }
  }

  async function pick(id: string) {
    setErr('');
    const c = connectors.find((x) => x.id === id);
    if (!c) return;
    try {
      await connectAsync({ connector: c, chainId: 8453 });
      setOpen(false);
      setFocusNext('connected');
    } catch (e) {
      const m = String((e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || '');
      setErr(/reject|denied|declin|closed/i.test(m) ? 'The wallet request was closed. Nothing was connected.' : 'That wallet did not connect. Try the other option.');
    }
  }

  return (
    <div className={`connect${compact ? ' connect-compact' : ''}`} ref={box}>
      {!connected && header ? (
        <Link href="/#find" className="btn btn-accent btn-sm header-cta" ref={setMain}>Check my wallet</Link>
      ) : !connected ? (
        <button type="button" className="btn btn-accent btn-sm" ref={setMain} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
          {isPending ? 'Connecting…' : prompt ?? 'Connect wallet'}
        </button>
      ) : !session.signedIn && !header ? (
        <button type="button" className="btn btn-accent btn-sm" ref={setMain} onClick={() => void signIn()} disabled={session.busy}>
          {session.busy ? 'Check your wallet…' : compact ? 'Sign in' : `Sign in as ${shortAddr(address!)}`}
        </button>
      ) : (
        <button type="button" className="btn btn-sm connect-me" ref={setMain} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
          <i aria-hidden="true" />
          <span className="num">{shortAddr(address!)}</span>
        </button>
      )}
      {connected && !session.signedIn && !compact && <p className="connect-note">One free signature proves the wallet is yours. It moves no funds.</p>}
      {session.error && session.errorBy === uid && !open && <p className="connect-err" role="status">{session.error}</p>}
      {open && (
        <div className="connect-menu" role="dialog" aria-label={connected ? 'Wallet' : 'Choose a wallet'}>
          {!connected ? (
            <>
              <p className="connect-title">Choose a wallet</p>
              {list.map((c) => (
                <button key={c.uid} type="button" className="connect-opt" onClick={() => void pick(c.id)}>
                  <b>{LABELS[c.id]?.name ?? c.name}</b>
                  <small>{LABELS[c.id]?.note}</small>
                </button>
              ))}
              {!hasInjected && <p className="connect-hint">No wallet found in this browser. Base Account works without one.</p>}
              <p className="connect-hint">Base mainnet only. Connecting shares your address and nothing else.</p>
              {err && <p className="connect-err" role="status">{err}</p>}
            </>
          ) : (
            <>
              <p className="connect-title num">{shortAddr(address!)}</p>
              {!session.signedIn && (
                <button type="button" className="connect-opt" onClick={() => void signIn()} disabled={session.busy}>
                  <b>{session.busy ? 'Check your wallet…' : 'Sign in'}</b>
                  <small>One free signature proves the wallet is yours. It moves no funds.</small>
                </button>
              )}
              <a className="connect-opt" href={`/statement/${address!.toLowerCase()}`}><b>My statement</b><small>Cost-basis statement (estimate)</small></a>
              <a className="connect-opt" href={`/ticket/${address!.toLowerCase()}`}><b>My tickets</b><small>Where this wallet ranks as a real holder</small></a>
              <button
                type="button"
                className="connect-opt"
                onClick={() => {
                  void session.signOut();
                  disconnect();
                  setOpen(false);
                }}
              >
                <b>Disconnect</b>
                <small>Signs out on this device</small>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
