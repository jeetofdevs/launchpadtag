import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMention } from "../src/bot.ts";
import { author, DAY, nextTweetId, setup } from "./helpers.ts";

test("launches a token and replies with the CA", async () => {
  const d = setup();
  const res = await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $ROBO paired $TSLA", author: author() });
  assert.equal(res.kind, "live");
  assert.equal(d.replier.sent.length, 1);
  assert.match(d.replier.sent[0].text, /\$ROBO/);
  assert.match(d.replier.sent[0].text, /80% of every trading fee/);
  assert.ok(d.replier.sent[0].text.length <= 280);
});

test("same tweet twice launches once", async () => {
  const d = setup();
  const m = { tweetId: nextTweetId(), text: "@longdotxyz launch $ONCE", author: author() };
  assert.equal((await handleMention(d, m)).kind, "live");
  assert.equal((await handleMention(d, m)).kind, "duplicate");
  assert.equal(d.replier.sent.length, 1);
});

test("non-commands are ignored silently", async () => {
  const d = setup();
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz gm", author: author() })).kind, "ignored");
  assert.equal(d.replier.sent.length, 0);
});

test("rejects young / small accounts", async () => {
  const d = setup();
  const young = await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $NEWB", author: author({ createdAt: new Date(Date.now() - 2 * DAY) }) });
  assert.equal(young.kind, "rejected");
  const small = await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $SMOL", author: author({ followers: 3 }) });
  assert.equal(small.kind, "rejected");
});

test("rejects real stock tickers", async () => {
  const d = setup();
  const r = await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $TSLA", author: author() });
  assert.equal(r.kind, "rejected");
});

test("rate limit: one launch per user per day", async () => {
  const d = setup();
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $AAA1", author: author() })).kind, "live");
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $AAA2", author: author() })).kind, "rejected");
});

test("duplicate ticker is refused as reserved", async () => {
  const d = setup();
  const first = await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $DUPE", author: author({ id: "1" }) });
  assert.equal(first.kind, "live");
  const second = await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $DUPE", author: author({ id: "2" }) });
  assert.equal(second.kind, "rejected");
  assert.equal(d.replier.sent.at(-1)!.text, "❌ $DUPE reserved. Try again using another ticker.");
});

test("chain failure marks launch failed and frees the user's daily slot", async () => {
  const d = setup();
  d.long.createToken = async () => { throw new Error("rpc down"); };
  const r = await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $FAIL", author: author() });
  assert.equal(r.kind, "failed");
  delete (d.long as { createToken?: unknown }).createToken; // restore prototype method
  assert.equal((await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $RETRY", author: author() })).kind, "live");
});

test("pairing with a stock that isn't a Long.xyz market is refused with a pointer to /stocks", async () => {
  const d = setup();
  const r = await handleMention(d, { tweetId: nextTweetId(), text: "@longdotxyz launch $NOPE paired $ZZZZ", author: author() });
  assert.equal(r.kind, "rejected");
  assert.match(d.replier.sent[0].text, /\$ZZZZ is not a stock you can pair with — see .*\/stocks/);
});
