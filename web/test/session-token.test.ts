import { createHmac, timingSafeEqual } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encodeSession, parseSession } from '../lib/session-token';

const KEY = 'test-key-not-a-secret';
const sign = (b: string) => createHmac('sha256', KEY).update(b).digest('base64url');
const check = (b: string, mac: string) => {
  const want = Buffer.from(sign(b));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
};
const W = '0xFDCD2DDEE853C940A2CE2E082A05744619B24689';
const now = 1_800_000_000;

describe('session token', () => {
  it('round-trips wallet, expiry and version', () => {
    const raw = encodeSession({ wallet: W, exp: now + 60, version: 3 }, sign);
    expect(parseSession(raw, check, now)).toEqual({ wallet: W.toLowerCase(), exp: now + 60, version: 3 });
  });

  it('rejects a changed version, wallet or expiry', () => {
    const raw = encodeSession({ wallet: W, exp: now + 60, version: 3 }, sign);
    const [w, e, , mac] = raw.split('.');
    expect(parseSession(`${w}.${e}.4.${mac}`, check, now)).toBeNull();
    expect(parseSession(`${w}.${Number(e) + 1}.3.${mac}`, check, now)).toBeNull();
    expect(parseSession(`0x${'1'.repeat(40)}.${e}.3.${mac}`, check, now)).toBeNull();
  });

  it('rejects an expired or malformed cookie', () => {
    expect(parseSession(encodeSession({ wallet: W, exp: now - 1, version: 0 }, sign), check, now)).toBeNull();
    for (const bad of ['', 'x', 'a.b', 'a.b.c.d.e', `${W}.soon.0.mac`]) expect(parseSession(bad, check, now)).toBeNull();
  });

  it('reads a cookie from before versions as version 0', () => {
    const body = `${W.toLowerCase()}.${now + 60}`;
    expect(parseSession(`${body}.${sign(body)}`, check, now)).toEqual({ wallet: W.toLowerCase(), exp: now + 60, version: 0 });
  });
});
