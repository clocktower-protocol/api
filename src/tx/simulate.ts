import type { Address, Hex } from 'viem';
import type { SimulationResult, UnsignedTransaction } from './types.js';

/**
 * Minimal structural shape we depend on from a viem PublicClient. Accepting
 * the structural type rather than the full `PublicClient<Transport, Chain>`
 * sidesteps a viem generics quirk where a chain-narrowed client (e.g. one
 * built with `chain: base`) is not assignable to the generic `PublicClient`
 * because `getBlock`'s return type union widens on Base.
 *
 * We only call `client.call(...)` here, so encoding that single dependency
 * keeps type safety on the bit we actually use while staying agnostic to
 * which chain the caller's PublicClient was narrowed to.
 */
export type SimulatorClient = {
	call(args: {
		account: Address;
		to: Address;
		data: Hex;
		value: bigint;
	}): Promise<unknown>;
};

export async function simulateUnsignedTransactions(
	client: SimulatorClient,
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
