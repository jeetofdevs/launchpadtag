import { STOCKS, type Config } from "./config.ts";
import type { DB } from "./db.ts";
import type { LaunchCommand } from "./parser.ts";

export interface Author {
  id: string;
  username: string;
  createdAt: Date;
  followers: number;
  protected?: boolean;
}

const BLOCKED_TICKERS = new Set<string>([
  ...STOCKS,
  "BTC", "ETH", "USDC", "USDT", "SOL", "BNB", "HOOD", "LONG",
  "APPLE", "GOOGLE", "TESLA", "NVIDIA", "MICROSOFT", "ROBINHOOD", "SPACEX",
  "SCAM", "RUG", "RUGPULL", "AIRDROP", "FREE",
]);

export type Verdict =
  | { ok: true }
  | { ok: false; reason: string; existingToken?: string };

const DAY = 24 * 60 * 60 * 1000;

export function validateLaunch(
  db: DB,
  rules: Config["rules"],
  cmd: LaunchCommand,
  author: Author,
  now = Date.now(),
): Verdict {
  if (author.protected) return { ok: false, reason: "akun private tidak bisa launch" };

  const ageDays = (now - author.createdAt.getTime()) / DAY;
  if (ageDays < rules.minAccountAgeDays)
    return { ok: false, reason: `umur akun minimal ${rules.minAccountAgeDays} hari` };

  if (author.followers < rules.minFollowers)
    return { ok: false, reason: `minimal ${rules.minFollowers} followers` };

  if (BLOCKED_TICKERS.has(cmd.ticker)) return { ok: false, reason: `ticker $${cmd.ticker} tidak diizinkan` };

  const recentByUser = db
    .prepare(
      "SELECT COUNT(*) AS n FROM launches WHERE x_user_id = ? AND created_at > ? AND status IN ('queued','deploying','live')",
    )
    .get(author.id, now - DAY) as { n: number };
  if (recentByUser.n >= rules.launchesPerDay)
    return { ok: false, reason: `maksimal ${rules.launchesPerDay} launch per 24 jam` };

  // 0 = a ticker can never be reused.
  const since = rules.tickerCooldownHours > 0 ? now - rules.tickerCooldownHours * 60 * 60 * 1000 : 0;
  const window = rules.tickerCooldownHours > 0 ? `dalam ${rules.tickerCooldownHours} jam terakhir` : "sebelumnya";

  const dup = db
    .prepare(
      "SELECT token_address FROM launches WHERE ticker = ? AND created_at > ? AND status IN ('queued','deploying','live') ORDER BY created_at DESC LIMIT 1",
    )
    .get(cmd.ticker, since) as { token_address: string | null } | undefined;
  if (dup)
    return { ok: false, reason: `$${cmd.ticker} sudah di-launch ${window}`, existingToken: dup.token_address ?? undefined };

  const external = db
    .prepare("SELECT asset FROM external_launches WHERE symbol = ? AND launched_at > ? ORDER BY launched_at DESC LIMIT 1")
    .get(cmd.ticker, since) as { asset: string } | undefined;
  if (external)
    return { ok: false, reason: `$${cmd.ticker} sudah dipakai di Long.xyz ${window}`, existingToken: external.asset };

  return { ok: true };
}
