import type { Address } from "viem";
import { BroadcastUncertainError, type LongClient } from "./chain/index.ts";
import type { Stock } from "./config.ts";
import type { DB } from "./db.ts";
import { recordFee } from "./ledger.ts";

/** Claim creator fees for every live token into the Treasury and book them 80/20 in the ledger. */
export async function harvestFees(db: DB, long: LongClient, log: (m: string) => void = () => {}) {
  const tokens = db
    .prepare("SELECT token_address, x_user_id, stock, ticker FROM launches WHERE status = 'live'")
    .all() as { token_address: Address; x_user_id: string; stock: Stock; ticker: string }[];

  let harvested = 0;
  for (const t of tokens) {
    try {
      const res = await long.claimCreatorFees(t.token_address, t.stock);
      if (!res) continue;
      for (const f of res.fees) {
        recordFee(db, { tokenAddress: t.token_address, xUserId: t.x_user_id, asset: f.asset, amount: f.amount, txHash: res.txHash });
        log(`harvested $${t.ticker}: ${f.amount} of ${f.asset} (${res.txHash})`);
      }
      harvested++;
    } catch (e) {
      if (e instanceof BroadcastUncertainError) {
        // Fees may have landed in the Treasury without being booked to the deployer. Must be reconciled by hand.
        log(`RECONCILE: fee claim for $${t.ticker} ${t.token_address} unconfirmed, tx ${e.txHash}`);
        continue;
      }
      log(`harvest failed for $${t.ticker} ${t.token_address}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return harvested;
}
