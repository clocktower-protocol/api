import {
	parseTransaction,
	recoverTransactionAddress,
	type Hash,
	type TransactionSerialized,
} from 'viem';
import { resolveChain } from '../chain.js';
import { createClocktowerClient } from '../client.js';
import { enforceWriteRateLimitForAddress } from '../rateLimit.js';
import { deletePrepareIntent, loadPrepareIntent } from './intent.js';
import type { IntentTransaction } from './types.js';

function normalizeValue(value: bigint): string {
	return value.toString();
}

function intentMatchesSigned(intentTx: IntentTransaction, signed: ReturnType<typeof parseTransaction>): boolean {
	if (signed.to?.toLowerCase() !== intentTx.to.toLowerCase()) {
		return false;
	}
	const signedData = signed.data ?? '0x';
	if (signedData.toLowerCase() !== intentTx.data.toLowerCase()) {
		return false;
	}
	if (normalizeValue(signed.value ?? 0n) !== intentTx.value) {
		return false;
	}
	return true;
}

export async function submitSignedTransactions(
	env: Env,
	prepareId: string,
	signedTransactions: `0x${string}`[],
): Promise<{ txHashes: Hash[] }> {
	// Load (don't consume) the intent first so we can validate before destroying it.
	// This avoids losing the user's paid prepare intent when rate limit / validation
	// rejects the submission.
	const intent = await loadPrepareIntent(env, prepareId);
	if (!intent) {
		throw new Error('Prepare intent not found or expired');
	}

	await enforceWriteRateLimitForAddress(env, intent.from);

	if (signedTransactions.length !== intent.transactions.length) {
		throw new Error(
			`Expected ${intent.transactions.length} signed transaction(s), got ${signedTransactions.length}`,
		);
	}

	const chain = resolveChain(env);
	const client = createClocktowerClient(chain);

	// Parse each signed transaction and recover its signer.
	// viem's parseTransaction does NOT populate `from`; we MUST recover it
	// cryptographically from the signature.
	const parsed = await Promise.all(
		signedTransactions.map(async (serialized) => {
			const tx = parseTransaction(serialized);
			const signer = await recoverTransactionAddress({
				serializedTransaction: serialized as TransactionSerialized,
			});
			if (signer.toLowerCase() !== intent.from.toLowerCase()) {
				throw new Error('Signed transaction signer does not match prepare intent');
			}
			if (tx.chainId !== undefined && Number(tx.chainId) !== intent.chainId) {
				throw new Error('Signed transaction chainId does not match prepare intent');
			}
			return tx;
		}),
	);

	for (let i = 0; i < intent.transactions.length; i++) {
		if (!intentMatchesSigned(intent.transactions[i], parsed[i])) {
			throw new Error(`Signed transaction ${i} does not match prepare intent`);
		}
	}

	const expectedNonce = await client.getTransactionCount({
		address: intent.from,
		blockTag: 'pending',
	});

	for (let i = 0; i < parsed.length; i++) {
		const nonce = parsed[i].nonce;
		if (nonce === undefined) {
			throw new Error(`Signed transaction ${i} missing nonce`);
		}
		if (BigInt(nonce) !== BigInt(expectedNonce) + BigInt(i)) {
			throw new Error(
				`Invalid nonce for transaction ${i}: expected ${BigInt(expectedNonce) + BigInt(i)}, got ${nonce}`,
			);
		}
	}

	// Only consume the intent after all validation passes. If broadcast fails
	// midway, the consumed intent is gone (acceptable: the first hash is on-chain).
	await deletePrepareIntent(env, prepareId);

	const txHashes: Hash[] = [];
	for (const serialized of signedTransactions) {
		const hash = await client.sendRawTransaction({ serializedTransaction: serialized });
		txHashes.push(hash);
	}

	return { txHashes };
}

export async function getTransactionStatus(env: Env, txHash: Hash) {
	const chain = resolveChain(env);
	const client = createClocktowerClient(chain);

	try {
		const receipt = await client.getTransactionReceipt({ hash: txHash });
		return {
			status: receipt.status,
			blockNumber: receipt.blockNumber.toString(),
			transactionHash: receipt.transactionHash,
			confirmed: true,
		};
	} catch {
		const pending = await client.getTransaction({ hash: txHash }).catch(() => null);
		if (pending) {
			return {
				status: 'pending',
				transactionHash: txHash,
				confirmed: false,
			};
		}
		return {
			status: 'unknown',
			transactionHash: txHash,
			confirmed: false,
		};
	}
}
