export const SUPPORTED_CHAIN_IDS = [8453, 84532] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export interface ChainConfig {
	chainId: SupportedChainId;
	rpcUrl: string;
	contractAddress: `0x${string}`;
}

export function resolveChain(env: Env, chainId: number): ChainConfig {
	switch (chainId) {
		case 8453:
			return {
				chainId: 8453,
				rpcUrl: `${env.ALCHEMY_URL_BASE}${env.ALCHEMY_API_KEY}`,
				contractAddress: env.CLOCKTOWER_ADDRESS_BASE as `0x${string}`,
			};
		case 84532:
			return {
				chainId: 84532,
				rpcUrl: `${env.ALCHEMY_URL_SEPOLIA_BASE}${env.ALCHEMY_API_KEY}`,
				contractAddress: env.CLOCKTOWER_ADDRESS_SEPOLIA_BASE as `0x${string}`,
			};
		default:
			throw new Error(`Unsupported chainId: ${chainId}. Use 8453 (Base) or 84532 (Base Sepolia).`);
	}
}
