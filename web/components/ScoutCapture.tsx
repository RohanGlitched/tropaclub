'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { captureScout } from '@/lib/scout-client';

/** Remembers a scout code from the URL (see lib/scout-client.ts). Renders nothing. */
export default function ScoutCapture() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      captureScout(window.location);
    } catch {
      /* cookies off: the link still works, it just credits nobody */
    }
  }, [pathname]);
  return null;
}
