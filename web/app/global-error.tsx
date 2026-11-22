'use client';

// The last line of defence: an error in the root layout itself. It has to draw its own page.
import { useEffect } from 'react';
import { isChunkError, reloadOnceForChunk, reportClientError } from '@/lib/client-errors';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    reportClientError('boundary', error, { digest: error.digest });
    if (isChunkError(error)) reloadOnceForChunk();
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#F4F1E8', color: '#121037' }}>
        <main style={{ maxWidth: 640, margin: '0 auto', padding: '64px 20px' }}>
          <h1 style={{ fontSize: 32, margin: '0 0 12px' }}>The floodlights went out</h1>
          <p style={{ fontSize: 18, lineHeight: 1.5 }}>This page could not be drawn. Reload it, and if it keeps happening, the home page still works.</p>
          <p>
            <button type="button" onClick={() => location.reload()} style={{ font: 'inherit', padding: '10px 18px', border: 0, borderRadius: 6, background: '#FFC531', color: '#121037', cursor: 'pointer' }}>Reload the page</button>{' '}
            <a href="/" style={{ color: '#121037' }}>Go home</a>
          </p>
          <p style={{ fontSize: 13, opacity: 0.7 }}><code>{error.message || 'no message'}</code>{error.digest ? ` · ref ${error.digest}` : ''}</p>
        </main>
      </body>
    </html>
  );
}
