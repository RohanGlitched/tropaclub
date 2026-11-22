'use client';

import { useEffect, useState } from 'react';
import { utcWhen } from '@/lib/site';

/**
 * "Tue Nov 24, 14:30 UTC (your time: Tue, Nov 24, 8:00 PM GMT+5:30)". UTC first, the same for
 * everyone, so the server and the first paint agree; the visitor's own time is added after mount.
 */
export default function OpensAt({ at, className }: { at: string; className?: string }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    try {
      const d = new Date(at);
      if (d.getTimezoneOffset() === 0) return;
      setLocal(new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d));
    } catch {
      /* UTC only */
    }
  }, [at]);
  return (
    <span className={className} suppressHydrationWarning>
      {utcWhen(at)}
      {local ? ` (your time: ${local})` : ''}
    </span>
  );
}
