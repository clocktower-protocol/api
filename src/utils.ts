import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { formatUnits } from 'viem';

dayjs.extend(utc);

export const PROTOCOL_DECIMALS = 18;

export const FREQUENCY_TYPES = {
	WEEKLY: 0,
	MONTHLY: 1,
	QUARTERLY: 2,
	YEARLY: 3,
} as const;

export const STATUS_TYPES = {
	ACTIVE: 0,
	CANCELLED: 1,
	UNSUBSCRIBED: 2,
} as const;

export const SUBSCRIPT_EVENT_TYPES = {
	CREATE: 0,
	CANCEL: 1,
	PROVPAID: 2,
	FAILED: 3,
	PROVREFUND: 4,
	SUBPAID: 5,
	SUBSCRIBED: 6,
	UNSUBSCRIBED: 7,
	FEEFILL: 8,
	SUBREFUND: 9,
} as const;

const FREQUENCY_LABELS: Record<number, string> = {
	[FREQUENCY_TYPES.WEEKLY]: 'WEEKLY',
	[FREQUENCY_TYPES.MONTHLY]: 'MONTHLY',
	[FREQUENCY_TYPES.QUARTERLY]: 'QUARTERLY',
	[FREQUENCY_TYPES.YEARLY]: 'YEARLY',
};

const STATUS_LABELS: Record<number, string> = {
	[STATUS_TYPES.ACTIVE]: 'ACTIVE',
	[STATUS_TYPES.CANCELLED]: 'CANCELLED',
	[STATUS_TYPES.UNSUBSCRIBED]: 'UNSUBSCRIBED',
};

const SUBSCRIPT_EVENT_LABELS: Record<number, string> = {
	[SUBSCRIPT_EVENT_TYPES.CREATE]: 'CREATE',
	[SUBSCRIPT_EVENT_TYPES.CANCEL]: 'CANCEL',
	[SUBSCRIPT_EVENT_TYPES.PROVPAID]: 'PROVPAID',
	[SUBSCRIPT_EVENT_TYPES.FAILED]: 'FAILED',
	[SUBSCRIPT_EVENT_TYPES.PROVREFUND]: 'PROVREFUND',
	[SUBSCRIPT_EVENT_TYPES.SUBPAID]: 'SUBPAID',
	[SUBSCRIPT_EVENT_TYPES.SUBSCRIBED]: 'SUBSCRIBED',
	[SUBSCRIPT_EVENT_TYPES.UNSUBSCRIBED]: 'UNSUBSCRIBED',
	[SUBSCRIPT_EVENT_TYPES.FEEFILL]: 'FEEFILL',
	[SUBSCRIPT_EVENT_TYPES.SUBREFUND]: 'SUBREFUND',
};

export function getFrequencyLabel(frequency: number | bigint): string {
	return FREQUENCY_LABELS[Number(frequency)] ?? 'UNKNOWN';
}

export function getStatusLabel(status: number | bigint): string {
	return STATUS_LABELS[Number(status)] ?? 'UNKNOWN';
}

export function getSubscriptEventLabel(event: number | bigint): string {
	return SUBSCRIPT_EVENT_LABELS[Number(event)] ?? 'UNKNOWN';
}

export function convertProtocolAmountToTokenNative(amount: bigint, tokenDecimals: number): bigint {
	if (tokenDecimals > PROTOCOL_DECIMALS) {
		return amount * 10n ** BigInt(tokenDecimals - PROTOCOL_DECIMALS);
	}

	if (tokenDecimals < PROTOCOL_DECIMALS) {
		return amount / 10n ** BigInt(PROTOCOL_DECIMALS - tokenDecimals);
	}

	return amount;
}

export function formatProtocolStoredAmount(protocolAmount: bigint, tokenDecimals: number) {
	const amountRaw = convertProtocolAmountToTokenNative(protocolAmount, tokenDecimals);

	return {
		amount: formatUnits(amountRaw, tokenDecimals),
		amountRaw,
		tokenDecimals,
	};
}

export function getCurrentDay(): number {
	return Math.floor(Date.now() / 1000 / 86400);
}

export function dayNumberToDayjs(dayNumber: number) {
	return dayjs.utc(dayNumber * 86400 * 1000);
}

function getDayOfWeek(day: dayjs.Dayjs): number {
	return day.day() === 0 ? 7 : day.day();
}

function getDayOfMonth(day: dayjs.Dayjs): number {
	return day.date();
}

function getDayOfQuarter(day: dayjs.Dayjs): number {
	const month = day.month();
	const quarter = Math.floor(month / 3);
	const quarterStartMonth = quarter * 3;
	const quarterStart = dayjs.utc().year(day.year()).month(quarterStartMonth).date(1);
	return day.diff(quarterStart, 'day') + 1;
}

function getDayOfYear(day: dayjs.Dayjs): number {
	return day.diff(day.startOf('year'), 'day') + 1;
}

export interface DueDayResult {
	dueDay?: number;
	shouldSkip: boolean;
	skipReason?: string;
}

export function getDueDay(frequency: number, day: dayjs.Dayjs): DueDayResult {
	let dueDay: number | undefined;
	let shouldSkip = false;
	let skipReason: string | undefined;

	switch (frequency) {
		case FREQUENCY_TYPES.WEEKLY:
			dueDay = getDayOfWeek(day);
			break;
		case FREQUENCY_TYPES.MONTHLY: {
			const dayOfMonth = getDayOfMonth(day);
			if (dayOfMonth > 28) {
				shouldSkip = true;
				skipReason = `Day of month (${dayOfMonth}) exceeds limit of 28`;
			} else {
				dueDay = dayOfMonth;
			}
			break;
		}
		case FREQUENCY_TYPES.QUARTERLY: {
			const dayOfQuarter = getDayOfQuarter(day);
			if (dayOfQuarter <= 0 || dayOfQuarter > 90) {
				shouldSkip = true;
				skipReason = `Day of quarter (${dayOfQuarter}) is invalid or exceeds limit of 90`;
			} else {
				dueDay = dayOfQuarter;
			}
			break;
		}
		case FREQUENCY_TYPES.YEARLY: {
			const dayOfYear = getDayOfYear(day);
			if (dayOfYear <= 0 || dayOfYear > 365) {
				shouldSkip = true;
				skipReason = `Day of year (${dayOfYear}) is invalid or exceeds limit of 365`;
			} else {
				dueDay = dayOfYear;
			}
			break;
		}
		default:
			shouldSkip = true;
			skipReason = `Unknown frequency: ${frequency}`;
	}

	return { dueDay, shouldSkip, skipReason };
}

export function serializeJson(value: unknown): string {
	return JSON.stringify(value, (_, current) => (typeof current === 'bigint' ? current.toString() : current), 2);
}

export function textResult(value: unknown) {
	return {
		content: [{ type: 'text' as const, text: serializeJson(value) }],
	};
}
