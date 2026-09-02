import { describe, expect, it } from 'vitest';
import { base } from 'viem/chains';
import {
	BASE_CAIP2,
	BASE_CHAIN_ID,
	UnsupportedChainError,
	getDefaultRestChainId,
	listChainCatalog,
	listMcpChainCatalog,
	parseChainIdParam,
	resolveChain,
	resolveMcpChain,
	resolveRestChain,
} from '../src/chain.js';
import { mcpChainIdSchema } from '../src/tools/mcpChain.js';
import { validateEnv } from '../src/validation.js';

const baseEnv = {
	ALCHEMY_API_KEY: 'test-key',
	ALCHEMY_URL: 'https://base-mainnet.g.alchemy.com/v2/',
	CLOCKTOWER_ADDRESS: '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
	CDP_API_KEY_ID: 'test-cdp-key-id',
	CDP_API_KEY_SECRET: 'test-cdp-key-secret',
	X402_RECIPIENT: '0x0000000000000000000000000000000000000001',
} as Env;

describe('parseChainIdParam', () => {
	it('accepts a decimal chain id', () => {
		expect(parseChainIdParam('8453')).toBe(BASE_CHAIN_ID);
		expect(parseChainIdParam(' 1 ')).toBe(1);
	});

	it('accepts CAIP-2 eip155:<id>', () => {
		expect(parseChainIdParam('eip155:8453')).toBe(BASE_CHAIN_ID);
		expect(parseChainIdParam('EIP155:1')).toBe(1);
	});

	it('rejects empty, hex, and malformed values', () => {
		expect(() => parseChainIdParam('')).toThrow(/chainId/);
		expect(() => parseChainIdParam('  ')).toThrow(/chainId/);
		expect(() => parseChainIdParam('0x2105')).toThrow(/chainId/);
		expect(() => parseChainIdParam('eip155:')).toThrow(/chainId/);
		expect(() => parseChainIdParam('solana:8453')).toThrow(/chainId/);
	});
});

describe('getDefaultRestChainId', () => {
	it('defaults to Base when unset or empty', () => {
		expect(getDefaultRestChainId(baseEnv)).toBe(BASE_CHAIN_ID);
		expect(getDefaultRestChainId({ ...baseEnv, DEFAULT_REST_CHAIN_ID: '' })).toBe(BASE_CHAIN_ID);
		expect(getDefaultRestChainId({ ...baseEnv, DEFAULT_REST_CHAIN_ID: '  ' })).toBe(BASE_CHAIN_ID);
	});

	it('accepts decimal and CAIP-2 env values', () => {
		expect(getDefaultRestChainId({ ...baseEnv, DEFAULT_REST_CHAIN_ID: '8453' })).toBe(
			BASE_CHAIN_ID,
		);
		expect(getDefaultRestChainId({ ...baseEnv, DEFAULT_REST_CHAIN_ID: 'eip155:8453' })).toBe(
			BASE_CHAIN_ID,
		);
	});
});

describe('resolveChain', () => {
	it('resolves Base mainnet config', () => {
		const chain = resolveChain(baseEnv);
		expect(chain.chainId).toBe(BASE_CHAIN_ID);
		expect(chain.caip2).toBe(BASE_CAIP2);
		expect(chain.name).toBe('base');
		expect(chain.viemChain).toBe(base);
		expect(chain.restEnabled).toBe(true);
		expect(chain.mcpEnabled).toBe(true);
		expect(chain.rpcUrl).toContain('test-key');
		expect(chain.contractAddress).toBe('0xFaF5fc2f77b21BC188f492b827D366B03a07c61f');
	});

	it('ignores DEFAULT_REST_CHAIN_ID even when it is an unregistered chain', () => {
		const chain = resolveChain({ ...baseEnv, DEFAULT_REST_CHAIN_ID: '1' });
		expect(chain.chainId).toBe(BASE_CHAIN_ID);
	});
});

describe('resolveRestChain', () => {
	it('uses the REST default when the query is omitted or empty', () => {
		expect(resolveRestChain(baseEnv).chainId).toBe(BASE_CHAIN_ID);
		expect(resolveRestChain(baseEnv, null).chainId).toBe(BASE_CHAIN_ID);
		expect(resolveRestChain(baseEnv, '').chainId).toBe(BASE_CHAIN_ID);
		expect(resolveRestChain({ ...baseEnv, DEFAULT_REST_CHAIN_ID: 'eip155:8453' }).chainId).toBe(
			BASE_CHAIN_ID,
		);
	});

	it('accepts decimal and CAIP-2 query values for Base', () => {
		expect(resolveRestChain(baseEnv, '8453').chainId).toBe(BASE_CHAIN_ID);
		expect(resolveRestChain(baseEnv, 'eip155:8453').caip2).toBe(BASE_CAIP2);
	});

	it('rejects unknown chains', () => {
		expect(() => resolveRestChain(baseEnv, '1')).toThrow(UnsupportedChainError);
		expect(() => resolveRestChain(baseEnv, 'eip155:1')).toThrow(/Unsupported chainId 1/);
	});
});

describe('resolveMcpChain', () => {
	it('defaults to Base when omitted or empty', () => {
		expect(resolveMcpChain(baseEnv).chainId).toBe(BASE_CHAIN_ID);
		expect(resolveMcpChain(baseEnv, null).chainId).toBe(BASE_CHAIN_ID);
		expect(resolveMcpChain(baseEnv, undefined).chainId).toBe(BASE_CHAIN_ID);
		expect(resolveMcpChain(baseEnv, '').chainId).toBe(BASE_CHAIN_ID);
		expect(resolveMcpChain(baseEnv, '  ').chainId).toBe(BASE_CHAIN_ID);
	});

	it('accepts decimal, CAIP-2, and numeric Base ids', () => {
		expect(resolveMcpChain(baseEnv, '8453').chainId).toBe(BASE_CHAIN_ID);
		expect(resolveMcpChain(baseEnv, 'eip155:8453').caip2).toBe(BASE_CAIP2);
		expect(resolveMcpChain(baseEnv, 8453).chainId).toBe(BASE_CHAIN_ID);
	});

	it('rejects unknown chains', () => {
		expect(() => resolveMcpChain(baseEnv, '1')).toThrow(UnsupportedChainError);
		expect(() => resolveMcpChain(baseEnv, 1)).toThrow(/Unsupported chainId 1/);
		expect(() => resolveMcpChain(baseEnv, 'eip155:1')).toThrow(/Unsupported chainId 1/);
	});

	it('rejects malformed chainId values', () => {
		expect(() => resolveMcpChain(baseEnv, 'not-a-chain')).toThrow(/chainId must/);
		expect(() => resolveMcpChain(baseEnv, '0x2105')).toThrow(/chainId must/);
	});

	it('does not follow DEFAULT_REST_CHAIN_ID', () => {
		expect(
			resolveMcpChain({ ...baseEnv, DEFAULT_REST_CHAIN_ID: '1' }).chainId,
		).toBe(BASE_CHAIN_ID);
	});
});

describe('mcpChainIdSchema', () => {
	it('accepts omitted, number, decimal string, and CAIP-2', () => {
		expect(mcpChainIdSchema.parse(undefined)).toBeUndefined();
		expect(mcpChainIdSchema.parse(8453)).toBe(8453);
		expect(mcpChainIdSchema.parse('8453')).toBe('8453');
		expect(mcpChainIdSchema.parse('eip155:8453')).toBe('eip155:8453');
	});

	it('rejects empty string, zero, and non-integers', () => {
		expect(() => mcpChainIdSchema.parse('')).toThrow();
		expect(() => mcpChainIdSchema.parse(0)).toThrow();
		expect(() => mcpChainIdSchema.parse(8453.5)).toThrow();
		expect(() => mcpChainIdSchema.parse({})).toThrow();
	});
});

describe('listChainCatalog', () => {
	it('marks Base as the REST default', () => {
		const catalog = listChainCatalog(baseEnv);
		expect(catalog).toEqual([
			{
				chainId: BASE_CHAIN_ID,
				caip2: BASE_CAIP2,
				name: 'base',
				rest: true,
				mcp: true,
				default: true,
			},
		]);
	});
});

describe('listMcpChainCatalog', () => {
	it('marks Base as the MCP default', () => {
		expect(listMcpChainCatalog()).toEqual([
			{
				chainId: BASE_CHAIN_ID,
				caip2: BASE_CAIP2,
				name: 'base',
				rest: true,
				mcp: true,
				default: true,
			},
		]);
	});
});

describe('validateEnv DEFAULT_REST_CHAIN_ID', () => {
	it('accepts unset, 8453, and eip155:8453', () => {
		expect(() => validateEnv(baseEnv)).not.toThrow();
		expect(() => validateEnv({ ...baseEnv, DEFAULT_REST_CHAIN_ID: '8453' })).not.toThrow();
		expect(() =>
			validateEnv({ ...baseEnv, DEFAULT_REST_CHAIN_ID: 'eip155:8453' }),
		).not.toThrow();
	});

	it('rejects an unregistered or malformed default', () => {
		expect(() => validateEnv({ ...baseEnv, DEFAULT_REST_CHAIN_ID: '1' })).toThrow(
			/DEFAULT_REST_CHAIN_ID/,
		);
		expect(() => validateEnv({ ...baseEnv, DEFAULT_REST_CHAIN_ID: 'not-a-chain' })).toThrow(
			/DEFAULT_REST_CHAIN_ID/,
		);
	});
});
