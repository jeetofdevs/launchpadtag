import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMention } from "../src/bot.ts";
import { BroadcastUncertainError } from "../src/chain/index.ts";
import { claimAll } from "../src/claim.ts";
import { harvestFees } from "../src/harvester.ts";
import { balances, splitFee } from "../src/ledger.ts";
import { author, nextTweetId, setup } from "./helpers.ts";

const TO = "0x000000000000000000000000000000000000dEaD";

test("split is 80% deployer / 20% treasury, no dust lost", () => {
  assert.deepEqual(splitFee(1000n), { deployer: 800n, treasury: 200n });
  const odd = splitFee(7n);
  assert.equal(odd.deployer + odd.treasury, 7n);
  assert.equal(odd.deployer, 5n);
});

async function launched(fee = 1000n) {
  const d = setup(fee);
  await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $FEE", author: author() });
  return d;
}

test("harvest books fees; claim pays exactly 80% once", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  await harvestFees(d.db, d.long);
  const [b] = balances(d.db, "42");
  assert.equal(b.totalFees, 2000n);
  assert.equal(b.claimable, 1600n);

  const r1 = await claimAll(d.db, d.long, "42", TO, 0n);
  assert.equal(r1[0].amount, 1600n);
  assert.equal(d.long.transfers.length, 1);
  assert.equal(d.long.transfers[0].amount, 1600n);

  const r2 = await claimAll(d.db, d.long, "42", TO, 0n);
  assert.equal(r2.length, 0);
  assert.equal(d.long.transfers.length, 1);
});

test("concurrent claims cannot double-pay", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  await Promise.all([claimAll(d.db, d.long, "42", TO, 0n), claimAll(d.db, d.long, "42", TO, 0n)]);
  const paid = d.long.transfers.reduce((a, t) => a + t.amount, 0n);
  assert.equal(paid, 800n);
});

test("failed transfer releases the balance for retry", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  const orig = d.long.transfer.bind(d.long);
  d.long.transfer = async () => { throw new Error("reverted"); };
  const r = await claimAll(d.db, d.long, "42", TO, 0n);
  assert.ok(r[0].error);
  assert.equal(balances(d.db, "42")[0].claimable, 800n);
  d.long.transfer = orig;
  await claimAll(d.db, d.long, "42", TO, 0n);
  assert.equal(balances(d.db, "42")[0].claimable, 0n);
});

test("unconfirmed transfer keeps the balance locked (no double pay)", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  d.long.transfer = async () => { throw new BroadcastUncertainError("0xabc", new Error("timeout")); };
  await claimAll(d.db, d.long, "42", TO, 0n);
  assert.equal(balances(d.db, "42")[0].claimable, 0n);
});

test("per-claim cap pays in chunks", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  await claimAll(d.db, d.long, "42", TO, 300n);
  assert.equal(balances(d.db, "42")[0].claimable, 500n);
});

test("other users cannot see or claim someone's fees", async () => {
  const d = await launched(1000n);
  await harvestFees(d.db, d.long);
  assert.equal(balances(d.db, "999").length, 0);
  assert.equal((await claimAll(d.db, d.long, "999", TO, 0n)).length, 0);
});
