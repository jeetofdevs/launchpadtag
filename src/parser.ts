import { isStock, type Stock } from "./config.ts";

export interface LaunchCommand {
  ticker: string;
  name: string;
  stock: Stock;
  /** Set when the tweet asked for a pair that isn't a supported stock. */
  unknownStock?: string;
  /** "Send fees": X username (without @) that should receive the creator share instead of the deployer. */
  feesTo?: string;
}

/** `fees @user`, `fee @user` or `fees to @user`, anywhere after the launch command. */
const FEES_TO = /(?:^|\s)fees?\s+(?:to\s+)?@([A-Za-z0-9_]{1,15})\b/i;

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse `@<handle> launch $TICKER "Name" paired $STOCK` out of a tweet.
 * `launch` may also be written `deploy` or `long`. Name and pairing are optional.
 * Add `fees @user` to send the creator share to another X account.
 * Curly quotes (common on mobile keyboards) are accepted.
 */
export function parseLaunch(text: string, handle: string, defaultStock: Stock): LaunchCommand | null {
  // Pull out `fees @user` first so it can sit anywhere, including before `paired $STOCK`.
  const quoted = text.replace(/[“”]/g, '"');
  const fees = quoted.match(FEES_TO);
  const normalized = fees ? quoted.slice(0, fees.index!) + quoted.slice(fees.index! + fees[0].length) : quoted;
  const re = new RegExp(
    `@${escape(handle)}\\s+(?:launch|deploy|long)\\s+\\$([A-Za-z0-9]{2,10})\\b` +
      `(?:\\s+"([^"\\n]{1,32})")?` +
      `(?:\\s+paired\\s+\\$([A-Za-z0-9]{1,15})\\b)?`,
    "i",
  );
  const m = normalized.match(re);
  if (!m) return null;
  const ticker = m[1].toUpperCase();
  const name = (m[2] ?? "").trim() || ticker;
  const asked = m[3]?.toUpperCase();
  // Only honour `fees @user` written after the launch command, not in some earlier text.
  const feesTo = fees && fees.index! >= m.index! ? fees[1] : undefined;
  const extra = feesTo ? { feesTo } : {};
  if (asked && !isStock(asked)) return { ticker, name, stock: defaultStock, unknownStock: asked, ...extra };
  return { ticker, name, stock: (asked as Stock | undefined) ?? defaultStock, ...extra };
}
