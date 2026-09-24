import type { Config } from "./config.ts";
import type { LongClient } from "./chain/index.ts";
import type { DB } from "./db.ts";
import { buildMetadata, publishMetadata } from "./metadata.ts";
import { feeSplit, pct } from "./tokenomics.ts";
import { marketLabel } from "./stocks.ts";
import { parseLaunch } from "./parser.ts";
import { chainErrorSummary } from "./chain/rpc.ts";
import { validateLaunch, type Author } from "./validate.ts";

export interface Mention {
  tweetId: string;
  text: string;
  author: Author;
  /** First photo attached to the tweet (or to the tweet it replies to). */
  imageUrl?: string;
  /** Tweet being replied to, when launching from a reply. */
  originTweetId?: string;
  /** Accounts @-mentioned in the tweet (from X's entities), used to resolve `fees @user` to an account ID. */
  mentioned?: { id: string; username: string }[];
}

export interface Replier {
  reply(toTweetId: string, text: string): Promise<void>;
}

export interface BotDeps {
  cfg: Config;
  db: DB;
  long: LongClient;
  replier: Replier;
  log?: (msg: string) => void;
}

export type MentionResult =
  | { kind: "ignored" }
  | { kind: "duplicate" }
  | { kind: "rejected"; reason: string }
  | { kind: "live"; tokenAddress: string; txHash: string }
  | { kind: "failed"; error: string };

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** The token's page on the LONGSHOT website, keyed by contract address. */
export function tokenPageUrl(cfg: Config, tokenAddress: string) {
  return `${cfg.publicUrl}/token/${tokenAddress.toLowerCase()}`;
}

/** Length as X counts it: every link is 23 characters, emoji and wide characters count double. */
export function xLength(text: string): number {
  const noUrls = text.replace(/https?:\/\/\S+/g, "x".repeat(23));
  let n = 0;
  for (const ch of noUrls) n += (ch.codePointAt(0) ?? 0) > 0x10ff ? 2 : 1;
  return n;
}

export function tokenUrl(cfg: Config, tokenAddress: string) {
  return `${cfg.longAppUrl}/tokens/${tokenAddress}`;
}

/** Until when replies leave out the contract address (X blocks crypto addresses from new apps for 7 days). */
let caBlockedUntil = 0;

/** Handle one tweet that tags the trigger handle. Safe to call repeatedly for the same tweet. */
export async function handleMention(deps: BotDeps, m: Mention, now = Date.now()): Promise<MentionResult> {
  const { cfg, db, long, replier } = deps;
  const log = deps.log ?? (() => {});

  if (db.prepare("SELECT 1 FROM launches WHERE tweet_id = ?").get(m.tweetId)) return { kind: "duplicate" };

  const cmd = parseLaunch(m.text, cfg.x.triggerHandle, cfg.chain.defaultStock);
  if (!cmd) return { kind: "ignored" };

  const insert = db.prepare(
    `INSERT INTO launches(tweet_id, x_user_id, x_username, ticker, name, stock, image_url, origin_tweet, status, reason, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // "Send fees": the creator share goes to another X account, identified by its ID (renames are safe).
  const own = [cfg.x.botHandle, cfg.x.triggerHandle].map((h) => h.toLowerCase());
  const wantsOther = cmd.feesTo && cmd.feesTo.toLowerCase() !== m.author.username.toLowerCase();
  const recipient = wantsOther ? m.mentioned?.find((u) => u.username.toLowerCase() === cmd.feesTo!.toLowerCase()) : undefined;
  const feeReject = !wantsOther
    ? undefined
    : !cfg.rules.sendFeesEnabled
      ? `sending fees to another account is coming soon. Tweet again without "fees @${cmd.feesTo}"`
      : own.includes(cmd.feesTo!.toLowerCase())
      ? `fees can't be sent to @${cmd.feesTo}`
      : !recipient
        ? `couldn't find the X account @${cmd.feesTo} to send fees to`
        : undefined;

  const verdict = cmd.unknownStock
    ? { ok: false as const, reason: `${cmd.unknownStock} is not a stock you can pair with — see ${cfg.publicUrl}/stocks`, reserved: false }
    : feeReject
      ? { ok: false as const, reason: feeReject, reserved: false }
      : validateLaunch(db, cfg.rules, cmd, m.author, now);
  if (!verdict.ok) {
    insert.run(m.tweetId, m.author.id, m.author.username, cmd.ticker, cmd.name, cmd.stock,
      m.imageUrl ?? null, m.originTweetId ?? null, "rejected", verdict.reason, now);
    const text = verdict.reserved
      ? `❌ $${cmd.ticker} reserved. Try again using another ticker.`
      : `❌ Could not launch $${cmd.ticker}: ${verdict.reason}.`;
    await replier.reply(m.tweetId, text).catch((e) => log(`reply failed: ${e}`));
    log(`rejected ${m.tweetId} $${cmd.ticker}: ${verdict.reason}`);
    return { kind: "rejected", reason: verdict.reason };
  }

  insert.run(m.tweetId, m.author.id, m.author.username, cmd.ticker, cmd.name, cmd.stock,
    m.imageUrl ?? null, m.originTweetId ?? null, "deploying", null, now);
  if (recipient) {
    db.prepare("UPDATE launches SET fee_user_id = ?, fee_username = ? WHERE tweet_id = ?").run(recipient.id, recipient.username, m.tweetId);
  }
  const earner = recipient?.username ?? m.author.username;

  try {
    const meta = buildMetadata(
      { ticker: cmd.ticker, name: cmd.name, stock: cmd.stock, x_username: m.author.username,
        tweet_id: m.tweetId, image_url: m.imageUrl ?? null, origin_tweet: m.originTweetId ?? null, fee_username: recipient?.username ?? null },
      cfg.publicUrl,
    );
    const metadataUri = await publishMetadata(cfg, m.tweetId, meta, { feeReceiver: long.treasury });
    const { tokenAddress, txHash } = await long.createToken({
      name: cmd.name, symbol: cmd.ticker, stock: cmd.stock, metadataUri,
    });
    db.prepare("UPDATE launches SET status = 'live', token_address = ?, tx_hash = ? WHERE tweet_id = ?")
      .run(tokenAddress, txHash, m.tweetId);
    log(`live ${m.tweetId} $${cmd.ticker} → ${tokenAddress}`);

    const lines = [
      `✅ $${cmd.ticker} "${cmd.name}" is LIVE on ${cfg.chain.launchVia === "long" ? "Long.xyz" : "Robinhood Chain"}`,
      `📈 Paired: ${marketLabel(cmd.stock)}`, // X allows only one cashtag per post: the token's
      `📜 CA: ${tokenAddress}`,
      `🔗 ${tokenPageUrl(cfg, tokenAddress)}`,
      recipient
        ? `🎁 @${m.author.username} sent the fees to @${earner}: ${pct(feeSplit(cfg.chain).share.deployer)} of every trading fee — claim: ${cfg.publicUrl}/claim`
        : `💰 @${earner} earns ${pct(feeSplit(cfg.chain).share.deployer)} of every trading fee — claim: ${cfg.publicUrl}/claim`,
    ];
    // The CA is also in the link, so drop the separate CA line if the reply would be too long for X.
    const full = xLength(lines.join("\n")) <= 280 ? lines.join("\n") : lines.filter((l) => !l.startsWith("📜")).join("\n");
    // Newly authorised X apps may not post crypto addresses for their first 7 days: same reply without the
    // CA, linking the token page by launch tweet instead.
    const noCa = lines
      .filter((l) => !l.startsWith("📜"))
      .map((l) => (l.startsWith("🔗") ? `🔗 ${cfg.publicUrl}/t/${m.tweetId}` : l))
      .join("\n");
    const sendNoCa = () => replier.reply(m.tweetId, noCa).catch((e) => log(`reply failed: ${e}`));
    if (Date.now() < caBlockedUntil) {
      await sendNoCa();
    } else {
      await replier.reply(m.tweetId, full).catch(async (e) => {
        if (!/crypto address/i.test(String(e))) return log(`reply failed: ${e}`);
        caBlockedUntil = Date.now() + 6 * 3600_000; // re-try with the CA every few hours
        log("X doesn't allow crypto addresses from this app yet (first 7 days); replying without the CA.");
        await sendNoCa();
      });
    }
    return { kind: "live", tokenAddress, txHash };
  } catch (e) {
    const error = chainErrorSummary(e);
    db.prepare("UPDATE launches SET status = 'failed', reason = ? WHERE tweet_id = ?").run(error.slice(0, 500), m.tweetId);
    log(`failed ${m.tweetId} $${cmd.ticker}: ${error}`);
    await replier
      .reply(m.tweetId, `⚠️ Launch of $${cmd.ticker} failed due to a technical issue. Please try again with a new tweet in a moment.`)
      .catch((err) => log(`reply failed: ${err}`));
    return { kind: "failed", error };
  }
}
