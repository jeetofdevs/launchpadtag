import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { handleMention, type Replier } from "./bot.ts";
import { createLongClient } from "./chain/index.ts";
import { LongTickerIndexer } from "./chain/tickers.ts";
import { loadConfig } from "./config.ts";
import { getKv, openDb, setKv } from "./db.ts";
import { harvestFees } from "./harvester.ts";
import { createApp } from "./web/server.ts";
import { ConsoleReplier, XMentionSource, XReplier } from "./x/client.ts";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

function fatal(e: unknown): never {
  console.error(`[${new Date().toISOString()}] FATAL: ${e instanceof Error ? e.message : String(e)}`);
  console.error("LONGSHOT could not start. Check the Variables on your host (see DEPLOY-RAILWAY.md).");
  process.exit(1);
}
process.on("unhandledRejection", (e) => log(`unhandled rejection: ${e instanceof Error ? e.stack : e}`));

let cfg: ReturnType<typeof loadConfig>;
let db: ReturnType<typeof openDb>;
let long: ReturnType<typeof createLongClient>;
try {
  cfg = loadConfig();
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
} catch (e) {
  fatal(e);
}

log(`LONGSHOT starting — chain=${cfg.chain.mode}, treasury=${long.treasury}, x=${cfg.x.enabled ? "on" : "off"}, url=${cfg.publicUrl}, db=${cfg.dbPath}`);

/** Run `fn` every `ms`, never overlapping with itself. */
function every(ms: number, name: string, fn: () => Promise<unknown>) {
  const tick = async () => {
    try {
      await fn();
    } catch (e) {
      log(`${name} error: ${e instanceof Error ? e.message : e}`);
    } finally {
      setTimeout(tick, ms);
    }
  };
  void tick();
}

// Know every ticker Long.xyz has handed out, so we respect its reservations.
const tickers = cfg.chain.mode === "onchain" ? new LongTickerIndexer(cfg.chain, cfg.rules, db, log) : null;
if (tickers) every(cfg.chain.tickerSyncIntervalMs, "ticker-sync", () => tickers.sync());

if (cfg.x.enabled) {
  const source = new XMentionSource(cfg.x, db);
  const replier: Replier = new XReplier(cfg.x);
  every(cfg.x.pollIntervalMs, "mentions", async () => {
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
