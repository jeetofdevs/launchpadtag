import {
  DopplerSDK,
  MulticurveBuilder,
  WAD,
  getAirlockOwner,
} from "@whetstone-research/doppler-sdk/evm";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  erc20Abi,
  formatEther,
  isAddress,
  keccak256,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood } from "viem/chains";
import { chainErrorSummary, rpcTransport } from "./rpc.ts";
import { buildLongCreate, decodeCreate, mineSalt, predictTokenAddress, templateFromReference, CANONICAL_SUFFIX, type LongTemplate } from "./longLaunch.ts";
import { LAUNCH_CREATED_TOPIC } from "./tickers.ts";
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
 * Doppler's market-cap presets put curve boundaries on multiples of 100 (e.g. -116300, -84100), so the
 * pool's tick spacing must divide 100. 200 (the usual spacing for a 1% fee) makes `create` revert with
 * TickNotAligned(int24).
 */
export const TICK_SPACING = 100;

/** The parts of Doppler's pool contract LONGSHOT uses to find a pool and collect its fees. */
const HOOK_INITIALIZER_ABI = [
  {
    type: "function", name: "getState", stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "numeraire", type: "address" },
      { name: "totalTokensOnBondingCurve", type: "uint256" },
      { name: "dopplerHook", type: "address" },
      { name: "graduationDopplerHookCalldata", type: "bytes" },
      { name: "status", type: "uint8" },
      { name: "poolKey", type: "tuple", components: [
        { name: "currency0", type: "address" },
        { name: "currency1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "tickSpacing", type: "int24" },
        { name: "hooks", type: "address" },
      ] },
      { name: "farTick", type: "int24" },
    ],
  },
  {
    type: "function", name: "collectFees", stateMutability: "nonpayable",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "fees0", type: "uint128" }, { name: "fees1", type: "uint128" }],
  },
] as const;

/** Readable reasons for reverts seen when launching through Long.xyz. */
const LONG_REVERTS: Record<string, string> = {
  "0xf2cef899": "ticker was launched on Long.xyz in the last 24 hours",
  "0xe666e3c7": "ticker must use letters only",
  "0x624f4151": "pool ticks are not aligned (TickNotAligned)",
};

/** The 4-byte error selector of a reverted call (viem keeps the raw revert data on an error in the cause chain). */
export function revertSelector(e: unknown): string | undefined {
  for (let c = e as { data?: unknown; cause?: unknown } | undefined, d = 0; c && d < 8; c = c.cause as typeof c, d++) {
    const data = typeof c.data === "string" ? c.data : (c.data as { data?: unknown } | undefined)?.data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]{8}/.test(data)) return data.slice(0, 10).toLowerCase();
  }
  return undefined;
}

/** Multicurve launch parameters for one LONGSHOT token (pure, so it can be tested without a chain). */
export function buildLaunchParams(
  cfg: Config["chain"],
  p: CreateTokenParams,
  a: { protocolOwner: Address; treasury: Address; numeraire: Address },
) {
  const protocolShares = (WAD * cfg.protocolShareBps) / BPS;
  return new MulticurveBuilder(robinhood.id)
    .tokenConfig({ name: p.name, symbol: p.symbol, tokenURI: p.metadataUri })
    .saleConfig({
      // 100% of supply goes into the curve: no team allocation, no presale, nothing held back.
      initialSupply: parseEther(TOKEN_SUPPLY.toString()),
      numTokensToSell: parseEther(TOKEN_SUPPLY.toString()),
      numeraire: a.numeraire,
    })
    .withMarketCapPresets({
      fee: cfg.poolFee,
      tickSpacing: TICK_SPACING,
      beneficiaries: [
        { beneficiary: a.protocolOwner, shares: protocolShares },
        { beneficiary: a.treasury, shares: WAD - protocolShares },
      ],
    })
    .withGovernance({ type: "noOp" })
    .withMigration({ type: "noOp" }) // keep the pool locked so beneficiary fees keep streaming
    .withIntegrator(a.treasury)
    .withUserAddress(a.treasury)
    .build();
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
  private template: Promise<LongTemplate> | null = null;

  constructor(private readonly cfg: Config["chain"]) {
    if (cfg.chainId !== robinhood.id) throw new Error(`CHAIN_ID must be ${robinhood.id} (Robinhood Chain)`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(cfg.treasuryPrivateKey)) throw new Error("TREASURY_PRIVATE_KEY is missing/invalid");
    if (cfg.poolFee <= 0) throw new Error("POOL_FEE must be > 0 or beneficiaries never earn anything");
    if (cfg.protocolShareBps < 500n || cfg.protocolShareBps > BPS - DEPLOYER_SHARE_BPS)
      throw new Error(`PROTOCOL_SHARE_BPS must be 500..${BPS - DEPLOYER_SHARE_BPS} so deployers keep 80%`);

    const account = privateKeyToAccount(cfg.treasuryPrivateKey);
    const transport = rpcTransport(cfg.rpcUrl);
    this.treasury = account.address;
    this.pub = createPublicClient({ chain: robinhood, transport });
    this.wallet = createWalletClient({ chain: robinhood, account, transport });
    this.sdk = new DopplerSDK({ publicClient: this.pub, walletClient: this.wallet, chainId: robinhood.id });
  }

  /**
   * The verified Long.xyz launch template, read once from LONG_TEMPLATE_TX. Every check must pass or no
   * launch is attempted: it must be a successful create() on Long.xyz's launcher, its token address must
   * be reproducible from its salt and end in 1e18, and its protocol cut must match PROTOCOL_SHARE_BPS.
   */
  longTemplate(): Promise<LongTemplate> {
    this.template ??= (async () => {
      const tried: string[] = [];
      try {
        return await this.templateFrom(this.cfg.longTemplateTx);
      } catch (e) {
        tried.push(`${this.cfg.longTemplateTx.slice(0, 10)}…: ${e instanceof Error ? e.message : e}`);
      }
      // Fall back to the most recent app.long.xyz launches found on-chain.
      for (const hash of await this.recentLaunchTxs(10)) {
        try {
          return await this.templateFrom(hash);
        } catch (e) {
          tried.push(`${hash.slice(0, 10)}…: ${e instanceof Error ? e.message : e}`);
        }
      }
      throw new Error(`no usable Long.xyz launch found to copy. Tried: ${tried.join(" | ")}`);
    })();
    this.template.catch(() => (this.template = null)); // retry on the next launch
    return this.template;
  }

  /** Transaction the verified template was taken from (for logs). */
  templateTx: Hex | null = null;

  /** Newest transactions that emitted LaunchCreated on Long.xyz's launcher (searches back ~2M blocks). */
  private async recentLaunchTxs(max: number): Promise<Hex[]> {
    const head = await this.pub.getBlockNumber();
    const out: Hex[] = [];
    for (let to = head; to > 0n && head - to < 2_000_000n && out.length < max; to -= 10_000n) {
      const from = to > 9_999n ? to - 9_999n : 0n;
      const logs = (await this.pub.request({
        method: "eth_getLogs",
        params: [{ address: this.cfg.longLauncher, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [LAUNCH_CREATED_TOPIC] }],
      } as never)) as { transactionHash: Hex }[];
      for (const l of logs.reverse()) if (!out.includes(l.transactionHash)) out.push(l.transactionHash);
    }
    return out.slice(0, max);
  }

  /**
   * Verify one launch and turn it into a template. It must be a successful create() sent straight to
   * Long.xyz's launcher, its token address must be reproducible from its salt and end in 1e18, and its
   * protocol cut must match PROTOCOL_SHARE_BPS.
   */
  private async templateFrom(hash: Hex): Promise<LongTemplate> {
    const [tx, receipt] = await Promise.all([this.pub.getTransaction({ hash }), this.pub.getTransactionReceipt({ hash })]);
    if (tx.to?.toLowerCase() !== this.cfg.longLauncher.toLowerCase())
      throw new Error(`sent to ${tx.to} (function ${tx.input.slice(0, 10)}), not to Long.xyz's launcher`);
    if (receipt.status !== "success") throw new Error("transaction failed");
    const args = decodeCreate(tx.input);
    const launched = receipt.logs.find((l) => l.address.toLowerCase() === this.cfg.longLauncher.toLowerCase() && l.topics[0]?.toLowerCase() === LAUNCH_CREATED_TOPIC);
    const asset = launched?.topics[2] ? (`0x${launched.topics[2].slice(-40)}` as Address) : undefined;
    if (!asset) throw new Error("no LaunchCreated event");
    if (predictTokenAddress(args.tokenFactory, args.salt, this.cfg.longInitCodeHash).toLowerCase() !== asset.toLowerCase())
      throw new Error("LONG_INITCODE_HASH does not reproduce its token address");
    if (!asset.toLowerCase().endsWith(CANONICAL_SUFFIX)) throw new Error(`token ${asset} is not canonical (…${CANONICAL_SUFFIX})`);
    const t = templateFromReference(args, this.cfg.longInitCodeHash);
    const protocolBps = (t.protocolShares * BPS) / WAD;
    if (protocolBps !== this.cfg.protocolShareBps)
      throw new Error(`Long.xyz takes ${protocolBps} bps but PROTOCOL_SHARE_BPS is ${this.cfg.protocolShareBps}; set PROTOCOL_SHARE_BPS=${protocolBps}`);
    this.templateTx = hash;
    return t;
  }

  /** Native ETH the Treasury holds for gas, formatted. */
  async gasBalance(): Promise<string> {
    return formatEther(await this.pub.getBalance({ address: this.treasury }));
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
    return this.cfg.launchVia === "long" ? this.createOnLong(p) : this.createOnDoppler(p);
  }

  /** Launch through Long.xyz's launcher (listed on app.long.xyz), simulated before anything is sent. */
  private async createOnLong(p: CreateTokenParams) {
    const t = await this.longTemplate();
    const { salt, address } = await mineSalt(t.args.tokenFactory, t.initCodeHash);
    const { data } = buildLongCreate(t, {
      name: p.name, symbol: p.symbol, tokenURI: p.metadataUri,
      numeraire: this.stockToken(p.stock), feeReceiver: this.treasury, salt,
    });
    const to = this.cfg.longLauncher;
    try {
      await this.pub.call({ account: this.wallet.account, to, data });
    } catch (e) {
      const sel = revertSelector(e);
      throw new Error(`launch simulation failed, nothing was sent: ${(sel && LONG_REVERTS[sel]) || chainErrorSummary(e)}`);
    }
    const txHash = await this.wallet.sendTransaction({ to, data });
    let receipt;
    try {
      receipt = await this.pub.waitForTransactionReceipt({ hash: txHash });
    } catch (e) {
      throw new BroadcastUncertainError(txHash, e);
    }
    if (receipt.status !== "success") throw new Error(`launch reverted: ${txHash}`);
    const launched = receipt.logs.find((l) => l.address.toLowerCase() === to.toLowerCase() && l.topics[0]?.toLowerCase() === LAUNCH_CREATED_TOPIC);
    const tokenAddress = launched?.topics[2] ? (`0x${launched.topics[2].slice(-40)}` as Address) : address;
    return { tokenAddress, txHash };
  }

  /** Launch straight on Doppler (LAUNCH_VIA=doppler): tradable on Uniswap v4, not listed on Long.xyz. */
  private async createOnDoppler(p: CreateTokenParams) {
    const protocolOwner = await getAirlockOwner(this.pub);
    const params = buildLaunchParams(this.cfg, p, { protocolOwner, treasury: this.treasury, numeraire: this.stockToken(p.stock) });
    const res = await this.sdk.factory.createMulticurve(params);
    return { tokenAddress: res.tokenAddress, txHash: res.transactionHash };
  }

  private balanceOf(asset: Address) {
    return this.pub.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [this.treasury] });
  }

  claimCreatorFees(token: Address, stock: Stock): Promise<FeeClaim | null> {
    return this.lock.run(async () => {
      const assets = [this.stockToken(stock), token];
      // Both Long.xyz launches and direct Doppler launches live in Doppler's hook initializer.
      const initializer = this.cfg.dopplerHookInitializer;
      const state = await this.pub.readContract({ address: initializer, abi: HOOK_INITIALIZER_ABI, functionName: "getState", args: [token] });
      const key = state[5];
      if (/^0x0+$/.test(key.hooks) && /^0x0+$/.test(key.currency1)) return null; // not a pool we know
      const poolId = keccak256(encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
        [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
      ));
      // Simulate first: skips the gas when nothing has accrued for the Treasury.
      const sim = await this.pub.simulateContract({ account: this.wallet.account, address: initializer, abi: HOOK_INITIALIZER_ABI, functionName: "collectFees", args: [poolId] });
      if (sim.result[0] === 0n && sim.result[1] === 0n) return null;

      const before = await Promise.all(assets.map((a) => this.balanceOf(a)));
      const txHash = await this.wallet.writeContract(sim.request);
      let receipt;
      try {
        receipt = await this.pub.waitForTransactionReceipt({ hash: txHash });
      } catch (e) {
        throw new BroadcastUncertainError(txHash, e);
      }
      if (receipt.status !== "success") throw new Error(`fee collection reverted: ${txHash}`);
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
