export const INFINITE_APPROVAL = 2n ** 255n;

/** Below this allowance (wei), prepare_subscribe includes an approve call. */
export const ALLOWANCE_THRESHOLD = 100_000_000_000_000_000_000_000n;

export const WRITE_PREPARE_PRICE = 0.02;
export const WRITE_READINESS_PRICE = 0.01;

export const DUEDAY_RANGES: Record<number, { start: number; stop: number }> = {
	0: { start: 1, stop: 7 },
	1: { start: 1, stop: 28 },
	2: { start: 1, stop: 90 },
	3: { start: 1, stop: 365 },
};

/** Multicall3 — used for batched remit-related getIdByTime reads. */
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

export const MULTICALL_CHUNK_SIZE = 100;

export const ZERO_SUBSCRIPTION_ID =
	`0x${'00'.repeat(32)}` as `0x${string}`;
