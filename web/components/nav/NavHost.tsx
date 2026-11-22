'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { usePathname } from 'next/navigation';
import { labelFor, sectionOf, type JumpToken, type Section } from '@/lib/nav';
import { anyDialogOpen, closePanel, openPanel, pushRecent, setKnownWallet, useNav } from '@/lib/nav-store';

/** What both overlays receive. */
export interface PanelProps {
  tokens: JumpToken[];
  ground: string;
  wallet: string | null | undefined;
  here: Section | null;
  onClose: () => void;
}

// The map and quick jump are only downloaded when first wanted (hover, focus, shortcut or tap).
type Mod = { default: ComponentType<PanelProps> };
const loaders = { map: () => import('./StadiumMap'), jump: () => import('./QuickJump') };
const loading: Partial<Record<keyof typeof loaders, Promise<Mod>>> = {};
export function preloadPanels(which: keyof typeof loaders): Promise<Mod> {
  return (loading[which] ??= loaders[which]().catch((e) => {
    delete loading[which];
    throw e;
  }));
}

const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|reset|range|color|file)$/i.test((el as HTMLInputElement).type)));

/**
 * Hosts the stadium map and quick jump: keyboard shortcuts (Ctrl/Cmd+K, and "/" outside text
 * fields), the lazy imports, and the "Recent" list. Renders nothing until a panel is opened.
 */
export default function NavHost({ tokens, ground, wallet }: { tokens: JumpToken[]; ground: string; wallet?: string | null }) {
  const { panel, wallet: known } = useNav();
  const pathname = usePathname();
  const [mods, setMods] = useState<Partial<Record<'map' | 'jump', ComponentType<PanelProps>>>>({});

  useEffect(() => {
    if (wallet !== undefined) setKnownWallet(wallet);
  }, [wallet]);

  useEffect(() => {
    if (!panel || mods[panel]) return;
    let live = true;
    preloadPanels(panel)
      .then((m) => live && setMods((s) => ({ ...s, [panel]: m.default })))
      .catch(() => live && closePanel());
    return () => {
      live = false;
    };
  }, [panel, mods]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const k = e.key.toLowerCase();
      const combo = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k === 'k';
      const slash = k === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextField(e.target);
      if (!combo && !slash) return;
      // never stack on top of the buy sheet or another dialog; Ctrl+K inside quick jump closes it
      const open = anyDialogOpen();
      if (open && !(combo && document.querySelector('dialog.qj[open]'))) return;
      e.preventDefault();
      if (open) closePanel();
      else openPanel('jump');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Recent destinations: every page visited, under a name worth reading.
  useEffect(() => {
    const label = pathname ? labelFor(pathname, tokens) : null;
    if (label) pushRecent({ href: pathname, label });
  }, [pathname, tokens]);

  const Panel = panel ? mods[panel] : undefined;
  return Panel ? <Panel tokens={tokens} ground={ground} wallet={known} here={sectionOf(pathname)} onClose={closePanel} /> : null;
}
