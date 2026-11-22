'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, fallback, http, useAccount, useSignMessage } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected } from 'wagmi/connectors';

// Base mainnet only. Base Account / Coinbase Smart Wallet first, then whatever wallet the browser has.
// Keyless public RPCs with fallback. WalletConnect is left out: it needs a project id.
export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [coinbaseWallet({ appName: 'Tropa Club', appLogoUrl: 'https://tropaclub.xyz/brand/icon-512.png', preference: 'smartWalletOnly' }), injected({ shimDisconnect: true })],
  transports: { [base.id]: fallback([http('https://base-rpc.publicnode.com'), http('https://mainnet.base.org')]) },
  ssr: true,
});

interface Session {
  /** The wallet the server knows is yours (signed in), lowercase. */
  wallet: string | null;
  /** Connected and signed in as the same wallet. */
  signedIn: boolean;
  ready: boolean;
  busy: boolean;
  error: string;
  /** Which control asked for the sign-in that set `error` (the id passed to signIn), so only that one shows it. */
  errorBy: string | null;
  /** One free signature. Resolves to the wallet, or null if it was declined. `by`: the asking control's id. */
  signIn: (by?: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}
const SessionContext = createContext<Session>({ wallet: null, signedIn: false, ready: false, busy: false, error: '', errorBy: null, signIn: async () => null, signOut: async () => {} });
export const useSession = () => useContext(SessionContext);

function SessionProvider({ initialWallet, children }: { initialWallet: string | null; children: ReactNode }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [wallet, setWallet] = useState<string | null>(initialWallet);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorBy, setErrorBy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => live && setWallet(j.wallet ?? null))
      .catch(() => {})
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  const signIn = useCallback(async (by?: string) => {
    setErrorBy(by ?? null);
    if (!address) {
      setError('Connect a wallet first.');
      return null;
    }
    setBusy(true);
    setError('');
    try {
      const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const c = await post('/api/auth/challenge', { address });
      if (!c.ok) throw new Error((await c.json()).error || 'Sign-in could not start.');
      const { message, token } = await c.json();
      const signature = await signMessageAsync({ message });
      const v = await post('/api/auth/verify', { address, token, message, signature });
      if (!v.ok) throw new Error((await v.json()).error || 'Sign-in failed.');
      const w = address.toLowerCase();
      setWallet(w);
      router.refresh();
      return w;
    } catch (e) {
      const m = String((e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || '');
      setError(/reject|denied|declin/i.test(m) ? 'You declined the signature, so you are not signed in.' : m || 'Sign-in failed. Try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [address, signMessageAsync, router]);

  const signOut = useCallback(async () => {
    await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {});
    setWallet(null);
    router.refresh();
  }, [router]);

  const value = useMemo<Session>(
    () => ({ wallet, signedIn: !!wallet && isConnected && address?.toLowerCase() === wallet, ready, busy, error, errorBy, signIn, signOut }),
    [wallet, isConnected, address, ready, busy, error, errorBy, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export default function WalletProvider({ initialWallet, children }: { initialWallet: string | null; children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider initialWallet={initialWallet}>{children}</SessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
