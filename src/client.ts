import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import type { ChainConfig } from './chain.js';

export const RPC_TIMEOUT_MS = 30_000;

export function createClocktowerClient(chain: ChainConfig) {
	return createPublicClient({
		chain: base,
		transport: http(chain.rpcUrl, { timeout: RPC_TIMEOUT_MS }),
	});
}
