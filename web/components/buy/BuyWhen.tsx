import OpensAt from '@/components/OpensAt';
import { LAUNCH_AT, PAUSED_MESSAGE, PAUSED_TITLE, type BuyState } from '@/lib/site';

/**
 * Where buying stands, as a tag and a line, for server pages: the launch time before launch (never
 * a moved gate date), the paused note while the kill switch is on, "Buying is open" after.
 */
export default function BuyWhen({ state }: { state: BuyState }) {
  if (state === 'paused') return <><span className="tag tag-quiet">{PAUSED_TITLE}</span> {PAUSED_MESSAGE}</>;
  if (state === 'open') return <span className="tag">Buying is open</span>;
  // the gate was moved past the launch time and that time has gone by: no stale date
  if (Date.now() >= Date.parse(LAUNCH_AT)) return <><span className="tag">Buying opens</span> shortly</>;
  return <><span className="tag">Buying opens</span> <OpensAt at={LAUNCH_AT} /></>;
}
