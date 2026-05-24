import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toFunctionSelector } from 'viem';
import { encodeCreateSubscription, encodeSubscribe, getFunctionSelector } from '../src/tx/encode.js';
import { prepareCreateSubscription } from '../src/tx/prepare.js';
import { PREPARE_KV_PREFIX } from '../src/tx/constants.js';

const testEnv = {
	...env,
	ALCHEMY_API_KEY: 'test-alchemy-key',
	ALCHEMY_URL: 'https://base-mainnet.g.alchemy.com/v2/',
	CLOCKTOWER_ADDRESS: '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
} as Env;

function encodeUint(value: bigint | number): string {
	return `0x${BigInt(value).toString(16).padStart(64, '0')}`;
}

function encodeBool(value: boolean): string {
	return value ? '0x0000000000000000000000000000000000000000000000000000000000000001' : encodeUint(0);
}

describe('tx encode', () => {
	it('encodeCreateSubscription produces known selector', () => {
		const data = encodeCreateSubscription(
			10n ** 18n,
			'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			{ url: 'https://example.com', description: 'desc' },
			1,
			15,
		);
		expect(getFunctionSelector(data)).toBe(
			toFunctionSelector(
				'createSubscription(uint256,address,(string,string),uint8,uint16)',
			),
		);
	});

	it('encodeSubscribe selector is stable', () => {
		const data = encodeSubscribe({
			id: `0x${'11'.repeat(32)}`,
			amount: 1n,
			provider: '0x0000000000000000000000000000000000000002',
			token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			cancelled: false,
			frequency: 1,
			dueDay: 1,
		});
		expect(getFunctionSelector(data)).toBe(
			toFunctionSelector(
				'subscribe((bytes32,uint256,address,address,bool,uint8,uint16))',
			),
		);
	});
});

describe('prepareCreateSubscription', () => {
	const originalFetch = globalThis.fetch;
	let callIndex = 0;

	beforeEach(() => {
		callIndex = 0;
		globalThis.fetch = vi.fn(async () => {
			const responses = [
				// approvedERC20: token, decimals, paused, minimum
				`0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913${encodeUint(6).slice(2)}${encodeBool(false).slice(2)}${encodeUint(0).slice(2)}`,
				// eth_call simulation
				'0x',
			];
			const result = responses[callIndex] ?? '0x';
			callIndex += 1;
			return Response.json({ jsonrpc: '2.0', id: 1, result });
		}) as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('returns prepareId and stores intent in KV', async () => {
		const from = '0x0000000000000000000000000000000000000001';
		const result = await prepareCreateSubscription(
			testEnv,
			from,
			10n ** 18n,
			'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			{ url: 'https://example.com', description: 'test' },
			1,
			15,
		);

		expect(result.prepareId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		expect(result.unsignedTransactions).toHaveLength(1);
		expect(result.eip5792.calls).toHaveLength(1);

		const stored = await testEnv.RATE_LIMIT.get(`${PREPARE_KV_PREFIX}${result.prepareId}`);
		expect(stored).not.toBeNull();
	});
});
