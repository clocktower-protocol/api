/**
 * Lightly managed list of approved ERC-20 tokens for the Clocktower Protocol.
 * 
 * This is a static configuration because the on-chain `approvedERC20` mapping
 * does not support enumeration.
 * 
 * When new tokens are approved on-chain via `addERC20Contract`, add them here
 * so they appear in the MCP tool and REST API list endpoints.
 */

export interface ApprovedTokenInfo {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
}

export const APPROVED_TOKENS: ApprovedTokenInfo[] = [
  {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  },
  // Add more tokens here as they are approved on-chain, for example:
  // {
  //   address: "0x...",
  //   symbol: "USDT",
  //   name: "Tether USD",
  //   decimals: 6,
  // },
  // {
  //   address: "0x...", // CLOCK token if deployed
  //   symbol: "CLOCK",
  //   name: "Clocktower Token",
  //   decimals: 18,
  // },
];

export function getApprovedTokenByAddress(address: string): ApprovedTokenInfo | undefined {
  const normalized = address.toLowerCase();
  return APPROVED_TOKENS.find(
    (t) => t.address.toLowerCase() === normalized
  );
}
