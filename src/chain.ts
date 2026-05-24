/** Base mainnet (CAIP-2: eip155:8453). */
export const BASE_CHAIN_ID = 8453 as const;

export type BaseChainId = typeof BASE_CHAIN_ID;

export interface ChainConfig {
	chainId: BaseChainId;
	rpcUrl: string;
	contractAddress: `0x${string}`;
}

export function resolveChain(env: Env): ChainConfig {
	return {
		chainId: BASE_CHAIN_ID,
		rpcUrl: `${env.ALCHEMY_URL}${env.ALCHEMY_API_KEY}`,
		contractAddress: env.CLOCKTOWER_ADDRESS as `0x${string}`,
	};
}
