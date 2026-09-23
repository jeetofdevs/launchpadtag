import type { Address, Hex } from "viem";
import { BroadcastUncertainError, type LongClient } from "./chain/index.ts";
import type { DB } from "./db.ts";
import { balances, completePayout, failPayout, markPayoutUncertain, reservePayout } from "./ledger.ts";

export interface ClaimResult {
  asset: string;
  amount: bigint;
  txHash?: Hex;
  error?: string;
}

/** Pay a deployer their 80% share of every fee asset they have a balance in. */
export async function claimAll(
  db: DB,
  long: LongClient,
  xUserId: string,
  to: Address,
  maxPayout: bigint,
): Promise<ClaimResult[]> {
  const results: ClaimResult[] = [];
  for (const b of balances(db, xUserId)) {
    if (b.claimable <= 0n) continue;
    const reserved = reservePayout(db, xUserId, b.asset, to, maxPayout);
    if (!reserved) continue;
    try {
      const txHash = await long.transfer(b.asset as Address, to, reserved.amount);
      completePayout(db, reserved.id, txHash);
      results.push({ asset: b.asset, amount: reserved.amount, txHash });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (e instanceof BroadcastUncertainError) {
        markPayoutUncertain(db, reserved.id, e.txHash, error);
        results.push({ asset: b.asset, amount: reserved.amount, txHash: e.txHash, error: "awaiting confirmation" });
      } else {
        failPayout(db, reserved.id, error);
        results.push({ asset: b.asset, amount: reserved.amount, error });
      }
    }
  }
  return results;
}
