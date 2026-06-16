import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTransactionStatus } from '../src/tx/status.js';

const testEnv = {
	...env,
	ALCHEMY_API_KEY: 'test-alchemy-key',
	ALCHEMY_URL: 'https://base-mainnet.g.alchemy.com/v2/',
	CLOCKTOWER_ADDRESS: '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
} as Env;

const TX_HASH =
	'0x1111111111111111111111111111111111111111111111111111111111111111' as const;

describe('getTransactionStatus', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('returns confirmed receipt when eth_getTransactionReceipt succeeds', async () => {
		globalThis.fetch = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body));
			if (body.method === 'eth_getTransactionReceipt') {
				return Response.json({
					jsonrpc: '2.0',
					id: 1,
					result: {
						status: '0x1',
						blockNumber: '0x64',
						transactionHash: TX_HASH,
					},
				});
			}
			throw new Error(`unexpected method: ${body.method}`);
		}) as typeof fetch;

		const result = await getTransactionStatus(testEnv, TX_HASH);
		expect(result).toMatchObject({
			status: 'success',
			blockNumber: '100',
			transactionHash: TX_HASH,
			confirmed: true,
		});
	});

	it('returns pending when receipt is missing but tx is in mempool', async () => {
		globalThis.fetch = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body));
			if (body.method === 'eth_getTransactionReceipt') {
				return Response.json({ jsonrpc: '2.0', id: 1, result: null });
			}
			if (body.method === 'eth_getTransactionByHash') {
				return Response.json({
					jsonrpc: '2.0',
					id: 1,
					result: { hash: TX_HASH },
				});
			}
			throw new Error(`unexpected method: ${body.method}`);
		}) as typeof fetch;

		const result = await getTransactionStatus(testEnv, TX_HASH);
		expect(result).toMatchObject({
			status: 'pending',
			transactionHash: TX_HASH,
			confirmed: false,
		});
	});
});