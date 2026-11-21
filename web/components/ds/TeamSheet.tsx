'use client';

import type { CrestRecipe } from './Pennant';
import { Pennant } from './Pennant';
import type { Kit } from '@/lib/clubs';

export interface Member {
  id: string;
  name: string;
  status: 'playing' | 'bench';
  note?: string; // "3 weeks in a row"
  badge?: string | null; // payday streak badge
  you?: boolean;
  calledUp?: boolean; // a call-up has been sent this gameweek
  canCallUp?: boolean; // the viewer may call this member up
  fresh?: boolean; // just stepped up: the pennant is raised
}

interface Props {
  members: Member[];
  kit: Kit | CrestRecipe;
  onCallUp?: (id: string) => void;
  /** Why call-ups are off, shown under the Bench instead of hiding the reason. */
  callUpOff?: string;
  playingLabel?: string;
  benchLabel?: string;
  busyId?: string | null;
}

/** A printed team sheet: who played this gameweek, and who is on the Bench. */
export default function TeamSheet({ members, kit, onCallUp, callUpOff, playingLabel = 'Playing', benchLabel = 'Bench', busyId }: Props) {
  const playing = members.filter((m) => m.status === 'playing');
  const bench = members.filter((m) => m.status === 'bench');
  return (
    <div className="sheet">
      <section aria-label={playingLabel}>
        <h4>{playingLabel} <span className="num">{playing.length}</span></h4>
        {playing.length === 0 ? (
          <p className="sheet-empty">Nobody has played yet this gameweek. The first buy of $5 or more puts a name here.</p>
        ) : (
          <ol>
            {playing.map((m, i) => (
              <li key={m.id}>
                <span className="sheet-no num">{i + 1}</span>
                <span className="sheet-name">
                  {m.name}{m.you && <em> (you)</em>}
                  {(m.note || m.badge) && <small>{[m.badge, m.note].filter(Boolean).join(', ')}</small>}
                </span>
                <span className={`sheet-flag${m.fresh ? ' raise' : ''}`}><Pennant kit={kit} width={16} emblem="none" /></span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-label={benchLabel}>
        <h4>{benchLabel} <span className="num">{bench.length}</span></h4>
        {bench.length === 0 ? (
          <p className="sheet-empty">Nobody on the Bench. Full team this week.</p>
        ) : (
          <ul>
            {bench.map((m) => (
              <li key={m.id}>
                <span className="sheet-no" aria-hidden="true">–</span>
                <span className="sheet-name">
                  {m.name}{m.you && <em> (you)</em>}
                  <small>{m.calledUp ? 'Call-up sent' : [m.badge, m.note ?? 'Has not bought this week'].filter(Boolean).join(', ')}</small>
                </span>
                {onCallUp && (m.canCallUp || m.calledUp) && (
                  <button type="button" className="btn btn-sm" onClick={() => onCallUp(m.id)} disabled={m.calledUp || busyId === m.id}>
                    {m.calledUp ? 'Sent' : busyId === m.id ? 'Sending…' : 'Call up'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {callUpOff && bench.length > 0 && <p className="sheet-why">{callUpOff}</p>}
      </section>
    </div>
  );
}
