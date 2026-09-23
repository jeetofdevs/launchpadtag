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
const [bal] = balances(db, author.id);
const { symbol, decimals } = await long.assetInfo(bal.asset as `0x${string}`);
const f = (v: bigint) => `${formatUnits(v, decimals)} ${symbol}`;
console.log(`\nfees: total ${f(bal.totalFees)} → deployer ${f(bal.deployerShare)} / treasury ${f(bal.treasuryShare)}`);

const payout = await claimAll(db, long, author.id, "0x000000000000000000000000000000000000dEaD", 0n);
console.log(`claim: sent ${f(payout[0].amount)} to deployer (tx ${payout[0].txHash})`);
console.log(`claimable after claim: ${f(balances(db, author.id)[0].claimable)}`);
