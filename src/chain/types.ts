import type { Address, Hex } from "viem";
import type { Stock } from "../config.ts";

/**
 * Thrown when a transaction was broadcast but its outcome is unknown (e.g. receipt timeout).
 * Callers must NOT treat this as "nothing happened" — the funds may have moved.
 */
export class BroadcastUncertainError extends Error {
  constructor(readonly txHash: `0x${string}`, cause: unknown) {
    super(`tx ${txHash} broadcast but not confirmed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export interface CreateTokenParams {
  name: string;
  symbol: string;
  stock: Stock;
  metadataUri: string;
}

export interface FeeClaim {
  txHash: Hex;
  /** What actually arrived in the Treasury, per asset (Doppler pays both sides of the pool). */
  fees: { asset: Address; amount: bigint }[];
}

/** Everything LONGSHOT needs from the launchpad + the chain, all signed by the Treasury wallet. */
export interface LongClient {
  readonly treasury: Address;
  /** Stock Token a launch paired with `stock` trades against. */
  stockToken(stock: Stock): Address;
  /** Symbol + decimals of an ERC-20, for display. */
  assetInfo(asset: Address): Promise<{ symbol: string; decimals: number }>;
  createToken(p: CreateTokenParams): Promise<{ tokenAddress: Address; txHash: Hex }>;
  /** Claim the Treasury's beneficiary fees for `token`. Returns null when nothing accrued. */
  claimCreatorFees(token: Address, stock: Stock): Promise<FeeClaim | null>;
  /** Send `amount` of ERC-20 `asset` from the Treasury to `to`. */
  transfer(asset: Address, to: Address, amount: bigint): Promise<Hex>;
  txUrl(hash: string): string;
  addressUrl(addr: string): string;
}
