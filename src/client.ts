import { createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { type ChainConfig, type SupportedChainId } from './chain.js';

const CHAIN_DEFINITIONS = {
	8453: base,
	84532: baseSepolia,
} as const;

export function createClocktowerClient(chain: ChainConfig) {
	const viemChain = CHAIN_DEFINITIONS[chain.chainId as SupportedChainId];

	return createPublicClient({
		chain: viemChain,
		transport: http(chain.rpcUrl),
	});
}
