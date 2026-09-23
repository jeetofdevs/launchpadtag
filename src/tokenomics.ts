import { BPS, DEPLOYER_SHARE_BPS, TOKEN_SUPPLY, type Config } from "./config.ts";

/** What every trade pays, in percent of trade size, derived from the live config. */
export function feeSplit(chain: Config["chain"]) {
  const poolFee = chain.poolFee / 10_000; // Uniswap v4 fee units: 10_000 = 1%
  const protocol = (poolFee * Number(chain.protocolShareBps)) / Number(BPS);
  const deployer = (poolFee * Number(DEPLOYER_SHARE_BPS)) / Number(BPS);
  const longshot = poolFee - deployer - protocol; // LONGSHOT's 20% minus the protocol cut
  // The same split expressed as a share of the fee itself (sums to 100).
  const ofFee = (x: number) => (poolFee > 0 ? (x / poolFee) * 100 : 0);
  return {
    poolFee, protocol, deployer, longshot,
    share: { deployer: ofFee(deployer), longshot: ofFee(longshot), protocol: ofFee(protocol), platform: ofFee(longshot + protocol) },
  };
}

export const TOKENOMICS = {
  supply: TOKEN_SUPPLY,
  curvePct: 100,
  teamPct: 0,
  presalePct: 0,
};

/** 0.76 → "0.76%", 1 → "1%" */
export const pct = (n: number) => `${Number(n.toFixed(4))}%`;
