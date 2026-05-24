import type { PublicClient } from 'viem';
import type { SimulationResult, UnsignedTransaction } from './types.js';

export async function simulateUnsignedTransactions(
	client: PublicClient,
	transactions: UnsignedTransaction[],
): Promise<SimulationResult[]> {
	return Promise.all(
		transactions.map(async (tx) => {
			try {
				await client.call({
					account: tx.from,
					to: tx.to,
					data: tx.data,
					value: tx.value,
				});
				return { success: true };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}),
	);
}
