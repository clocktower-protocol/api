import { describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import {
	buildDayFrequencyProbes,
	buildGetIdByTimeCalls,
	multicallGetIdByTime,
	scanDueSubscriptionIds,
} from '../src/tx/remit-scan.js';
import { FREQUENCY_TYPES, getDueDay } from '../src/utils.js';
import { ZERO_SUBSCRIPTION_ID } from '../src/tx/constants.js';

dayjs.extend(utc);

describe('remit-scan helpers', () => {
	it('getDueDay skips monthly days after the 28th', () => {
		const day = dayjs.utc('2024-01-29');
		const result = getDueDay(FREQUENCY_TYPES.MONTHLY, day);
		expect(result.shouldSkip).toBe(true);
		expect(result.skipReason).toMatch(/exceeds limit of 28/);
	});

	it('getDueDay maps weekly frequency to ISO weekday (Sunday = 7)', () => {
		const sunday = dayjs.utc('2024-01-07');
		expect(getDueDay(FREQUENCY_TYPES.WEEKLY, sunday).dueDay).toBe(7);
	});

	it('buildDayFrequencyProbes returns four frequencies by default', () => {
		const probes = buildDayFrequencyProbes(20_000);
		expect(probes).toHaveLength(4);
	});

	it('buildGetIdByTimeCalls aggregates a multi-day window', () => {
		const calls = buildGetIdByTimeCalls(100, 101);
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.every((c) => c.frequency >= 0 && c.frequency <= 3)).toBe(true);
	});

	it('multicallGetIdByTime counts non-zero subscription ids', async () => {
		const nonZero = `0x${'11'.repeat(32)}` as `0x${string}`;
		const client = {
			multicall: vi.fn().mockResolvedValue([
				{ status: 'success', result: [nonZero, ZERO_SUBSCRIPTION_ID] },
			]),
		};

		const results = await multicallGetIdByTime(
			client as never,
			'0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
			[{ frequency: 0, dueDay: 1 }],
		);

		expect(results).toHaveLength(1);
		expect(results[0]).toEqual([nonZero, ZERO_SUBSCRIPTION_ID]);
	});

	it('scanDueSubscriptionIds sums ids across batched calls', async () => {
		const nonZero = `0x${'22'.repeat(32)}` as `0x${string}`;
		const client = {
			multicall: vi.fn().mockImplementation(async ({ contracts }) =>
				contracts.map((_: unknown, index: number) => ({
					status: 'success' as const,
					result: index === 0 ? [nonZero] : [ZERO_SUBSCRIPTION_ID, nonZero],
				})),
			),
		};

		const total = await scanDueSubscriptionIds(
			client as never,
			'0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
			100,
			101,
		);

		expect(total).toBeGreaterThan(0);
	});
});
