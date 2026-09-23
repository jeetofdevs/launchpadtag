import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLaunchParams, TICK_SPACING } from "../src/chain/onchain.ts";
import { loadConfig } from "../src/config.ts";

const A = (n: string) => `0x${n.repeat(40)}` as `0x${string}`;

test("every curve tick is aligned to the pool's tick spacing (else create reverts with TickNotAligned)", () => {
  const cfg = loadConfig().chain;
  const params = buildLaunchParams(cfg, { name: "Test", symbol: "TEST", stock: "NVDA", metadataUri: "https://x/m.json" },
    { protocolOwner: A("1"), treasury: A("2"), numeraire: A("3") }) as unknown as {
      pool: { tickSpacing: number; fee: number; curves: { tickLower: number; tickUpper: number }[]; beneficiaries: { beneficiary: string; shares: bigint }[] };
    };
  assert.equal(params.pool.tickSpacing, TICK_SPACING);
  assert.equal(params.pool.fee, 10_000);
  assert.ok(params.pool.curves.length > 0);
  for (const c of params.pool.curves) {
    assert.equal(Math.abs(c.tickLower % params.pool.tickSpacing), 0, `tickLower ${c.tickLower}`);
    assert.equal(Math.abs(c.tickUpper % params.pool.tickSpacing), 0, `tickUpper ${c.tickUpper}`);
  }
  const total = params.pool.beneficiaries.reduce((s, b) => s + b.shares, 0n);
  assert.equal(total, 10n ** 18n);
});
