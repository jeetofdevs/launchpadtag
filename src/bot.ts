import type { Config } from "./config.ts";
import type { LongClient } from "./chain/index.ts";
import type { DB } from "./db.ts";
import { buildMetadata, publishMetadata } from "./metadata.ts";
import { parseLaunch } from "./parser.ts";
import { validateLaunch, type Author } from "./validate.ts";

export interface Mention {
  tweetId: string;
  text: string;
  author: Author;
  /** First photo attached to the tweet (or to the tweet it replies to). */
  imageUrl?: string;
  /** Tweet being replied to, when launching from a reply. */
  originTweetId?: string;
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

export function tokenUrl(cfg: Config, tokenAddress: string) {
  return `${cfg.longAppUrl}/tokens/${tokenAddress}`;
}

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

  const verdict = validateLaunch(db, cfg.rules, cmd, m.author, now);
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

  try {
    const meta = buildMetadata(
      { ticker: cmd.ticker, name: cmd.name, stock: cmd.stock, x_username: m.author.username,
        tweet_id: m.tweetId, image_url: m.imageUrl ?? null, origin_tweet: m.originTweetId ?? null },
      cfg.publicUrl,
    );
    const metadataUri = await publishMetadata(cfg, m.tweetId, meta);
    const { tokenAddress, txHash } = await long.createToken({
      name: cmd.name, symbol: cmd.ticker, stock: cmd.stock, metadataUri,
    });
    db.prepare("UPDATE launches SET status = 'live', token_address = ?, tx_hash = ? WHERE tweet_id = ?")
      .run(tokenAddress, txHash, m.tweetId);
    log(`live ${m.tweetId} $${cmd.ticker} → ${tokenAddress}`);

    await replier
      .reply(
        m.tweetId,
        [
          `✅ $${cmd.ticker} "${cmd.name}" is LIVE on @${cfg.x.triggerHandle}`,
          `📈 Paired: $${cmd.stock}`,
          `📜 CA: ${short(tokenAddress)}`,
          `🔗 ${tokenUrl(cfg, tokenAddress)}`,
          `💰 80% of creator fees go to @${m.author.username} — claim: ${cfg.publicUrl}/claim`,
        ].join("\n"),
      )
      .catch((e) => log(`reply failed: ${e}`));
    return { kind: "live", tokenAddress, txHash };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    db.prepare("UPDATE launches SET status = 'failed', reason = ? WHERE tweet_id = ?").run(error.slice(0, 500), m.tweetId);
    log(`failed ${m.tweetId} $${cmd.ticker}: ${error}`);
    await replier
      .reply(m.tweetId, `⚠️ Launch of $${cmd.ticker} failed due to a technical issue. Please try again with a new tweet in a moment.`)
      .catch((err) => log(`reply failed: ${err}`));
    return { kind: "failed", error };
  }
}
