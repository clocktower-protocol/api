import { describe, expect, it } from 'vitest';
import { resolveChain, SUPPORTED_CHAIN_IDS } from '../src/chain.js';

describe('resolveChain', () => {
	const env = {
		ALCHEMY_API_KEY: 'test-key',
		ALCHEMY_URL_BASE: 'https://base-mainnet.g.alchemy.com/v2/',
		ALCHEMY_URL_SEPOLIA_BASE: 'https://base-sepolia.g.alchemy.com/v2/',
		CLOCKTOWER_ADDRESS_BASE: '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
		CLOCKTOWER_ADDRESS_SEPOLIA_BASE: '0x6A0791Cd884f2199dC8F372f6715f675D2950922',
	} as Env;

	it('supports Base mainnet and Base Sepolia', () => {
		expect(SUPPORTED_CHAIN_IDS).toEqual([8453, 84532]);
	});

	it('resolves Base mainnet config', () => {
		const chain = resolveChain(env, 8453);
		expect(chain.chainId).toBe(8453);
		expect(chain.rpcUrl).toContain('test-key');
		expect(chain.contractAddress).toBe('0xFaF5fc2f77b21BC188f492b827D366B03a07c61f');
	});

	it('resolves Base Sepolia config', () => {
		const chain = resolveChain(env, 84532);
		expect(chain.chainId).toBe(84532);
		expect(chain.rpcUrl).toContain('base-sepolia');
	});

	it('rejects unsupported chains', () => {
		expect(() => resolveChain(env, 1)).toThrow('Unsupported chainId');
	});
});
