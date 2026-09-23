import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMention } from "../src/bot.ts";
import { harvestFees } from "../src/harvester.ts";
import { balances } from "../src/ledger.ts";
import { parseLaunch } from "../src/parser.ts";
import { createApp } from "../src/web/server.ts";
import { author, nextTweetId, setup } from "./helpers.ts";

const bob = { id: "777", username: "Bob_1" };

test("parser reads `fees @user` in any position after the command", () => {
  const p = (t: string) => parseLaunch(t, "longshotpadxyz", "NVDA");
  assert.equal(p("@longshotpadxyz launch $GIFT fees @bob_1")?.feesTo, "bob_1");
  assert.equal(p('@longshotpadxyz launch $GIFT "Gift" paired $TSLA fees to @Bob_1 🎁')?.feesTo, "Bob_1");
  assert.deepEqual(p('@longshotpadxyz launch $GIFT "Gift" fee @bob paired $TSLA'), { ticker: "GIFT", name: "Gift", stock: "TSLA", feesTo: "bob" });
  assert.equal(p("fees @bob @longshotpadxyz launch $GIFT")?.feesTo, undefined);
  assert.equal(p("@longshotpadxyz launch $GIFT paired $TSLA")?.feesTo, undefined);
  assert.equal(p("@longshotpadxyz launch $GIFT coffees @bob")?.feesTo, undefined);
});

test("send fees is coming soon: off by default, the tweet gets a reply and nothing launches", async () => {
  const d = setup();
  assert.equal(d.cfg.rules.sendFeesEnabled, false);
  const r = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $SOON1 fees @bob_1", author: author({ id: "5" }), mentioned: [bob] });
  assert.equal(r.kind, "rejected");
  assert.match(d.replier.sent[0].text, /coming soon/);
  const faq = await (await createApp({ ...d.cfg, sessionSecret: "x".repeat(32) }, d.db, d.long).request("http://x/")).text();
  assert.match(faq, /Can I send the fees to someone else\?<\/summary><p><b>Coming soon\.<\/b>/);
});

test("send fees: the recipient is credited and can claim; the reply says so", async () => {
  const d = setup(1_000_000n);
  d.cfg.rules.sendFeesEnabled = true;
  d.cfg.sessionSecret = "x".repeat(32);
  const tweetId = nextTweetId();
  const res = await handleMention(d, { tweetId, text: "@longshotpadxyz launch $GIFT paired $NVDA fees @bob_1", author: author({ id: "1", username: "alice" }), mentioned: [bob] });
  assert.equal(res.kind, "live");
  assert.match(d.replier.sent[0].text, /@alice sent the fees to @Bob_1: 80% of every trading fee/);
  assert.ok(d.replier.sent[0].text.length <= 280);

  await harvestFees(d.db, d.long);
  assert.equal(balances(d.db, "1").length, 0);
  const nvda = d.long.stockToken("NVDA").toLowerCase();
  assert.equal(balances(d.db, "777").find((b) => b.asset === nvda)?.claimable, 800_000n);

  const page = await (await createApp(d.cfg, d.db, d.long).request(`http://x/t/${tweetId}`)).text();
  assert.match(page, /Fees go to<\/small><a href="https:\/\/x.com\/Bob_1"/);
  assert.match(page, /Creator fees go to <a href="https:\/\/x.com\/Bob_1"/);
  const app = createApp(d.cfg, d.db, d.long);
  for (const path of ["/", "/launches"]) {
    assert.match(await (await app.request(`http://x${path}`)).text(), /🎁 fees → <a href="https:\/\/x.com\/Bob_1"/, path);
  }
});

test("send fees: unknown account or the bot itself is rejected; yourself is a normal launch", async () => {
  const d = setup();
  d.cfg.rules.sendFeesEnabled = true;
  const missing = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $NOPE1 fees @ghost", author: author({ id: "2" }), mentioned: [] });
  assert.equal(missing.kind, "rejected");
  assert.match(d.replier.sent.at(-1)!.text, /couldn't find the X account @ghost/);

  const self = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $NOPE2 fees @longshotpadxyz", author: author({ id: "3" }), mentioned: [{ id: "9", username: "longshotpadxyz" }] });
  assert.equal(self.kind, "rejected");

  const mine = await handleMention(d, { tweetId: nextTweetId(), text: "@longshotpadxyz launch $MINE fees @alice", author: author({ id: "4", username: "alice" }) });
  assert.equal(mine.kind, "live");
  assert.match(d.replier.sent.at(-1)!.text, /💰 @alice earns 80%/);
});
