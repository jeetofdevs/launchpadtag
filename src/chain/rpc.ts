import { fallback, http, type Transport } from "viem";
import { robinhood } from "viem/chains";

/**
 * RPC endpoints to use, in order: RPC_URL (comma-separated, e.g. a private provider first), then the
 * public Robinhood Chain endpoints. The public one sits behind Cloudflare and sometimes answers 403
 * ("Just a moment…") to servers, so a single URL isn't enough.
 */
export function rpcUrls(rpcUrl: string): string[] {
  const own = rpcUrl.split(",").map((u) => u.trim()).filter(Boolean);
  return [...new Set([...own, ...robinhood.rpcUrls.default.http])];
}

export function rpcTransport(rpcUrl: string): Transport {
  return fallback(
    rpcUrls(rpcUrl).map((url) => http(url, { retryCount: 2, retryDelay: 1500, timeout: 20_000 })),
    { rank: false, retryCount: 1 },
  );
}

/** One line instead of viem's multi-line error with a full Cloudflare HTML page in it. */
export function shortRpcError(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; status?: number; url?: string; cause?: unknown };
  let status = err.status;
  let url = err.url;
  for (let c = err.cause as typeof err | undefined; c && (!status || !url); c = c.cause as typeof err | undefined) {
    status ??= c.status;
    url ??= c.url;
  }
  const msg = (err.shortMessage ?? err.message ?? String(e)).split("\n")[0];
  const hint = status === 403 || status === 429 ? " (the RPC is blocking or rate-limiting this server — set RPC_URL to a private endpoint)" : "";
  return `${msg}${status ? ` [HTTP ${status}]` : ""}${url ? ` ${url}` : ""}${hint}`;
}
