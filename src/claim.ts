import type { Address, Hex } from "viem";
import { BroadcastUncertainError, type LongClient } from "./chain/index.ts";
import { BURN_ADDRESS } from "./config.ts";
import type { DB } from "./db.ts";
import { balances, completePayout, failPayout, markPayoutUncertain, reservePayout } from "./ledger.ts";

export interface ClaimResult {
  asset: string;
  amount: bigint;
  burned?: boolean;
  txHash?: Hex;
  error?: string;
}

/** Addresses of tokens launched through LONGSHOT (lower-case). */
function launchedTokens(db: DB): Set<string> {
  const rows = db.prepare("SELECT token_address FROM launches WHERE token_address IS NOT NULL").all() as { token_address: string }[];
  return new Set(rows.map((r) => r.token_address.toLowerCase()));
}

/**
 * Pay a deployer their 80% share of every fee asset they have a balance in.
 * With `burn`, rewards paid in their own launched token are sent to the burn address instead
 * (shrinking its supply), while rewards in the paired stock still go to `to`.
 */
export async function claimAll(
  db: DB,
  long: LongClient,
  xUserId: string,
  to: Address,
  maxPayout: bigint,
  opts: { burn?: boolean } = {},
): Promise<ClaimResult[]> {
  const results: ClaimResult[] = [];
  const tokens = opts.burn ? launchedTokens(db) : new Set<string>();
  for (const b of balances(db, xUserId)) {
    if (b.claimable <= 0n) continue;
    const burned = tokens.has(b.asset.toLowerCase());
    const dest: Address = burned ? BURN_ADDRESS : to;
    const reserved = reservePayout(db, xUserId, b.asset, dest, maxPayout);
    if (!reserved) continue;
    try {
      const txHash = await long.transfer(b.asset as Address, dest, reserved.amount);
      completePayout(db, reserved.id, txHash);
      results.push({ asset: b.asset, amount: reserved.amount, txHash, burned });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (e instanceof BroadcastUncertainError) {
        markPayoutUncertain(db, reserved.id, e.txHash, error);
        results.push({ asset: b.asset, amount: reserved.amount, txHash: e.txHash, error: "awaiting confirmation", burned });
      } else {
        failPayout(db, reserved.id, error);
        results.push({ asset: b.asset, amount: reserved.amount, error, burned });
      }
    }
  }
  return results;
}
