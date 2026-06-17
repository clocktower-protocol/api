import { formatEther } from 'viem';
import { BASE_CHAIN_ID } from '../chain.js';
import { getFunctionSelector } from './encode.js';
import type { GasEstimate, GasSummary, UnsignedTransaction } from './types.js';

/** Conservative per-selector gas limits when eth_estimateGas is unavailable. */
const HEURISTIC_GAS_BY_SELECTOR: Record<string, bigint> = {
	'0x095ea7b3': 65_000n, // ERC-20 approve
	'0x8e0625a9': 220_000n, // createSubscription (approximate)
	'0x5c5f6d7b': 180_000n, // subscribe
	'0x305a67a8': 120_000n, // cancelSubscription
	'0x066b2e8b': 120_000n, // unsubscribe
	'0x0e316ab0': 130_000n, // unsubscribeByProvider
	'0x2f8f3aa3': 110_000n, // editDetails
	'0x5f398a10': 500_000n, // remit() baseline
};

const DEFAULT_HEURISTIC_GAS = 200_000n;

const FEE_BUFFER_NUMERATOR = 2n;
const FEE_BUFFER_DENOMINATOR = 1n;

export type GasEstimatorClient = {
	getChainId(): Promise<number>;
	getBlock(args: { blockTag: 'latest' }): Promise<{
		baseFeePerGas: bigint | null;
	}>;
	estimateMaxPriorityFeePerGas(): Promise<bigint>;
	estimateGas(args: {
		account: `0x${string}`;
		to: `0x${string}`;
		data: `0x${string}`;
		value: bigint;
	}): Promise<bigint>;
};

export type EstimateGasOptions = {
	/** Account used for eth_estimateGas; defaults to each tx's `from`. */
	simulateFromAddress?: `0x${string}`;
};

export type EstimateGasResult = {
	estimates: GasEstimate[];
	warnings: string[];
};

export async function assertRpcChainId(client: GasEstimatorClient): Promise<void> {
	const rpcChainId = await client.getChainId();
	if (rpcChainId !== BASE_CHAIN_ID) {
		throw new Error(`RPC chainId mismatch: expected ${BASE_CHAIN_ID}, got ${rpcChainId}`);
	}
}

function assertTxChainId(tx: UnsignedTransaction): void {
	if (tx.chainId !== BASE_CHAIN_ID) {
		throw new Error(
			`Unsigned transaction chainId does not match Base mainnet (${BASE_CHAIN_ID})`,
		);
	}
}

function heuristicGasLimit(tx: UnsignedTransaction): bigint {
	try {
		const selector = getFunctionSelector(tx.data);
		return HEURISTIC_GAS_BY_SELECTOR[selector] ?? DEFAULT_HEURISTIC_GAS;
	} catch {
		return DEFAULT_HEURISTIC_GAS;
	}
}

async function resolveFeePerGas(client: GasEstimatorClient): Promise<{
	maxFeePerGas: bigint;
	maxPriorityFeePerGas: bigint;
}> {
	const [block, maxPriorityFeePerGas] = await Promise.all([
		client.getBlock({ blockTag: 'latest' }),
		client.estimateMaxPriorityFeePerGas().catch(() => 1_000_000n),
	]);

	const baseFee = block.baseFeePerGas ?? 1_000_000n;
	const maxFeePerGas =
		(baseFee * FEE_BUFFER_NUMERATOR) / FEE_BUFFER_DENOMINATOR + maxPriorityFeePerGas;

	return { maxFeePerGas, maxPriorityFeePerGas };
}

function buildGasEstimate(
	gasLimit: bigint,
	maxFeePerGas: bigint,
	maxPriorityFeePerGas: bigint,
	source: GasEstimate['source'],
): GasEstimate {
	const estimatedCostWei = gasLimit * maxFeePerGas;
	return {
		chainId: BASE_CHAIN_ID,
		gasLimit: gasLimit.toString(),
		maxFeePerGas: maxFeePerGas.toString(),
		maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
		estimatedCostWei: estimatedCostWei.toString(),
		estimatedCostEth: formatEther(estimatedCostWei),
		source,
	};
}

export async function estimateGasForTransactions(
	client: GasEstimatorClient,
	transactions: UnsignedTransaction[],
	options: EstimateGasOptions = {},
): Promise<EstimateGasResult> {
	await assertRpcChainId(client);

	const warnings: string[] = [];
	const { maxFeePerGas, maxPriorityFeePerGas } = await resolveFeePerGas(client);

	const estimates: GasEstimate[] = [];

	for (const tx of transactions) {
		assertTxChainId(tx);
		const account = options.simulateFromAddress ?? tx.from;

		try {
			const gasLimit = await client.estimateGas({
				account,
				to: tx.to,
				data: tx.data,
				value: tx.value,
			});
			estimates.push(
				buildGasEstimate(gasLimit, maxFeePerGas, maxPriorityFeePerGas, 'simulated'),
			);
		} catch {
			const gasLimit = heuristicGasLimit(tx);
			estimates.push(
				buildGasEstimate(gasLimit, maxFeePerGas, maxPriorityFeePerGas, 'heuristic'),
			);
			warnings.push(
				`Gas limit for transaction to ${tx.to} fell back to heuristic (${gasLimit}) after estimateGas failed.`,
			);
		}
	}

	return { estimates, warnings };
}

export function buildGasSummary(
	estimates: GasEstimate[],
	options?: {
		expectedTransactions?: number;
	},
): GasSummary {
	const totalGasLimit = estimates.reduce((sum, e) => sum + BigInt(e.gasLimit), 0n);
	const totalEstimatedCostWei = estimates.reduce(
		(sum, e) => sum + BigInt(e.estimatedCostWei),
		0n,
	);

	const summary: GasSummary = {
		chainId: BASE_CHAIN_ID,
		totalGasLimit: totalGasLimit.toString(),
		totalEstimatedCostWei: totalEstimatedCostWei.toString(),
		totalEstimatedCostEth: formatEther(totalEstimatedCostWei),
		transactionCount: estimates.length,
	};

	const expectedTransactions = options?.expectedTransactions ?? 1;
	if (expectedTransactions > 1) {
		summary.backlogMultiplier = expectedTransactions;
		summary.totalBacklogEstimatedCostWei = (
			totalEstimatedCostWei * BigInt(expectedTransactions)
		).toString();
		summary.totalBacklogEstimatedCostEth = formatEther(
			totalEstimatedCostWei * BigInt(expectedTransactions),
		);
	}

	return summary;
}

export function buildRemitBacklogGasWarning(expectedTransactions: number, gasSummary: GasSummary): string | null {
	if (expectedTransactions <= 1 || !gasSummary.totalBacklogEstimatedCostEth) {
		return null;
	}
	return (
		`Remit backlog may require ${expectedTransactions} broadcasts; estimated total gas budget ` +
		`~${gasSummary.totalBacklogEstimatedCostEth} ETH on Base (chainId ${BASE_CHAIN_ID}) if each remit costs similarly.`
	);
}