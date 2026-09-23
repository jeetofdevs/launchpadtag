import { randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";
import { STOCKS, type Stock } from "../config.ts";
import type { CreateTokenParams, LongClient } from "./types.ts";

const rand = (n: number) => `0x${randomBytes(n).toString("hex")}` as const;

/**
 * In-memory stand-in for Long.xyz so the whole bot → fee → claim loop can run locally.
 * Each harvest pretends the token earned `feePerHarvest` of fees.
 */
export class MockLongClient implements LongClient {
  readonly treasury: Address = rand(20) as Address;
  private readonly assets = Object.fromEntries(STOCKS.map((s) => [s, rand(20)])) as Record<Stock, Address>;
  readonly transfers: { asset: Address; to: Address; amount: bigint; txHash: Hex }[] = [];

  constructor(private readonly feePerHarvest = 1_000_000n) {}

  feeAsset(stock: Stock): Address {
    return this.assets[stock];
  }

  async assetInfo(asset: Address) {
    const stock = STOCKS.find((s) => this.assets[s].toLowerCase() === asset.toLowerCase());
    return { symbol: stock ? `${stock}x` : "TOKEN", decimals: 6 };
  }

  async createToken(_p: CreateTokenParams) {
    return { tokenAddress: rand(20) as Address, txHash: rand(32) as Hex };
  }

  async claimCreatorFees(_token: Address, stock: Stock) {
    if (this.feePerHarvest <= 0n) return null;
    return { asset: this.assets[stock], amount: this.feePerHarvest, txHash: rand(32) as Hex };
  }

  async transfer(asset: Address, to: Address, amount: bigint) {
    const txHash = rand(32) as Hex;
    this.transfers.push({ asset, to, amount, txHash });
    return txHash;
  }

  txUrl(hash: string) {
    return `mock://tx/${hash}`;
  }

  addressUrl(addr: string) {
    return `mock://address/${addr}`;
  }
}
