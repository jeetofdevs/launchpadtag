import { isStock, type Stock } from "./config.ts";

export interface LaunchCommand {
  ticker: string;
  name: string;
  stock: Stock;
  /** Set when the tweet asked for a pair that isn't a supported stock. */
  unknownStock?: string;
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse `@<handle> launch $TICKER "Name" paired $STOCK` out of a tweet.
 * `launch` may also be written `deploy` or `long`. Name and pairing are optional.
 * Curly quotes (common on mobile keyboards) are accepted.
 */
export function parseLaunch(text: string, handle: string, defaultStock: Stock): LaunchCommand | null {
  const normalized = text.replace(/[“”]/g, '"');
  const re = new RegExp(
    `@${escape(handle)}\\s+(?:launch|deploy|long)\\s+\\$([A-Za-z0-9]{2,10})\\b` +
      `(?:\\s+"([^"\\n]{1,32})")?` +
      `(?:\\s+paired\\s+\\$([A-Za-z0-9]{1,6})\\b)?`,
    "i",
  );
  const m = normalized.match(re);
  if (!m) return null;
  const ticker = m[1].toUpperCase();
  const name = (m[2] ?? "").trim() || ticker;
  const asked = m[3]?.toUpperCase();
  if (asked && !isStock(asked)) return { ticker, name, stock: defaultStock, unknownStock: asked };
  return { ticker, name, stock: (asked as Stock | undefined) ?? defaultStock };
}
