'use client';

import { useEffect } from 'react';

/**
 * Region gate, client half. The inline script in <head> has already applied the tc_region cookie
 * if there is one. On a first visit there is none: club sections stay invisible (data-region
 * "pending") until /api/region answers and leaves the cookie. Nothing wrong is ever shown.
 */
export default function RegionGate() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.region !== 'pending') return;
    let live = true;
    fetch('/api/region', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live) return;
        if (j && j.clubs === false) root.dataset.region = 'restricted';
        else root.dataset.region = j?.region === 'unknown' ? 'unknown' : 'ok';
      })
      .catch(() => {
        if (live) root.dataset.region = 'unknown';
      });
    return () => {
      live = false;
    };
  }, []);
  return null;
}
