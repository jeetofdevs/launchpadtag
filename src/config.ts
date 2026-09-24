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

/** "true", "True", " TRUE ", "\"true\"", "1", "yes", "on" all count as on. */
function flag(name: string): boolean {
  const v = (process.env[name] ?? "").trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
  return ["true", "1", "yes", "on"].includes(v);
}

/** Secrets pasted into a host UI often pick up spaces, newlines or quotes; any of those makes X answer 401. */
function key(name: string): string {
  return (process.env[name] ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  return v === undefined ? fallback : Number.parseInt(v, 10);
}

/** Values copied from .env.example that must never be used as a real secret. */
const PLACEHOLDER_SECRETS = new Set(["change-me-to-a-long-random-string", "REPLACE_WITH_A_LONG_RANDOM_STRING", "dev-only-change-me"]);

/**
 * On Railway the container disk is wiped on every deploy, so the database must live on a Volume.
 * When a Volume is attached (RAILWAY_VOLUME_MOUNT_PATH) and DB_PATH doesn't point into it, use the Volume.
 */
function resolveDbPath(): string {
  const dbPath = process.env.DB_PATH || "data/longshot.db";
  const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.replace(/\/$/, "");
  if (mount && !dbPath.startsWith(`${mount}/`)) {
    console.warn(`DB_PATH=${dbPath} is not on the Railway Volume (${mount}) — using ${mount}/longshot.db so data survives redeploys.`);
    return `${mount}/longshot.db`;
  }
  return dbPath;
}

/** True when running on Railway without the database on a Volume: every redeploy would erase it. */
export function dbIsEphemeral(dbPath: string): boolean {
  if (!process.env.RAILWAY_ENVIRONMENT) return false;
  const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.replace(/\/$/, "");
  return !mount || !dbPath.startsWith(`${mount}/`);
}

/** X access tokens look like "<numeric user id>-<letters>"; the secret never has that shape. */
const ACCESS_TOKEN_SHAPE = /^\d+-[A-Za-z0-9]+$/;

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

  // A common paste mistake: token and secret the wrong way round. Recognisable by shape, so fix it.
  let accessToken = key("X_ACCESS_TOKEN");
  let accessSecret = key("X_ACCESS_SECRET");
  const accessSwapped = !ACCESS_TOKEN_SHAPE.test(accessToken) && ACCESS_TOKEN_SHAPE.test(accessSecret);
  if (accessSwapped) [accessToken, accessSecret] = [accessSecret, accessToken];

  return {
    dbPath: resolveDbPath(),
    // Railway exposes the generated domain as RAILWAY_PUBLIC_DOMAIN.
    publicUrl: (process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:8787")).replace(/\/$/, ""),
    /** "Login as test user" on /claim. Only ever allowed in mock mode. */
    allowDevLogin: process.env.ALLOW_DEV_LOGIN === "true" || (!process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== "production"),
    port: int("PORT", 8787),
    /** Signs login cookies. If unset, one is generated and stored in the database on first boot. */
    sessionSecret: process.env.SESSION_SECRET?.trim() ?? "",

    x: {
      enabled: flag("X_ENABLED"),
      /** LONGSHOT's own X account (posts the replies), shown on the website. */
      botHandle: env("BOT_HANDLE", "longshotpadxyz").replace(/^@/, ""),
      /**
       * Handle users tag to launch (without @). Defaults to the bot's own account: X only allows
       * automated replies to people who tagged you, so the trigger must be LONGSHOT's handle.
       */
      triggerHandle: env("TRIGGER_HANDLE", process.env.BOT_HANDLE ?? "longshotpadxyz").replace(/^@/, ""),
      appKey: key("X_APP_KEY"),
      appSecret: key("X_APP_SECRET"),
      accessToken,
      /** True when X_ACCESS_TOKEN and X_ACCESS_SECRET were pasted the wrong way round (fixed automatically). */
      accessSwapped,
      accessSecret,
      bearerToken: key("X_BEARER_TOKEN"),
      oauthClientId: (process.env.X_OAUTH_CLIENT_ID ?? "").trim(),
      oauthClientSecret: (process.env.X_OAUTH_CLIENT_SECRET ?? "").trim(),
      pollIntervalMs: int("X_POLL_INTERVAL_MS", 30_000),
    },

    rules: {
      minAccountAgeDays: int("MIN_ACCOUNT_AGE_DAYS", 30),
      minFollowers: int("MIN_FOLLOWERS", 50),
      launchesPerDay: int("LAUNCHES_PER_DAY", 1),
      /**
       * X accounts with no launch limit and no account-age/follower minimums (e.g. the team's own),
       * comma-separated: usernames (with or without @) or numeric account IDs. Ticker rules still apply.
       * Default: @nathanbullish (the LONGSHOT dev). Setting UNLIMITED_ACCOUNTS replaces the default.
       */
      unlimitedAccounts: (process.env.UNLIMITED_ACCOUNTS ?? "nathanbullish").split(",").map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter(Boolean),
      /**
       * A ticker launched in the last N hours (via LONGSHOT or on Long.xyz) is reserved.
       * Default 72: Long.xyz frees a ticker again after 2–3 days. 0 = reserved forever.
       */
      tickerCooldownHours: int("TICKER_COOLDOWN_HOURS", 72),
      /** "Send fees" (`fees @user` in the launch tweet). On unless SEND_FEES_ENABLED=false. */
      sendFeesEnabled: process.env.SEND_FEES_ENABLED === undefined || flag("SEND_FEES_ENABLED"),
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
      /**
       * "doppler" (default): launch straight on Doppler, tradable on Uniswap v4 (not listed on app.long.xyz).
       * "long": launch through Long.xyz's launcher so tokens are listed on app.long.xyz. Off for now:
       * app.long.xyz moved to a new launcher contract whose format isn't known yet.
       */
      launchVia: (process.env.LAUNCH_VIA === "long" ? "long" : "doppler") as "long" | "doppler",
      /** A real app.long.xyz launch whose create() call is reused as the template for every launch. */
      longTemplateTx: env("LONG_TEMPLATE_TX", "0xf2b83f462671397a3d8b77b65f42ec71e5b6fb2ceacbaff79a34fba6d36ca09d") as Hex,
      /** Creation-code hash of Long.xyz tokens; only used after it reproduces the template's token address. */
      longInitCodeHash: env("LONG_INITCODE_HASH", "0x25b1c7dce612b68798d046d3614a74d420425f2cee9f8c16ec578781ed8377ae") as Hex,
      /** Doppler pool contract that holds the fees of Long.xyz pools (collectFees). */
      dopplerHookInitializer: env("DOPPLER_HOOK_INITIALIZER", "0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544") as Address,
      tickerSyncIntervalMs: int("TICKER_SYNC_INTERVAL_MS", 60_000),
      /** Refuse any single claim payout above this (base units, 0 = no cap). */
      maxPayoutPerClaim: BigInt(process.env.MAX_PAYOUT_PER_CLAIM ?? "0"),
    },

    longAppUrl: env("LONG_APP_URL", "https://app.long.xyz"),
    /** LONGSHOT's own coin, shown on the website as the official coin. OFFICIAL_TOKEN="" hides it. */
    officialToken: (process.env.OFFICIAL_TOKEN ?? "0xd260AB037A616962987A66311A136551C3C61e18").trim() as Address | "",
    pinataJwt: process.env.PINATA_JWT ?? "",
  };
}

export type Config = ReturnType<typeof loadConfig>;
