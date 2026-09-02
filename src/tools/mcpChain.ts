import { z } from 'zod';
import { resolveMcpChain, type ChainConfig } from '../chain.js';

/** Optional MCP tool `chainId`. Number or decimal/CAIP-2 string; omitted uses Base. */
export const mcpChainIdSchema = z
	.union([z.number().int().positive(), z.string().min(1)])
	.optional()
	.describe(
		'Protocol chain (decimal or CAIP-2, e.g. 8453 or eip155:8453). Omitted uses Base (8453).',
	);

export function mcpChain(env: Env, chainId?: string | number): ChainConfig {
	return resolveMcpChain(env, chainId);
}
