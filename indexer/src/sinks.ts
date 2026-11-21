// Burn / sink addresses are never fans: tokens sent there are gone, not held.
// Explicit list + patterns: almost-all-zero addresses (precompiles, 0x0..01 style sinks) and 0x0…dead / 0xdead0… vanity burns.
const SINKS = new Set([
  '0x000000000000000000000000000000000000dead',
  '0xdead000000000000000042069420694206942069',
  '0x0000000000000000000000000000000000000001',
]);
export function isSink(a: string): boolean {
  if (SINKS.has(a)) return true;
  const h = a.slice(2);
  if ((h.match(/0/g) || []).length >= 32) return true;
  return /^0{20,}dead$/.test(h) || /^dead0{20,}/.test(h);
}
