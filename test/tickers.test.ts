import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, Hex } from "viem";
import { handleMention } from "../src/bot.ts";
import { LAUNCH_CREATED_TOPIC, LongTickerIndexer, recordExternalLaunch, type TickerChainReader } from "../src/chain/tickers.ts";
import { getKv } from "../src/db.ts";
import { author, DAY, nextTweetId, setup } from "./helpers.ts";

const pad = (a: string) => `0x${"0".repeat(24)}${a.slice(2).toLowerCase()}` as Hex;
const TSLA = "0x322F0929c4625eD5bAd873c95208D54E1c003b2d";

function external(d: ReturnType<typeof setup>, symbol: string, agoMs: number) {
  recordExternalLaunch(d.db, { asset: `0x${"ab".repeat(20)}`, symbol, numeraire: TSLA, block: 1n, launchedAt: Date.now() - agoMs });
}

test("ticker launched on Long.xyz within 24h is rejected (case-insensitive)", async () => {
  const d = setup();
  external(d, "moon", 2 * 3600_000);
  const r = await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $MOON", author: author() });
  assert.equal(r.kind, "rejected");
  assert.match(d.replier.sent[0].text, /Long\.xyz/);
});

test("ticker becomes free again after the reservation window", async () => {
  const d = setup();
  external(d, "MOON", 2 * DAY);
  const r = await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $MOON", author: author() });
  assert.equal(r.kind, "live");
});

test("TICKER_COOLDOWN_HOURS=0 means a ticker is never reusable", async () => {
  const d = setup();
  d.cfg.rules.tickerCooldownHours = 0;
  external(d, "OLD", 365 * DAY);
  const r = await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $OLD", author: author() });
  assert.equal(r.kind, "rejected");
});

/** Fake chain: LaunchCreated logs at given blocks, 1 block per second, head = 2_000_000. */
function fakeChain(events: { block: bigint; asset: Address; symbol: string }[], opts: { maxRange?: bigint } = {}) {
  const head = 2_000_000n;
  const now = BigInt(Math.floor(Date.now() / 1000));
  let calls = 0;
  const client: TickerChainReader = {
    async getBlockNumber() { return head; },
    async getBlock({ blockNumber }) { return { timestamp: now - (head - blockNumber) }; },
    async request({ params }) {
      calls++;
      const p = params[0] as { fromBlock: Hex; toBlock: Hex; topics: Hex[] };
      const from = BigInt(p.fromBlock), to = BigInt(p.toBlock);
      if (opts.maxRange && to - from + 1n > opts.maxRange) throw new Error("query exceeds max block range");
      assert.equal(p.topics[0], LAUNCH_CREATED_TOPIC);
      return events
        .filter((e) => e.block >= from && e.block <= to)
        .map((e) => ({ blockNumber: `0x${e.block.toString(16)}`, topics: [LAUNCH_CREATED_TOPIC, pad("0x" + "11".repeat(20)), pad(e.asset), pad(TSLA)] }));
    },
    async multicall({ contracts }) {
      return contracts.map((c) => ({ status: "success" as const, result: events.find((e) => e.asset.toLowerCase() === c.address.toLowerCase())!.symbol }));
    },
  };
  return { client, head, calls: () => calls };
}

test("indexer picks up Long.xyz launches, then the bot refuses those tickers", async () => {
  const d = setup();
  const chain = fakeChain([
    { block: 1_999_000n, asset: `0x${"a1".repeat(20)}`, symbol: "PEPE" },  // ~17 min ago
    { block: 1_900_000n, asset: `0x${"a2".repeat(20)}`, symbol: "doge" },  // ~28 h ago
  ]);
  d.cfg.chain.longStartBlock = 0n; // fake chain is shorter than the real one
  const idx = new LongTickerIndexer(d.cfg.chain, d.cfg.rules, d.db, () => {}, chain.client);
  assert.equal(idx.isFresh(), false);
  const added = await idx.sync();
  assert.equal(idx.isFresh(), true);
  assert.equal(added, 2);
  assert.equal(getKv(d.db, "long_ticker_cursor"), chain.head.toString());

  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $PEPE", author: author({ id: "a" }) })).kind, "rejected");
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $DOGE", author: author({ id: "b" }) })).kind, "live");

  // Second sync resumes from the cursor: nothing new, no re-scan.
  const before = chain.calls();
  assert.equal(await idx.sync(), 0);
  assert.ok(chain.calls() - before <= 1);
});

test("indexer shrinks the block range when the RPC limits it", async () => {
  const d = setup();
  const chain = fakeChain([{ block: 1_999_990n, asset: `0x${"a3".repeat(20)}`, symbol: "ZAP" }], { maxRange: 2_000n });
  d.cfg.chain.longStartBlock = 0n;
  const idx = new LongTickerIndexer(d.cfg.chain, d.cfg.rules, d.db, () => {}, chain.client);
  assert.equal(await idx.sync(), 1);
});

test("first sync only scans the reservation window, never before the launcher existed", async () => {
  const d = setup();
  d.cfg.chain.longStartBlock = 1_950_000n;
  const chain = fakeChain([
    { block: 1_940_000n, asset: `0x${"a4".repeat(20)}`, symbol: "PRE" },  // before launcher start: ignored
    { block: 1_990_000n, asset: `0x${"a5".repeat(20)}`, symbol: "POST" },
  ]);
  const idx = new LongTickerIndexer(d.cfg.chain, d.cfg.rules, d.db, () => {}, chain.client);
  assert.equal(await idx.sync(), 1);
});
