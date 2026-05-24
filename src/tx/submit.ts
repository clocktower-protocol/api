import { parseTransaction, type Hash } from 'viem';
import { resolveChain } from '../chain.js';
import { createClocktowerClient } from '../client.js';
import { enforceWriteRateLimitForAddress } from '../rateLimit.js';
import { consumePrepareIntent } from './intent.js';
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
	const intent = await consumePrepareIntent(env, prepareId);
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

	const parsed = signedTransactions.map((serialized) => {
		const tx = parseTransaction(serialized);
		if (!tx.from) {
			throw new Error('Signed transaction missing from address');
		}
		if (tx.from.toLowerCase() !== intent.from.toLowerCase()) {
			throw new Error('Signed transaction from address does not match prepare intent');
		}
		if (tx.chainId !== undefined && Number(tx.chainId) !== intent.chainId) {
			throw new Error('Signed transaction chainId does not match prepare intent');
		}
		return tx;
	});

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
		if (nonce !== expectedNonce + BigInt(i)) {
			throw new Error(
				`Invalid nonce for transaction ${i}: expected ${expectedNonce + BigInt(i)}, got ${nonce}`,
			);
		}
	}

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
