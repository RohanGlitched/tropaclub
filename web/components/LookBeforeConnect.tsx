import { BUY_AMOUNTS, BUY_ROUTER, GUARD_PCT, PAY_WITH, basescan, siwePreview } from '@/lib/site';
import { shortAddr } from '@/lib/format';

/**
 * "What you'll see": a closed-by-default preview of every screen and wallet prompt, before any
 * wallet is connected. Static text only (no wallet code), so it can sit next to the sign-in and
 * buy buttons on any page. Facts follow lib/server/session.ts (the sign-in message),
 * components/buy/BuySheet.tsx (the buy screen) and buy/src/calls.ts and guard.ts (the calls).
 */
export default function LookBeforeConnect({ className, site }: { className?: string; site?: string }) {
  const amounts = BUY_AMOUNTS.map((n) => `$${n}`);
  return (
    <details className={`look${className ? ` ${className}` : ''}`}>
      <summary>
        <span className="look-label look-show">Show what you&rsquo;ll see before you connect</span>
        <span className="look-label look-hide">Hide what you&rsquo;ll see</span>
        <svg className="look-chev" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </summary>
      <div className="look-body">
        <section>
          <h3>1. Sign in: one free signature</h3>
          <p>Your wallet shows this message, word for word. It asks for no payment and moves no funds: signing it only proves the wallet is yours.</p>
          <pre className="code look-msg" tabIndex={0}><code>{siwePreview(site)}</code></pre>
        </section>
        <section>
          <h3>2. The buy screen</h3>
          <ul className="ticks">
            <li>Amount: {amounts.slice(0, -1).join(', ')} or {amounts[amounts.length - 1]}, paid in {PAY_WITH}.</li>
            <li>Route: the KyberSwap router, trading only in Aerodrome pools on Base. No other venue is used.</li>
            <li>{GUARD_PCT}% price guard: the swap is built to stop if you would get more than {GUARD_PCT}% fewer tokens than the reference price gives. A stopped swap buys nothing.</li>
            <li>0% Tropa fee. Network gas on Base is a few cents.</li>
            <li>A live quote (what you pay, about what you get, and the guard minimum) before you tap Buy.</li>
          </ul>
        </section>
        <section>
          <h3>3. What your wallet asks you to confirm</h3>
          <ol className="look-steps">
            <li><b>Paying in USDC, if needed:</b> an approval of exactly that amount of USDC for the KyberSwap router (<a className="num" href={basescan(BUY_ROUTER)} rel="noopener">{shortAddr(BUY_ROUTER)}</a>). It is skipped when the router may already spend that much.</li>
            <li><b>The swap:</b> a call to the same router. It sends your USDC or ETH and returns the stock token to your own wallet.</li>
            <li><b>Paying in ETH:</b> no approval, only the swap.</li>
          </ol>
          <p className="muted small">Some wallets show both steps as one confirmation. Each call ends with Tropa Club&rsquo;s public Builder Code tag, and nothing goes to a Tropa Club contract: there isn&rsquo;t one.</p>
        </section>
      </div>
    </details>
  );
}
