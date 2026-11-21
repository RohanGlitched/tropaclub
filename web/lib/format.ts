const nf = new Intl.NumberFormat('en-US');
export const fmtInt = (n: number | null | undefined) => (typeof n === 'number' && isFinite(n) ? nf.format(Math.round(n)) : '—');
export const fmtPct = (n: number | null | undefined, dp = 1) => (typeof n === 'number' && isFinite(n) ? `${n.toFixed(dp)}%` : '—');
export const fmtUsd = (n: number | null | undefined, dp = 2) =>
  typeof n === 'number' && isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}` : '—';
export const shortAddr = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(iso: string | number | null | undefined, withTime = false): string {
  if (iso == null) return '—';
  const d = typeof iso === 'number' ? new Date(iso * 1000) : new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (!withTime) return day;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day}, ${hh}:${mm} UTC`;
}
