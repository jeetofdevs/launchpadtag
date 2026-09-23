import { BPS, DEPLOYER_SHARE_BPS, TOKEN_SUPPLY, type Config } from "./config.ts";

/** What every trade pays, in percent of trade size, derived from the live config. */
export function feeSplit(chain: Config["chain"]) {
  const poolFee = chain.poolFee / 10_000; // Uniswap v4 fee units: 10_000 = 1%
  const protocol = (poolFee * Number(chain.protocolShareBps)) / Number(BPS);
  const creatorSide = poolFee - protocol;
  const deployer = (creatorSide * Number(DEPLOYER_SHARE_BPS)) / Number(BPS);
  return { poolFee, protocol, deployer, longshot: creatorSide - deployer };
}

export const TOKENOMICS = {
  supply: TOKEN_SUPPLY,
  curvePct: 100,
  teamPct: 0,
  presalePct: 0,
};

/** 0.76 → "0.76%", 1 → "1%" */
export const pct = (n: number) => `${Number(n.toFixed(4))}%`;
