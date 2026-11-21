'use client';

import Link from 'next/link';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main">
      <section className="wrap page-head empty">
        <h1>The floodlights went out</h1>
        <p className="lede">This page could not be drawn. The data may be between counts. Try again, and if it keeps happening, the home page still works.</p>
        <p className="closing-links">
          <button type="button" className="btn btn-accent" onClick={() => reset()}>Try again</button>
          <Link className="btn" href="/">Go home</Link>
        </p>
      </section>
    </main>
  );
}
