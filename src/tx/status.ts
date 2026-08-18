import type { Hash } from 'viem';
import { resolveChain, type ChainConfig } from '../chain.js';
import { createClocktowerClient } from '../client.js';

export async function getTransactionStatus(
	env: Env,
	txHash: Hash,
	chain: ChainConfig = resolveChain(env),
) {
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