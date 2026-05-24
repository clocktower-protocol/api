import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeCreateSubscription } from '../src/tx/encode.js';
import { storePrepareIntent } from '../src/tx/intent.js';
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

describe('submitSignedTransactions', () => {
	it('rejects when signed transaction count mismatches intent', async () => {
		const unsigned: UnsignedTransaction[] = [
			{
				from: account.address,
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
			},
		];

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
});
