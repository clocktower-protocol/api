import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

export const FREQUENCY_TYPES = {
	WEEKLY: 0,
	MONTHLY: 1,
	QUARTERLY: 2,
	YEARLY: 3,
} as const;

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
