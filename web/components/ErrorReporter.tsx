'use client';

import { useEffect } from 'react';
import { isChunkError, reloadOnceForChunk, reportClientError } from '@/lib/client-errors';

/**
 * Reports uncaught errors and rejected promises to /api/log, and recovers from a stale build:
 * when a chunk of an older build is no longer served, the page reloads once. Renders nothing.
 */
export default function ErrorReporter() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      // errors thrown by browser extensions (e.g. two wallets fighting over window.ethereum) are
      // not ours: their scripts come from chrome-extension:// URLs
      if (/^(chrome|moz|safari)-extension:/.test(ev.filename ?? '')) return;
      const e = ev.error ?? new Error(ev.message);
      reportClientError('error', e);
      if (isChunkError(e)) reloadOnceForChunk();
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      reportClientError('rejection', ev.reason);
      if (isChunkError(ev.reason)) reloadOnceForChunk();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
