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
  assert.match(page, />Claim fees</);
  assert.match(page, />Claim &amp; burn supply</);

  const csrf = createHmac("sha256", d.cfg.sessionSecret).update("csrf:1001").digest("hex");
  const body = new URLSearchParams({ to: "0x00000000000000000000000000000000000000aa", csrf, mode: "burn" });
  const r = await app.request("http://x/claim", { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body });
  assert.equal(r.status, 302);
  const burned = d.long.transfers.filter((t) => t.to.toLowerCase() === "0x000000000000000000000000000000000000dead");
  assert.equal(burned.length, 1);
});

test("launches list, token page, and sign-in link", async () => {
  const { handleMention } = await import("../src/bot.ts");
  const { author, nextTweetId } = await import("./helpers.ts");
  const d = setup();
  d.cfg.sessionSecret = "s".repeat(32);
  const tweetId = nextTweetId();
  await handleMention(d, { tweetId, text: '@longdotxyz launch $PAGE "Page Token" paired $AAPL', author: author({ username: "pager" }) });
  const app = createApp(d.cfg, d.db, d.long);

  const home = await (await app.request("http://x/")).text();
  assert.match(home, /href="\/login">𝕏 Sign in</);
  assert.match(home, /id="faq"/);

  const list = await (await app.request("http://x/launches?q=pa")).text();
  assert.match(list, /\$PAGE/);
  const none = await (await app.request("http://x/launches?q=zzz")).text();
  assert.match(none, /No matches/);

  const tok = await app.request(`http://x/t/${tweetId}`);
  assert.equal(tok.status, 200);
  const body = await tok.text();
  assert.match(body, /Page Token/);
  assert.match(body, /Paired with <img class="slogo" src="\/logo\/AAPL"[^>]*>\$AAPL/);
  assert.equal((await app.request("http://x/t/123")).status, 404);

  const login = await app.request("http://x/login");
  assert.equal(login.status, 302);
});

test("empty variables fall back to defaults; example SESSION_SECRET is ignored", async () => {
  const { loadConfig } = await import("../src/config.ts");
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { CHAIN_ID: "", RPC_URL: "", PROTOCOL_SHARE_BPS: " ", SESSION_SECRET: "change-me-to-a-long-random-string", X_OAUTH_CLIENT_ID: "" });
    const cfg = loadConfig();
    assert.equal(cfg.chain.chainId, 4663);
    assert.equal(cfg.chain.rpcUrl, "https://rpc.mainnet.chain.robinhood.com");
    assert.equal(cfg.chain.protocolShareBps, 500n);
    assert.equal(cfg.sessionSecret, "");
    assert.equal(cfg.x.oauthClientId, "");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("/stocks lists the pairable markets", async () => {
  const { STOCKS, marketLabel } = await import("../src/stocks.ts");
  const d = setup();
  d.cfg.sessionSecret = "s".repeat(32);
  const body = await (await createApp(d.cfg, d.db, d.long).request("http://x/stocks")).text();
  for (const s of STOCKS) assert.ok(body.includes(`<b>$${marketLabel(s)}</b>`), s);
  assert.ok(body.includes("<b>$NVDAx3L</b>"));
  assert.match(await (await createApp(d.cfg, d.db, d.long).request("http://x/stocks?q=tesla")).text(), /\$TSLA/);
});

test("stock logos: pages show them, letter badge fallback, unknown symbol 404", async () => {
  const d = setup();
  d.cfg.sessionSecret = "x".repeat(32);
  const app = createApp(d.cfg, d.db, d.long);
  const page = await (await app.request("http://x/stocks")).text();
  assert.match(page, /<img class="slogo" src="\/logo\/NVDA"/);
  assert.match(page, /src="\/logo\/NVDAX3L"/);
  const svg = await app.request("http://x/logo/nvda?letter=1");
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(await svg.text(), />NVD</);
  assert.equal((await app.request("http://x/logo/ZZZZ")).status, 404);
});
