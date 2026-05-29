import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_CHAIN_ID } from '../src/chain.js';
import { getProtocolState } from '../src/tools/read.js';

const env = {
	ALCHEMY_API_KEY: 'test-alchemy-key',
	ALCHEMY_URL: 'https://base-mainnet.g.alchemy.com/v2/',
	CLOCKTOWER_ADDRESS: '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
} as Env;

function encodeUint(value: bigint | number): string {
	return `0x${BigInt(value).toString(16).padStart(64, '0')}`;
}

describe('getProtocolState', () => {
	const originalFetch = globalThis.fetch;
	let callCount = 0;

	beforeEach(() => {
		callCount = 0;
		globalThis.fetch = vi.fn(async () => {
			const results = [
				encodeUint(10500), // callerFee bps → 5% above baseline (10000)
				encodeUint(10100), // systemFee bps → 1% of caller fee
			];

			const result = results[callCount] ?? encodeUint(0);
			callCount += 1;

			return Response.json({
				jsonrpc: '2.0',
				id: 1,
				result,
			});
		}) as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('returns protocol state from mocked RPC calls', async () => {
		const state = await getProtocolState(env);

		expect(state.chainId).toBe(BASE_CHAIN_ID);
		expect(state.callerFeePercent).toBe(5);
		expect(state.systemFeePercent).toBe(1);
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});
});
