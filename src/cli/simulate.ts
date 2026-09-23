/**
 * Run the full LONGSHOT loop locally against the mock Long.xyz client:
 *   tweet → launch → reply → fee harvest → 80/20 ledger → claim payout.
 *
 *   npm run simulate
 *   npm run simulate -- '@longdotxyz launch $MOON "Moon Nvidia" paired $NVDA'
 */
import { formatUnits } from "viem";
import { handleMention } from "../bot.ts";
import { MockLongClient } from "../chain/mock.ts";
import { loadConfig } from "../config.ts";
import { openDb } from "../db.ts";
import { harvestFees } from "../harvester.ts";
import { balances } from "../ledger.ts";
import { claimAll } from "../claim.ts";
import { ConsoleReplier } from "../x/client.ts";

const cfg = loadConfig();
const db = openDb(":memory:");
const long = new MockLongClient(1_000_000_000n); // 1,000 units (6 decimals) of fees per harvest
const replier = new ConsoleReplier();
const text = process.argv[2] ?? `@${cfg.x.triggerHandle} launch $ROBO "Robo Tesla" paired $TSLA`;

const author = {
  id: "1001",
  username: "degen",
  createdAt: new Date(Date.now() - 400 * 24 * 3600 * 1000),
  followers: 1200,
};

console.log(`> tweet by @${author.username}: ${text}\n`);
const res = await handleMention({ cfg, db, long, replier }, { tweetId: "1900000000000000001", text, author });
console.log("result:", res.kind, "\n");
if (res.kind !== "live") process.exit(0);

await harvestFees(db, long, (m) => console.log(m));
const f = async (asset: string, v: bigint) => {
  const { symbol, decimals } = await long.assetInfo(asset as `0x${string}`);
  return `${formatUnits(v, decimals)} ${symbol}`;
};
console.log("");
for (const b of balances(db, author.id))
  console.log(`fees: total ${await f(b.asset, b.totalFees)} → deployer ${await f(b.asset, b.deployerShare)} / treasury ${await f(b.asset, b.treasuryShare)}`);

for (const p of await claimAll(db, long, author.id, "0x000000000000000000000000000000000000dEaD", 0n))
  console.log(`claim: sent ${await f(p.asset, p.amount)} to deployer (tx ${p.txHash?.slice(0, 18)}…)`);
for (const b of balances(db, author.id)) console.log(`claimable after claim: ${await f(b.asset, b.claimable)}`);
