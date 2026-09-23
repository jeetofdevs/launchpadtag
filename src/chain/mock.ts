import { randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";
import { STOCKS, type Stock } from "../config.ts";
import type { CreateTokenParams, LongClient } from "./types.ts";

const rand = (n: number) => `0x${randomBytes(n).toString("hex")}` as const;

/**
 * In-memory stand-in for Long.xyz so the whole bot → fee → claim loop can run locally.
 * Each harvest pretends the pool earned `feePerHarvest` of the Stock Token and 10× that of the launched token.
 */
export class MockLongClient implements LongClient {
  readonly treasury: Address = rand(20) as Address;
  private readonly stocks = Object.fromEntries(STOCKS.map((s) => [s, rand(20)])) as Record<Stock, Address>;
  private readonly tokens = new Map<string, string>();
  readonly transfers: { asset: Address; to: Address; amount: bigint; txHash: Hex }[] = [];

  constructor(private readonly feePerHarvest = 1_000_000n) {}

  stockToken(stock: Stock): Address {
    return this.stocks[stock];
  }

  async assetInfo(asset: Address) {
    const stock = STOCKS.find((s) => this.stocks[s].toLowerCase() === asset.toLowerCase());
    if (stock) return { symbol: stock, decimals: 6 };
    return { symbol: this.tokens.get(asset.toLowerCase()) ?? "TOKEN", decimals: 6 };
  }

  async createToken(p: CreateTokenParams) {
    const tokenAddress = rand(20) as Address;
    this.tokens.set(tokenAddress.toLowerCase(), p.symbol);
    return { tokenAddress, txHash: rand(32) as Hex };
  }

  async claimCreatorFees(token: Address, stock: Stock) {
    if (this.feePerHarvest <= 0n) return null;
    return {
      txHash: rand(32) as Hex,
      fees: [
        { asset: this.stocks[stock], amount: this.feePerHarvest },
        { asset: token, amount: this.feePerHarvest * 10n },
      ],
    };
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
