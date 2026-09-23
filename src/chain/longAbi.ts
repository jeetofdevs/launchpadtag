import { parseAbi } from "viem";

/**
 * ⚠️ ASSUMED interface of the Long.xyz launch factory.
 *
 * Long.xyz has not published its contract ABI in a place this repo could read, so these
 * signatures are placeholders. Before running with CHAIN_MODE=onchain, replace them with the
 * real ABI from the Long.xyz team / block explorer and adjust `OnchainLongClient` to match.
 */
export const LONG_FACTORY_ABI = parseAbi([
  "function createToken(string name, string symbol, string metadataURI, address pairedAsset) returns (address token)",
  "function claimCreatorFees(address token)",
  "event TokenCreated(address indexed token, address indexed creator, address indexed pairedAsset)",
]);
