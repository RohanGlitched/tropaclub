'use client';

import { useEffect, useRef, useState } from 'react';
import Scoreboard from './ds/Scoreboard';
import TeamSheet, { type Member } from './ds/TeamSheet';
import type { Kit } from '@/lib/clubs';
import Term from './nav/Term';

const START: Member[] = [
  { id: 'a', name: 'Ana', status: 'playing', badge: 'Payday streak, 3' },
  { id: 'k', name: 'Kofi', status: 'playing', badge: 'Payday streak, 2' },
  { id: 'm', name: 'Mei', status: 'playing', badge: 'First payday' },
  { id: 'd', name: 'Diego', status: 'playing', badge: 'Payday streak, 3' },
  { id: 's', name: 'Sam', status: 'bench', canCallUp: true },
];
const KIT: Kit = { primary: '#12A874', secondary: '#F4F1E8', pattern: 'chevron' };

/** A working preview of a Matchday card (a club's weekly card), with made-up members. */
export default function ClubPreview() {
  const [members, setMembers] = useState(START);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const playing = members.filter((m) => m.status === 'playing').length;
  const bench = members.length - playing;
  const callUp = (id: string) => {
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, calledUp: true } : m)));
    timer.current = setTimeout(() => {
      setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, status: 'playing', calledUp: false, fresh: true, note: 'Bought after the nudge' } : m)));
    }, 1100);
  };
  const changed = members !== START;

  return (
    <div className="club-preview">
      <Scoreboard
        title="Sample club: Sunday League Tropa"
        kicker="Matchday card, week 0 (sample)"
        cells={[
          { label: 'Played', value: playing },
          { label: 'Bench', value: bench },
          { label: 'Turnout %', value: Math.round((playing / members.length) * 100), pad: 2 },
        ]}
        foot={playing === members.length ? 'Everyone bought this week.' : 'If 80% or more of members buy this week, the club gets a bonus point in the weekly rankings.'}
      />
      <div>
        <TeamSheet members={members} kit={KIT} onCallUp={callUp} />
        <p className="muted small club-preview-note" role="status">
          {changed && bench === 0 ? 'In the sample Sam buys at once. A real nudge is a WhatsApp or Telegram message to your friend, who then buys from their own wallet. ' : <>A sample with made-up names. Played means bought this week; Bench means not yet. The badges are each member&rsquo;s <Term id="payday-streak">payday streak</Term>. Try the nudge. </>}
          {changed && (
            <button type="button" className="linklike" onClick={() => { if (timer.current) clearTimeout(timer.current); setMembers(START); }}>
              Start again
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
