import { TRANSFER_TOPIC, USDC_ADDRESS, type AttributionLite, type ChainReader, type RawLog, type ReceiptLite, type TransferLog, type TxLite } from '../src/chain/types';
import { createClubsService, type ClubsDeps } from '../src/service';
import { MemoryDocStore } from '../src/store/memory';
import type { DocStore } from '../src/store/docstore';
import { StaticPriceSource } from '../src/prices';
import { createGeoPolicy } from '../src/geo';
import { StaticFundingResolver } from '../src/funding';

export const TOK = {
  NVDAc: '0xb20000000000000000000078ee7ce2fe4908108c',
  SNDKc: '0xb200000000000000000000397293cb8cda9a10c5',
  TSLAc: '0xb2000000000000000000001e800a7f5189430cd0',
};
export const TOKEN_MAP = new Map(Object.entries(TOK).map(([s, a]) => [a, s]));
export const ROUTER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5';
export const POOL = '0x00000000000000000000000000000000000000aa';

export const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
export const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`;
export const transferLog = (token: string, from: string, to: string, value: bigint, logIndex: number): RawLog => ({
  address: token,
  topics: [TRANSFER_TOPIC, pad(from), pad(to)],
  data: `0x${value.toString(16).padStart(64, '0')}`,
  logIndex,
});

interface FakeTx {
  receipt: ReceiptLite;
  tx: TxLite;
  attribution: AttributionLite;
}

/** In-memory Base: receipts, attribution results, block times and sell logs. */
export class FakeChain implements ChainReader {
  txs = new Map<string, FakeTx>();
  times = new Map<bigint, number>();
  logs: TransferLog[] = [];
  head = 60_000_000n;
  balances = new Map<string, bigint>();

  addBuy(o: {
    hash: string;
    wallet: string;
    token: string;
    raw: bigint;
    usdc?: bigint; // micro USDC paid
    attributed?: boolean;
    signer?: string;
    via?: 'tx' | 'userop';
    block: bigint;
    time: number;
    reverted?: boolean;
    ethValue?: bigint;
    splitLegs?: boolean;
  }) {
    const logs: RawLog[] = [];
    let li = 0;
    if (o.usdc) logs.push(transferLog(USDC_ADDRESS, o.wallet, POOL, o.usdc, li++));
    if (o.splitLegs) {
      logs.push(transferLog(o.token, POOL, o.wallet, o.raw / 2n, li++));
      logs.push(transferLog(o.token, POOL, o.wallet, o.raw - o.raw / 2n, li++));
    } else logs.push(transferLog(o.token, POOL, o.wallet, o.raw, li++));
    const signer = o.signer ?? o.wallet;
    this.times.set(o.block, o.time);
    this.txs.set(o.hash, {
      receipt: { status: o.reverted ? 'reverted' : 'success', blockNumber: o.block, from: signer, to: ROUTER, logs },
      tx: { from: o.via === 'userop' ? addr(0xbeef) : signer, to: ROUTER, value: o.ethValue ?? 0n, input: '0x', blockNumber: o.block },
      attribution: { attributed: o.attributed ?? true, codes: o.attributed === false ? [] : ['bc_vdp89s9b'], via: o.attributed === false ? 'none' : o.via ?? 'tx', from: signer },
    });
    this.logs.push({ token: o.token, from: POOL, to: o.wallet, value: o.raw, blockNumber: o.block, txHash: o.hash, logIndex: 1 });
  }

  addSell(o: { hash: string; wallet: string; token: string; raw: bigint; block: bigint; time: number }) {
    this.times.set(o.block, o.time);
    this.logs.push({ token: o.token, from: o.wallet, to: POOL, value: o.raw, blockNumber: o.block, txHash: o.hash, logIndex: 0 });
  }

  async verifyAttribution(h: string) {
    return this.txs.get(h)?.attribution ?? { attributed: false, codes: [], via: 'none' as const };
  }
  async getReceipt(h: string) {
    return this.txs.get(h)?.receipt ?? null;
  }
  async getTransaction(h: string) {
    return this.txs.get(h)?.tx ?? null;
  }
  async getBlockTime(b: bigint) {
    const t = this.times.get(b);
    if (t === undefined) throw new Error(`no time for block ${b}`);
    return t;
  }
  async blockNumber() {
    return this.head;
  }
  async ethUsd() {
    return 3000;
  }
  async balanceOf(token: string, wallet: string) {
    return this.balances.get(`${token}:${wallet}`) ?? 0n;
  }
  async getTransferLogs(q: { tokens: string[]; from?: string[]; to?: string[]; fromBlock: bigint; toBlock: bigint }) {
    return this.logs.filter(
      (l) =>
        q.tokens.includes(l.token) &&
        l.blockNumber >= q.fromBlock &&
        l.blockNumber <= q.toBlock &&
        (q.from ? q.from.includes(l.from) : true) &&
        (q.to ? q.to.includes(l.to) : true),
    );
  }
}

export class Clock {
  constructor(public t: number) {}
  now = () => this.t;
  set(t: number) {
    this.t = t;
  }
  add(sec: number) {
    this.t += sec;
  }
}

export function makeService(opts: { store?: DocStore; chain?: FakeChain; prices?: StaticPriceSource; clock: Clock; funders?: Record<string, string | null> } & Partial<Omit<ClubsDeps, 'funding'>>) {
  const chain = opts.chain ?? new FakeChain();
  const prices = opts.prices ?? new StaticPriceSource();
  const svc = createClubsService({
    store: opts.store ?? new MemoryDocStore(),
    chain,
    prices,
    now: opts.clock.now,
    geo: createGeoPolicy({ unknown: 'allow' }),
    funding: new StaticFundingResolver(opts.funders ?? {}),
    history: opts.history,
    config: { tokens: TOKEN_MAP, matchSalt: 'test-salt', siteUrl: 'https://tropaclub.xyz' },
  });
  return { svc, chain, prices };
}

/** Stores to run integration suites against: memory always, the Firestore emulator when it is up. */
export async function storesUnderTest(): Promise<{ name: string; make: () => Promise<DocStore> }[]> {
  const out: { name: string; make: () => Promise<DocStore> }[] = [{ name: 'memory', make: async () => new MemoryDocStore() }];
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const { FirestoreDocStore, firestoreFor } = await import('../src/store/firestore');
    const db = firestoreFor({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-tropaclub', appName: 'tropa-clubs-test' });
    let n = 0;
    out.push({ name: 'firestore-emulator', make: async () => new FirestoreDocStore(db, { collectionPrefix: `t${Date.now()}_${n++}_` }) });
  }
  return out;
}
