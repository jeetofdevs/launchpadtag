import type { Address, Hex } from "viem";

import { CATALOG, type Stock } from "./stocks.ts";
export { STOCKS, isStock, type Stock } from "./stocks.ts";

/** Tokens sent here are gone forever ("Claim & Burn"). */
export const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;

/** Every LONGSHOT token: fixed supply, 100% sold through the fair-launch curve (no team, no presale). */
export const TOKEN_SUPPLY = 1_000_000_000n;

/**
 * Deployer's share of the WHOLE trading fee: 80%. The other 20% is LONGSHOT's, and the Doppler
 * protocol's mandatory cut (PROTOCOL_SHARE_BPS, min 5%) comes out of LONGSHOT's 20%.
 */
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

/** Values copied from .env.example that must never be used as a real secret. */
const PLACEHOLDER_SECRETS = new Set(["change-me-to-a-long-random-string", "REPLACE_WITH_A_LONG_RANDOM_STRING", "dev-only-change-me"]);

export function loadConfig() {
  // Hosts like Railway keep variables that were pasted with an empty value. Treat those as unset
  // so every setting falls back to its default instead of becoming "" / NaN.
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v.trim() === "") delete process.env[k];
  if (process.env.SESSION_SECRET && PLACEHOLDER_SECRETS.has(process.env.SESSION_SECRET.trim())) {
    console.warn("SESSION_SECRET is still the example value from .env.example — ignoring it and generating a private one.");
    delete process.env.SESSION_SECRET;
  }
  const chainMode = env("CHAIN_MODE", "mock") as "mock" | "onchain";
  const stockTokens = Object.fromEntries(
    Object.entries(CATALOG).map(([s, t]) => [s, (process.env[`STOCK_TOKEN_${s}`] || t.address) as Address]),
  ) as Record<Stock, Address>;

  return {
    dbPath: env("DB_PATH", "data/longshot.db"),
    // Railway exposes the generated domain as RAILWAY_PUBLIC_DOMAIN.
    publicUrl: (process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:8787")).replace(/\/$/, ""),
    /** "Login as test user" on /claim. Only ever allowed in mock mode. */
    allowDevLogin: process.env.ALLOW_DEV_LOGIN === "true" || (!process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== "production"),
    port: int("PORT", 8787),
    /** Signs login cookies. If unset, one is generated and stored in the database on first boot. */
    sessionSecret: process.env.SESSION_SECRET?.trim() ?? "",

    x: {
      enabled: process.env.X_ENABLED === "true",
      /** LONGSHOT's own X account (posts the replies), shown on the website. */
      botHandle: env("BOT_HANDLE", "longshotpadxyz").replace(/^@/, ""),
      /**
       * Handle users tag to launch (without @). Defaults to the bot's own account: X only allows
       * automated replies to people who tagged you, so the trigger must be LONGSHOT's handle.
       */
      triggerHandle: env("TRIGGER_HANDLE", process.env.BOT_HANDLE ?? "longshotpadxyz").replace(/^@/, ""),
      appKey: process.env.X_APP_KEY ?? "",
      appSecret: process.env.X_APP_SECRET ?? "",
      accessToken: process.env.X_ACCESS_TOKEN ?? "",
      accessSecret: process.env.X_ACCESS_SECRET ?? "",
      bearerToken: process.env.X_BEARER_TOKEN ?? "",
      oauthClientId: (process.env.X_OAUTH_CLIENT_ID ?? "").trim(),
      oauthClientSecret: (process.env.X_OAUTH_CLIENT_SECRET ?? "").trim(),
      pollIntervalMs: int("X_POLL_INTERVAL_MS", 30_000),
    },

    rules: {
      minAccountAgeDays: int("MIN_ACCOUNT_AGE_DAYS", 30),
      minFollowers: int("MIN_FOLLOWERS", 50),
      launchesPerDay: int("LAUNCHES_PER_DAY", 1),
      /**
       * A ticker launched in the last N hours (via LONGSHOT or on Long.xyz) is reserved.
       * 0 (default) = reserved forever, matching what app.long.xyz shows for already-deployed tickers.
       */
      tickerCooldownHours: int("TICKER_COOLDOWN_HOURS", 0),
    },

    chain: {
      mode: chainMode,
      rpcUrl: env("RPC_URL", "https://rpc.mainnet.chain.robinhood.com"),
      chainId: int("CHAIN_ID", 4663),
      explorerUrl: env("EXPLORER_URL", "https://robinhoodchain.blockscout.com"),
      // MetaMask exports keys without the 0x prefix; accept both.
      treasuryPrivateKey: ((k) => (k && !k.startsWith("0x") ? `0x${k}` : k))((process.env.TREASURY_PRIVATE_KEY ?? "").trim()) as Hex,
      defaultStock: env("DEFAULT_STOCK", "NVDA") as Stock,
      stockTokens,
      /** Doppler pool swap fee in hundredths of a bip (10000 = 1%). Must be > 0 for beneficiaries to earn. */
      poolFee: int("POOL_FEE", 10_000),
      /** Share of pool fees routed to the Doppler protocol owner (5%..20%); paid out of LONGSHOT's 20%. */
      protocolShareBps: BigInt(process.env.PROTOCOL_SHARE_BPS ?? "500"),
      harvestIntervalMs: int("HARVEST_INTERVAL_MS", 15 * 60_000),
      /** Long.xyz launcher; its LaunchCreated events tell us which tickers are taken. */
      longLauncher: env("LONG_LAUNCHER_ADDRESS", "0x22e99278308B393ea1260859B181AD7E78f5eeED") as Address,
      longStartBlock: BigInt(process.env.LONG_START_BLOCK ?? "8636038"),
      tickerSyncIntervalMs: int("TICKER_SYNC_INTERVAL_MS", 60_000),
      /** Refuse any single claim payout above this (base units, 0 = no cap). */
      maxPayoutPerClaim: BigInt(process.env.MAX_PAYOUT_PER_CLAIM ?? "0"),
    },

    longAppUrl: env("LONG_APP_URL", "https://app.long.xyz"),
    pinataJwt: process.env.PINATA_JWT ?? "",
  };
}

export type Config = ReturnType<typeof loadConfig>;
