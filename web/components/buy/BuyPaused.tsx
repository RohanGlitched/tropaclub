import { PAUSED_MESSAGE, PAUSED_TITLE } from '@/lib/site';

/** The calm stand-in for every buy button while the kill switch is on (BUY_PAUSED). No button, no date. */
export default function BuyPaused({ className }: { className?: string }) {
  return (
    <div className={`buy-paused${className ? ` ${className}` : ''}`} role="status">
      <p className="buy-paused-t"><span className="tag tag-quiet">{PAUSED_TITLE}</span></p>
      <p>{PAUSED_MESSAGE}</p>
    </div>
  );
}
