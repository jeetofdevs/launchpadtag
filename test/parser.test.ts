import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLaunch } from "../src/parser.ts";

const p = (t: string) => parseLaunch(t, "longdotxyz", "NVDA");

test("full command", () => {
  assert.deepEqual(p('@longdotxyz launch $robo "Robo Tesla" paired $tsla'), { ticker: "ROBO", name: "Robo Tesla", stock: "TSLA" });
});

test("defaults: name = ticker, stock = NVDA", () => {
  assert.deepEqual(p("@longdotxyz launch $APPLZ"), { ticker: "APPLZ", name: "APPLZ", stock: "NVDA" });
});

test("aliases and curly quotes", () => {
  assert.deepEqual(p("@LongDotXyz long $CHIP “Micron Degen” paired $MU"), { ticker: "CHIP", name: "Micron Degen", stock: "MU" });
  assert.equal(p("@longdotxyz deploy $ABC")?.ticker, "ABC");
});

test("works inside a reply prefix", () => {
  assert.equal(p("@elonmusk @longdotxyz launch $DOGEX lol")?.ticker, "DOGEX");
});

test("a pair that isn't a Long.xyz market is flagged, not silently swapped", () => {
  const r = p("@longdotxyz launch $ABC paired $ZZZZ");
  assert.equal(r?.unknownStock, "ZZZZ");
});

test("any Long.xyz market can be paired, including 1-letter symbols", () => {
  assert.equal(p("@longdotxyz launch $ABC paired $AMZN")?.stock, "AMZN");
  assert.equal(p("@longdotxyz launch $ABC paired $f")?.stock, "F");
  assert.equal(p('@longdotxyz launch $ABC "Gold Bug" paired $GLD')?.stock, "GLD");
});

test("rejects non-commands", () => {
  assert.equal(p("@longdotxyz gm"), null);
  assert.equal(p("@longdotxyz launch $A"), null); // too short
  assert.equal(p("@longdotxyz launch $TOOLONGTICKER1"), null);
  assert.equal(p("@longdotxyzfake launch $ABC"), null);
  assert.equal(p("@someoneelse launch $ABC"), null);
});

test("EXTRA_MARKETS adds ERC-20 markets by address", async () => {
  const { extraMarkets } = await import("../src/stocks.ts");
  const saved = process.env.EXTRA_MARKETS;
  process.env.EXTRA_MARKETS = "NVDAx3L=0x1111111111111111111111111111111111111111=NVDA 3x Long, AI=0x2222222222222222222222222222222222222222, bad=nope";
  try {
    const m = extraMarkets();
    assert.deepEqual(Object.keys(m), ["NVDAX3L", "AI"]);
    assert.equal(m.NVDAX3L.name, "NVDA 3x Long");
    assert.equal(m.AI.name, "AI");
  } finally {
    if (saved === undefined) delete process.env.EXTRA_MARKETS; else process.env.EXTRA_MARKETS = saved;
  }
});

test("Long.xyz tokens can be paired, case-insensitively", () => {
  assert.equal(p("@longdotxyz launch $ABC paired $NVDAx3L")?.stock, "NVDAX3L");
  assert.equal(p("@longdotxyz launch $ABC paired $openaix1l")?.stock, "OPENAIX1L");
  assert.equal(p("@longdotxyz launch $ABC paired $AI")?.stock, "AI");
});
