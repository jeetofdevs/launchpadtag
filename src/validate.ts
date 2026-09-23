import { STOCKS, type Config } from "./config.ts";
import type { DB } from "./db.ts";
import type { LaunchCommand } from "./parser.ts";
import { ROBINHOOD_STOCK_SYMBOLS } from "./stockSymbols.ts";

export interface Author {
  id: string;
  username: string;
  createdAt: Date;
  followers: number;
  protected?: boolean;
}

const BLOCKED_TICKERS = new Set<string>([
  ...STOCKS,
  ...ROBINHOOD_STOCK_SYMBOLS,
  "BTC", "ETH", "USDC", "USDT", "SOL", "BNB", "HOOD", "LONG",
  "APPLE", "GOOGLE", "TESLA", "NVIDIA", "MICROSOFT", "ROBINHOOD", "SPACEX",
  "SCAM", "RUG", "RUGPULL", "AIRDROP", "FREE",
]);

export type Verdict =
  | { ok: true }
  | { ok: false; reason: string; existingToken?: string; reserved?: boolean };

const DAY = 24 * 60 * 60 * 1000;

export function validateLaunch(
  db: DB,
  rules: Config["rules"],
  cmd: LaunchCommand,
  author: Author,
  now = Date.now(),
): Verdict {
  if (author.protected) return { ok: false, reason: "protected accounts cannot launch" };

  const ageDays = (now - author.createdAt.getTime()) / DAY;
  if (ageDays < rules.minAccountAgeDays)
    return { ok: false, reason: `account must be at least ${rules.minAccountAgeDays} days old` };

  if (author.followers < rules.minFollowers)
    return { ok: false, reason: `account needs at least ${rules.minFollowers} followers` };

  // Long.xyz only accepts letters in a ticker; its launcher reverts on anything else.
  if (!/^[A-Z]+$/.test(cmd.ticker)) return { ok: false, reason: "tickers can only use letters (A–Z), no numbers" };

  if (BLOCKED_TICKERS.has(cmd.ticker)) return { ok: false, reason: "ticker belongs to a real stock/asset", reserved: true };

  // Same rule as Long.xyz: a ticker that has been launched is reserved (for TICKER_COOLDOWN_HOURS; 0 = forever).
  const since = rules.tickerCooldownHours > 0 ? now - rules.tickerCooldownHours * 60 * 60 * 1000 : 0;

  const dup = db
    .prepare(
      "SELECT token_address FROM launches WHERE ticker = ? AND created_at > ? AND status IN ('queued','deploying','live') ORDER BY created_at DESC LIMIT 1",
    )
    .get(cmd.ticker, since) as { token_address: string | null } | undefined;
  if (dup) return { ok: false, reason: "already launched via LONGSHOT", existingToken: dup.token_address ?? undefined, reserved: true };

  const external = db
    .prepare("SELECT asset FROM external_launches WHERE symbol = ? AND launched_at > ? ORDER BY launched_at DESC LIMIT 1")
    .get(cmd.ticker, since) as { asset: string } | undefined;
  if (external) return { ok: false, reason: "already launched on Long.xyz", existingToken: external.asset, reserved: true };

  const recentByUser = db
    .prepare(
      "SELECT COUNT(*) AS n FROM launches WHERE x_user_id = ? AND created_at > ? AND status IN ('queued','deploying','live')",
    )
    .get(author.id, now - DAY) as { n: number };
  if (recentByUser.n >= rules.launchesPerDay)
    return { ok: false, reason: `limit is ${rules.launchesPerDay} launch(es) per 24 hours` };

  return { ok: true };
}
