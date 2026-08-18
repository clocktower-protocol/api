import { createPublicClient, http } from 'viem';
import type { ChainConfig } from './chain.js';

export const RPC_TIMEOUT_MS = 30_000;

export function createClocktowerClient(chain: ChainConfig) {
	return createPublicClient({
		chain: chain.viemChain,
		transport: http(chain.rpcUrl, { timeout: RPC_TIMEOUT_MS }),
	});
}
