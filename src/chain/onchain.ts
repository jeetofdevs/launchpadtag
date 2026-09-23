import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config, Stock } from "../config.ts";
import { LONG_FACTORY_ABI } from "./longAbi.ts";
import { BroadcastUncertainError, type CreateTokenParams, type LongClient } from "./types.ts";

/** Real Long.xyz integration on Robinhood Chain, signed by the LONGSHOT Treasury key. */
export class OnchainLongClient implements LongClient {
  readonly treasury: Address;
  private readonly pub;
  private readonly wallet;
  private readonly account;

  constructor(private readonly cfg: Config["chain"]) {
    if (!cfg.rpcUrl || !cfg.chainId) throw new Error("RPC_URL and CHAIN_ID are required for CHAIN_MODE=onchain");
    if (!isAddress(cfg.longFactory)) throw new Error("LONG_FACTORY_ADDRESS is not a valid address");
    if (!/^0x[0-9a-fA-F]{64}$/.test(cfg.treasuryPrivateKey)) throw new Error("TREASURY_PRIVATE_KEY is missing/invalid");

    const chain = defineChain({
      id: cfg.chainId,
      name: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [cfg.rpcUrl] } },
    });
    this.account = privateKeyToAccount(cfg.treasuryPrivateKey);
    this.treasury = this.account.address;
    this.pub = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
    this.wallet = createWalletClient({ chain, account: this.account, transport: http(cfg.rpcUrl) });
  }

  feeAsset(stock: Stock): Address {
    const a = this.cfg.stockTokens[stock];
    if (!isAddress(a)) throw new Error(`STOCK_TOKEN_${stock} is not configured`);
    return a;
  }

  private readonly infoCache = new Map<string, { symbol: string; decimals: number }>();

  async assetInfo(asset: Address) {
    const hit = this.infoCache.get(asset.toLowerCase());
    if (hit) return hit;
    const [symbol, decimals] = await Promise.all([
      this.pub.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }),
      this.pub.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
    ]);
    const info = { symbol, decimals };
    this.infoCache.set(asset.toLowerCase(), info);
    return info;
  }

  async createToken(p: CreateTokenParams) {
    const { request, result } = await this.pub.simulateContract({
      account: this.account,
      address: this.cfg.longFactory,
      abi: LONG_FACTORY_ABI,
      functionName: "createToken",
      args: [p.name, p.symbol, p.metadataUri, this.feeAsset(p.stock)],
    });
    const txHash = await this.wallet.writeContract(request);
    const receipt = await this.pub.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error(`createToken reverted: ${txHash}`);
    return { tokenAddress: result, txHash };
  }

  private balanceOf(asset: Address) {
    return this.pub.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [this.treasury] });
  }

  async claimCreatorFees(token: Address, stock: Stock) {
    const asset = this.feeAsset(stock);
    const before = await this.balanceOf(asset);
    const { request } = await this.pub.simulateContract({
      account: this.account,
      address: this.cfg.longFactory,
      abi: LONG_FACTORY_ABI,
      functionName: "claimCreatorFees",
      args: [token],
    });
    const txHash = await this.wallet.writeContract(request);
    let receipt;
    try {
      receipt = await this.pub.waitForTransactionReceipt({ hash: txHash });
    } catch (e) {
      throw new BroadcastUncertainError(txHash, e);
    }
    if (receipt.status !== "success") throw new Error(`claimCreatorFees reverted: ${txHash}`);
    // Measure what actually arrived instead of trusting a return value.
    const amount = (await this.balanceOf(asset)) - before;
    return amount > 0n ? { asset, amount, txHash } : null;
  }

  async transfer(asset: Address, to: Address, amount: bigint): Promise<Hex> {
    const { request } = await this.pub.simulateContract({
      account: this.account,
      address: asset,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, amount],
    });
    const txHash = await this.wallet.writeContract(request);
    let receipt;
    try {
      receipt = await this.pub.waitForTransactionReceipt({ hash: txHash });
    } catch (e) {
      throw new BroadcastUncertainError(txHash, e);
    }
    if (receipt.status !== "success") throw new Error(`transfer reverted: ${txHash}`);
    return txHash;
  }

  txUrl(hash: string) {
    return this.cfg.explorerUrl ? `${this.cfg.explorerUrl}/tx/${hash}` : hash;
  }

  addressUrl(addr: string) {
    return this.cfg.explorerUrl ? `${this.cfg.explorerUrl}/address/${addr}` : addr;
  }
}
