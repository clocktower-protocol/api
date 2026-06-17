import { describe, expect, it } from 'vitest';
import {
	buildPrepareInstructions,
	buildReadinessInstructions,
	buildReadinessOnlyResult,
	finalizePrepareResult,
} from '../src/tx/prepare-response.js';
import { BASE_CHAIN_ID } from '../src/chain.js';

describe('prepare-response helpers', () => {
	it('buildPrepareInstructions covers EIP-5792 and status polling', () => {
		const steps = buildPrepareInstructions('eip5792', 2);
		expect(steps.some((s) => s.includes('EIP-5792'))).toBe(true);
		expect(steps.some((s) => s.includes('get_transaction_status'))).toBe(true);
		expect(steps.some((s) => s.includes('requestId'))).toBe(true);
	});

	it('finalizePrepareResult attaches requestId, instructions, and warnings', () => {
		const requestId = '11111111-1111-4111-8111-111111111111';
		const result = finalizePrepareResult(
			requestId,
			{
				chainId: BASE_CHAIN_ID,
				signingMode: 'raw',
				eip5792: {
					version: '1.0',
					chainId: '0x2105',
					from: '0x0000000000000000000000000000000000000001',
					calls: [],
				},
				unsignedTransactions: [],
				simulation: [{ success: true }],
				gasEstimates: [
					{
						chainId: BASE_CHAIN_ID,
						gasLimit: '200000',
						maxFeePerGas: '3000000',
						maxPriorityFeePerGas: '1000000',
						estimatedCostWei: '600000000000000',
						estimatedCostEth: '0.0006',
						source: 'simulated',
					},
				],
				preflight: { warnings: ['Queue may require 2 transactions'] },
			},
			{ warnings: ['Queue may require 2 transactions'] },
		);

		expect(result.requestId).toBe(requestId);
		expect(result.instructions.length).toBeGreaterThan(0);
		expect(result.warnings).toContain('Queue may require 2 transactions');
	});

	it('buildReadinessOnlyResult marks readiness-only responses', () => {
		const result = buildReadinessOnlyResult(
			'22222222-2222-4222-8222-222222222222',
			'prepare_subscribe',
			true,
			[],
			['low allowance'],
			{ needsApproval: true },
		);

		expect(result.readinessOnly).toBe(true);
		expect(result.ready).toBe(true);
		expect(result.operation).toBe('prepare_subscribe');
		expect(result.instructions).toEqual(buildReadinessInstructions('prepare_subscribe'));
	});
});