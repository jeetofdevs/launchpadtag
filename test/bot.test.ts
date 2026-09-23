import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMention } from "../src/bot.ts";
import { author, DAY, nextTweetId, setup } from "./helpers.ts";

test("launches a token and replies with the CA", async () => {
  const d = setup();
  const res = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $ROBO paired $TSLA", author: author() });
  assert.equal(res.kind, "live");
  assert.equal(d.replier.sent.length, 1);
  assert.match(d.replier.sent[0].text, /\$ROBO/);
  assert.match(d.replier.sent[0].text, /80% of every trading fee/);
  assert.ok(d.replier.sent[0].text.length <= 280);
});

test("same tweet twice launches once", async () => {
  const d = setup();
  const m = { tweetId: nextTweetId(), text: "@longshotpadxyz launch $ONCE", author: author() };
  assert.equal((await handleMention(d, m)).kind, "live");
  assert.equal((await handleMention(d, m)).kind, "duplicate");
  assert.equal(d.replier.sent.length, 1);
});

test("non-commands are ignored silently", async () => {
  const d = setup();
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz gm", author: author() })).kind, "ignored");
  assert.equal(d.replier.sent.length, 0);
});

test("rejects young / small accounts", async () => {
  const d = setup();
  const young = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $NEWB", author: author({ createdAt: new Date(Date.now() - 2 * DAY) }) });
  assert.equal(young.kind, "rejected");
  const small = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $SMOL", author: author({ followers: 3 }) });
  assert.equal(small.kind, "rejected");
});

test("rejects real stock tickers", async () => {
  const d = setup();
  const r = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $TSLA", author: author() });
  assert.equal(r.kind, "rejected");
});

test("rate limit: one launch per user per day", async () => {
  const d = setup();
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $AAAA", author: author() })).kind, "live");
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $AAAB", author: author() })).kind, "rejected");
});

test("duplicate ticker is refused as reserved", async () => {
  const d = setup();
  const first = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $DUPE", author: author({ id: "1" }) });
  assert.equal(first.kind, "live");
  const second = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $DUPE", author: author({ id: "2" }) });
  assert.equal(second.kind, "rejected");
  assert.equal(d.replier.sent.at(-1)!.text, "❌ $DUPE reserved. Try again using another ticker.");
});

test("chain failure marks launch failed and frees the user's daily slot", async () => {
  const d = setup();
  d.long.createToken = async () => { throw new Error("rpc down"); };
  const r = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $FAIL", author: author() });
  assert.equal(r.kind, "failed");
  delete (d.long as { createToken?: unknown }).createToken; // restore prototype method
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $RETRY", author: author() })).kind, "live");
});

test("pairing with a stock that isn't a Long.xyz market is refused with a pointer to /stocks", async () => {
  const d = setup();
  const r = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $NOPE paired $ZZZZ", author: author() });
  assert.equal(r.kind, "rejected");
  assert.match(d.replier.sent[0].text, /\$ZZZZ is not a stock you can pair with — see .*\/stocks/);
});

test("X errors are explained without leaking keys", async () => {
  const { ApiResponseError } = await import("twitter-api-v2");
  const { describeXError } = await import("../src/x/client.ts");
  const e = new ApiResponseError("Request failed with code 401", {
    code: 401, data: { title: "Unauthorized", detail: "Unauthorized" } as never,
    request: {} as never, response: { headers: {} } as never, headers: {},
  } as never);
  const msg = describeXError(e);
  assert.match(msg, /^X 401: Unauthorized/);
  assert.match(msg, /regenerate the Access Token AFTER the Consumer Key/);
});

test("swapped X_ACCESS_TOKEN / X_ACCESS_SECRET are detected and fixed", async () => {
  const { loadConfig } = await import("../src/config.ts");
  const saved = { ...process.env };
  try {
    process.env.X_ACCESS_TOKEN = "5OZr4OT1nZGGVerZg0AjlFnKeoI2UWEfpvxDUrrcFqk6q";
    process.env.X_ACCESS_SECRET = "2102813850382807040-NLpQqwjKiXDZw3v01ZVkns2BbXjjwF";
    const x = loadConfig().x;
    assert.equal(x.accessSwapped, true);
    assert.match(x.accessToken, /^2102813850382807040-/);
    process.env.X_ACCESS_TOKEN = "2102813850382807040-abc";
    process.env.X_ACCESS_SECRET = "secretsecret";
    assert.equal(loadConfig().x.accessSwapped, false);
  } finally {
    process.env = saved;
  }
});

test("a failed launch is summarised in one line and shown in /healthz", async () => {
  const { createApp } = await import("../src/web/server.ts");
  const d = setup();
  d.cfg.sessionSecret = "x".repeat(32);
  const cause = Object.assign(new Error("Execution reverted with reason: SenderNotAirlock"), { shortMessage: "Execution reverted with reason: SenderNotAirlock" });
  d.long.createToken = async () => { throw Object.assign(new Error("The contract function \"create\" reverted.\n\nContract Call:\n  data: 0xdeadbeef…"), { shortMessage: "The contract function \"create\" reverted.", cause }); };
  const r = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $BOOM", author: author() });
  assert.equal(r.kind, "failed");
  const h = await (await createApp(d.cfg, d.db, d.long).request("http://x/healthz")).json() as { lastFailedLaunch: { ticker: string; error: string } };
  assert.equal(h.lastFailedLaunch.ticker, "BOOM");
  assert.match(h.lastFailedLaunch.error, /reverted\. \| Execution reverted with reason: SenderNotAirlock/);
  assert.ok(!h.lastFailedLaunch.error.includes("\n"));
});

test("token metadata links X to the launch tweet", async () => {
  const { buildMetadata } = await import("../src/metadata.ts");
  const m = buildMetadata({ ticker: "MOON", name: "Moon", stock: "NVDA", x_username: "alice", tweet_id: "123", image_url: null, origin_tweet: null }, "https://longshotpad.xyz");
  const tweet = "https://x.com/alice/status/123";
  assert.equal(m.twitter, tweet);
  assert.equal(m.x, tweet);
  assert.equal(m.extensions.twitter, tweet);
  assert.deepEqual(m.socials[0], { type: "twitter", url: tweet });
  assert.equal(m.website, "https://longshotpad.xyz/t/123");
});

test("tickers with numbers are refused before anything is launched (Long.xyz accepts letters only)", async () => {
  const d = setup();
  const r = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $MOON2", author: author() });
  assert.equal(r.kind, "rejected");
  assert.match(d.replier.sent[0].text, /letters \(A–Z\)/);
  assert.equal((d.db.prepare("SELECT COUNT(*) AS n FROM launches WHERE status = 'live'").get() as { n: number }).n, 0);
});

test("UNLIMITED_ACCOUNTS: listed accounts have no daily limit or account minimums; ticker rules still apply", async () => {
  const d = setup();
  d.cfg.rules.unlimitedAccounts = ["devteam", "777"];
  const dev = author({ id: "1", username: "DevTeam", followers: 0, createdAt: new Date() });
  for (const t of ["DEVA", "DEVB", "DEVC"]) {
    assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: `@longshotpadxyz launch $${t}`, author: dev })).kind, "live", t);
  }
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $IDA", author: author({ id: "777" }) })).kind, "live");
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $IDB", author: author({ id: "777" }) })).kind, "live");
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $DEVA", author: dev })).kind, "rejected"); // ticker taken
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $OTHA", author: author({ id: "2" }) })).kind, "live");
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $OTHB", author: author({ id: "2" }) })).kind, "rejected"); // normal limit
});

test("@nathanbullish is a dev account by default", async () => {
  const d = setup();
  assert.deepEqual(d.cfg.rules.unlimitedAccounts, ["nathanbullish"]);
  const me = author({ id: "9", username: "NathanBullish", followers: 0, createdAt: new Date() });
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $NATA", author: me })).kind, "live");
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $NATB", author: me })).kind, "live");
});
