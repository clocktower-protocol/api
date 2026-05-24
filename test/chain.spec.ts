import { describe, expect, it } from 'vitest';
import { BASE_CHAIN_ID, resolveChain } from '../src/chain.js';

describe('resolveChain', () => {
	const env = {
		ALCHEMY_API_KEY: 'test-key',
		ALCHEMY_URL: 'https://base-mainnet.g.alchemy.com/v2/',
		CLOCKTOWER_ADDRESS: '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
	} as Env;

	it('resolves Base mainnet config', () => {
		const chain = resolveChain(env);
		expect(chain.chainId).toBe(BASE_CHAIN_ID);
		expect(chain.rpcUrl).toContain('test-key');
		expect(chain.contractAddress).toBe('0xFaF5fc2f77b21BC188f492b827D366B03a07c61f');
	});
});
