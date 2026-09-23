import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeFunctionData, type Address, type Hex } from "viem";
import {
  CREATE_ABI, buildLongCreate, decodeCreate, decodeTokenFactoryData, findBeneficiaries,
  mineSalt, predictTokenAddress, templateFromReference, type CreateArgs,
} from "../src/chain/longLaunch.ts";

const A = (h: string) => `0x${h.repeat(40 / h.length)}` as Address;
const w = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as Address;
const TSLA = "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" as Address;
const LONG_PROTOCOL = A("21");
const REF_CREATOR = A("aa");
const TREASURY = A("05"); // sorts before LONG_PROTOCOL, so the beneficiary order must flip
const HASH = `0x${"25".repeat(32)}` as Hex;

/** A reference launch shaped like app.long.xyz's: numeraire inside pool data, 5%/95% beneficiary block. */
function reference(): CreateArgs {
  const poolInitializerData = `0x${[
    w("20"), w("3e8"), w("8"), w(NVDA), w("64"),
    w("2"), w(LONG_PROTOCOL), (5n * 10n ** 16n).toString(16).padStart(64, "0"), w(REF_CREATOR), (95n * 10n ** 16n).toString(16).padStart(64, "0"),
    w("ff"),
  ].join("")}` as Hex;
  const tokenFactoryData = encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "bytes" }, { type: "bytes" }, { type: "bytes" }, { type: "bytes" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }],
    ["Ref Token", "REF", "0x", "0x", "0x", "0x", "ipfs://ref", 0n, 0n, 0n, "0x"],
  );
  return {
    initialSupply: 10n ** 27n, numTokensToSell: 10n ** 27n, numeraire: NVDA, tokenFactory: A("1b"),
    tokenFactoryData, governanceFactory: A("85"), governanceFactoryData: "0x", poolInitializer: A("4e"),
    poolInitializerData, liquidityMigrator: A("ba"), liquidityMigratorData: "0x", integrator: A("92"),
    salt: `0x${"00".repeat(31)}01`,
  };
}

test("reads the reference create() call and finds Long.xyz's 5% cut and the 95% fee receiver", () => {
  const ref = reference();
  const decoded = decodeCreate(encodeFunctionData({ abi: CREATE_ABI, functionName: "create", args: [ref] }));
  assert.equal(decoded.numeraire.toLowerCase(), NVDA.toLowerCase());
  const t = templateFromReference(decoded, HASH);
  assert.equal(t.protocolBeneficiary.toLowerCase(), LONG_PROTOCOL.toLowerCase());
  assert.equal(t.protocolShares, 5n * 10n ** 16n);
  assert.equal(t.receiverShares, 95n * 10n ** 16n);
});

test("a launch changes only name, symbol, tokenURI, pair, fee receiver and salt", () => {
  const t = templateFromReference(reference(), HASH);
  const salt = `0x${"ab".repeat(32)}` as Hex;
  const { args } = buildLongCreate(t, { name: "Moon", symbol: "MOON", tokenURI: "ipfs://moon", numeraire: TSLA, feeReceiver: TREASURY, salt });

  const tf = decodeTokenFactoryData(args.tokenFactoryData);
  assert.deepEqual([tf[0], tf[1], tf[6]], ["Moon", "MOON", "ipfs://moon"]);
  assert.equal(args.numeraire, TSLA);
  assert.equal(args.salt, salt);
  assert.ok(args.poolInitializerData.toLowerCase().includes(w(TSLA)));
  assert.ok(!args.poolInitializerData.toLowerCase().includes(w(NVDA)));
  assert.ok(!args.poolInitializerData.toLowerCase().includes(w(REF_CREATOR)), "reference creator no longer receives fees");

  // Treasury gets 95%, Long.xyz keeps 5%, sorted by address as the contract requires.
  const { entries } = findBeneficiaries(args.poolInitializerData);
  assert.deepEqual(entries.map((e) => [e.beneficiary.toLowerCase(), e.shares]), [
    [TREASURY.toLowerCase(), 95n * 10n ** 16n],
    [LONG_PROTOCOL.toLowerCase(), 5n * 10n ** 16n],
  ]);

  // Everything else is the reference, byte for byte.
  const ref = reference();
  for (const k of ["initialSupply", "numTokensToSell", "tokenFactory", "governanceFactory", "governanceFactoryData", "poolInitializer", "liquidityMigrator", "liquidityMigratorData", "integrator"] as const) {
    assert.equal(args[k], ref[k], k);
  }
  assert.equal(args.poolInitializerData.length, ref.poolInitializerData.length);
});

test("a pool data blob without a clear beneficiary block is refused", () => {
  assert.throws(() => findBeneficiaries(`0x${w("2")}${w("1")}`), /expected one fee beneficiary block/);
});

test("salt mining finds a token address with the canonical suffix", async () => {
  const { salt, address } = await mineSalt(A("1b"), HASH, "1e"); // short suffix keeps the test fast
  assert.ok(address.toLowerCase().endsWith("1e"));
  assert.equal(predictTokenAddress(A("1b"), salt, HASH), address);
});
