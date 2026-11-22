'use client';

import { useEffect, useState } from 'react';
import { utcWhenYear } from '@/lib/site';

/**
 * "Tue Nov 24, 14:30 UTC (your time: Tue, Nov 24, 8:00 PM GMT+5:30)". UTC first, the same for
 * everyone, so the server and the first paint agree; the visitor's own time is added after mount.
 * A time in another year than this one carries its year.
 */
export default function OpensAt({ at, className }: { at: string; className?: string }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    try {
      const d = new Date(at);
      if (d.getTimezoneOffset() === 0) return;
      const otherYear = d.getFullYear() !== new Date().getFullYear();
      setLocal(new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(otherYear ? { year: 'numeric' } : {}), hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d));
    } catch {
      /* UTC only */
    }
  }, [at]);
  return (
    <span className={className} suppressHydrationWarning>
      {utcWhenYear(at)}
      {local ? ` (your time: ${local})` : ''}
    </span>
  );
}
