import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMention } from "../src/bot.ts";
import { BroadcastUncertainError } from "../src/chain/index.ts";
import { claimAll } from "../src/claim.ts";
import { harvestFees } from "../src/harvester.ts";
import { balances, splitFee } from "../src/ledger.ts";
import { author, nextTweetId, setup } from "./helpers.ts";

const TO = "0x00000000000000000000000000000000000000Aa";

test("split is 80% deployer / 20% treasury, no dust lost", () => {
  assert.deepEqual(splitFee(1000n), { deployer: 800n, treasury: 200n });
  const odd = splitFee(7n);
  assert.equal(odd.deployer + odd.treasury, 7n);
  assert.equal(odd.deployer, 5n);
});

test("with the protocol's 5% taken first, the deployer still gets 80% of the whole fee", () => {
  // Fee 10000 → protocol took 500 → Treasury received 9500 → deployer 8000 (80% of 10000), LONGSHOT 1500.
  assert.deepEqual(splitFee(9500n, 500n), { deployer: 8000n, treasury: 1500n });
});

async function launched(fee = 1000n) {
  const d = setup(fee);
  const res = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $FEE paired $TSLA", author: author() });
  if (res.kind !== "live") throw new Error("launch failed");
  const stock = d.long.stockToken("TSLA").toLowerCase();
  const token = res.tokenAddress.toLowerCase();
  /** Balance of the deployer ("42") in one asset. */
  const bal = (asset: string) => balances(d.db, "42").find((b) => b.asset === asset)!;
  const paidIn = (asset: string) =>
    d.long.transfers.filter((t) => t.asset.toLowerCase() === asset).reduce((a, t) => a + t.amount, 0n);
  return { ...d, stock, token, bal, paidIn };
}

test("harvest books both pool assets; claim pays exactly 80% of each, once", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  await harvestFees(d.db, d.long);
  assert.equal(d.bal(d.stock).totalFees, 2000n);
  assert.equal(d.bal(d.stock).claimable, 1600n);
  assert.equal(d.bal(d.token).totalFees, 20000n); // mock pays 10x in the launched token
  assert.equal(d.bal(d.token).claimable, 16000n);

  const r1 = await claimAll(d.db, d.long, "42", TO, 0n);
  assert.equal(r1.length, 2);
  assert.equal(d.paidIn(d.stock), 1600n);
  assert.equal(d.paidIn(d.token), 16000n);

  const r2 = await claimAll(d.db, d.long, "42", TO, 0n);
  assert.equal(r2.length, 0);
  assert.equal(d.long.transfers.length, 2);
});

test("concurrent claims cannot double-pay", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  await Promise.all([claimAll(d.db, d.long, "42", TO, 0n), claimAll(d.db, d.long, "42", TO, 0n)]);
  assert.equal(d.paidIn(d.stock), 800n);
  assert.equal(d.paidIn(d.token), 8000n);
});

test("failed transfer releases the balance for retry", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  const orig = d.long.transfer.bind(d.long);
  d.long.transfer = async () => { throw new Error("reverted"); };
  const r = await claimAll(d.db, d.long, "42", TO, 0n);
  assert.ok(r.every((x) => x.error));
  assert.equal(d.bal(d.stock).claimable, 800n);
  d.long.transfer = orig;
  await claimAll(d.db, d.long, "42", TO, 0n);
  assert.equal(d.bal(d.stock).claimable, 0n);
  assert.equal(d.bal(d.token).claimable, 0n);
});

test("unconfirmed transfer keeps the balance locked (no double pay)", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  d.long.transfer = async () => { throw new BroadcastUncertainError("0xabc", new Error("timeout")); };
  await claimAll(d.db, d.long, "42", TO, 0n);
  assert.equal(d.bal(d.stock).claimable, 0n);
});

test("per-claim cap pays in chunks", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  await claimAll(d.db, d.long, "42", TO, 300n);
  assert.equal(d.bal(d.stock).claimable, 500n);
});

test("other users cannot see or claim someone's fees", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  assert.equal(balances(d.db, "999").length, 0);
  assert.equal((await claimAll(d.db, d.long, "999", TO, 0n)).length, 0);
});

test("Claim & Burn: own-token rewards go to the burn address, stock rewards to the wallet", async () => {
  const { BURN_ADDRESS } = await import("../src/config.ts");
  const { rewardTotals } = await import("../src/ledger.ts");
  const d = await launched(1000n);
  await harvestFees(d.db, d.long); // mock: 1000 stock + 10000 token of fees
  const res = await claimAll(d.db, d.long, "42", TO, 0n, { burn: true });
  const byAsset = Object.fromEntries(d.long.transfers.map((t) => [t.asset.toLowerCase(), t]));
  assert.equal(byAsset[d.stock].to, TO);
  assert.equal(byAsset[d.stock].amount, 800n);
  assert.equal(byAsset[d.token].to, BURN_ADDRESS);
  assert.equal(byAsset[d.token].amount, 8000n);
  assert.ok(res.find((r) => r.asset === d.token)!.burned);
  assert.ok(!res.find((r) => r.asset === d.stock)!.burned);

  const totals = Object.fromEntries(rewardTotals(d.db).map((t) => [t.asset, t]));
  assert.equal(totals[d.token].burned, 8000n);
  assert.equal(totals[d.token].claimed, 0n);
  assert.equal(totals[d.token].unclaimed, 0n);
  assert.equal(totals[d.stock].claimed, 800n);
  assert.equal(totals[d.stock].burned, 0n);
});

test("a normal claim never burns", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  await claimAll(d.db, d.long, "42", TO, 0n);
  assert.ok(d.long.transfers.every((t) => t.to === TO));
});

test("a transfer that fails (e.g. reverted) releases the balance so it can be claimed again", async () => {
  const { balances } = await import("../src/ledger.ts");
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  const real = d.long.transfer.bind(d.long);
  d.long.transfer = async () => { throw new Error("transfer reverted: 0xabc"); };
  const failed = await claimAll(d.db, d.long, "42", TO, 0n);
  assert.ok(failed.every((r) => r.error));
  assert.equal(balances(d.db, "42").find((b) => b.asset === d.stock)!.claimable, 800n);
  d.long.transfer = real;
  const ok = await claimAll(d.db, d.long, "42", TO, 0n);
  assert.ok(ok.every((r) => r.txHash && !r.error));
  assert.equal(balances(d.db, "42").find((b) => b.asset === d.stock)!.claimable, 0n);
});

test("switching the same database from mock to onchain drops fake launches once", async () => {
  const { dropMockDataOnSwitch } = await import("../src/db.ts");
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  await claimAll(d.db, d.long, "42", TO, 0n);
  const count = (t: string) => (d.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  assert.equal(dropMockDataOnSwitch(d.db, "mock"), 0);
  assert.ok(count("launches") > 0);
  assert.equal(dropMockDataOnSwitch(d.db, "onchain"), 1);
  assert.equal(count("launches") + count("fees") + count("payouts"), 0);
  // Real launches made after the switch are never touched again.
  d.db.prepare("INSERT INTO launches(tweet_id, x_user_id, x_username, ticker, name, stock, status, created_at) VALUES('1','1','a','REAL','Real','NVDA','live',1)").run();
  assert.equal(dropMockDataOnSwitch(d.db, "onchain"), 0);
  assert.equal(count("launches"), 1);
});
