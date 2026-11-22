/**
 * Minimal document-store interface the engine is written against. Two implementations:
 * - MemoryDocStore (tests, local demos)
 * - FirestoreDocStore (Firestore Admin SDK; also used against the emulator in tests)
 *
 * Services only use equality filters (plus at most one range filter on the same field) and sort in memory,
 * so the Firestore implementation needs few composite indexes (see firestore.indexes.json).
 */

export type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';
export type Where = [field: string, op: WhereOp, value: unknown];

export interface QuerySpec {
  where?: Where[];
  orderBy?: [field: string, dir: 'asc' | 'desc'];
  limit?: number;
}

/** Sentinel for atomic counters: store.update(col, id, { memberCount: inc(1) }). */
export class Increment {
  constructor(public readonly by: number) {}
}
export const inc = (by: number) => new Increment(by);

export class AlreadyExistsError extends Error {
  constructor(col: string, id: string) {
    super(`${col}/${id} already exists`);
    this.name = 'AlreadyExistsError';
  }
}
export class NotFoundError extends Error {
  constructor(col: string, id: string) {
    super(`${col}/${id} not found`);
    this.name = 'NotFoundError';
  }
}

export interface DocStore {
  readonly kind: 'memory' | 'firestore';
  get<T>(col: string, id: string): Promise<T | null>;
  getMany<T>(col: string, ids: string[]): Promise<(T | null)[]>;
  /** Atomic create; throws AlreadyExistsError if the doc exists (used for tx-hash dedupe). */
  create<T extends object>(col: string, id: string, data: T): Promise<void>;
  set<T extends object>(col: string, id: string, data: T): Promise<void>;
  /** Partial update; supports inc(n). Throws NotFoundError if missing. */
  update(col: string, id: string, patch: Record<string, unknown>): Promise<void>;
  delete(col: string, id: string): Promise<void>;
  /**
   * Read a document and write its replacement atomically (a Firestore transaction). `fn` gets the
   * current document (or null) and returns the new one, or null to leave it as it is. Resolves to
   * what `fn` returned.
   */
  transact<T extends object>(col: string, id: string, fn: (current: T | null) => T | null): Promise<T | null>;
  query<T>(col: string, spec?: QuerySpec): Promise<T[]>;
}

export function matchesWhere(doc: Record<string, unknown>, [field, op, value]: Where): boolean {
  const v = field.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), doc);
  switch (op) {
    case '==':
      return v === value;
    case '!=':
      return v !== undefined && v !== value;
    case '<':
      return v != null && (v as number) < (value as number);
    case '<=':
      return v != null && (v as number) <= (value as number);
    case '>':
      return v != null && (v as number) > (value as number);
    case '>=':
      return v != null && (v as number) >= (value as number);
    case 'in':
      return (value as unknown[]).includes(v);
    case 'array-contains':
      return Array.isArray(v) && v.includes(value);
  }
}

/** Firestore 'in' takes at most 30 values; split long lists. */
export async function queryIn<T>(store: DocStore, col: string, field: string, values: unknown[], extra: Where[] = []): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += 30) {
    out.push(...(await store.query<T>(col, { where: [...extra, [field, 'in', values.slice(i, i + 30)]] })));
  }
  return out;
}
