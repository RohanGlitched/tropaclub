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
/** KyberSwap's executor on Base: takes the payment, trades with the pool, hands the stock to the buyer. */
export const EXECUTOR = '0x8f10b468b06c6fd214b65f87778827f7d113f996';
/** ERC-4337 EntryPoint v0.7: a smart wallet's transaction is sent here, not to the router. */
export const ENTRYPOINT = '0x0000000071727de22e5e9d8baf0edac6f37da032';
export const SWAPPED_TOPIC = '0xd6d4f5681c246c9f42c203e287975af1601f8df8035a9251f79aab5c8f09e2f8';
export const NATIVE_ETH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const word = (v: string | bigint) => (typeof v === 'bigint' ? v.toString(16) : v.slice(2).toLowerCase()).padStart(64, '0');
/** The router's Swapped(sender, srcToken, dstToken, dstReceiver, spentAmount, returnAmount) log. */
export const swappedLog = (o: { sender: string; srcToken: string; dstToken: string; dstReceiver: string; spent: bigint; returned: bigint; logIndex: number; emitter?: string }): RawLog => ({
  address: o.emitter ?? ROUTER,
  topics: [SWAPPED_TOPIC],
  data: `0x${word(o.sender)}${word(o.srcToken)}${word(o.dstToken)}${word(o.dstReceiver)}${word(o.spent)}${word(o.returned)}`,
  logIndex: o.logIndex,
});

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
  /** Addresses the fake chain treats as real Aerodrome pools. */
  pools = new Set<string>([POOL]);

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
    // The shape of a real KyberSwap buy: payment buyer -> executor -> pool, stock pool -> executor
    // -> buyer, then the router's Swapped log.
    const logs: RawLog[] = [];
    let li = 0;
    const eth = !o.usdc;
    const spent = o.usdc ?? o.ethValue ?? 0n;
    if (o.usdc) {
      logs.push(transferLog(USDC_ADDRESS, o.wallet, EXECUTOR, o.usdc, li++));
      logs.push(transferLog(USDC_ADDRESS, EXECUTOR, POOL, o.usdc, li++));
    }
    logs.push(transferLog(o.token, POOL, EXECUTOR, o.raw, li++));
    if (o.splitLegs) {
      logs.push(transferLog(o.token, EXECUTOR, o.wallet, o.raw / 2n, li++));
      logs.push(transferLog(o.token, EXECUTOR, o.wallet, o.raw - o.raw / 2n, li++));
    } else logs.push(transferLog(o.token, EXECUTOR, o.wallet, o.raw, li++));
    if (spent > 0n) logs.push(swappedLog({ sender: o.wallet, srcToken: eth ? NATIVE_ETH : USDC_ADDRESS, dstToken: o.token, dstReceiver: o.wallet, spent, returned: o.raw, logIndex: li++ }));
    const signer = o.signer ?? o.wallet;
    this.times.set(o.block, o.time);
    this.txs.set(o.hash, {
      receipt: { status: o.reverted ? 'reverted' : 'success', blockNumber: o.block, from: signer, to: ROUTER, logs },
      tx: { from: o.via === 'userop' ? addr(0xbeef) : signer, to: ROUTER, value: o.ethValue ?? 0n, input: '0x', blockNumber: o.block },
      attribution: { attributed: o.attributed ?? true, codes: o.attributed === false ? [] : ['bc_vdp89s9b'], via: o.attributed === false ? 'none' : o.via ?? 'tx', from: signer },
    });
    this.logs.push({ token: o.token, from: POOL, to: o.wallet, value: o.raw, blockNumber: o.block, txHash: o.hash, logIndex: 1 });
  }

  /** Any receipt, as logged (fixtures, forged batches). */
  addRaw(o: { hash: string; wallet: string; logs: RawLog[]; block: bigint; time: number; to?: string; via?: 'tx' | 'userop'; attributed?: boolean }) {
    this.times.set(o.block, o.time);
    const to = o.to ?? ROUTER;
    this.txs.set(o.hash, {
      receipt: { status: 'success', blockNumber: o.block, from: o.via === 'userop' ? addr(0xbeef) : o.wallet, to, logs: o.logs },
      tx: { from: o.via === 'userop' ? addr(0xbeef) : o.wallet, to, value: 0n, input: '0x', blockNumber: o.block },
      attribution: { attributed: o.attributed ?? true, codes: o.attributed === false ? [] : ['bc_vdp89s9b'], via: o.attributed === false ? 'none' : o.via ?? 'tx', from: o.wallet },
    });
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
  async isAerodromePool(a: string) {
    return this.pools.has(a.toLowerCase());
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
