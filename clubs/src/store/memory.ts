import { AlreadyExistsError, type DocStore, Increment, NotFoundError, type QuerySpec, matchesWhere } from './docstore';

/** In-memory DocStore with the same semantics the engine relies on from Firestore. */
export class MemoryDocStore implements DocStore {
  readonly kind = 'memory' as const;
  private cols = new Map<string, Map<string, Record<string, unknown>>>();

  private col(name: string) {
    let c = this.cols.get(name);
    if (!c) {
      c = new Map();
      this.cols.set(name, c);
    }
    return c;
  }

  async get<T>(col: string, id: string): Promise<T | null> {
    const d = this.col(col).get(id);
    return d ? (structuredClone(d) as T) : null;
  }

  async getMany<T>(col: string, ids: string[]): Promise<(T | null)[]> {
    return Promise.all(ids.map((id) => this.get<T>(col, id)));
  }

  async create<T extends object>(col: string, id: string, data: T): Promise<void> {
    const c = this.col(col);
    if (c.has(id)) throw new AlreadyExistsError(col, id);
    c.set(id, strip(structuredClone(data) as Record<string, unknown>));
  }

  async set<T extends object>(col: string, id: string, data: T): Promise<void> {
    this.col(col).set(id, strip(structuredClone(data) as Record<string, unknown>));
  }

  async update(col: string, id: string, patch: Record<string, unknown>): Promise<void> {
    const c = this.col(col);
    const d = c.get(id);
    if (!d) throw new NotFoundError(col, id);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (v instanceof Increment) d[k] = ((d[k] as number) ?? 0) + v.by;
      else d[k] = structuredClone(v);
    }
  }

  async delete(col: string, id: string): Promise<void> {
    this.col(col).delete(id);
  }

  async query<T>(col: string, spec: QuerySpec = {}): Promise<T[]> {
    let rows = [...this.col(col).values()].filter((d) => (spec.where ?? []).every((w) => matchesWhere(d, w)));
    if (spec.orderBy) {
      const [f, dir] = spec.orderBy;
      rows.sort((a, b) => {
        const x = a[f] as number | string;
        const y = b[f] as number | string;
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'asc' ? 1 : -1);
      });
    }
    if (spec.limit !== undefined) rows = rows.slice(0, spec.limit);
    return rows.map((r) => structuredClone(r) as T);
  }

  /** Test helper. */
  dump(col: string): Record<string, unknown>[] {
    return [...this.col(col).values()].map((d) => structuredClone(d));
  }
}

function strip(d: Record<string, unknown>): Record<string, unknown> {
  for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
  return d;
}
