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
  await claimAll(d.db, d.long, "1", "0x00000000000000000000000000000000000000Aa", 0n);

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

test("claim page offers Claim & Burn and the POST burns own-token rewards", async () => {
  const { handleMention } = await import("../src/bot.ts");
  const { harvestFees } = await import("../src/harvester.ts");
  const { author, nextTweetId } = await import("./helpers.ts");
  const { createHmac } = await import("node:crypto");
  const d = setup(1_000_000n);
  d.cfg.sessionSecret = "s".repeat(32);
  d.cfg.allowDevLogin = true;
  await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $BRN paired $TSLA", author: author({ id: "1001" }) });
  await harvestFees(d.db, d.long);
  const app = createApp(d.cfg, d.db, d.long);

  const login = await app.request("http://x/auth/dev?uid=1001&username=degen");
  const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie")!]).map((c) => c.split(";")[0]).join("; ");
  const page = await (await app.request("http://x/claim", { headers: { cookie } })).text();
  assert.match(page, /Claim &amp; Burn 🔥/);

  const csrf = createHmac("sha256", d.cfg.sessionSecret).update("csrf:1001").digest("hex");
  const body = new URLSearchParams({ to: "0x00000000000000000000000000000000000000aa", csrf, mode: "burn" });
  const r = await app.request("http://x/claim", { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body });
  assert.equal(r.status, 302);
  const burned = d.long.transfers.filter((t) => t.to.toLowerCase() === "0x000000000000000000000000000000000000dead");
  assert.equal(burned.length, 1);
});
