export default function Loading() {
  return (
    <main id="main" aria-busy="true">
      <section className="wrap page-head">
        <h1>Checking the gate…</h1>
        <p className="lede">Looking this wallet up in every ground.</p>
      </section>
      <section className="wrap tickets" aria-hidden="true">
        <div className="ticket-stage">
          <div className="ticket ticket-skeleton">
            <div className="ticket-main" />
            <div className="ticket-stub" />
          </div>
        </div>
      </section>
    </main>
  );
}
