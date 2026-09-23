import type { Config } from "../config.ts";
import { MockLongClient } from "./mock.ts";
import { OnchainLongClient } from "./onchain.ts";
import type { LongClient } from "./types.ts";

export function createLongClient(cfg: Config["chain"]): LongClient {
  return cfg.mode === "onchain" ? new OnchainLongClient(cfg) : new MockLongClient();
}

export type { LongClient } from "./types.ts";
export { BroadcastUncertainError } from "./types.ts";
