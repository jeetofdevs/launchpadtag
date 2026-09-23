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
