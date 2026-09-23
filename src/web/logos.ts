import { CATALOG, LONG_TOKENS } from "../stocks.ts";

/**
 * Market logos for /logo/:symbol.
 *
 * Order: LOGO_<SYM> env override → the token's icon on the Robinhood Chain explorer → the company logo
 * by ticker → a generated letter badge. Found URLs are cached in memory; misses are retried after a while.
 */

/** Leveraged / wrapped Long.xyz markets that should show their underlying company's logo. */
const UNDERLYING: Record<string, string> = { NVDAX3L: "NVDA" };

const TICKER_LOGO = (sym: string) => `https://financialmodelingprep.com/image-stock/${encodeURIComponent(sym)}.png`;
const MISS_TTL_MS = 6 * 60 * 60_000;

async function fetchOk(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
    return r.ok ? r : null;
  } catch {
    return null;
  }
}

async function isImage(url: string): Promise<boolean> {
  const r = await fetchOk(url, { method: "HEAD" });
  return Boolean(r?.headers.get("content-type")?.startsWith("image/"));
}

export function createLogoResolver(explorerUrl: string, addressOf: (sym: string) => string | undefined) {
  const cache = new Map<string, { url: string | null; at: number }>();
  const pending = new Map<string, Promise<string | null>>();

  async function lookup(sym: string): Promise<string | null> {
    const override = process.env[`LOGO_${sym}`];
    if (override?.startsWith("https://")) return override;
    const address = addressOf(sym);
    if (address) {
      const r = await fetchOk(`${explorerUrl}/api/v2/tokens/${address}`);
      const icon = r ? ((await r.json().catch(() => null)) as { icon_url?: string } | null)?.icon_url : undefined;
      if (icon?.startsWith("https://")) return icon;
    }
    // Long.xyz's own tokens ($AI is ArtificialINU, not C3.ai) have no company logo to look up by ticker.
    if (LONG_TOKENS[sym] && !UNDERLYING[sym]) return null;
    const ticker = UNDERLYING[sym] ?? sym;
    if (await isImage(TICKER_LOGO(ticker))) return TICKER_LOGO(ticker);
    return null;
  }

  return async function resolve(sym: string): Promise<string | null> {
    const hit = cache.get(sym);
    if (hit && (hit.url || Date.now() - hit.at < MISS_TTL_MS)) return hit.url;
    let p = pending.get(sym);
    if (!p) {
      p = lookup(sym).finally(() => pending.delete(sym));
      pending.set(sym, p);
    }
    const url = await p;
    cache.set(sym, { url, at: Date.now() });
    return url;
  };
}

/** Dark-green round badge with the market's initials; used when no real logo exists. */
export function letterLogo(sym: string): string {
  const label = (CATALOG[sym] ? sym.replace(/X\d+L$/, "") : sym).slice(0, 3).replace(/[^A-Z0-9]/gi, "");
  const size = label.length > 2 ? 22 : 28;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#0f2a1c"/><circle cx="32" cy="32" r="31" fill="none" stroke="#1f6b43" stroke-width="2"/><text x="32" y="33" text-anchor="middle" dominant-baseline="middle" font-family="Inter,Arial,sans-serif" font-weight="700" font-size="${size}" fill="#3ddc84">${label}</text></svg>`;
}
