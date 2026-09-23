import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  type Address,
  type Hex,
} from "viem";

/**
 * Launching through Long.xyz's own launcher so tokens are listed on app.long.xyz.
 *
 * Long.xyz's launcher takes Doppler's `create(CreateParams)` struct. Instead of hard-coding its many
 * opaque fields, LONGSHOT reads one real app.long.xyz launch from the chain (LONG_TEMPLATE_TX) and
 * reuses it byte for byte, changing only: name, symbol, tokenURI, pair (numeraire), the fee receiver
 * (the LONGSHOT Treasury) and the CREATE2 salt. Everything is checked against that transaction first.
 */

/** Doppler Airlock `create(CreateParams)`; Long.xyz's launcher exposes the same entry point. */
export const CREATE_ABI = [
  {
    name: "create",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "data",
        type: "tuple",
        components: [
          { name: "initialSupply", type: "uint256" },
          { name: "numTokensToSell", type: "uint256" },
          { name: "numeraire", type: "address" },
          { name: "tokenFactory", type: "address" },
          { name: "tokenFactoryData", type: "bytes" },
          { name: "governanceFactory", type: "address" },
          { name: "governanceFactoryData", type: "bytes" },
          { name: "poolInitializer", type: "address" },
          { name: "poolInitializerData", type: "bytes" },
          { name: "liquidityMigrator", type: "address" },
          { name: "liquidityMigratorData", type: "bytes" },
          { name: "integrator", type: "address" },
          { name: "salt", type: "bytes32" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

export type CreateArgs = {
  initialSupply: bigint;
  numTokensToSell: bigint;
  numeraire: Address;
  tokenFactory: Address;
  tokenFactoryData: Hex;
  governanceFactory: Address;
  governanceFactoryData: Hex;
  poolInitializer: Address;
  poolInitializerData: Hex;
  liquidityMigrator: Address;
  liquidityMigratorData: Hex;
  integrator: Address;
  salt: Hex;
};

/** Layout of Long.xyz's `tokenFactoryData`: name, symbol, four empty byte fields, tokenURI, three zeros, empty bytes. */
const TOKEN_FACTORY_LAYOUT = [
  { type: "string" }, { type: "string" },
  { type: "bytes" }, { type: "bytes" }, { type: "bytes" }, { type: "bytes" },
  { type: "string" },
  { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
  { type: "bytes" },
] as const;

/** Tokens Long.xyz treats as genuine have an address ending in this; others show as "Fake LONG asset". */
export const CANONICAL_SUFFIX = "1e18";

export function decodeCreate(input: Hex): CreateArgs {
  const { functionName, args } = decodeFunctionData({ abi: CREATE_ABI, data: input });
  if (functionName !== "create") throw new Error("reference transaction is not a create() call");
  return args[0] as CreateArgs;
}

export function decodeTokenFactoryData(data: Hex) {
  const v = decodeAbiParameters(TOKEN_FACTORY_LAYOUT, data);
  // Refuse to rebuild data we don't understand exactly.
  if (encodeAbiParameters(TOKEN_FACTORY_LAYOUT, v).toLowerCase() !== data.toLowerCase()) {
    throw new Error("Long.xyz tokenFactoryData has an unexpected layout");
  }
  return v;
}

const words = (data: Hex) => (data.slice(2).match(/.{64}/g) ?? []) as string[];
const wordToAddr = (w: string) => `0x${w.slice(24)}` as Address;
const isAddrWord = (w: string) => w.startsWith("0".repeat(24)) && !/^0+$/.test(w);
const addrWord = (a: Address) => a.toLowerCase().slice(2).padStart(64, "0");
const numWord = (n: bigint) => n.toString(16).padStart(64, "0");
const WAD = 10n ** 18n;

export interface BeneficiaryBlock {
  /** Word index of the array length (2) in poolInitializerData. */
  at: number;
  entries: { beneficiary: Address; shares: bigint }[];
}

/** Finds the fee beneficiary array (length 2, ascending addresses, shares summing to 100%). */
export function findBeneficiaries(poolInitializerData: Hex): BeneficiaryBlock {
  const w = words(poolInitializerData);
  const found: BeneficiaryBlock[] = [];
  for (let i = 0; i + 4 < w.length; i++) {
    if (BigInt(`0x${w[i]}`) !== 2n || !isAddrWord(w[i + 1]) || !isAddrWord(w[i + 3])) continue;
    const a = { beneficiary: wordToAddr(w[i + 1]), shares: BigInt(`0x${w[i + 2]}`) };
    const b = { beneficiary: wordToAddr(w[i + 3]), shares: BigInt(`0x${w[i + 4]}`) };
    if (a.shares + b.shares !== WAD || BigInt(a.beneficiary) >= BigInt(b.beneficiary)) continue;
    found.push({ at: i, entries: [a, b] });
  }
  if (found.length !== 1) throw new Error(`expected one fee beneficiary block in Long.xyz pool data, found ${found.length}`);
  return found[0];
}

export interface LongTemplate {
  args: CreateArgs;
  /** Long.xyz's own beneficiary (kept as-is) and its share (1e18 = 100%). */
  protocolBeneficiary: Address;
  protocolShares: bigint;
  /** Share the launcher's fee receiver gets (the reference creator's; ours becomes the Treasury). */
  receiverShares: bigint;
  /** Hash of the token contract's creation code, verified against the reference launch. */
  initCodeHash: Hex;
}

/**
 * Turn a decoded reference launch into a template. The smaller beneficiary share is Long.xyz's protocol
 * cut; the other is the reference creator's fee receiver, which we replace.
 */
export function templateFromReference(args: CreateArgs, initCodeHash: Hex): LongTemplate {
  decodeTokenFactoryData(args.tokenFactoryData); // layout check
  const { entries } = findBeneficiaries(args.poolInitializerData);
  const [protocol, receiver] = entries[0].shares <= entries[1].shares ? entries : [entries[1], entries[0]];
  return { args, protocolBeneficiary: protocol.beneficiary, protocolShares: protocol.shares, receiverShares: receiver.shares, initCodeHash };
}

export function predictTokenAddress(tokenFactory: Address, salt: Hex, initCodeHash: Hex): Address {
  return getCreate2Address({ from: tokenFactory, salt, bytecodeHash: initCodeHash });
}

function randomSalt(): Hex {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** Find a CREATE2 salt whose token address ends in `suffix` (~65k tries for "1e18"). Yields to the event loop. */
export async function mineSalt(tokenFactory: Address, initCodeHash: Hex, suffix = CANONICAL_SUFFIX) {
  const want = suffix.toLowerCase();
  for (let tries = 0; ; ) {
    for (let i = 0; i < 2000; i++, tries++) {
      const salt = randomSalt();
      const address = predictTokenAddress(tokenFactory, salt, initCodeHash);
      if (address.toLowerCase().endsWith(want)) return { salt, address, tries: tries + 1 };
    }
    await new Promise((r) => setImmediate(r));
  }
}

/** The create() calldata for one LONGSHOT launch, derived from the verified Long.xyz template. */
export function buildLongCreate(
  t: LongTemplate,
  p: { name: string; symbol: string; tokenURI: string; numeraire: Address; feeReceiver: Address; salt: Hex },
): { data: Hex; args: CreateArgs } {
  const tf = decodeTokenFactoryData(t.args.tokenFactoryData);
  const tokenFactoryData = encodeAbiParameters(TOKEN_FACTORY_LAYOUT, [
    p.name, p.symbol, tf[2], tf[3], tf[4], tf[5], p.tokenURI, tf[7], tf[8], tf[9], tf[10],
  ]);

  const w = words(t.args.poolInitializerData);
  // Pair: swap the reference numeraire wherever it appears in the pool data.
  const refNum = addrWord(t.args.numeraire);
  for (let i = 0; i < w.length; i++) if (w[i] === refNum) w[i] = addrWord(p.numeraire);
  // Fees: Long.xyz's protocol cut stays; the fee receiver becomes the Treasury. Array must stay sorted.
  const { at } = findBeneficiaries(t.args.poolInitializerData);
  const entries = [
    { beneficiary: t.protocolBeneficiary, shares: t.protocolShares },
    { beneficiary: p.feeReceiver, shares: t.receiverShares },
  ].sort((a, b) => (BigInt(a.beneficiary) < BigInt(b.beneficiary) ? -1 : 1));
  w.splice(at + 1, 4, ...entries.flatMap((e) => [addrWord(e.beneficiary), numWord(e.shares)]));
  const poolInitializerData = `0x${w.join("")}` as Hex;

  const args: CreateArgs = { ...t.args, numeraire: p.numeraire, tokenFactoryData, poolInitializerData, salt: p.salt };
  return { data: encodeFunctionData({ abi: CREATE_ABI, functionName: "create", args: [args] }), args };
}
