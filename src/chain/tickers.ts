import { createPublicClient, erc20Abi, getAddress, http, type Address, type Hex } from "viem";
import { robinhood } from "viem/chains";
import type { Config } from "../config.ts";
import { getKv, setKv, tx, type DB } from "../db.ts";

/** keccak topic of LongLauncher.LaunchCreated(poolOrHook indexed, asset indexed, numeraire indexed, ...). */
export const LAUNCH_CREATED_TOPIC = "0xadc6f1f726f7c710f77ec06adc75f3bb964e5be19581b072c67f7b9b4039267b";

const CURSOR_KEY = "long_ticker_cursor";
const MAX_CHUNK = 10_000n;
const MIN_CHUNK = 250n;

export interface RawLaunchLog {
  topics: Hex[];
  blockNumber: Hex;
}

export function decodeLaunchCreated(log: RawLaunchLog): { asset: Address; numeraire: Address; block: bigint } | null {
  if (log.topics.length < 4 || log.topics[0].toLowerCase() !== LAUNCH_CREATED_TOPIC) return null;
  const addr = (t: Hex) => getAddress(`0x${t.slice(-40)}`);
  return { asset: addr(log.topics[2]), numeraire: addr(log.topics[3]), block: BigInt(log.blockNumber) };
}

export function recordExternalLaunch(
  db: DB,
  l: { asset: string; symbol: string; numeraire: string; block: bigint; launchedAt: number },
) {
  db.prepare(
    `INSERT INTO external_launches(asset, symbol, numeraire, block, launched_at) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(asset) DO NOTHING`,
  ).run(l.asset.toLowerCase(), l.symbol.trim().toUpperCase(), l.numeraire.toLowerCase(), Number(l.block), l.launchedAt);
}

/** The slice of a viem public client the indexer uses (injectable for tests). */
export interface TickerChainReader {
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  request(args: { method: "eth_getLogs"; params: unknown[] }): Promise<unknown>;
  multicall(args: {
    contracts: readonly { address: Address; abi: typeof erc20Abi; functionName: "symbol" }[];
    allowFailure: true;
  }): Promise<({ status: "success"; result: string } | { status: "failure"; error: Error })[]>;
}

/**
 * Follows every Long.xyz launch on-chain so LONGSHOT never hands out a ticker Long.xyz has reserved.
 * The ticker is read from the launched token's `symbol()`, which avoids decoding the (unpublished)
 * event payload.
 */
export class LongTickerIndexer {
  private readonly pub: TickerChainReader;
  private lastSyncAt = 0;
  private inFlight: Promise<number> | null = null;

  constructor(
    private readonly cfg: Config["chain"],
    private readonly rules: Config["rules"],
    private readonly db: DB,
    private readonly log: (m: string) => void = () => {},
    client?: TickerChainReader,
  ) {
    this.pub = client ?? (createPublicClient({ chain: robinhood, transport: http(cfg.rpcUrl) }) as unknown as TickerChainReader);
  }

  /** True when the index was brought up to the chain head recently enough to trust. */
  isFresh(maxAgeMs = 5 * 60_000) {
    return Date.now() - this.lastSyncAt < maxAgeMs;
  }

  /** Seconds per block, measured over the last `sample` blocks, plus the head's timestamp. */
  private async clock(head: bigint) {
    const sample = 10_000n;
    const [a, b] = await Promise.all([
      this.pub.getBlock({ blockNumber: head }),
      this.pub.getBlock({ blockNumber: head > sample ? head - sample : 0n }),
    ]);
    const secsPerBlock = Math.max(Number(a.timestamp - b.timestamp) / Number(sample), 0.01);
    /** Estimated wall-clock time of a block, in ms. Avoids one RPC call per launch. */
    const timeOf = (block: bigint) => Number(a.timestamp) * 1000 - Number(head - block) * secsPerBlock * 1000;
    return { secsPerBlock, timeOf };
  }

  /** Where to start the very first sync: only as far back as the reservation window needs. */
  private initialBlock(head: bigint, secsPerBlock: number): bigint {
    if (this.rules.tickerCooldownHours <= 0) return this.cfg.longStartBlock; // reserved forever: need full history
    const windowBlocks = BigInt(Math.ceil((this.rules.tickerCooldownHours * 3600 * 1.25) / secsPerBlock));
    const start = head > windowBlocks ? head - windowBlocks : 0n;
    return start > this.cfg.longStartBlock ? start : this.cfg.longStartBlock;
  }

  /** Bring the index up to the chain head. Concurrent callers share one run. */
  sync(): Promise<number> {
    this.inFlight ??= this.syncOnce().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async syncOnce(): Promise<number> {
    const head = await this.pub.getBlockNumber();
    const { secsPerBlock, timeOf } = await this.clock(head);
    const cursor = getKv(this.db, CURSOR_KEY);
    let from = cursor ? BigInt(cursor) + 1n : this.initialBlock(head, secsPerBlock);
    let chunk = MAX_CHUNK;
    let added = 0;
    const backfill = head - from > 100n * MAX_CHUNK;
    if (backfill) this.log(`ticker index: backfilling Long.xyz launches from block ${from} to ${head}…`);
    let lastProgress = Date.now();

    while (from <= head) {
      const to = from + chunk - 1n > head ? head : from + chunk - 1n;
      let logs: RawLaunchLog[];
      try {
        logs = (await this.pub.request({
          method: "eth_getLogs",
          params: [{
            address: this.cfg.longLauncher,
            fromBlock: `0x${from.toString(16)}`,
            toBlock: `0x${to.toString(16)}`,
            topics: [LAUNCH_CREATED_TOPIC],
          }],
        })) as RawLaunchLog[];
      } catch (e) {
        if (chunk > MIN_CHUNK) {
          chunk /= 2n; // RPC range limit — retry smaller
          continue;
        }
        throw e;
      }

      const launches = logs.map(decodeLaunchCreated).filter((l) => l !== null);
      if (launches.length) {
        const symbols = await this.pub.multicall({
          contracts: launches.map((l) => ({ address: l.asset, abi: erc20Abi, functionName: "symbol" as const })),
          allowFailure: true,
        });
        tx(this.db, () => {
          launches.forEach((l, i) => {
            const s = symbols[i];
            if (s.status !== "success") return;
            recordExternalLaunch(this.db, { asset: l.asset, symbol: s.result, numeraire: l.numeraire, block: l.block, launchedAt: Math.max(1, Math.round(timeOf(l.block))) });
            added++;
          });
        });
      }
      setKv(this.db, CURSOR_KEY, to.toString());
      from = to + 1n;
      if (backfill && Date.now() - lastProgress > 30_000) {
        lastProgress = Date.now();
        this.log(`ticker index: block ${to}/${head}, ${added} launches so far`);
      }
      if (chunk < MAX_CHUNK) chunk *= 2n;
    }

    this.lastSyncAt = Date.now();
    if (added) this.log(`ticker index: +${added} Long.xyz launches (head ${head})`);
    return added;
  }
}
