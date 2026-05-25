import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeCreateSubscription } from '../src/tx/encode.js';
import { loadPrepareIntent, storePrepareIntent } from '../src/tx/intent.js';
import { submitSignedTransactions } from '../src/tx/submit.js';
import type { UnsignedTransaction } from '../src/tx/types.js';
import { BASE_CHAIN_ID } from '../src/chain.js';

const testEnv = {
	...env,
	ALCHEMY_API_KEY: 'test-alchemy-key',
	ALCHEMY_URL: 'https://base-mainnet.g.alchemy.com/v2/',
	CLOCKTOWER_ADDRESS: '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
} as Env;

const account = privateKeyToAccount(
	'0xac0974bec39a17e36ba4a6b4d625e084ebb0ec8141cef9740b39c0e1f05fe630',
);

const otherAccount = privateKeyToAccount(
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);

function buildUnsigned(from: `0x${string}`): UnsignedTransaction {
	return {
		from,
		to: testEnv.CLOCKTOWER_ADDRESS as `0x${string}`,
		data: encodeCreateSubscription(
			1n,
			'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			{ url: '', description: '' },
			0,
			1,
		),
		value: 0n,
		chainId: BASE_CHAIN_ID,
	};
}

describe('submitSignedTransactions', () => {
	it('rejects when signed transaction count mismatches intent', async () => {
		const unsigned = [buildUnsigned(account.address)];
		const intent = await storePrepareIntent(testEnv, account.address, unsigned);

		await expect(
			submitSignedTransactions(testEnv, intent.prepareId, []),
		).rejects.toThrow(/Expected 1 signed/);
	});

	it('rejects expired or unknown prepareId', async () => {
		await expect(
			submitSignedTransactions(testEnv, crypto.randomUUID(), ['0x00']),
		).rejects.toThrow(/not found or expired/);
	});

	it('rejects when the recovered signer differs from intent.from', async () => {
		const unsigned = [buildUnsigned(account.address)];
		const intent = await storePrepareIntent(testEnv, account.address, unsigned);

		// Sign with a DIFFERENT key than intent.from. The previous implementation
		// could not detect this because parseTransaction does not populate from.
		const signed = await otherAccount.signTransaction({
			chainId: BASE_CHAIN_ID,
			to: unsigned[0].to,
			data: unsigned[0].data,
			value: 0n,
			nonce: 0,
			maxFeePerGas: 1_000_000_000n,
			maxPriorityFeePerGas: 1_000_000_000n,
			gas: 100_000n,
		});

		await expect(
			submitSignedTransactions(testEnv, intent.prepareId, [signed]),
		).rejects.toThrow(/signer does not match prepare intent/);

		// Critical: the intent must still exist so the legitimate signer can retry.
		const stillThere = await loadPrepareIntent(testEnv, intent.prepareId);
		expect(stillThere).not.toBeNull();
	});

	it('rejects when signed calldata does not match intent', async () => {
		const unsigned = [buildUnsigned(account.address)];
		const intent = await storePrepareIntent(testEnv, account.address, unsigned);

		// Sign DIFFERENT calldata than what's in the intent (substitute another
		// encoded createSubscription with different amount).
		const tamperedData = encodeCreateSubscription(
			99n,
			'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			{ url: '', description: '' },
			0,
			1,
		);
		const signed = await account.signTransaction({
			chainId: BASE_CHAIN_ID,
			to: unsigned[0].to,
			data: tamperedData,
			value: 0n,
			nonce: 0,
			maxFeePerGas: 1_000_000_000n,
			maxPriorityFeePerGas: 1_000_000_000n,
			gas: 100_000n,
		});

		await expect(
			submitSignedTransactions(testEnv, intent.prepareId, [signed]),
		).rejects.toThrow(/does not match prepare intent/);
	});

	it('rejects when chainId differs from intent', async () => {
		const unsigned = [buildUnsigned(account.address)];
		const intent = await storePrepareIntent(testEnv, account.address, unsigned);

		const signed = await account.signTransaction({
			chainId: 1, // Ethereum mainnet, not Base
			to: unsigned[0].to,
			data: unsigned[0].data,
			value: 0n,
			nonce: 0,
			maxFeePerGas: 1_000_000_000n,
			maxPriorityFeePerGas: 1_000_000_000n,
			gas: 100_000n,
		});

		await expect(
			submitSignedTransactions(testEnv, intent.prepareId, [signed]),
		).rejects.toThrow(/chainId/);
	});

	it('rejects malformed raw transactions without consuming the intent', async () => {
		const unsigned = [buildUnsigned(account.address)];
		const intent = await storePrepareIntent(testEnv, account.address, unsigned);

		await expect(
			submitSignedTransactions(testEnv, intent.prepareId, ['0xdeadbeef']),
		).rejects.toThrow();

		const stillThere = await loadPrepareIntent(testEnv, intent.prepareId);
		expect(stillThere).not.toBeNull();
	});

	it('passes signer + calldata validation, then fails on chain nonce check', async () => {
		// Mock fetch so getTransactionCount resolves; the test verifies the
		// signer recovery path actually runs and succeeds before nonce check.
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async () =>
			// nonce as bigint hex; we return 5 so the signed nonce=0 will be rejected.
			Response.json({ jsonrpc: '2.0', id: 1, result: '0x5' }),
		) as typeof fetch;

		try {
			const unsigned = [buildUnsigned(account.address)];
			const intent = await storePrepareIntent(testEnv, account.address, unsigned);

			const signed = await account.signTransaction({
				chainId: BASE_CHAIN_ID,
				to: unsigned[0].to,
				data: unsigned[0].data,
				value: 0n,
				nonce: 0,
				maxFeePerGas: 1_000_000_000n,
				maxPriorityFeePerGas: 1_000_000_000n,
				gas: 100_000n,
			});

			await expect(
				submitSignedTransactions(testEnv, intent.prepareId, [signed]),
			).rejects.toThrow(/Invalid nonce/);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('broadcasts successfully when signer, calldata, and nonce all validate', async () => {
		// Guards against regressing the C1 fix: covers the full happy path
		// through eth_sendRawTransaction. Mock returns matching nonce (0) for
		// getTransactionCount and a real-shaped tx hash for sendRawTransaction.
		const txHash =
			'0x1111111111111111111111111111111111111111111111111111111111111111';
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const body = typeof init?.body === 'string' ? init.body : '';
			const method = JSON.parse(body).method as string;
			if (method === 'eth_getTransactionCount') {
				return Response.json({ jsonrpc: '2.0', id: 1, result: '0x0' });
			}
			if (method === 'eth_sendRawTransaction') {
				return Response.json({ jsonrpc: '2.0', id: 1, result: txHash });
			}
			throw new Error(`unexpected rpc method: ${method}`);
		}) as typeof fetch;

		try {
			const unsigned = [buildUnsigned(account.address)];
			const intent = await storePrepareIntent(testEnv, account.address, unsigned);

			const signed = await account.signTransaction({
				chainId: BASE_CHAIN_ID,
				to: unsigned[0].to,
				data: unsigned[0].data,
				value: 0n,
				nonce: 0,
				maxFeePerGas: 1_000_000_000n,
				maxPriorityFeePerGas: 1_000_000_000n,
				gas: 100_000n,
			});

			const result = await submitSignedTransactions(testEnv, intent.prepareId, [signed]);

			expect(result.txHashes).toEqual([txHash]);
			// Intent must be consumed exactly once on the success path.
			const after = await loadPrepareIntent(testEnv, intent.prepareId);
			expect(after).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
