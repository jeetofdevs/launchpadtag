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

/** Pin metadata to IPFS when PINATA_JWT is set, otherwise serve it from our own /meta endpoint. */
export async function publishMetadata(cfg: Config, tweetId: string, meta: TokenMetadata): Promise<string> {
  if (!cfg.pinataJwt) return `${cfg.publicUrl}/meta/${tweetId}.json`;
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.pinataJwt}` },
    body: JSON.stringify({ pinataContent: meta, pinataMetadata: { name: `longshot-${meta.symbol}-${tweetId}` } }),
  });
  if (!res.ok) throw new Error(`Pinata upload failed: ${res.status} ${await res.text()}`);
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return `ipfs://${IpfsHash}`;
}
