import { serve } from "@hono/node-server";
import { handleMention, type Replier } from "./bot.ts";
import { createLongClient } from "./chain/index.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { harvestFees } from "./harvester.ts";
import { createApp } from "./web/server.ts";
import { ConsoleReplier, XMentionSource, XReplier } from "./x/client.ts";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

const cfg = loadConfig();
if (cfg.sessionSecret === "dev-only-change-me" && cfg.chain.mode === "onchain")
  throw new Error("Set SESSION_SECRET before running onchain");

const db = openDb(cfg.dbPath);
const long = createLongClient(cfg.chain);
log(`LONGSHOT starting — chain=${cfg.chain.mode}, treasury=${long.treasury}, x=${cfg.x.enabled ? "on" : "off"}`);

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

if (cfg.x.enabled) {
  const source = new XMentionSource(cfg.x, db);
  const replier: Replier = new XReplier(cfg.x);
  every(cfg.x.pollIntervalMs, "mentions", async () => {
    const { mentions, newestId } = await source.fetchNew();
    for (const m of mentions) await handleMention({ cfg, db, long, replier, log }, m);
    if (newestId) source.commit(newestId);
  });
} else {
  log("X_ENABLED is not true — mention listener off. Use `npm run simulate` to try launches locally.");
  void new ConsoleReplier(log);
}

every(cfg.chain.harvestIntervalMs, "harvest", () => harvestFees(db, long, log));

serve({ fetch: createApp(cfg, db, long).fetch, port: cfg.port }, (info) => log(`web on http://localhost:${info.port}`));
