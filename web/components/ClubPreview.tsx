'use client';

import { useEffect, useRef, useState } from 'react';
import Scoreboard from './ds/Scoreboard';
import TeamSheet, { type Member } from './ds/TeamSheet';
import type { Kit } from '@/lib/clubs';

const START: Member[] = [
  { id: 'a', name: 'Ana', status: 'playing', note: '3 weeks in a row' },
  { id: 'k', name: 'Kofi', status: 'playing', note: '2 weeks in a row' },
  { id: 'm', name: 'Mei', status: 'playing', note: 'First week' },
  { id: 'd', name: 'Diego', status: 'playing', note: '3 weeks in a row' },
  { id: 's', name: 'Sam', status: 'bench', canCallUp: true },
];
const KIT: Kit = { primary: '#12A874', secondary: '#F4F1E8', pattern: 'chevron' };

/** A working preview of a Matchday card, with made-up members. Real clubs open on Tuesday. */
export default function ClubPreview() {
  const [members, setMembers] = useState(START);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const playing = members.filter((m) => m.status === 'playing').length;
  const bench = members.length - playing;
  const callUp = (id: string) => {
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, calledUp: true } : m)));
    timer.current = setTimeout(() => {
      setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, status: 'playing', calledUp: false, fresh: true, note: 'Answered the call-up' } : m)));
    }, 1100);
  };
  const changed = members !== START;

  return (
    <div className="club-preview">
      <Scoreboard
        title="Sunday League Tropa"
        kicker="Gameweek 0, preview"
        cells={[
          { label: 'Played', value: playing },
          { label: 'Bench', value: bench },
          { label: 'Turnout %', value: Math.round((playing / members.length) * 100), pad: 2 },
        ]}
        foot={playing === members.length ? 'Full team. Everyone bought this week.' : 'Turnout of 80% or more earns the club its bonus point.'}
      />
      <div>
        <TeamSheet members={members} kit={KIT} onCallUp={callUp} />
        <p className="muted small club-preview-note" role="status">
          {changed && bench === 0 ? 'In the preview Sam answers at once. A real call-up is a message to your friend, who then buys from their own wallet. ' : 'A preview with made-up names. Try the call-up. '}
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
