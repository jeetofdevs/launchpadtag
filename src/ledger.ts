import { BPS, DEPLOYER_SHARE_BPS } from "./config.ts";
import { tx, type DB } from "./db.ts";
import { BURN_ADDRESS } from "./config.ts";

/**
 * Split what the Treasury received. The protocol already took `protocolBps` of the fee before it
 * reached us, so the deployer's 80%-of-the-whole-fee is 80 / (100 - protocol) of what arrived.
 */
export function splitFee(amount: bigint, protocolBps = 0n): { deployer: bigint; treasury: bigint } {
  const deployer = (amount * DEPLOYER_SHARE_BPS) / (BPS - protocolBps);
  return { deployer, treasury: amount - deployer };
}

/** Record a creator-fee claim the Treasury made from Long.xyz for one token. */
export function recordFee(
  db: DB,
  f: { tokenAddress: string; xUserId: string; asset: string; amount: bigint; txHash: string },
  protocolBps = 0n,
  now = Date.now(),
) {
  if (f.amount <= 0n) return;
  const { deployer, treasury } = splitFee(f.amount, protocolBps);
  db.prepare(
    `INSERT INTO fees(token_address, x_user_id, asset, amount, deployer_share, treasury_share, tx_hash, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(f.tokenAddress, f.xUserId, f.asset.toLowerCase(), f.amount.toString(), deployer.toString(), treasury.toString(), f.txHash, now);
}

function sum(rows: { v: string }[]): bigint {
  return rows.reduce((acc, r) => acc + BigInt(r.v), 0n);
}

export interface Balance {
  asset: string;
  totalFees: bigint;
  deployerShare: bigint;
  treasuryShare: bigint;
  paidOrPending: bigint;
  claimable: bigint;
}

/** Per-asset balance for one deployer. Pending payouts count as spent so they can't be claimed twice. */
export function balances(db: DB, xUserId: string): Balance[] {
  const assets = db
    .prepare("SELECT DISTINCT asset FROM fees WHERE x_user_id = ?")
    .all(xUserId) as { asset: string }[];
  return assets.map(({ asset }) => {
    const fees = db
      .prepare("SELECT amount, deployer_share, treasury_share FROM fees WHERE x_user_id = ? AND asset = ?")
      .all(xUserId, asset) as { amount: string; deployer_share: string; treasury_share: string }[];
    const paid = db
      .prepare("SELECT amount AS v FROM payouts WHERE x_user_id = ? AND asset = ? AND status IN ('pending','sent')")
      .all(xUserId, asset) as { v: string }[];
    const totalFees = sum(fees.map((f) => ({ v: f.amount })));
    const deployerShare = sum(fees.map((f) => ({ v: f.deployer_share })));
    const treasuryShare = sum(fees.map((f) => ({ v: f.treasury_share })));
    const paidOrPending = sum(paid);
    return { asset, totalFees, deployerShare, treasuryShare, paidOrPending, claimable: deployerShare - paidOrPending };
  });
}

/**
 * Atomically reserve the deployer's full claimable balance of `asset` as a pending payout.
 * Returns null when nothing is claimable.
 */
export function reservePayout(
  db: DB,
  xUserId: string,
  asset: string,
  toAddress: string,
  maxPayout: bigint,
  now = Date.now(),
): { id: number; amount: bigint } | null {
  return tx(db, () => {
    const bal = balances(db, xUserId).find((b) => b.asset === asset.toLowerCase());
    if (!bal || bal.claimable <= 0n) return null;
    const amount = maxPayout > 0n && bal.claimable > maxPayout ? maxPayout : bal.claimable;
    const res = db
      .prepare(
        "INSERT INTO payouts(x_user_id, asset, amount, to_address, status, created_at) VALUES(?, ?, ?, ?, 'pending', ?)",
      )
      .run(xUserId, asset.toLowerCase(), amount.toString(), toAddress, now);
    return { id: Number(res.lastInsertRowid), amount };
  });
}

export function completePayout(db: DB, id: number, txHash: string) {
  db.prepare("UPDATE payouts SET status = 'sent', tx_hash = ? WHERE id = ?").run(txHash, id);
}

/** Outcome unknown: keep the reservation (so it can't be double-claimed) and flag it for manual reconciliation. */
export function markPayoutUncertain(db: DB, id: number, txHash: string, error: string) {
  db.prepare("UPDATE payouts SET tx_hash = ?, error = ? WHERE id = ?").run(txHash, `UNCONFIRMED: ${error}`.slice(0, 500), id);
}

/** Release the reservation so the balance becomes claimable again. */
export function failPayout(db: DB, id: number, error: string) {
  db.prepare("UPDATE payouts SET status = 'failed', error = ? WHERE id = ?").run(error.slice(0, 500), id);
}

export interface TokenReport {
  tokenAddress: string;
  ticker: string;
  xUsername: string;
  asset: string;
  totalFees: bigint;
  deployerShare: bigint;
  treasuryShare: bigint;
}

/** Public transparency report: fees per token. */
export function feeReport(db: DB): TokenReport[] {
  const rows = db
    .prepare(
      `SELECT f.token_address, l.ticker, l.x_username, f.asset,
              f.amount, f.deployer_share, f.treasury_share
       FROM fees f JOIN launches l ON l.token_address = f.token_address`,
    )
    .all() as {
    token_address: string; ticker: string; x_username: string; asset: string;
    amount: string; deployer_share: string; treasury_share: string;
  }[];
  const byKey = new Map<string, TokenReport>();
  for (const r of rows) {
    const key = `${r.token_address}:${r.asset}`;
    const cur = byKey.get(key) ?? {
      tokenAddress: r.token_address, ticker: r.ticker, xUsername: r.x_username, asset: r.asset,
      totalFees: 0n, deployerShare: 0n, treasuryShare: 0n,
    };
    cur.totalFees += BigInt(r.amount);
    cur.deployerShare += BigInt(r.deployer_share);
    cur.treasuryShare += BigInt(r.treasury_share);
    byKey.set(key, cur);
  }
  return [...byKey.values()];
}

export function recentPayouts(db: DB, limit = 50) {
  return db
    .prepare(
      `SELECT p.amount, p.asset, p.to_address, p.tx_hash, p.created_at, p.x_user_id,
              (SELECT x_username FROM launches l WHERE l.x_user_id = p.x_user_id ORDER BY created_at DESC LIMIT 1) AS x_username
       FROM payouts p WHERE p.status = 'sent' ORDER BY p.created_at DESC LIMIT ?`,
    )
    .all(limit) as { amount: string; asset: string; to_address: string; tx_hash: string; created_at: number; x_username: string | null }[];
}

export interface RewardTotals {
  asset: string;
  /** Paid out to deployers' wallets. */
  claimed: bigint;
  /** Sent to the burn address via "Claim & Burn". */
  burned: bigint;
  /** Deployer rewards collected into the Treasury but not yet claimed (in-flight payouts excluded). */
  unclaimed: bigint;
}

/** Platform-wide deployer rewards per asset. */
export function rewardTotals(db: DB): RewardTotals[] {
  const earned = db.prepare("SELECT asset, deployer_share AS v FROM fees").all() as { asset: string; v: string }[];
  const paid = db
    .prepare("SELECT asset, amount AS v, status, to_address FROM payouts WHERE status IN ('pending','sent')")
    .all() as { asset: string; v: string; status: string; to_address: string }[];
  const burn = BURN_ADDRESS.toLowerCase();
  const by = new Map<string, { earned: bigint; sent: bigint; burned: bigint; pending: bigint }>();
  const row = (a: string) => by.get(a) ?? by.set(a, { earned: 0n, sent: 0n, burned: 0n, pending: 0n }).get(a)!;
  for (const e of earned) row(e.asset).earned += BigInt(e.v);
  for (const p of paid) {
    const r = row(p.asset);
    if (p.status !== "sent") r.pending += BigInt(p.v);
    else if (p.to_address.toLowerCase() === burn) r.burned += BigInt(p.v);
    else r.sent += BigInt(p.v);
  }
  return [...by].map(([asset, t]) => ({
    asset, claimed: t.sent, burned: t.burned, unclaimed: t.earned - t.sent - t.burned - t.pending,
  }));
}
