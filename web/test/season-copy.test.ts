import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import rules from '../lib/rules.json';
import { CAPS_COPY, CAPS_COPY_LINK, TERMS_HREF } from '../lib/season';
import { capsPointsLine } from '../lib/site';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const web = path.join(here, '..');
const docs = path.join(web, '..', 'docs', 'src');

function files(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

describe('Season 1 airdrop copy', () => {
  it('keeps the six airdrop terms word for word', () => {
    expect(rules.season1.terms).toEqual([
      '$TROPA is a planned token. If it launches, Season 1 Caps convert to a share of the Season 1 airdrop pool, in proportion to Caps at the snapshot.',
      "There's no guarantee it launches, or that it will have any value. Not financial advice.",
      'Not available to US persons or in sanctioned regions; the same region rules apply to claims.',
      "Wallets that fail our checks (shared funders, wash trades, buys that don't verify) get no allocation. Team wallets are excluded.",
      "Caps themselves can't be bought, sold or transferred.",
      'Terms may be updated before the snapshot; changes are announced on @tropaclubxyz.',
    ]);
  });
  it('keeps the extra-accounts answer and the spot-check line', () => {
    expect(rules.season1.faq).toHaveLength(4);
    expect(rules.season1.faq.map((f) => f.a)).toContain("Don't make extra X accounts or wallets; duplicates are removed and can disqualify the wallet.");
    expect(rules.season1.socialTerms.join(' ')).toContain("We spot-check before the snapshot; claims we can't confirm are removed.");
  });
  it('calls the token planned wherever the short lines name it', () => {
    expect(rules.season1.banner).toContain('planned $TROPA');
    expect(CAPS_COPY).toContain('planned $TROPA airdrop');
    expect(CAPS_COPY_LINK).toEqual({ label: 'See the terms.', href: TERMS_HREF });
    expect(TERMS_HREF).toBe('/season#terms');
  });
  it('prints the ticket Caps line with the Season 1 rank', () => {
    expect(capsPointsLine({ caps: 3.5, rank: 12 })).toBe('3.5 Caps · rank #12 in Season 1');
  });
  it('leaves no page or docs source with the old Caps lines', () => {
    const all = [...files(path.join(web, 'app'), ['.ts', '.tsx']), ...files(path.join(web, 'components'), ['.ts', '.tsx']), ...files(path.join(web, 'lib'), ['.ts', '.tsx', '.json']), ...files(docs, ['.html'])];
    expect(all.length).toBeGreaterThan(20);
    const stale = all.filter((f) => /announced separately|Not money, not a token|Cosmetic only: nothing here/i.test(fs.readFileSync(f, 'utf8')));
    expect(stale.map((f) => path.relative(web, f))).toEqual([]);
  });
});
