import type { Config } from "./config.ts";

export interface TokenMetadata {
  name: string;
  symbol: string;
  description: string;
  image: string | null;
  external_url: string;
  /** Social links. Launchpads, explorers and wallets read different keys, so the X link is under all common ones. */
  twitter: string;
  x: string;
  website: string;
  extensions: { twitter: string; website: string };
  socials: { type: "twitter" | "website"; url: string }[];
  attributes: { trait_type: string; value: string }[];
}

export function buildMetadata(l: {
  ticker: string; name: string; stock: string; x_username: string;
  tweet_id: string; image_url: string | null; origin_tweet: string | null; fee_username?: string | null;
}, publicUrl: string): TokenMetadata {
  const tweetUrl = `https://x.com/${l.x_username}/status/${l.tweet_id}`;
  return {
    name: l.name,
    symbol: l.ticker,
    description: `$${l.ticker} launched by @${l.x_username} via LONGSHOT on Long.xyz, paired with $${l.stock}. ${tweetUrl}`,
    image: l.image_url,
    external_url: `${publicUrl}/t/${l.tweet_id}`,
    // The X link of the token is the tweet that launched it, like other launch-by-tag launchpads.
    twitter: tweetUrl,
    x: tweetUrl,
    website: `${publicUrl}/t/${l.tweet_id}`,
    extensions: { twitter: tweetUrl, website: `${publicUrl}/t/${l.tweet_id}` },
    socials: [
      { type: "twitter", url: tweetUrl },
      { type: "website", url: `${publicUrl}/t/${l.tweet_id}` },
    ],
    attributes: [
      { trait_type: "launched_by", value: `@${l.x_username}` },
      { trait_type: "paired", value: l.stock },
      { trait_type: "launch_tweet", value: tweetUrl },
      ...(l.fee_username ? [{ trait_type: "fees_to", value: `@${l.fee_username}` }] : []),
      ...(l.origin_tweet ? [{ trait_type: "origin_tweet", value: `https://x.com/i/status/${l.origin_tweet}` }] : []),
    ],
  };
}

async function pinata(cfg: Config, path: string, init: RequestInit): Promise<string> {
  const res = await fetch(`https://api.pinata.cloud/pinning/${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${cfg.pinataJwt}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Pinata upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { IpfsHash: string }).IpfsHash;
}

/**
 * Pin metadata to IPFS when PINATA_JWT is set, otherwise serve it from our own /meta endpoint.
 * app.long.xyz only shows a token's image, description and links from an ipfs:// JSON in its own schema
 * (image_hash, social_links, fee_receiver…), so those fields are added next to the standard ones.
 */
export async function publishMetadata(cfg: Config, tweetId: string, meta: TokenMetadata, opts: { feeReceiver?: string } = {}): Promise<string> {
  if (!cfg.pinataJwt) return `${cfg.publicUrl}/meta/${tweetId}.json`;
  let imageHash = "";
  if (meta.image?.startsWith("https://")) {
    try {
      const img = await fetch(meta.image, { signal: AbortSignal.timeout(20_000) });
      if (img.ok) {
        const form = new FormData();
        form.append("file", new Blob([await img.arrayBuffer()], { type: img.headers.get("content-type") ?? "image/jpeg" }), `${meta.symbol}.jpg`);
        form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
        imageHash = `ipfs://${await pinata(cfg, "pinFileToIPFS", { method: "POST", body: form })}`;
      }
    } catch {
      // No image beats no launch: continue with the text metadata.
    }
  }
  const content = {
    ...meta,
    ...(imageHash ? { image: imageHash } : {}),
    image_hash: imageHash,
    social_links: [{ label: "X", url: meta.twitter }, { label: "Website", url: meta.website }],
    vesting_recipients: [{ address: "0x0000000000000000000000000000000000000000", amount: 0 }],
    fee_receiver: opts.feeReceiver ?? "",
    categories: [],
  };
  const cid = await pinata(cfg, "pinJSONToIPFS", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pinataContent: content, pinataOptions: { cidVersion: 1 }, pinataMetadata: { name: `longshot-${meta.symbol}-${tweetId}` } }),
  });
  return `ipfs://${cid}`;
}
