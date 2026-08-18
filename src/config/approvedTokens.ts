/**
 * Lightly managed list of approved ERC-20 tokens for the Clocktower Protocol,
 * keyed by chain id.
 *
 * This is a static configuration because the on-chain `approvedERC20` mapping
 * does not support enumeration.
 *
 * When new tokens are approved on-chain via `addERC20Contract`, add them here
 * so they appear in the MCP tool and REST API list endpoints.
 */

import { BASE_CHAIN_ID } from '../chain.js';

export interface ApprovedTokenInfo {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
}

const BASE_APPROVED_TOKENS: ApprovedTokenInfo[] = [
  {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  },
];

export const APPROVED_TOKENS_BY_CHAIN: Record<number, ApprovedTokenInfo[]> = {
  [BASE_CHAIN_ID]: BASE_APPROVED_TOKENS,
};

/** Base mainnet list (MCP is Base-only). Prefer getApprovedTokens(chainId) on REST. */
export const APPROVED_TOKENS: ApprovedTokenInfo[] = BASE_APPROVED_TOKENS;

export function getApprovedTokens(chainId: number): ApprovedTokenInfo[] {
  return APPROVED_TOKENS_BY_CHAIN[chainId] ?? [];
}

export function getApprovedTokenByAddress(
  address: string,
  chainId: number = BASE_CHAIN_ID,
): ApprovedTokenInfo | undefined {
  const normalized = address.toLowerCase();
  return getApprovedTokens(chainId).find(
    (t) => t.address.toLowerCase() === normalized
  );
}
