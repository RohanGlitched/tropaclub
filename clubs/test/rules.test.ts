/**
 * firestore.rules, checked as an unauthenticated client against the emulator's REST API
 * (runs only under `npm run test:emulator`). The Admin SDK seeds docs (it bypasses rules).
 */
import { describe, expect, it } from 'vitest';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = process.env.GCLOUD_PROJECT ?? 'demo-tropaclub';

describe.skipIf(!host)('firestore.rules (emulator, unauthenticated client)', () => {
  const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
  const get = (path: string) => fetch(`${base}/${path}`);
  const write = (path: string) =>
    fetch(`${base}/${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: { x: { stringValue: 'y' } } }) });

  it('allows reads of public aggregates only, and no client writes anywhere', async () => {
    const { firestoreFor } = await import('../src/store/firestore');
    const db = firestoreFor({ projectId: project, appName: 'tropa-rules-test' });
    const id = `r${Date.now()}`;
    await db.collection('clubs').doc(`${id}-stock`).set({ kind: 'stock', name: 'NVIDIA FC' });
    await db.collection('clubs').doc(`${id}-private`).set({ kind: 'private', name: 'Secret', createdBy: '0xabc' });
    await db.collection('exclusions').doc(id).set({ wallet: id });
    await db.collection('tables').doc(id).set({ rows: [] });
    for (const c of ['members', 'buys', 'transfers', 'callups', 'clubSecrets', 'invites', 'matchQueue', 'wallets', 'attestations', 'geoLog'])
      await db.collection(c).doc(id).set({ secret: true });

    expect((await get(`clubs/${id}-stock`)).status).toBe(200);
    expect((await get(`clubs/${id}-private`)).status).toBe(403);
    expect((await get(`exclusions/${id}`)).status).toBe(200);
    expect((await get(`tables/${id}`)).status).toBe(200);
    for (const c of ['members', 'buys', 'transfers', 'callups', 'clubSecrets', 'invites', 'matchQueue', 'wallets', 'attestations', 'geoLog'])
      expect((await get(`${c}/${id}`)).status, c).toBe(403);
    for (const c of ['clubs', 'exclusions', 'tables', 'gwResults', 'fixtures', 'marks', 'buys', 'members'])
      expect((await write(`${c}/${id}-w`)).status, c).toBe(403);
  });
});
