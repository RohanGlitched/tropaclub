'use client';

import Link from 'next/link';
import { useNav } from '@/lib/nav-store';

/** "Your ticket": the signed-in wallet's ticket when the header knows it, else the paste-a-wallet box. */
export default function MyTicketLink({ className, title, sub }: { className?: string; title: string; sub: string }) {
  const { wallet } = useNav();
  return (
    <Link className={className} href={wallet ? `/ticket/${wallet}` : '/#find'} prefetch={false}>
      <span className="next-title">{title}</span>
      <span className="next-sub">{wallet ? sub : 'Paste any wallet to see its ticket'}</span>
      <span className="next-arrow" aria-hidden="true">→</span>
    </Link>
  );
}
