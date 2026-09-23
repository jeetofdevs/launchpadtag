import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/web/server.ts";
import { setup } from "./helpers.ts";
test("www redirects to canonical domain; apex serves", async () => {
  const d = setup();
  d.cfg.publicUrl = "https://longshotpad.xyz";
  d.cfg.sessionSecret = "x".repeat(32);
  const app = createApp(d.cfg, d.db, d.long);
  const r = await app.request("https://www.longshotpad.xyz/claim?a=1", { headers: { host: "www.longshotpad.xyz" } });
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "https://longshotpad.xyz/claim?a=1");
  const ok = await app.request("https://longshotpad.xyz/healthz", { headers: { host: "longshotpad.xyz" } });
  assert.equal(ok.status, 200);
  const rw = await app.request("http://x/healthz", { headers: { host: "longshot.up.railway.app" } });
  assert.equal(rw.status, 200);
});

test("home shows platform-wide claimed and unclaimed rewards", async () => {
  const { handleMention } = await import("../src/bot.ts");
  const { harvestFees } = await import("../src/harvester.ts");
  const { claimAll } = await import("../src/claim.ts");
  const { rewardTotals } = await import("../src/ledger.ts");
  const d = setup(1_000_000n); // 1 NVDA (6 decimals) of fees per harvest in the mock
  d.cfg.sessionSecret = "x".repeat(32);
  const { author, nextTweetId } = await import("./helpers.ts");
  await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $AAA1 paired $NVDA", author: author({ id: "1" }) });
  await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $BBB1 paired $NVDA", author: author({ id: "2" }) });
  await harvestFees(d.db, d.long); // each token: 1 NVDA fee → 0.8 NVDA to its deployer
  await claimAll(d.db, d.long, "1", "0x000000000000000000000000000000000000dEaD", 0n);

  const nvda = d.long.stockToken("NVDA").toLowerCase();
  const t = rewardTotals(d.db).find((r) => r.asset === nvda)!;
  assert.equal(t.claimed, 800_000n);
  assert.equal(t.unclaimed, 800_000n);

  const body = await (await createApp(d.cfg, d.db, d.long).request("http://x/")).text();
  assert.match(body, /Claimed by deployers<\/small><b>0\.8 NVDA<\/b>/);
  assert.match(body, /Unclaimed — ready to withdraw<\/small><b>0\.8 NVDA<\/b>/);
  assert.match(body, /Plus rewards paid in 2 launched tokens/);
  assert.doesNotMatch(body, /per day|\/ month|\/ year/);
});
