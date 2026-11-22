/** Club names are public: cleaned, capped, and kept free of impersonation and abuse. */
import { describe, expect, it } from 'vitest';
import { validateClubName, validateNickname } from '../src/clubs';
import { cleanName, isListedClub, nameProblem, publicName } from '../src/names';
import { MemoryDocStore } from '../src/store/memory';
import { COL, type ClubDoc } from '../src/types';
import { Clock, addr, makeService } from './helpers';

describe('cleanName', () => {
  it('applies NFKC and strips bidi, zero-width and control characters', () => {
    expect(cleanName('\u{FF34}\u{FF52}\u{FF4F}\u{FF50}\u{FF41} FC')).toBe('Tropa FC'); // fullwidth
    expect(cleanName('Lagos\u{200B}\u{200D} Value\u{202E} FC\u{2066}')).toBe('Lagos Value FC');
    expect(cleanName('A\u0000B\u0007C\u001B\n\tD')).toBe('ABC D');
    expect(cleanName('\u{FEFF}  Berlin \u{A0}\u{3000} Bulls  ')).toBe('Berlin Bulls');
    // NFKC composes the first accent; at most two more marks are kept
    const acute = String.fromCodePoint(0x301);
    expect([...cleanName('Ze' + acute.repeat(5) + 'ro')].filter((c) => /\p{M}/u.test(c)).length).toBe(2);
  });

  it('caps the public name at 40 characters without splitting one', () => {
    const long = 'Club '.repeat(20);
    expect([...publicName(long)].length).toBeLessThanOrEqual(40);
    expect([...publicName('\u{1F600}'.repeat(45))].length).toBe(40);
  });
});

describe('nameProblem', () => {
  it('blocks reserved words however they are dressed up', () => {
    for (const n of ['Base Bulls', 'Coinbase Club', 'CoinbaseFC', 'C0INBASE FC', 'Official Picks', 'Admin Desk', 'Support Team', 'The Team', 'Tropa HQ', 'TropaClub Official', 'Teams United', 'Bаse Crew', 'Сoinbase', 'T R O P A']) {
      expect(nameProblem(n), n).not.toBeNull();
    }
  });

  it('blocks slurs, including stretched and leetspeak spellings', () => {
    expect(nameProblem('n1gg3r club')).toBe('abusive');
    expect(nameProblem('Naaazi Lads')).toBe('abusive');
    expect(nameProblem('FAGGOTS FC')).toBe('abusive');
    expect(nameProblem('xxretardxx')).toBe('abusive');
  });

  it('catches slurs and reserved words that are spaced, dotted or joined to another word', () => {
    for (const n of ['n i g g a', 'n.i.g.g.a', 'K-K-K Club', 'f_a_g', 'f a g', 'Club K K K', 'n.igg.a', 'FagClub', 'ClubFag', 'PakiPals', 'DykeSquad', 'GookFC', 'CoonCrew', 'SpicCrew', 'The Nazi', 'NaziFC', 'Cunt United', 'N i gga']) {
      expect(nameProblem(n), n).toBe('abusive');
    }
    for (const n of ['b.a.s.e', 'B A S E Club', 'c-o-i-n-b-a-s-e', 't r o p a', 't.r.o.p.a', 'o f f i c i a l', 'A d m i n']) {
      expect(nameProblem(n), n).toBe('reserved');
    }
  });

  it('allows real words that start or end with a short blocked entry', () => {
    for (const n of ['Spicy Savers', 'Spiced Picks', 'Spice Girls FC', 'Raccoon Rovers', 'Cocoon Club', 'Tycoon Tribe', 'Racoons', 'Pakistan XI', 'Pakistani Savers', 'Fagin Fans', 'Fagundes United', 'Nazir FC', 'Nazim Nine', 'Heilbronn United', 'Vandyke FC', 'Coonhound Club']) {
      expect(nameProblem(n), n).toBeNull();
    }
  });

  it('leaves ordinary names alone', () => {
    for (const n of ['Lagos Value FC', 'Spicy Savers', 'Scunthorpe United', 'Con Amigos', 'K Club', 'Badminton Crew', 'Baseline Bros', 'Database Dads', 'Andes Rovers', 'São Paulo Poupança', 'A C Milan Fans', 'Lagos-Value FC', 'Co-op Club']) {
      expect(nameProblem(n), n).toBeNull();
    }
  });

  it('refuses links and names over 40 characters', () => {
    expect(nameProblem('join www.scam.xyz')).toBe('link');
    expect(nameProblem('x'.repeat(41))).toBe('too_long');
  });
});

describe('validation on create', () => {
  it('stores the cleaned name and refuses blocked ones', () => {
    expect(validateClubName('  Lagos\u{200B}   Value FC ')).toBe('Lagos Value FC');
    expect(() => validateClubName('Coinbase Official')).toThrow(/Base, Coinbase/);
    expect(() => validateClubName('a')).toThrow(/2 to 40/);
    expect(() => validateClubName('\u{200B}\u{200B}\u{200B}a')).toThrow(/2 to 40/);
    expect(validateNickname(' Ada\u{202E} ')).toBe('Ada');
    expect(() => validateNickname('admin')).toThrow(/not allowed/);
  });
});

describe('public listing', () => {
  const club = (o: Partial<ClubDoc>): ClubDoc => ({ id: 'c', name: 'Lagos Value FC', kind: 'private', crestSeed: 's', createdBy: addr(1), createdAt: 0, regionLabel: null, stockSymbol: null, stockToken: null, memberCount: 1, playingCount: 0, maxMembers: 50, status: 'open', ...o });

  it('needs two members or a playing member, a clean name, and no hidden flag', () => {
    expect(isListedClub(club({}))).toBe(false);
    expect(isListedClub(club({ memberCount: 2 }))).toBe(true);
    expect(isListedClub(club({ playingCount: 1 }))).toBe(true);
    expect(isListedClub(club({ memberCount: 9, hidden: true }))).toBe(false);
    expect(isListedClub(club({ memberCount: 9, name: 'Tropa Official' }))).toBe(false);
    expect(isListedClub(club({ kind: 'stock', name: 'NVIDIA FC', memberCount: 0 }))).toBe(true);
  });

  it('hidden is set on the server only, and survives', async () => {
    const store = new MemoryDocStore();
    const { svc } = makeService({ store, clock: new Clock(1_800_000_000) });
    const { club: c } = await svc.createClub({ name: 'Quiet Club', createdBy: addr(5) });
    expect(c.hidden).toBeUndefined();
    await svc.setClubHidden(c.id, true, 'reported');
    expect(await store.get<ClubDoc>(COL.clubs, c.id)).toMatchObject({ hidden: true, hiddenReason: 'reported' });
    await svc.setClubHidden(c.id, false);
    expect((await store.get<ClubDoc>(COL.clubs, c.id))!.hidden).toBe(false);
  });
});
