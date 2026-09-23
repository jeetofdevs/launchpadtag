import type { Address, Hex } from "viem";

export const STOCKS = ["NVDA", "AAPL", "MSFT", "GOOGL", "TSLA", "MU", "SPCX"] as const;
export type Stock = (typeof STOCKS)[number];

/** Fee split in basis points. Deployer gets 80%, LONGSHOT Treasury keeps 20%. */
export const DEPLOYER_SHARE_BPS = 8000n;
export const BPS = 10000n;

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  return v === undefined ? fallback : Number.parseInt(v, 10);
}

export function loadConfig() {
  const chainMode = env("CHAIN_MODE", "mock") as "mock" | "onchain";
  const stockTokens = Object.fromEntries(
    STOCKS.map((s) => [s, (process.env[`STOCK_TOKEN_${s}`] ?? "") as Address]),
  ) as Record<Stock, Address>;

  return {
    dbPath: env("DB_PATH", "data/longshot.db"),
    publicUrl: env("PUBLIC_URL", "http://localhost:8787"),
    port: int("PORT", 8787),
    sessionSecret: env("SESSION_SECRET", "dev-only-change-me"),

    x: {
      enabled: process.env.X_ENABLED === "true",
      /** Handle users tag to launch (without @). */
      triggerHandle: env("TRIGGER_HANDLE", "longdotxyz"),
      appKey: process.env.X_APP_KEY ?? "",
      appSecret: process.env.X_APP_SECRET ?? "",
      accessToken: process.env.X_ACCESS_TOKEN ?? "",
      accessSecret: process.env.X_ACCESS_SECRET ?? "",
      bearerToken: process.env.X_BEARER_TOKEN ?? "",
      oauthClientId: process.env.X_OAUTH_CLIENT_ID ?? "",
      oauthClientSecret: process.env.X_OAUTH_CLIENT_SECRET ?? "",
      pollIntervalMs: int("X_POLL_INTERVAL_MS", 30_000),
    },

    rules: {
      minAccountAgeDays: int("MIN_ACCOUNT_AGE_DAYS", 30),
      minFollowers: int("MIN_FOLLOWERS", 50),
      launchesPerDay: int("LAUNCHES_PER_DAY", 1),
      tickerCooldownHours: int("TICKER_COOLDOWN_HOURS", 24),
    },

    chain: {
      mode: chainMode,
      rpcUrl: process.env.RPC_URL ?? "",
      chainId: int("CHAIN_ID", 0),
      explorerUrl: process.env.EXPLORER_URL ?? "",
      treasuryPrivateKey: (process.env.TREASURY_PRIVATE_KEY ?? "") as Hex,
      longFactory: (process.env.LONG_FACTORY_ADDRESS ?? "") as Address,
      defaultStock: env("DEFAULT_STOCK", "NVDA") as Stock,
      stockTokens,
      harvestIntervalMs: int("HARVEST_INTERVAL_MS", 15 * 60_000),
      /** Refuse any single claim payout above this (base units, 0 = no cap). */
      maxPayoutPerClaim: BigInt(process.env.MAX_PAYOUT_PER_CLAIM ?? "0"),
    },

    longAppUrl: env("LONG_APP_URL", "https://app.longxyz.com"),
    pinataJwt: process.env.PINATA_JWT ?? "",
  };
}

export type Config = ReturnType<typeof loadConfig>;
