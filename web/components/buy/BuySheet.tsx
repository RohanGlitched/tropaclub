'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, usePublicClient, useSwitchChain } from 'wagmi';
import { WALLET_CANT_TAG_MESSAGE, accountKind, planSend, type Call } from '@buy/calls';
import { decodeRevert } from '@buy/revert';
import ConnectButton from '@/components/wallet/ConnectButton';
import { useSession } from '@/components/wallet/WalletProvider';
import { shortAddr } from '@/lib/format';

interface BuyToken { address: string; symbol: string; name: string; buyable: boolean; reason: string | null; referencePrice: boolean; reopenGapRisk: boolean }
interface Quote {
  ok: true; token: string; symbol: string; pay: 'USDC' | 'ETH'; usd: number;
  calls: { to: string; data: string; value: string; label: string }[];
  shares: string; minShares: string; pricePerShareUsd: number; paying: string;
  markSource: string; referencePrice: boolean; reopenGapRisk: boolean; venues: string[]; expiresAt: number;
}
type QuoteState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; q: Quote } | { status: 'hold'; message: string; retry: boolean; needsFunds?: 'USDC' | 'ETH' };
type StepState = 'todo' | 'wallet' | 'chain' | 'done' | 'failed';
type Phase = 'form' | 'sending' | 'recording' | 'done' | 'failed';
type Eip1193 = { request(args: { method: string; params?: unknown }): Promise<unknown> };

const PRESETS = [10, 25, 50];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One plain sentence for anything that can go wrong between the wallet and the chain. */
function explain(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; message?: string; data?: unknown; cause?: { data?: unknown; code?: number } };
  const msg = String(err?.shortMessage || err?.message || e || '');
  const code = err?.code ?? err?.cause?.code;
  if (code === 4001 || /user rejected|user denied|rejected the request|declined|cancell?ed/i.test(msg)) return 'You declined the request in your wallet. Nothing was sent.';
  if (/insufficient funds|gas required exceeds|exceeds the balance/i.test(msg)) return 'The wallet does not hold enough ETH on Base to pay the network fee. Nothing was bought.';
  if (/chain|network/i.test(msg) && /switch|mismatch|unsupported|does not match/i.test(msg)) return 'The wallet is not on Base. Switch it to Base and try again.';
  const data = (typeof err?.data === 'string' ? err.data : typeof err?.cause?.data === 'string' ? err.cause.data : null) as `0x${string}` | null;
  if (data || /revert/i.test(msg)) return decodeRevert(data, msg.replace(/^.*reverted with reason string\s*/i, '').slice(0, 160)).sentence;
  if (/timed out|timeout/i.test(msg)) return 'The network took too long to answer. Check your wallet history before trying again.';
  return 'The wallet could not send the transaction, so nothing was bought. Try again.';
}

interface Props {
  open: boolean;
  onClose: () => void;
  clubId?: string | null;
  /** Token address to preselect (stock clubs). */
  token?: string | null;
  /** United States: the sheet explains and offers no buy button. */
  us: boolean;
}
const NOT_US_KEY = 'tropa-not-us';

export default function BuySheet({ open, onClose, clubId = null, token = null, us }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const { address, isConnected, connector, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: 8453 });
  const session = useSession();
  const ready = isConnected && session.signedIn;

  const [tokens, setTokens] = useState<BuyToken[] | null>(null);
  const [tokensErr, setTokensErr] = useState(false);
  const [sel, setSel] = useState<string>(token?.toLowerCase() ?? '');
  const [usd, setUsd] = useState(10);
  const [pay, setPay] = useState<'USDC' | 'ETH'>('USDC');
  const [quote, setQuote] = useState<QuoteState>({ status: 'idle' });
  const [notUs, setNotUs] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [steps, setSteps] = useState<{ label: string; state: StepState }[]>([]);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [record, setRecord] = useState<{ recorded: boolean; attributed: boolean | null; message: string | null; promoted: boolean } | null>(null);
  // a contract wallet that can neither tag the buy itself nor take wallet_sendCalls: no buy button
  const [blocked, setBlocked] = useState(false);
  const seq = useRef(0);

  // Everyone confirms "I am not a US person" before their first buy. The tick is remembered on this device.
  useEffect(() => {
    try {
      if (localStorage.getItem(NOT_US_KEY) === '1') setNotUs(true);
    } catch {
      /* private mode */
    }
  }, []);
  const tickNotUs = (v: boolean) => {
    setNotUs(v);
    try {
      if (v) localStorage.setItem(NOT_US_KEY, '1');
      else localStorage.removeItem(NOT_US_KEY);
    } catch {
      /* private mode */
    }
  };

  // open / close the native dialog (focus trap and Escape come with it)
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // the list of stocks that can be bought right now
  useEffect(() => {
    if (!open || us || tokens) return;
    let live = true;
    setTokensErr(false);
    fetch(token ? `/api/buy/tokens?token=${token.toLowerCase()}` : '/api/buy/tokens')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { tokens: BuyToken[] }) => {
        if (!live) return;
        setTokens(j.tokens);
        setSel((s) => (s && j.tokens.some((t) => t.address === s && t.buyable) ? s : j.tokens.find((t) => t.buyable)?.address ?? ''));
      })
      .catch(() => live && setTokensErr(true));
    return () => {
      live = false;
    };
  }, [open, us, tokens, token]);

  /** Code at the address (smart wallet, EIP-7702 delegation) and the wallet's ERC-5792 capabilities. */
  const readAccount = useCallback(async () => {
    if (!address || !connector) return null;
    // undefined (no code, or the read failed) plans as an EOA
    const code = publicClient ? await publicClient.getCode({ address }).catch(() => undefined) : undefined;
    const provider = (await connector.getProvider()) as Eip1193;
    const caps = (await provider.request({ method: 'wallet_getCapabilities', params: [address] }).catch(() => null)) as Record<string, Record<string, unknown>> | null;
    return { code, caps, provider };
  }, [address, connector, publicClient]);

  // before any quote: can this wallet carry the Builder Code for this account?
  useEffect(() => {
    setBlocked(false);
    if (!open || us || !ready || !address || !connector || !publicClient) return;
    let live = true;
    void (async () => {
      const code = await publicClient.getCode({ address }).catch(() => undefined);
      // a plain EOA is never blocked, so only a contract account is asked for its capabilities here
      if (!live || accountKind(code) === 'eoa') return;
      const provider = (await connector.getProvider()) as Eip1193;
      const caps = (await provider.request({ method: 'wallet_getCapabilities', params: [address] }).catch(() => null)) as Record<string, Record<string, unknown>> | null;
      if (live) setBlocked(planSend([], address, caps, { code }).kind === 'blocked');
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [open, us, ready, address, connector, publicClient]);

  const fetchQuote = useCallback(async (): Promise<QuoteState> => {
    if (!address || !sel || !notUs) return { status: 'idle' };
    try {
      const res = await fetch('/api/buy/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: sel, pay, usd, taker: address, notUsPerson: notUs }), signal: AbortSignal.timeout(35000) });
      const j = await res.json();
      if (!res.ok) return { status: 'hold', message: j.error || 'The quote could not be made just now.', retry: res.status !== 403 };
      return j.ok ? { status: 'ready', q: j as Quote } : { status: 'hold', message: j.message, retry: !!j.retry, needsFunds: j.needsFunds };
    } catch {
      return { status: 'hold', message: 'The quote did not arrive. Check your connection and try again.', retry: true };
    }
  }, [address, sel, pay, usd, notUs]);

  // live quote: on every change, and refreshed while the form is open
  useEffect(() => {
    if (!open || us || blocked || phase !== 'form' || !ready || !address || !sel || !notUs) return;
    let live = true;
    const run = async (quiet: boolean) => {
      const id = ++seq.current;
      if (!quiet) setQuote({ status: 'loading' });
      const q = await fetchQuote();
      if (live && id === seq.current) setQuote(q);
    };
    void run(false);
    const t = setInterval(() => document.visibilityState === 'visible' && void run(true), 20000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [open, us, blocked, phase, ready, address, sel, pay, usd, notUs, fetchQuote]);

  const picked = tokens?.find((t) => t.address === sel) ?? null;
  const onHold = tokens?.filter((t) => !t.buyable) ?? [];

  async function buy() {
    if (!address || !connector || blocked) return;
    setError('');
    setPhase('sending');
    setTxHash(null);
    setRecord(null);
    try {
      let q = quote.status === 'ready' ? quote.q : null;
      if (!q || Date.now() > q.expiresAt - 4000) {
        const fresh = await fetchQuote();
        setQuote(fresh);
        if (fresh.status !== 'ready') {
          setPhase('form');
          return;
        }
        q = fresh.q;
      }
      // plan first: a wallet that cannot tag the buy is stopped before anything reaches it to sign
      const acct = await readAccount();
      if (!acct) throw new Error('no wallet');
      const { provider, caps, code } = acct;
      const calls: Call[] = q.calls.map((c) => ({ to: c.to as `0x${string}`, data: c.data as `0x${string}`, value: BigInt(c.value), label: c.label }));
      const plan = planSend(calls, address, caps, { code });
      if (plan.kind === 'blocked') {
        setBlocked(true);
        setPhase('form');
        return;
      }
      setSteps([...q.calls.map((c) => ({ label: c.label, state: 'todo' as StepState })), { label: 'Confirm on Base', state: 'todo' as StepState }]);
      const mark = (i: number, state: StepState) => setSteps((s) => s.map((x, k) => (k === i ? { ...x, state } : x)));
      if (chainId !== 8453) await switchChainAsync({ chainId: 8453 });
      const last = q.calls.length;
      let hash: string | null = null;

      if (plan.kind === 'sendCalls') {
        // one request: the wallet runs approve and buy together
        q.calls.forEach((_, i) => mark(i, 'wallet'));
        const res = (await provider.request(plan.request)) as string | { id: string };
        const id = typeof res === 'string' ? res : res.id;
        q.calls.forEach((_, i) => mark(i, 'done'));
        mark(last, 'chain');
        for (let n = 0; n < 80 && !hash; n++) {
          await wait(1500);
          const st = (await provider.request({ method: 'wallet_getCallsStatus', params: [id] }).catch(() => null)) as { status?: number | string; receipts?: { transactionHash: string; status?: string | number }[] } | null;
          const code = typeof st?.status === 'number' ? st.status : st?.status === 'CONFIRMED' ? 200 : st?.status === 'PENDING' ? 100 : 0;
          if (code >= 400) throw new Error('execution reverted');
          if (code >= 200 && st?.receipts?.length) {
            const r = st.receipts[st.receipts.length - 1];
            if (r.status === 'reverted' || r.status === '0x0' || r.status === 0) throw new Error('execution reverted');
            hash = r.transactionHash;
          }
        }
        if (!hash) throw new Error('timed out');
      } else {
        // one transaction at a time, each waited for
        for (let i = 0; i < plan.requests.length; i++) {
          mark(i, 'wallet');
          const h = (await provider.request(plan.requests[i])) as `0x${string}`;
          mark(i, 'chain');
          const rc = await publicClient!.waitForTransactionReceipt({ hash: h, timeout: 120_000 });
          if (rc.status !== 'success') throw new Error('execution reverted');
          mark(i, 'done');
          // an approval sent on its own also carries the Builder Code: report it so it is counted apart from swaps
          if (i < plan.requests.length - 1) void fetch('/api/buy/approval', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: h, wallet: address }) }).catch(() => {});
          hash = h;
        }
        mark(last, 'chain');
      }
      mark(last, 'done');
      setTxHash(hash);
      setPhase('recording');

      // tell the server: it checks the Builder Code on the transaction and records the buy
      let out: { recorded: boolean; attributed: boolean | null; message: string | null; promoted: boolean; retryable?: boolean } | null = null;
      for (let n = 0; n < 5; n++) {
        const r = await fetch('/api/buy/record', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: hash, wallet: address, clubId, notUsPerson: notUs }) }).catch(() => null);
        out = r ? await r.json().catch(() => null) : null;
        if (out && (out.recorded || !out.retryable)) break;
        await wait(2500);
      }
      setRecord(out ? { recorded: !!out.recorded, attributed: out.attributed ?? null, message: out.message ?? (out as { error?: string }).error ?? null, promoted: !!out.promoted } : { recorded: false, attributed: null, message: 'The buy went through, but it could not be recorded yet. It will be picked up by the hourly sweep.', promoted: false });
      setPhase('done');
      router.refresh();
    } catch (e) {
      setSteps((s) => s.map((x) => (x.state === 'wallet' || x.state === 'chain' ? { ...x, state: 'failed' } : x)));
      setError(explain(e));
      setPhase('failed');
    }
  }

  const close = () => {
    if (phase === 'sending' || phase === 'recording') return; // a transaction is in flight
    setPhase('form');
    setSteps([]);
    setError('');
    onClose();
  };

  const q = quote.status === 'ready' ? quote.q : null;
  const why = !isConnected
    ? 'Connect a wallet to see a live quote.'
    : !session.signedIn
      ? 'Sign in with one free signature, so the buy is recorded for your wallet.'
      : !notUs
        ? 'Tick “I am not a US person” to see a live quote.'
        : blocked
          ? ''
          : !sel
      ? 'Pick a stock.'
      : quote.status === 'loading' || quote.status === 'idle'
        ? 'Getting a live quote…'
        : quote.status === 'hold'
          ? ''
          : '';
  const canBuy = !!q && !why && !blocked && phase === 'form';

  return (
    <dialog ref={ref} className="sheet-dialog" onClose={close} onCancel={(e) => { if (phase === 'sending' || phase === 'recording') e.preventDefault(); }} aria-labelledby="buy-title">
      <div className="buy">
        <header className="buy-head">
          <h2 id="buy-title">Buy a stock token</h2>
          <button type="button" className="buy-x" onClick={close} aria-label="Close" disabled={phase === 'sending' || phase === 'recording'}>×</button>
        </header>

        {us ? (
          <div className="buy-body">
            <p className="notice"><b>Buying isn't available in your region.</b> Not available to US persons or in sanctioned regions. Grounds, tickets and stock rankings stay open to you.</p>
            <button type="button" className="btn" onClick={close}>Close</button>
          </div>
        ) : phase === 'done' ? (
          <div className="buy-body">
            <p className="buy-ok"><b>Bought.</b> {q ? `About ${q.shares} shares’ worth of ${q.symbol} is in your wallet.` : 'The tokens are in your wallet.'}</p>
            {txHash && <p><a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer">See the transaction on BaseScan</a></p>}
            <ul className="buy-facts">
              <li>{record?.recorded ? (record.promoted ? 'Recorded. You played this gameweek.' : clubId ? 'Recorded for your club.' : 'Recorded. It counts toward the season.') : record?.message ?? 'Recording…'}</li>
              {record?.attributed != null && <li>{record.attributed ? 'Counted as a Tropa Club buy on Base.' : 'This wallet did not carry our Builder Code on the transaction, so it is not counted in our stats.'}</li>}
            </ul>
            <div className="buy-next">
              <h3>What next</h3>
              <a className="buy-next-row" href={address ? `/ticket/${address.toLowerCase()}` : '/'}>
                <b>Share your ticket</b>
                <small>Your ticket, ready to post. A new holding shows on it at the next count, every 6 hours.</small>
              </a>
              <a className="buy-next-row" href={clubId ? `/club/${encodeURIComponent(clubId)}#invite` : '/clubs#start'}>
                <b>{clubId ? 'Invite your group chat' : 'Start a club for your group chat'}</b>
                <small>{clubId ? 'Send the invite link. Anyone who opens it can join the club for free, with no buy needed.' : 'Free, takes a minute. This buy already counts for you.'}</small>
              </a>
              {clubId && (
                <a className="buy-next-row" href={`/club/${encodeURIComponent(clubId)}#team`}>
                  <b>Nudge a teammate</b>
                  <small>You played, so you can send a nudge to anyone who hasn’t bought yet. If 80% of members buy this week, the club gets a bonus point.</small>
                </a>
              )}
            </div>
            <button type="button" className="btn" onClick={close}>Done</button>
          </div>
        ) : (
          <div className="buy-body">
            {!ready && (
              <div className="buy-connect">
                <p>{isConnected ? 'One free signature proves the wallet is yours, so this buy is recorded for it. It moves no funds.' : 'Buying happens from your own wallet. Tropa Club never holds your money.'}</p>
                <ConnectButton />
              </div>
            )}

            <fieldset disabled={phase !== 'form'}>
              <label className="buy-field">
                <span>Stock</span>
                {tokens ? (
                  <select value={sel} onChange={(e) => setSel(e.target.value)}>
                    {tokens.filter((t) => t.buyable).map((t) => (
                      <option key={t.address} value={t.address}>{t.name} ({t.symbol}){t.referencePrice ? '' : ', no reference price'}</option>
                    ))}
                  </select>
                ) : tokensErr ? (
                  <span className="buy-inline-err">The list of stocks did not load. <button type="button" className="linklike" onClick={() => setTokens(null)}>Try again</button></span>
                ) : (
                  <span className="skeleton-line" aria-busy="true" />
                )}
              </label>
              {tokens && token && !tokens.some((t) => t.address === token.toLowerCase() && t.buyable) && (
                <p className="buy-hold">{tokens.find((t) => t.address === token.toLowerCase())?.reason ?? 'The stock you came from cannot be bought here right now.'} You can pick another above.</p>
              )}
              {picked && !picked.referencePrice && <p className="buy-note">No reference price: this stock has no live price feed, so the guard uses the 30-minute pool average.</p>}

              <div className="buy-field" role="radiogroup" aria-label="Amount">
                <span>Amount</span>
                <div className="seg">
                  {PRESETS.map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={usd === v} className={usd === v ? 'on' : ''} onClick={() => setUsd(v)}>${v}</button>
                  ))}
                </div>
              </div>
              <div className="buy-field" role="radiogroup" aria-label="Pay with">
                <span>Pay with</span>
                <div className="seg">
                  {(['USDC', 'ETH'] as const).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={pay === v} className={pay === v ? 'on' : ''} onClick={() => setPay(v)}>{v}</button>
                  ))}
                </div>
              </div>
            </fieldset>

            <label className="buy-check">
              <input type="checkbox" checked={notUs} onChange={(e) => tickNotUs(e.target.checked)} disabled={phase !== 'form'} />
              <span>I am not a US person.</span>
            </label>

            <div className="buy-quote" aria-live="polite">
              {!ready || !notUs ? (
                <p className="muted">{why}</p>
              ) : blocked ? (
                <p className="buy-hold" role="alert">{WALLET_CANT_TAG_MESSAGE}</p>
              ) : quote.status === 'hold' ? (
                <p className="buy-hold">{quote.message} {quote.retry && <button type="button" className="linklike" onClick={() => { setQuote({ status: 'loading' }); void fetchQuote().then(setQuote); }}>Get a new quote</button>}</p>
              ) : q ? (
                <dl>
                  <div><dt>You pay</dt><dd className="num">{q.paying}</dd></div>
                  <div><dt>You get about</dt><dd className="num">{q.shares} <small>shares’ worth of {q.symbol}</small></dd></div>
                  <div><dt>Reference price</dt><dd className="num">${q.pricePerShareUsd.toFixed(2)} <small>a share</small></dd></div>
                  <div><dt>Guard</dt><dd><span className="num">{q.minShares}</span> <small>at least, or the buy stops (1.5%)</small></dd></div>
                </dl>
              ) : (
                <div className="buy-skel" aria-busy="true"><span /><span /><span /><span /></div>
              )}
              {!blocked && quote.status === 'hold' && quote.needsFunds && address && (
                <div className="buy-funds">
                  <h3>Add funds to this wallet</h3>
                  {connector?.id === 'coinbaseWalletSDK' && (
                    <p><a className="btn btn-sm" href="https://keys.coinbase.com" target="_blank" rel="noopener noreferrer">Open your Base Account</a> and choose “Add funds”.</p>
                  )}
                  <ol>
                    <li>Buy {quote.needsFunds} at an exchange you already use.</li>
                    <li>Withdraw it to the address below, choosing the <b>Base</b> network.</li>
                    <li>Come back and tap “Get a new quote”. {quote.needsFunds === 'USDC' ? 'Keep a few cents of ETH on Base for gas.' : ''}</li>
                  </ol>
                  <p className="buy-addr">
                    <span className="num">{address}</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(address);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        } catch {
                          window.prompt('Copy this address', address);
                        }
                      }}
                    >
                      {copied ? 'Copied' : 'Copy address'}
                    </button>
                  </p>
                  <p><button type="button" className="linklike" onClick={() => { setQuote({ status: 'loading' }); void fetchQuote().then(setQuote); }}>Get a new quote</button></p>
                </div>
              )}
              {!blocked && q?.reopenGapRisk && (
                <p className="buy-gap" role="note">
                  <b>The stock market is closed.</b>{' '}
                  {q.markSource === 'twap'
                    ? 'There is no official price to check against right now, so the 1.5% guard is measured against this token’s own average price on the exchange over the last 30 minutes. That is not a fair-value check, and the price can jump when the market reopens.'
                    : 'The reference price is the last official one. The token trades on, and its price can jump when the market reopens.'}
                </p>
              )}
            </div>


            {steps.length > 0 && (
              <ol className="buy-steps" aria-label="Progress">
                {steps.map((s, i) => (
                  <li key={i} data-state={s.state}>
                    <i aria-hidden="true" />
                    <span>{s.label}</span>
                    <small>{s.state === 'wallet' ? 'Confirm in your wallet' : s.state === 'chain' ? 'Waiting for Base' : s.state === 'done' ? 'Done' : s.state === 'failed' ? 'Stopped' : ''}</small>
                  </li>
                ))}
              </ol>
            )}
            {phase === 'recording' && <p className="muted" role="status">Recording the buy for your club…</p>}
            {error && <p className="buy-error" role="alert">{error}</p>}

            <div className="buy-go">
              {phase === 'failed' ? (
                <button type="button" className="btn btn-accent" onClick={() => { setPhase('form'); setSteps([]); setError(''); }}>Try again</button>
              ) : (
                <button type="button" className="btn btn-accent" onClick={() => void buy()} disabled={!canBuy}>
                  {phase === 'sending' ? 'Buying…' : phase === 'recording' ? 'Recording…' : `Buy $${usd} of ${picked?.symbol ?? 'stock'}`}
                </button>
              )}
              {why && phase === 'form' && ready && notUs && <span className="buy-why">{why}</span>}
            </div>

            <ul className="buy-fine">
              <li>{picked?.symbol ?? 'A stock token'} is a stock token that tracks the share price. It is not the share and carries no vote.</li>
              <li>Buys here don’t earn third-party cashback.</li>
              <li>Sent from {address ? shortAddr(address) : 'your wallet'} through a public exchange route. Tropa Club takes no fee and never holds funds. Not advice.</li>
            </ul>
          </div>
        )}
      </div>
    </dialog>
  );
}
