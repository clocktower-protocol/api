export const INFINITE_APPROVAL = 2n ** 255n;

/** Below this allowance (wei), prepare_subscribe includes an approve call. */
export const ALLOWANCE_THRESHOLD = 100_000_000_000_000_000_000_000n;

export const DEFAULT_PREPARE_INTENT_TTL_SECONDS = 900;

export const WRITE_PREPARE_PRICE = 0.02;
export const WRITE_SUBMIT_PRICE = 0.02;
export const WRITE_READINESS_PRICE = 0.01;

export const PREPARE_KV_PREFIX = 'prep:';

export const DUEDAY_RANGES: Record<number, { start: number; stop: number }> = {
	0: { start: 1, stop: 7 },
	1: { start: 1, stop: 28 },
	2: { start: 1, stop: 90 },
	3: { start: 1, stop: 365 },
};
