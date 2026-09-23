import {
  DopplerSDK,
  MulticurveBuilder,
  WAD,
  getAirlockOwner,
} from "@whetstone-research/doppler-sdk/evm";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  isAddress,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood } from "viem/chains";
import { BPS, DEPLOYER_SHARE_BPS, TOKEN_SUPPLY, type Config, type Stock } from "../config.ts";
import { BroadcastUncertainError, type CreateTokenParams, type FeeClaim, type LongClient } from "./types.ts";

/** Serialises async work so balance-delta fee accounting never overlaps a payout. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
}

/**
 * Real integration on Robinhood Chain via the Doppler protocol — the launch infrastructure Long.xyz
 * runs on. Tokens are multicurve pools paired with a Robinhood Stock Token, with the LONGSHOT Treasury
 * as the fee beneficiary (alongside the protocol owner's mandatory minimum share).
 */
export class OnchainLongClient implements LongClient {
  readonly treasury: Address;
  private readonly pub;
  private readonly wallet;
  private readonly sdk;
  private readonly lock = new Mutex();
  private readonly infoCache = new Map<string, { symbol: string; decimals: number }>();

  constructor(private readonly cfg: Config["chain"]) {
    if (cfg.chainId !== robinhood.id) throw new Error(`CHAIN_ID must be ${robinhood.id} (Robinhood Chain)`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(cfg.treasuryPrivateKey)) throw new Error("TREASURY_PRIVATE_KEY is missing/invalid");
    if (cfg.poolFee <= 0) throw new Error("POOL_FEE must be > 0 or beneficiaries never earn anything");
    if (cfg.protocolShareBps < 500n || cfg.protocolShareBps > BPS - DEPLOYER_SHARE_BPS)
      throw new Error(`PROTOCOL_SHARE_BPS must be 500..${BPS - DEPLOYER_SHARE_BPS} so deployers keep 80%`);

    const account = privateKeyToAccount(cfg.treasuryPrivateKey);
    const transport = http(cfg.rpcUrl);
    this.treasury = account.address;
    this.pub = createPublicClient({ chain: robinhood, transport });
    this.wallet = createWalletClient({ chain: robinhood, account, transport });
    this.sdk = new DopplerSDK({ publicClient: this.pub, walletClient: this.wallet, chainId: robinhood.id });
  }

  stockToken(stock: Stock): Address {
    const a = this.cfg.stockTokens[stock];
    if (!isAddress(a)) throw new Error(`STOCK_TOKEN_${stock} is not a valid address`);
    return a;
  }

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
    const protocolOwner = await getAirlockOwner(this.pub);
    const protocolShares = (WAD * this.cfg.protocolShareBps) / BPS;
    const params = new MulticurveBuilder(robinhood.id)
      .tokenConfig({ name: p.name, symbol: p.symbol, tokenURI: p.metadataUri })
      .saleConfig({
        // 100% of supply goes into the curve: no team allocation, no presale, nothing held back.
        initialSupply: parseEther(TOKEN_SUPPLY.toString()),
        numTokensToSell: parseEther(TOKEN_SUPPLY.toString()),
        numeraire: this.stockToken(p.stock),
      })
      .withMarketCapPresets({
        fee: this.cfg.poolFee,
        tickSpacing: 200,
        beneficiaries: [
          { beneficiary: protocolOwner, shares: protocolShares },
          { beneficiary: this.treasury, shares: WAD - protocolShares },
        ],
      })
      .withGovernance({ type: "noOp" })
      .withMigration({ type: "noOp" }) // keep the pool locked so beneficiary fees keep streaming
      .withIntegrator(this.treasury)
      .withUserAddress(this.treasury)
      .build();
    const res = await this.sdk.factory.createMulticurve(params);
    return { tokenAddress: res.tokenAddress, txHash: res.transactionHash };
  }

  private balanceOf(asset: Address) {
    return this.pub.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [this.treasury] });
  }

  claimCreatorFees(token: Address, stock: Stock): Promise<FeeClaim | null> {
    return this.lock.run(async () => {
      const assets = [this.stockToken(stock), token];
      const pool = await this.sdk.getMulticurvePool(token);
      const pending = await pool.getPendingFees(this.treasury);
      if (pending.fees0 === 0n && pending.fees1 === 0n) return null;

      const before = await Promise.all(assets.map((a) => this.balanceOf(a)));
      let txHash: Hex;
      try {
        ({ transactionHash: txHash } = await pool.collectFees());
      } catch (e) {
        // The SDK waits for the receipt; if we can't tell whether it landed, flag for reconciliation.
        const hash = (e as { transactionHash?: Hex }).transactionHash;
        if (hash) throw new BroadcastUncertainError(hash, e);
        throw e;
      }
      // Book what actually arrived, not what the pool reports as collected.
      const after = await Promise.all(assets.map((a) => this.balanceOf(a)));
      const fees = assets
        .map((asset, i) => ({ asset, amount: after[i] - before[i] }))
        .filter((f) => f.amount > 0n);
      return fees.length ? { txHash, fees } : null;
    });
  }

  transfer(asset: Address, to: Address, amount: bigint): Promise<Hex> {
    return this.lock.run(async () => {
      const { request } = await this.pub.simulateContract({
        account: this.wallet.account,
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
    });
  }

  txUrl(hash: string) {
    return `${this.cfg.explorerUrl}/tx/${hash}`;
  }

  addressUrl(addr: string) {
    return `${this.cfg.explorerUrl}/address/${addr}`;
  }
}
