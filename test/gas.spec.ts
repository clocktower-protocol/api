import { describe, expect, it, vi } from 'vitest';
import { BASE_CHAIN_ID } from '../src/chain.js';
import { encodeApprove, encodeRemit } from '../src/tx/encode.js';
import {
	assertRpcChainId,
	buildGasSummary,
	buildRemitBacklogGasWarning,
	estimateGasForTransactions,
	type GasEstimatorClient,
} from '../src/tx/gas.js';
import type { UnsignedTransaction } from '../src/tx/types.js';

const FROM = '0x0000000000000000000000000000000000000001' as const;
const TO = '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f' as const;
const TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

function makeTx(data: `0x${string}`): UnsignedTransaction {
	return {
		to: TO,
		data,
		value: 0n,
		chainId: BASE_CHAIN_ID,
		from: FROM,
	};
}

function mockClient(overrides: Partial<GasEstimatorClient> = {}): GasEstimatorClient {
	return {
		getChainId: vi.fn(async () => BASE_CHAIN_ID),
		getBlock: vi.fn(async () => ({ baseFeePerGas: 1_000_000n })),
		estimateMaxPriorityFeePerGas: vi.fn(async () => 1_000_000n),
		estimateGas: vi.fn(async () => 150_000n),
		...overrides,
	};
}

describe('gas estimation', () => {
	it('assertRpcChainId rejects mismatched RPC chain', async () => {
		const client = mockClient({ getChainId: vi.fn(async () => 1) });
		await expect(assertRpcChainId(client, BASE_CHAIN_ID)).rejects.toThrow(/chainId mismatch/);
	});

	it('estimateGasForTransactions returns per-tx estimates on Base', async () => {
		const client = mockClient();
		const { estimates, warnings } = await estimateGasForTransactions(client, [
			makeTx(encodeRemit()),
		]);

		expect(estimates).toHaveLength(1);
		expect(estimates[0]?.chainId).toBe(BASE_CHAIN_ID);
		expect(estimates[0]?.source).toBe('simulated');
		expect(estimates[0]?.gasLimit).toBe('150000');
		expect(estimates[0]?.maxFeePerGas).toBeTruthy();
		expect(estimates[0]?.estimatedCostEth).toBeTruthy();
		expect(warnings).toHaveLength(0);
	});

	it('falls back to heuristic gas when estimateGas fails', async () => {
		const client = mockClient({
			estimateGas: vi.fn(async () => {
				throw new Error('reverted');
			}),
		});

		const { estimates, warnings } = await estimateGasForTransactions(client, [
			makeTx(encodeApprove(TO, 2n ** 256n - 1n)),
		]);

		expect(estimates[0]?.source).toBe('heuristic');
		expect(estimates[0]?.gasLimit).toBe('65000');
		expect(warnings.some((w) => w.includes('heuristic'))).toBe(true);
	});

	it('uses simulateFromAddress when provided', async () => {
		const simulateFrom = '0x00000000000000000000000000000000000000aa' as const;
		const estimateGas = vi.fn(async () => 120_000n);
		const client = mockClient({ estimateGas });

		await estimateGasForTransactions(client, [makeTx(encodeRemit())], {
			simulateFromAddress: simulateFrom,
		});

		expect(estimateGas).toHaveBeenCalledWith(
			expect.objectContaining({ account: simulateFrom }),
		);
	});

	it('buildGasSummary aggregates totals and backlog multiplier', () => {
		const estimates = [
			{
				chainId: BASE_CHAIN_ID,
				gasLimit: '100000',
				maxFeePerGas: '2000000',
				maxPriorityFeePerGas: '1000000',
				estimatedCostWei: '200000000000',
				estimatedCostEth: '0.0000002',
				source: 'simulated' as const,
			},
			{
				chainId: BASE_CHAIN_ID,
				gasLimit: '50000',
				maxFeePerGas: '2000000',
				maxPriorityFeePerGas: '1000000',
				estimatedCostWei: '100000000000',
				estimatedCostEth: '0.0000001',
				source: 'simulated' as const,
			},
		];

		const summary = buildGasSummary(estimates, { expectedTransactions: 3 });
		expect(summary.totalGasLimit).toBe('150000');
		expect(summary.totalEstimatedCostWei).toBe('300000000000');
		expect(summary.transactionCount).toBe(2);
		expect(summary.backlogMultiplier).toBe(3);
		expect(summary.totalBacklogEstimatedCostWei).toBe('900000000000');
	});

	it('buildRemitBacklogGasWarning describes multi-broadcast backlog', () => {
		const summary = buildGasSummary(
			[
				{
					chainId: BASE_CHAIN_ID,
					gasLimit: '500000',
					maxFeePerGas: '2000000',
					maxPriorityFeePerGas: '1000000',
					estimatedCostWei: '1000000000000',
					estimatedCostEth: '0.000001',
					source: 'simulated',
				},
			],
			{ expectedTransactions: 3 },
		);

		const warning = buildRemitBacklogGasWarning(3, summary);
		expect(warning).toMatch(/3 broadcasts/);
		expect(warning).toMatch(/8453/);
	});
});