'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { TokenSummary } from '@shared/types';
import LeagueTable, { type LeagueColumn } from './ds/LeagueTable';
import { Pennant } from './ds/Pennant';
import { groundPath, kitFor, shortName } from '@/lib/clubs';
import { fmtInt, fmtPct } from '@/lib/format';

export type Row = Pick<TokenSummary, 'symbol' | 'name' | 'holdersTotal' | 'realFans' | 'attendancePct' | 'weeklyBuyers' | 'newBuyers7d' | 'priceUsd'> & Pick<Partial<TokenSummary>, 'priceSource'>;

/** Stock rankings (The Attendance): every stock token, ranked by real holders. */
export default function AttendanceTable({ rows, controls = true }: { rows: Row[]; controls?: boolean }) {
  const columns = useMemo<LeagueColumn<Row>[]>(() => {
    const maxAtt = Math.max(1, ...rows.map((r) => r.attendancePct));
    return [
      { key: 'holdersTotal', label: 'All holders', value: (r) => r.holdersTotal, render: (r) => fmtInt(r.holdersTotal) },
      {
        key: 'realFans',
        label: 'Real holders',
        strong: true,
        value: (r) => (r.priceUsd == null ? null : r.realFans),
        render: (r) => (r.priceUsd == null ? <span className="na" title="No price yet, so no $10 line">no price yet</span> : fmtInt(r.realFans)),
      },
      {
        key: 'attendancePct',
        label: 'Real share',
        value: (r) => (r.priceUsd == null ? null : r.attendancePct),
        render: (r) =>
          r.priceUsd == null ? '—' : (
            <span className="att">
              <span className="att-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (r.attendancePct / maxAtt) * 100)}%` }} /></span>
              <span>{fmtPct(r.attendancePct)}</span>
            </span>
          ),
      },
      { key: 'weeklyBuyers', label: 'Buyers, 7 days', value: (r) => r.weeklyBuyers, render: (r) => (r.weeklyBuyers > r.holdersTotal ? <span title="Includes wallets that bought and sold again">{fmtInt(r.weeklyBuyers)}</span> : fmtInt(r.weeklyBuyers)) },
      { key: 'newBuyers7d', label: 'New buyers, 7 days', value: (r) => r.newBuyers7d, render: (r) => fmtInt(r.newBuyers7d) },
    ];
  }, [rows]);

  return (
    <LeagueTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.symbol}
      leadLabel="Stock token"
      noun="tokens"
      searchPlaceholder="Company or ticker"
      leadText={(r) => `${r.name} ${r.symbol}`}
      lead={(r) => (
        <Link href={groundPath(r.symbol)} prefetch={false}>
          <Pennant kit={kitFor(r.symbol)} width={18} />
          <span>
            {shortName(r.name, r.symbol)}
            <small>{r.symbol}{r.priceSource === 'reference' && <abbr className="ref" title="No active market: valued at the share's last price times the token's split multiplier, so the $10 line is approximate"> · reference price</abbr>}</small>
          </span>
        </Link>
      )}
      initialSort="realFans"
      caption="Stock rankings: real holders of each stock token on Base"
      controls={controls}
    />
  );
}
