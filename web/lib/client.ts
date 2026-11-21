'use client';

import { useEffect, useState } from 'react';
import type { Seat, TokenSeatsFile, WalletSummary } from '@shared/types';
import { isAddress } from './format';

export type Resolved = { ok: true; address: string; name?: string } | { ok: false; message: string };

async function getJson<T>(url: string, ms = 9000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

/** Accepts a 0x address, or a basename / ENS name. */
export async function resolveInput(raw: string): Promise<Resolved> {
  const v = raw.trim();
  if (!v) return { ok: false, message: 'Paste a wallet address to find its seat.' };
  if (isAddress(v)) return { ok: true, address: v.toLowerCase() };
  if (/^0x/i.test(v)) return { ok: false, message: 'That address is not 42 characters long. Check it and paste it again.' };
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v)) {
    try {
      const r = await getJson<{ address?: string; message?: string }>(`/api/resolve?name=${encodeURIComponent(v.toLowerCase())}`);
      if (r.address && isAddress(r.address)) return { ok: true, address: r.address.toLowerCase(), name: v.toLowerCase() };
      return { ok: false, message: r.message || `No wallet found for ${v}. Paste the 0x address instead.` };
    } catch {
      return { ok: false, message: 'The name lookup did not answer. Paste the 0x address instead.' };
    }
  }
  return { ok: false, message: 'Enter a 0x address, or a name such as yourname.base.eth.' };
}

export async function fetchWallet(address: string): Promise<{ wallet: WalletSummary | null; source: 'live' | 'mock' }> {
  return getJson(`/api/wallet/${address}`);
}

const seatCache = new Map<string, Promise<TokenSeatsFile | null>>();
function loadSeats(symbol: string, base?: string | null): Promise<TokenSeatsFile | null> {
  let p = seatCache.get(symbol);
  if (!p) {
    // with live data the file comes straight from the public bucket (gzip, preloaded by the page)
    const url = base ? `${base}/tokens/${encodeURIComponent(symbol)}.json` : `/api/seats/${encodeURIComponent(symbol)}`;
    p = (base ? fetch(url, { signal: AbortSignal.timeout(25000) }).then((r) => (r.ok ? (r.json() as Promise<TokenSeatsFile>) : Promise.reject(new Error(String(r.status))))) : getJson<TokenSeatsFile>(url, 25000))
      .then((f) => (f && Array.isArray(f.seats) ? f : null))
      .catch(() => {
        seatCache.delete(symbol);
        return null;
      });
    seatCache.set(symbol, p);
  }
  return p;
}

export type SeatsState = { status: 'loading' | 'ready' | 'missing'; seats: Seat[]; kinds: Uint8Array | null; asOf?: string };

const KIND_CODE: Record<string, number> = { real: 0, dust: 1, farmer: 2, contract: 3, pool: 3 };

/** The full seat list for one ground. Shared between the stadium and the lists under it. */
export function useSeats(symbol: string, enabled = true, base?: string | null): SeatsState {
  const [state, setState] = useState<SeatsState>({ status: 'loading', seats: [], kinds: null });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState({ status: 'loading', seats: [], kinds: null });
    loadSeats(symbol, base).then((f) => {
      if (!live) return;
      if (!f || !f.seats.length) return setState({ status: 'missing', seats: [], kinds: null });
      const kinds = new Uint8Array(f.seats.length);
      for (let i = 0; i < f.seats.length; i++) kinds[i] = KIND_CODE[f.seats[i]?.k] ?? 1;
      setState({ status: 'ready', seats: f.seats, kinds, asOf: f.asOf });
    });
    return () => {
      live = false;
    };
  }, [symbol, enabled, base]);
  return state;
}
