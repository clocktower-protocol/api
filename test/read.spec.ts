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
				encodeUint(12345), // nextUncheckedDay
				encodeUint(10500), // callerFee
				encodeUint(200), // systemFee
				encodeUint(50), // maxRemits
				encodeUint(10), // cancelLimit
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
		expect(state.nextUncheckedDay).toBe(12345);
		expect(state.callerFee).toBe(10500n);
		expect(state.systemFee).toBe(200n);
		expect(state.maxRemits).toBe(50n);
		expect(state.cancelLimit).toBe(10n);
		expect(globalThis.fetch).toHaveBeenCalledTimes(5);
	});
});
