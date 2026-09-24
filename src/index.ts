import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { ApiResponseError } from "twitter-api-v2";
import { handleMention, type Replier } from "./bot.ts";
import { createLongClient } from "./chain/index.ts";
import { OnchainLongClient } from "./chain/onchain.ts";
import { rpcUrls, shortRpcError } from "./chain/rpc.ts";
import { LongTickerIndexer } from "./chain/tickers.ts";
import { dbIsEphemeral, loadConfig } from "./config.ts";
import { clearLaunchHistoryOnce, dropMockDataOnSwitch, getKv, openDb, setKv } from "./db.ts";
import { harvestFees } from "./harvester.ts";
import { createApp } from "./web/server.ts";
import { ConsoleReplier, XMentionSource, XReplier, describeXError } from "./x/client.ts";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

/**
 * Startup failed (usually a Variable on the host). Instead of exiting — which Railway shows as a crashed,
 * unreachable site — keep a minimal server up: pages show a maintenance notice and /healthz shows the reason.
 * The bot, fee collector and claims stay off, so nothing can go wrong on-chain.
 */
function fatal(e: unknown): void {
  // Never echo anything that looks like a private key or long secret.
  const reason = (e instanceof Error ? e.message : String(e)).replace(/(0x)?[0-9a-fA-F]{40,}/g, "[redacted]");
  console.error(`[${new Date().toISOString()}] FATAL: ${reason}`);
  console.error("LONGSHOT is running in safe mode (website shows maintenance, bot and claims are off). Fix the Variables and redeploy.");
  const port = Number.parseInt(process.env.PORT ?? "8787", 10);
  serve({
    port,
    fetch: (req) => new URL(req.url).pathname === "/healthz"
      ? Response.json({ ok: false, safeMode: true, error: reason }, { status: 503 })
      : new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LONGSHOT</title>' +
          '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#04130b;color:#e4f7ec;font:16px system-ui,sans-serif;text-align:center">' +
          '<div><h1 style="color:#35f28a;letter-spacing:.08em">LONGSHOT</h1><p>We\'re doing some maintenance. Back shortly.</p></div></body>',
          { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "120" } },
        ),
  });
}
// Railway sends SIGTERM to the old container when a new deploy takes over. Exit cleanly (code 0) so it
// isn't reported as a failure. Progress (ticker index, ledger) is already saved in the database.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[${new Date().toISOString()}] ${sig} received — a newer deploy is taking over; shutting down cleanly.`);
    process.exit(0);
  });
}
process.on("unhandledRejection", (e) => log(`unhandled rejection: ${e instanceof Error ? e.stack : e}`));

let cfg!: ReturnType<typeof loadConfig>;
let db!: ReturnType<typeof openDb>;
let long!: ReturnType<typeof createLongClient>;
try {
  cfg = loadConfig();
  if (dbIsEphemeral(cfg.dbPath)) {
    const msg = `the database (${cfg.dbPath}) is on the container disk, which Railway wipes on every deploy. Add a Volume to this service with mount path /data and set DB_PATH=/data/longshot.db.`;
    // Onchain the database is the fee ledger: losing it loses what every deployer is owed. Refuse to run.
    if (cfg.chain.mode === "onchain") throw new Error(msg);
    log(`WARNING: ${msg}`);
  }
  db = openDb(cfg.dbPath);
  if (!cfg.sessionSecret) {
    // No SESSION_SECRET set: generate one and keep it in the database so logins survive restarts.
    let secret = getKv(db, "session_secret");
    if (!secret) {
      secret = randomBytes(32).toString("hex");
      setKv(db, "session_secret", secret);
      log("SESSION_SECRET not set — generated one and stored it in the database.");
    }
    cfg.sessionSecret = secret;
  }
  long = createLongClient(cfg.chain);
  const removed = dropMockDataOnSwitch(db, cfg.chain.mode);
  // Test launches made before going public are wiped once ("pre-launch-cleanup"); later wipes use CLEAR_LAUNCH_HISTORY.
  const cleared = clearLaunchHistoryOnce(db, process.env.CLEAR_LAUNCH_HISTORY || "pre-launch-cleanup-2");
  if (cleared) log(`CLEAR_LAUNCH_HISTORY: removed ${cleared} launch record(s) and their fee/payout history. You can delete the variable now.`);
  if (removed) log(`switched to onchain: removed ${removed} test launch(es) and their fake fees/payouts from mock mode.`);
} catch (e) {
  fatal(e);
  // Stay on the maintenance server: pause this module forever so nothing below runs.
  await new Promise<never>(() => {});
}

log(`LONGSHOT starting — chain=${cfg.chain.mode}, treasury=${long.treasury}, x=${cfg.x.enabled ? "on" : "off"}, x-login=${cfg.x.oauthClientId ? (cfg.x.oauthClientSecret ? "on" : "missing X_OAUTH_CLIENT_SECRET") : "off (X_OAUTH_CLIENT_ID not set)"}, url=${cfg.publicUrl}, db=${cfg.dbPath}`);
if (cfg.chain.mode === "onchain") log(`RPC endpoints (tried in order): ${rpcUrls(cfg.chain.rpcUrl).map((u) => new URL(u).host).join(", ")}`);

/** Run `fn` every `ms`, never overlapping with itself. */
function every(ms: number, name: string, fn: () => Promise<unknown>) {
  const tick = async () => {
    try {
      await fn();
    } catch (e) {
      log(`${name} error: ${shortRpcError(e)}`);
    } finally {
      setTimeout(tick, ms);
    }
  };
  void tick();
}

if (long instanceof OnchainLongClient) {
  long.gasBalance().then(
    (eth) => log(Number(eth) > 0
      ? `Treasury ${long.treasury} has ${eth} ETH for gas on Robinhood Chain.`
      : `WARNING: Treasury ${long.treasury} has 0 ETH on Robinhood Chain — launches and claims will fail until you send it some ETH for gas.`),
    (e) => log(`could not read Treasury balance: ${shortRpcError(e)}`),
  );
}

if (long instanceof OnchainLongClient && cfg.chain.launchVia === "long") {
  long.longTemplate().then(
    (t) => log(`Long.xyz launch template verified (copied from tx ${long.templateTx}): launches go through Long.xyz's launcher, canonical …1e18 addresses, Treasury receives ${Number((t.receiverShares * 100n) / 10n ** 18n)}% of pool fees, Long.xyz ${Number((t.protocolShares * 100n) / 10n ** 18n)}%.`),
    (e) => log(`WARNING: Long.xyz launch template could not be verified — launches will fail until fixed: ${shortRpcError(e)}`),
  );
} else if (cfg.chain.mode === "onchain") {
  log("LAUNCH_VIA=doppler: tokens launch straight on Doppler (Uniswap v4) and are not listed on app.long.xyz.");
}

// Know every ticker Long.xyz has handed out, so we respect its reservations.
const tickers = cfg.chain.mode === "onchain" ? new LongTickerIndexer(cfg.chain, cfg.rules, db, log) : null;
if (tickers) every(cfg.chain.tickerSyncIntervalMs, "ticker-sync", () => tickers.sync());

if (cfg.x.enabled) {
  const source = new XMentionSource(cfg.x, db);
  const xReplier = new XReplier(cfg.x);
  const replier: Replier = xReplier;
  const missing = ["X_BEARER_TOKEN", "X_APP_KEY", "X_APP_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) log(`X bot: missing ${missing.join(", ")} — the bot can't read or reply until these are set.`);
  // Don't launch anything until the bot can actually post as its own account: otherwise real tokens
  // would be deployed (spending Treasury gas) with no reply to the user. Tweets wait, they aren't lost.
  let xReady = false;
  let lastCheck = 0;
  const checkKeys = async () => {
    lastCheck = Date.now();
    try {
      const u = await xReplier.whoami();
      if (u.toLowerCase() !== cfg.x.botHandle.toLowerCase()) {
        log(`X bot WARNING: the access token belongs to @${u}, not @${cfg.x.botHandle}. Regenerate X_ACCESS_TOKEN/X_ACCESS_SECRET while logged in as @${cfg.x.botHandle}. Launches are paused.`);
        return;
      }
      xReady = true;
      log(`X bot: replies will be posted as @${u}; listening for @${cfg.x.triggerHandle} every ${cfg.x.pollIntervalMs / 1000}s`);
    } catch (e) {
      const why = e instanceof ApiResponseError && e.code === 401 ? ` Diagnosis: ${await xReplier.diagnose()}` : "";
      log(`X bot: key check failed — ${describeXError(e)}${why} Launches are paused until this is fixed; tweets will be handled afterwards.`);
    }
  };
  if (cfg.x.accessSwapped) log("X bot: X_ACCESS_TOKEN and X_ACCESS_SECRET were swapped in the Variables — using them the right way round.");
  void checkKeys();
  every(cfg.x.pollIntervalMs, "mentions", async () => {
    if (!xReady) {
      if (Date.now() - lastCheck > 5 * 60_000) await checkKeys(); // re-check every 5 minutes
      if (!xReady) return;
    }
    const { mentions, newestId } = await source.fetchNew();
    if (!mentions.length) return;
    // Catch up to the chain head first. If that fails we bail out without committing
    // newestId, so these tweets are retried on the next poll instead of risking a taken ticker.
    if (tickers) await tickers.sync();
    for (const m of mentions) await handleMention({ cfg, db, long, replier, log }, m);
    if (newestId) source.commit(newestId);
  });
} else {
  log("X_ENABLED is not true — mention listener is off. Use `npm run simulate` to try launches locally.");
  void new ConsoleReplier(log);
}

every(cfg.chain.harvestIntervalMs, "harvest", () => harvestFees(db, long, log, cfg.chain.mode === "onchain" ? cfg.chain.protocolShareBps : 0n));

serve({ fetch: createApp(cfg, db, long, () => tickers?.isFresh() ?? true).fetch, port: cfg.port }, (info) =>
  log(`web listening on port ${info.port}`),
);
