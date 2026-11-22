import { describe, expect, it } from 'vitest';
import rules from '../lib/rules.json';
import { REGION_LINE, SCOUT_FUNDER_RULE, FIXTURE_STEPS } from '../lib/site';
import { STAND_MOVES, hrefFor, labelFor, pagesFor, sectionOf, standsFor } from '../lib/nav';

describe('one name per section', () => {
  it('puts grounds and tickets under Stock rankings, as their breadcrumbs do', () => {
    expect(sectionOf('/attendance')).toBe('attendance');
    expect(sectionOf('/ground/NVDAc')).toBe('attendance');
    expect(sectionOf('/ticket/0xfdcd2ddee853c940a2ce2e082a05744619b24689')).toBe('attendance');
    expect(sectionOf('/league')).toBe('league');
  });
  it('never sends a nav item called Grounds straight to one ground', () => {
    const stands = standsFor({ grounds: 90, wallet: null });
    expect(stands.find((s) => s.label === 'Grounds')).toBeUndefined();
    expect(hrefFor('attendance', null)).toBe('/attendance');
    expect(labelFor('/league', [])).toBe('League');
  });
  it('has a Season 1 airdrop stand, a header section and quick-jump entries', () => {
    expect(sectionOf('/season')).toBe('season');
    expect(hrefFor('season', null)).toBe('/season');
    expect(labelFor('/season', [])).toBe('Season 1 airdrop');
    const stand = standsFor({ grounds: 90, wallet: null }).find((s) => s.id === 'season');
    expect(stand?.label).toBe(rules.season1.navLabel);
    // every stand can be walked to and from on the map
    for (const s of standsFor({ grounds: 90, wallet: null })) expect(STAND_MOVES[s.id]).toBeDefined();
    expect(Object.values(STAND_MOVES).some((m) => Object.values(m).includes('season'))).toBe(true);
    const pages = pagesFor('/ground/NVDAc', 'NVIDIA');
    for (const word of ['airdrop', 'tropa', 'season', 'caps', 'quests']) {
      expect(pages.some((p) => p.href.startsWith('/season') && `${p.label} ${p.keys}`.toLowerCase().includes(word))).toBe(true);
    }
    expect(pages.find((p) => p.href === '/league?tab=caps')?.label).toBe('Season 1 points (Caps)');
  });
});

describe('rule copy', () => {
  it('states the region rule in one sentence, the same in the site and the docs', () => {
    expect(REGION_LINE).toBe("Buying, clubs and call-ups aren't available to US persons or in sanctioned regions. Checking a wallet works everywhere.");
    expect(rules.regionLine).toBe(REGION_LINE);
  });
  it('says exactly what the scout funding check looks at', () => {
    expect(SCOUT_FUNDER_RULE).toContain("funded with ETH, USDC or WETH from the scout's wallet, or sharing a first sender (the first wallet to send it ETH, USDC or WETH) with the scout or with another of the scout's credited friends");
    expect(SCOUT_FUNDER_RULE).not.toMatch(/funded by the scout|first funder/);
  });
  it('lists the fixture tie-break as three steps', () => {
    expect(FIXTURE_STEPS.steps).toHaveLength(3);
    expect(FIXTURE_STEPS.steps[1]).toContain('1 percentage point');
    expect(FIXTURE_STEPS.steps[2]).toBe('Still level: 1 point each.');
  });
});
