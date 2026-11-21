'use client';

import { useMemo, useState, type ReactNode } from 'react';

export interface LeagueColumn<T> {
  key: string;
  label: string;
  /** Sort value. null sorts last in either direction. */
  value: (row: T) => number | null;
  render?: (row: T) => ReactNode;
  strong?: boolean;
}

interface Props<T> {
  rows: T[];
  columns: LeagueColumn<T>[];
  rowKey: (row: T) => string;
  /** The name cell: pennant, club, small print. */
  lead: (row: T) => ReactNode;
  leadLabel: string;
  leadText: (row: T) => string; // for search and A to Z
  initialSort: string;
  caption: string;
  noun?: string; // "clubs", "members"
  controls?: boolean;
  pageSize?: number;
  searchPlaceholder?: string;
}

/**
 * A league table: sortable columns on wide screens, one card per row on phones.
 * Used by The Attendance now, and by club standings and the Supporters table next.
 */
export default function LeagueTable<T>({ rows, columns, rowKey, lead, leadLabel, leadText, initialSort, caption, noun = 'clubs', controls = true, pageSize = 20, searchPlaceholder = 'Club or ticker' }: Props<T>) {
  const [key, setKey] = useState(initialSort);
  const [dir, setDir] = useState<1 | -1>(-1);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);

  const sorted = useMemo(() => {
    const f = q.trim().toLowerCase();
    const list = f ? rows.filter((r) => leadText(r).toLowerCase().includes(f)) : rows.slice();
    const col = columns.find((c) => c.key === key);
    list.sort((a, b) => {
      if (!col) return leadText(a).localeCompare(leadText(b)) * dir;
      const av = col.value(a);
      const bv = col.value(b);
      if (av == null || bv == null) return av == null && bv == null ? 0 : av == null ? 1 : -1;
      return (av - bv) * dir;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, key, dir, q]);
  const shown = !controls || all || q.trim() ? sorted : sorted.slice(0, pageSize);

  const sortBy = (k: string) => {
    if (k === key) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setKey(k);
      setDir(k === '_lead' ? 1 : -1);
    }
  };
  const aria = (k: string) => (k === key ? (dir === 1 ? 'ascending' : 'descending') : 'none');

  return (
    <div className="league">
      {controls && (
        <div className="league-tools">
          <label className="league-search">
            <span>Search</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} type="search" autoComplete="off" />
          </label>
          <label className="league-sort">
            <span>Sort by</span>
            <select
              value={`${key}:${dir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split(':');
                setKey(k);
                setDir(Number(d) as 1 | -1);
              }}
            >
              {columns.map((c) => (
                <option key={c.key} value={`${c.key}:-1`}>{c.label}, most first</option>
              ))}
              {columns.map((c) => (
                <option key={`${c.key}-asc`} value={`${c.key}:1`}>{c.label}, least first</option>
              ))}
              <option value="_lead:1">{leadLabel}, A to Z</option>
            </select>
          </label>
          <p className="league-count" aria-live="polite">Showing {shown.length} of {rows.length} {noun}</p>
        </div>
      )}
      <table className="league-table">
        <caption className="sr">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="c-pos">Pos</th>
            <th scope="col" className="c-club" aria-sort={aria('_lead')}>
              {controls ? <button type="button" onClick={() => sortBy('_lead')}>{leadLabel}</button> : leadLabel}
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className="r" aria-sort={aria(c.key)}>
                {controls ? (
                  <button type="button" onClick={() => sortBy(c.key)} className={c.key === key ? 'on' : undefined}>
                    {c.label}
                    <span aria-hidden="true" className="arrow">{c.key === key ? (dir === 1 ? '▲' : '▼') : ''}</span>
                  </button>
                ) : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={rowKey(r)}>
              <td className="c-pos num">{i + 1}</td>
              <th scope="row" className="c-club">{lead(r)}</th>
              {columns.map((c) => (
                <td key={c.key} className={`r num${c.strong ? ' c-strong' : ''}`} data-label={c.label}>
                  {c.render ? c.render(r) : (c.value(r) ?? '—')}
                </td>
              ))}
            </tr>
          ))}
          {shown.length === 0 && (
            <tr className="league-empty">
              <td colSpan={columns.length + 2}>Nothing matches &ldquo;{q}&rdquo;. Try a shorter search.</td>
            </tr>
          )}
        </tbody>
      </table>
      {shown.length < sorted.length && (
        <p className="after-table">
          <button type="button" className="btn" onClick={() => setAll(true)}>Show all {sorted.length} {noun}</button>
        </p>
      )}
    </div>
  );
}
