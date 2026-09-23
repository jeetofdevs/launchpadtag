import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { MockLongClient } from "../src/chain/mock.ts";
import { ConsoleReplier } from "../src/x/client.ts";
import type { Author } from "../src/validate.ts";

export function setup(feePerHarvest = 1000n) {
  const cfg = loadConfig();
  const db = openDb(":memory:");
  const long = new MockLongClient(feePerHarvest);
  const replier = new ConsoleReplier(() => {});
  return { cfg, db, long, replier };
}

export const DAY = 24 * 3600 * 1000;

export function author(over: Partial<Author> = {}): Author {
  return { id: "42", username: "alice", createdAt: new Date(Date.now() - 365 * DAY), followers: 500, ...over };
}

let n = 1n;
export const nextTweetId = () => (1_900_000_000_000_000_000n + n++).toString();
