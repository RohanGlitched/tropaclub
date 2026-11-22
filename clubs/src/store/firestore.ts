/**
 * Firestore Admin SDK implementation of DocStore.
 *
 * - Production: Application Default Credentials on Cloud Run, project from FIRESTORE_PROJECT_ID /
 *   GOOGLE_CLOUD_PROJECT, else the Tropa Club project. Default database.
 * - Emulator: set FIRESTORE_EMULATOR_HOST (the Admin SDK then talks to the emulator, no credentials).
 * Clients never write to Firestore: the rules deny all client writes, and every write goes through this.
 */
import { type App, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, type Firestore, getFirestore } from 'firebase-admin/firestore';
import { AlreadyExistsError, type DocStore, Increment, NotFoundError, type QuerySpec } from './docstore';

export const TROPA_PROJECT_ID = 'project-5523359e-5941-4df4-998';

export interface FirestoreStoreOptions {
  projectId?: string;
  /** Prefix every collection name (lets parallel test runs share one emulator). */
  collectionPrefix?: string;
  appName?: string;
}

export function firestoreFor(opts: FirestoreStoreOptions = {}): Firestore {
  const projectId = opts.projectId ?? process.env.FIRESTORE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? TROPA_PROJECT_ID;
  const name = opts.appName ?? `tropa-clubs-${projectId}`;
  const app: App = getApps().find((a) => a.name === name) ?? initializeApp({ projectId }, name);
  const db = getFirestore(app);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    /* settings() may only be called once per instance */
  }
  return db;
}

export class FirestoreDocStore implements DocStore {
  readonly kind = 'firestore' as const;
  private prefix: string;
  constructor(
    private db: Firestore,
    opts: { collectionPrefix?: string } = {},
  ) {
    this.prefix = opts.collectionPrefix ?? '';
  }

  private ref(col: string) {
    return this.db.collection(this.prefix + col);
  }

  async get<T>(col: string, id: string): Promise<T | null> {
    const s = await this.ref(col).doc(id).get();
    return s.exists ? (s.data() as T) : null;
  }

  async getMany<T>(col: string, ids: string[]): Promise<(T | null)[]> {
    if (!ids.length) return [];
    const out: (T | null)[] = [];
    for (let i = 0; i < ids.length; i += 300) {
      const refs = ids.slice(i, i + 300).map((id) => this.ref(col).doc(id));
      const snaps = await this.db.getAll(...refs);
      for (const s of snaps) out.push(s.exists ? (s.data() as T) : null);
    }
    return out;
  }

  async create<T extends object>(col: string, id: string, data: T): Promise<void> {
    try {
      await this.ref(col).doc(id).create(data as FirebaseFirestore.DocumentData);
    } catch (e) {
      // gRPC ALREADY_EXISTS = 6
      if ((e as { code?: number }).code === 6) throw new AlreadyExistsError(col, id);
      throw e;
    }
  }

  async set<T extends object>(col: string, id: string, data: T): Promise<void> {
    await this.ref(col).doc(id).set(data as FirebaseFirestore.DocumentData);
  }

  async update(col: string, id: string, patch: Record<string, unknown>): Promise<void> {
    const p: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      p[k] = v instanceof Increment ? FieldValue.increment(v.by) : v;
    }
    try {
      await this.ref(col).doc(id).update(p);
    } catch (e) {
      // gRPC NOT_FOUND = 5
      if ((e as { code?: number }).code === 5) throw new NotFoundError(col, id);
      throw e;
    }
  }

  async delete(col: string, id: string): Promise<void> {
    await this.ref(col).doc(id).delete();
  }

  async transact<T extends object>(col: string, id: string, fn: (current: T | null) => T | null): Promise<T | null> {
    const ref = this.ref(col).doc(id);
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const next = fn(s.exists ? (s.data() as T) : null);
      if (next) tx.set(ref, next as FirebaseFirestore.DocumentData);
      return next;
    });
  }

  async query<T>(col: string, spec: QuerySpec = {}): Promise<T[]> {
    let q: FirebaseFirestore.Query = this.ref(col);
    for (const [f, op, v] of spec.where ?? []) q = q.where(f, op, v);
    if (spec.orderBy) q = q.orderBy(spec.orderBy[0], spec.orderBy[1]);
    if (spec.limit !== undefined) q = q.limit(spec.limit);
    const s = await q.get();
    return s.docs.map((d) => d.data() as T);
  }
}

export function createFirestoreStore(opts: FirestoreStoreOptions = {}): FirestoreDocStore {
  return new FirestoreDocStore(firestoreFor(opts), { collectionPrefix: opts.collectionPrefix });
}

/** True only when talking to the local emulator (seed scripts refuse to run otherwise). */
export function isEmulator(): boolean {
  return !!process.env.FIRESTORE_EMULATOR_HOST;
}
