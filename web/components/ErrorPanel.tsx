'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isChunkError, reloadOnceForChunk, reportClientError } from '@/lib/client-errors';

/**
 * What an error boundary shows. A page built by an older release (a deploy happened while it was
 * open) is reloaded once by itself; anything else is reported and explained, with the real message
 * in a small details line so it can be diagnosed.
 */
export default function ErrorPanel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const chunk = isChunkError(error);
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    reportClientError('boundary', error, { digest: error.digest });
    if (chunk && reloadOnceForChunk()) setReloading(true);
  }, [error, chunk]);

  return (
    <main id="main">
      <section className="wrap page-head empty">
        <h1>{reloading ? 'Loading the latest version' : 'The floodlights went out'}</h1>
        <p className="lede">
          {reloading
            ? 'The site was updated while this page was open. Reloading it now.'
            : chunk
              ? 'The site was updated while this page was open, and part of the old version is gone. Reload the page to get the new one.'
              : 'This page could not be drawn. The data may be between counts. Try again, and if it keeps happening, the home page still works.'}
        </p>
        {!reloading && (
          <p className="closing-links">
            {chunk ? (
              <button type="button" className="btn btn-accent" onClick={() => location.reload()}>Reload the page</button>
            ) : (
              <button type="button" className="btn btn-accent" onClick={() => reset()}>Try again</button>
            )}
            <Link className="btn" href="/">Go home</Link>
          </p>
        )}
        <details className="error-details">
          <summary>Details for the team</summary>
          <p className="muted small">
            <code>{(error.name && error.name !== 'Error' ? `${error.name}: ` : '') + (error.message || 'no message')}</code>
            {error.digest ? <> · ref <code>{error.digest}</code></> : null}
          </p>
        </details>
      </section>
    </main>
  );
}
