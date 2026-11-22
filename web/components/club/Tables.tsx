'use client';

import Link from 'next/link';
import LeagueTable, { type LeagueColumn } from '@/components/ds/LeagueTable';
import { Pennant, type CrestRecipe } from '@/components/ds/Pennant';

interface Base { clubId: string; name: string; crest: CrestRecipe; position: number; note?: string | null }
const lead = (r: Base) => (
  <Link href={`/club/${r.clubId}`} prefetch={false}>
    <Pennant kit={r.crest} width={18} emblem="none" />
    <span>
      {r.name}
      {r.note && <small>{r.note}</small>}
    </span>
  </Link>
);
const pct = (n: number | null, dp = 0) => (n == null ? '—' : `${n.toFixed(dp)}%`);
const signed = (n: number | null) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);

export interface LeagueRowView extends Base { played: number; won: number; drawn: number; lost: number; bonus: number; points: number; diff: number; form: string[] }
export function ClubLeagueTable({ rows }: { rows: LeagueRowView[] }) {
  const columns: LeagueColumn<LeagueRowView>[] = [
    { key: 'played', label: 'Weeks paired', value: (r) => r.played },
    { key: 'won', label: 'Higher (3)', value: (r) => r.won },
    { key: 'drawn', label: 'Level (1)', value: (r) => r.drawn },
    { key: 'lost', label: 'Lower (0)', value: (r) => r.lost },
    { key: 'bonus', label: 'Bonus', value: (r) => r.bonus },
    { key: 'points', label: 'Points', strong: true, value: (r) => r.points },
  ];
  return <LeagueTable rows={rows} columns={columns} rowKey={(r) => r.clubId} lead={lead} leadLabel="Club" leadText={(r) => r.name} initialSort="points" caption="Club rankings: private and pick-up clubs" searchPlaceholder="Club name" controls={rows.length > 8} />;
}

export interface PreseasonRowView extends Base { score: number | null; played: number; members: number; participationPct: number }
export function PreseasonTable({ rows }: { rows: PreseasonRowView[] }) {
  const columns: LeagueColumn<PreseasonRowView>[] = [
    { key: 'members', label: 'Members', value: (r) => r.members },
    { key: 'played', label: 'Bought', value: (r) => r.played },
    { key: 'participationPct', label: 'Turnout', strong: true, value: (r) => r.participationPct, render: (r) => pct(r.participationPct) },
    { key: 'score', label: 'Middle return', value: (r) => r.score, render: (r) => signed(r.score) },
  ];
  return <LeagueTable rows={rows} columns={columns} rowKey={(r) => r.clubId} lead={lead} leadLabel="Club" leadText={(r) => r.name} initialSort="participationPct" caption="Practice week (gameweek 0) rankings, by turnout" searchPlaceholder="Club name" controls={rows.length > 8} />;
}

export interface SupportersRowView extends Base { members: number; played: number; participationPct: number; activeStreaks: number; streakPct: number }
export function SupportersTable({ rows }: { rows: SupportersRowView[] }) {
  const columns: LeagueColumn<SupportersRowView>[] = [
    { key: 'members', label: 'Members', value: (r) => r.members },
    { key: 'played', label: 'Bought', value: (r) => r.played },
    { key: 'participationPct', label: 'Turnout', strong: true, value: (r) => r.participationPct, render: (r) => pct(r.participationPct) },
    { key: 'streakPct', label: 'On a streak', value: (r) => r.streakPct, render: (r) => pct(r.streakPct) },
  ];
  return <LeagueTable rows={rows} columns={columns} rowKey={(r) => r.clubId} lead={lead} leadLabel="Open club" leadText={(r) => r.name} initialSort="participationPct" caption="Open club rankings: ranked on turnout and streaks, never on returns" searchPlaceholder="Company or ticker" controls={rows.length > 8} />;
}
