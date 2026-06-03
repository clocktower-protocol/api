import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import { createClocktowerClient } from '../client.js';
import {
	dayNumberToDayjs,
	FREQUENCY_TYPES,
	getDueDay,
} from '../utils.js';
import {
	MULTICALL3_ADDRESS,
	MULTICALL_CHUNK_SIZE,
	ZERO_SUBSCRIPTION_ID,
} from './constants.js';

type ClocktowerClient = ReturnType<typeof createClocktowerClient>;

export type GetIdByTimeCall = {
	frequency: number;
	dueDay: number;
};

export type DayFrequencyProbe = {
	frequency: number;
	dueDay?: number;
	skipped: boolean;
	skipReason?: string;
};

const ALL_FREQUENCIES = [
	FREQUENCY_TYPES.WEEKLY,
	FREQUENCY_TYPES.MONTHLY,
	FREQUENCY_TYPES.QUARTERLY,
	FREQUENCY_TYPES.YEARLY,
];

export function buildDayFrequencyProbes(
	dayNumber: number,
	frequencies: number[] = ALL_FREQUENCIES,
): DayFrequencyProbe[] {
	const day = dayNumberToDayjs(dayNumber);

	return frequencies.map((frequency) => {
		const dueDayInfo = getDueDay(frequency, day);
		return {
			frequency,
			dueDay: dueDayInfo.dueDay,
			skipped: dueDayInfo.shouldSkip,
			skipReason: dueDayInfo.skipReason,
		};
	});
}

export function buildGetIdByTimeCalls(
	nextUncheckedDay: number,
	currentDay: number,
): GetIdByTimeCall[] {
	const calls: GetIdByTimeCall[] = [];

	for (let dayNumber = nextUncheckedDay; dayNumber <= currentDay; dayNumber++) {
		for (const probe of buildDayFrequencyProbes(dayNumber)) {
			if (probe.skipped || probe.dueDay === undefined) {
				continue;
			}
			calls.push({ frequency: probe.frequency, dueDay: probe.dueDay });
		}
	}

	return calls;
}

function countNonZeroIds(ids: readonly `0x${string}`[]): number {
	let count = 0;
	for (const id of ids) {
		if (id !== ZERO_SUBSCRIPTION_ID) {
			count++;
		}
	}
	return count;
}

export async function multicallGetIdByTime(
	client: ClocktowerClient,
	contractAddress: `0x${string}`,
	calls: GetIdByTimeCall[],
): Promise<`0x${string}`[][]> {
	if (calls.length === 0) {
		return [];
	}

	const contracts = calls.map((call) => ({
		address: contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'getIdByTime' as const,
		args: [BigInt(call.frequency), call.dueDay] as const,
	}));

	const allResults: `0x${string}`[][] = [];

	for (let offset = 0; offset < contracts.length; offset += MULTICALL_CHUNK_SIZE) {
		const chunk = contracts.slice(offset, offset + MULTICALL_CHUNK_SIZE);
		const results = await client.multicall({
			contracts: chunk,
			allowFailure: true,
			multicallAddress: MULTICALL3_ADDRESS,
		});

		for (const item of results) {
			if (item.status === 'success' && item.result) {
				allResults.push(item.result as `0x${string}`[]);
			} else {
				allResults.push([]);
			}
		}
	}

	return allResults;
}

export async function fetchGetIdByTimeForDay(
	client: ClocktowerClient,
	contractAddress: `0x${string}`,
	dayNumber: number,
	frequencies: number[] = ALL_FREQUENCIES,
): Promise<Map<number, `0x${string}`[]>> {
	const probes = buildDayFrequencyProbes(dayNumber, frequencies);
	const activeCalls: GetIdByTimeCall[] = [];

	for (const probe of probes) {
		if (!probe.skipped && probe.dueDay !== undefined) {
			activeCalls.push({ frequency: probe.frequency, dueDay: probe.dueDay });
		}
	}

	const results = await multicallGetIdByTime(client, contractAddress, activeCalls);
	const byFrequency = new Map<number, `0x${string}`[]>();

	let resultIndex = 0;
	for (const probe of probes) {
		if (probe.skipped || probe.dueDay === undefined) {
			continue;
		}
		byFrequency.set(probe.frequency, results[resultIndex] ?? []);
		resultIndex++;
	}

	return byFrequency;
}

export async function scanDueSubscriptionIds(
	client: ClocktowerClient,
	contractAddress: `0x${string}`,
	nextUncheckedDay: number,
	currentDay: number,
): Promise<number> {
	const calls = buildGetIdByTimeCalls(nextUncheckedDay, currentDay);
	if (calls.length === 0) {
		return 0;
	}

	const results = await multicallGetIdByTime(client, contractAddress, calls);
	let totalSubscriptions = 0;

	for (const ids of results) {
		totalSubscriptions += countNonZeroIds(ids);
	}

	return totalSubscriptions;
}
