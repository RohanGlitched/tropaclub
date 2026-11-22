'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { askWallet, useNav } from '@/lib/nav-store';
import { shortAddr } from '@/lib/format';

/**
 * The header's one action on the read-only pages: "Check my wallet" when signed out, the short
 * address (opening that wallet's tickets) when this visitor is signed in. Club pages use the
 * wallet button in header mode, which keeps the same two labels.
 */
export default function HeaderWallet() {
  const { wallet } = useNav();
  useEffect(() => {
    void askWallet();
  }, []);
  if (wallet) {
    return (
      <Link href={`/ticket/${wallet}`} className="btn btn-sm connect-me header-cta" prefetch={false}>
        <i aria-hidden="true" />
        <span className="num">{shortAddr(wallet)}</span>
      </Link>
    );
  }
  return <Link href="/#find" className="btn btn-accent btn-sm header-cta">Check my wallet</Link>;
}
