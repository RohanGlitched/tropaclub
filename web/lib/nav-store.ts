'use client';

// A tiny shared state for the navigation pieces that live in different parts of the page
// (header buttons, bottom bar, the overlays, "your ticket" links). No context provider needed.
import { useSyncExternalStore } from 'react';

export type Panel = 'map' | 'jump' | null;
interface NavState {
  panel: Panel;
  /** The signed-in wallet: a string, null when known to be signed out, undefined when not asked yet. */
  wallet: string | null | undefined;
}

let state: NavState = { panel: null, wallet: undefined };
let opener: HTMLElement | null = null;
const subs = new Set<() => void>();
const SERVER: NavState = { panel: null, wallet: undefined };

function set(next: Partial<NavState>) {
  state = { ...state, ...next };
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function useNav(): NavState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

/** Open a panel. The element that asked gets focus back when it closes. */
export function openPanel(panel: Exclude<Panel, null>, from?: Element | null) {
  if (from instanceof HTMLElement) opener = from;
  else if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) opener = document.activeElement;
  set({ panel });
}
export function closePanel(restoreFocus = true) {
  const el = opener;
  opener = null;
  set({ panel: null });
  if (restoreFocus && el && el.isConnected) requestAnimationFrame(() => el.focus({ preventScroll: true }));
}
export function setKnownWallet(wallet: string | null | undefined) {
  if (wallet !== state.wallet) set({ wallet });
}
export const knownWallet = () => state.wallet;

let asking: Promise<string | null> | null = null;
/** Ask the server once whether this visitor is signed in (static pages do not know). */
export function askWallet(): Promise<string | null> {
  if (state.wallet !== undefined) return Promise.resolve(state.wallet);
  asking ??= fetch('/api/auth/session', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { wallet?: string | null } | null) => {
      const w = j && typeof j.wallet === 'string' && /^0x[0-9a-fA-F]{40}$/.test(j.wallet) ? j.wallet.toLowerCase() : null;
      setKnownWallet(w);
      return w;
    })
    .catch(() => null)
    .finally(() => {
      asking = null;
    });
  return asking;
}

// Recent destinations, in this browser only. Storage can be missing or blocked: never let it throw.
export interface Recent { href: string; label: string }
const KEY = 'tc-recent-v1';
export function readRecent(): Recent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((r): r is Recent => r && typeof r.href === 'string' && typeof r.label === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}
export function pushRecent(r: Recent) {
  try {
    const list = [r, ...readRecent().filter((x) => x.href !== r.href)].slice(0, 6);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode: no recents */
  }
}

/** True while any <dialog> is open (the buy sheet, the map, quick jump). */
export const anyDialogOpen = () => !!document.querySelector('dialog[open]');
