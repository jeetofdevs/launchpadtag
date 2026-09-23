import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS launches (
  tweet_id      TEXT PRIMARY KEY,
  x_user_id     TEXT NOT NULL,
  x_username    TEXT NOT NULL,
  ticker        TEXT NOT NULL,
  name          TEXT NOT NULL,
  stock         TEXT NOT NULL,
  image_url     TEXT,
  origin_tweet  TEXT,
  status        TEXT NOT NULL,          -- queued | deploying | live | rejected | failed
  reason        TEXT,
  token_address TEXT,
  tx_hash       TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS launches_user ON launches(x_user_id, created_at);
CREATE INDEX IF NOT EXISTS launches_ticker ON launches(ticker, created_at);

-- Every creator-fee claim the Treasury makes from Long.xyz, per token.
CREATE TABLE IF NOT EXISTS fees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_address TEXT NOT NULL,
  x_user_id     TEXT NOT NULL,
  asset         TEXT NOT NULL,          -- ERC-20 the fee is paid in
  amount        TEXT NOT NULL,          -- base units (bigint as string)
  deployer_share TEXT NOT NULL,         -- 80% of amount
  treasury_share TEXT NOT NULL,         -- 20% of amount
  tx_hash       TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fees_user ON fees(x_user_id, asset);

-- Payouts from the Treasury to deployers.
CREATE TABLE IF NOT EXISTS payouts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  x_user_id     TEXT NOT NULL,
  asset         TEXT NOT NULL,
  amount        TEXT NOT NULL,
  to_address    TEXT NOT NULL,
  status        TEXT NOT NULL,          -- pending | sent | failed
  tx_hash       TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payouts_user ON payouts(x_user_id, asset);

-- Launches made outside LONGSHOT (e.g. on app.long.xyz), indexed from LongLauncher.LaunchCreated,
-- so we respect Long.xyz's ticker reservations.
CREATE TABLE IF NOT EXISTS external_launches (
  asset       TEXT PRIMARY KEY,
  symbol      TEXT NOT NULL,          -- upper-cased
  numeraire   TEXT NOT NULL,
  block       INTEGER NOT NULL,
  launched_at INTEGER NOT NULL        -- ms
);
CREATE INDEX IF NOT EXISTS external_launches_symbol ON external_launches(symbol, launched_at);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  // "Send fees": the X account that receives the creator share when it isn't the deployer.
  const cols = new Set((db.prepare("PRAGMA table_info(launches)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("fee_user_id")) db.exec("ALTER TABLE launches ADD COLUMN fee_user_id TEXT");
  if (!cols.has("fee_username")) db.exec("ALTER TABLE launches ADD COLUMN fee_username TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS launches_fee_user ON launches(fee_user_id)");
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Mock mode invents token addresses, fees and payouts. The first time the same database is started
 * in onchain mode, that fake data is removed so the harvester never touches made-up addresses and
 * the website only lists real tokens. Returns how many fake launches were removed.
 */
export function dropMockDataOnSwitch(db: DB, mode: "mock" | "onchain"): number {
  const prev = getKv(db, "chain_mode");
  let removed = 0;
  if (mode === "onchain" && prev !== "onchain") {
    const hadMock = prev === "mock" || (db.prepare("SELECT COUNT(*) AS n FROM launches").get() as { n: number }).n > 0;
    if (hadMock) {
      removed = (db.prepare("SELECT COUNT(*) AS n FROM launches").get() as { n: number }).n;
      tx(db, () => {
        db.exec("DELETE FROM payouts; DELETE FROM fees; DELETE FROM launches;");
      });
    }
  }
  setKv(db, "chain_mode", mode);
  return removed;
}

export function getKv(db: DB, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setKv(db: DB, key: string, value: string) {
  db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}
