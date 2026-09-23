import { ApiResponseError, TwitterApi, type TweetV2, type TwitterV2IncludesHelper } from "twitter-api-v2";
import type { Mention, Replier } from "../bot.ts";
import type { Config } from "../config.ts";
import { getKv, setKv, type DB } from "../db.ts";

const SINCE_KEY = "x_since_id";

function firstPhoto(includes: TwitterV2IncludesHelper, tweet: TweetV2 | undefined): string | undefined {
  if (!tweet) return undefined;
  const photo = includes.medias(tweet).find((m) => m.type === "photo");
  return photo?.url;
}

/**
 * "Request failed with code 401" alone doesn't say what's wrong; X puts the reason in the body.
 * Never includes keys: only the status code and X's own title/detail/errors.
 */
export function describeXError(e: unknown): string {
  if (e instanceof ApiResponseError) {
    const d = (e.data ?? {}) as { title?: string; detail?: string; reason?: string; errors?: { message?: string; code?: number }[] };
    const parts = [d.title, d.detail, d.reason, ...(d.errors ?? []).map((x) => `${x.code ?? ""} ${x.message ?? ""}`.trim())].filter(Boolean);
    const hint =
      e.code === 401 ? " → X_APP_KEY/X_APP_SECRET and X_ACCESS_TOKEN/X_ACCESS_SECRET don't match: regenerate the Access Token AFTER the Consumer Key, from the same app."
      : e.code === 403 ? " → the token can't post: set app permissions to Read and write, then regenerate the Access Token."
      : e.code === 402 ? " → no API credits left on the X developer account."
      : e.code === 429 ? " → X rate limit; it will retry later."
      : "";
    return `X ${e.code}: ${parts.join(" | ") || e.message}${hint}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Posts replies from the LONGSHOT bot account (OAuth 1.0a user context). */
export class XReplier implements Replier {
  private readonly client: TwitterApi;
  constructor(private readonly x: Config["x"]) {
    this.client = new TwitterApi({
      appKey: x.appKey, appSecret: x.appSecret, accessToken: x.accessToken, accessSecret: x.accessSecret,
    });
  }
  /**
   * Narrow a 401 down to one pair of keys: the Consumer Key/Secret alone can fetch an app token,
   * so if that works the Access Token/Secret is the wrong pair.
   */
  async diagnose(): Promise<string> {
    const shape = /^\d+-[A-Za-z0-9]+$/;
    if (!shape.test(this.x.accessToken)) return "X_ACCESS_TOKEN doesn't look like an Access Token (it should start with your account's number and a dash, e.g. 2102813850…-…).";
    try {
      await new TwitterApi({ appKey: this.x.appKey, appSecret: this.x.appSecret }).appLogin();
    } catch {
      return "X_APP_KEY / X_APP_SECRET are wrong: regenerate the Consumer Key and paste both, then regenerate the Access Token.";
    }
    return "X_APP_KEY / X_APP_SECRET are fine, so X_ACCESS_TOKEN / X_ACCESS_SECRET are the wrong pair: regenerate the Access Token (after the Consumer Key) and paste both.";
  }

  /** Which account these keys post as. Logged at startup so wrong or read-only keys show up immediately. */
  async whoami(): Promise<string> {
    const me = await this.client.v2.me();
    return me.data.username;
  }
  async reply(toTweetId: string, text: string) {
    try {
      await this.client.v2.reply(text, toTweetId);
    } catch (e) {
      throw new Error(describeXError(e));
    }
  }
}

/**
 * Finds new tweets tagging the trigger handle with a launch command, via recent search
 * (needs an X API plan with search access).
 */
export class XMentionSource {
  private readonly client: TwitterApi;
  constructor(private readonly x: Config["x"], private readonly db: DB) {
    this.client = new TwitterApi(x.bearerToken);
  }

  /** Returns new mentions; call `commit(newestId)` only after they have all been handled. */
  async fetchNew(): Promise<{ mentions: Mention[]; newestId?: string }> {
    const sinceId = getKv(this.db, SINCE_KEY);
    const query = `@${this.x.triggerHandle} (launch OR deploy OR long) -is:retweet`;
    const page = await this.client.v2.search(query, {
      ...(sinceId ? { since_id: sinceId } : {}),
      max_results: 100,
      expansions: ["author_id", "attachments.media_keys", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys"],
      "tweet.fields": ["created_at", "author_id", "referenced_tweets", "attachments", "note_tweet", "entities"],
      "user.fields": ["created_at", "public_metrics", "protected"],
      "media.fields": ["url", "type"],
    });

    const mentions: Mention[] = [];
    for (const t of page.tweets) {
      const author = page.includes.author(t);
      if (!author?.created_at) continue;
      const repliedTo = t.referenced_tweets?.find((r) => r.type === "replied_to");
      const origin = repliedTo ? page.includes.tweets.find((x) => x.id === repliedTo.id) : undefined;
      mentions.push({
        tweetId: t.id,
        text: t.note_tweet?.text ?? t.text,
        author: {
          id: author.id,
          username: author.username,
          createdAt: new Date(author.created_at),
          followers: author.public_metrics?.followers_count ?? 0,
          protected: author.protected,
        },
        imageUrl: firstPhoto(page.includes, t) ?? firstPhoto(page.includes, origin),
        originTweetId: repliedTo?.id,
        mentioned: [...(t.entities?.mentions ?? []), ...(t.note_tweet?.entities?.mentions ?? [])]
          .filter((u): u is typeof u & { id: string } => Boolean(u.id))
          .map((u) => ({ id: u.id, username: u.username })),
      });
    }

    // Oldest first, so rate limits and ticker cooldowns favour whoever tweeted first.
    mentions.sort((a, b) => (BigInt(a.tweetId) < BigInt(b.tweetId) ? -1 : 1));
    return { mentions, newestId: page.meta.newest_id };
  }

  commit(newestId: string) {
    setKv(this.db, SINCE_KEY, newestId);
  }
}

/** Replier used when X is disabled (local dev): just logs. */
export class ConsoleReplier implements Replier {
  readonly sent: { toTweetId: string; text: string }[] = [];
  constructor(private readonly log: (m: string) => void = console.log) {}
  async reply(toTweetId: string, text: string) {
    this.sent.push({ toTweetId, text });
    this.log(`[reply → ${toTweetId}]\n${text}\n`);
  }
}
