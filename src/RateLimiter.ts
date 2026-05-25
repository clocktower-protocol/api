import { DurableObject } from 'cloudflare:workers';

/**
 * Strongly-consistent fixed-window rate limiter backed by Durable Object
 * storage. Each DO instance is single-threaded for storage operations, so
 * read-modify-write counter updates are atomic and not subject to the
 * eventual-consistency races that affected the previous KV-based limiter.
 *
 * Instances are sharded by id (caller-chosen, e.g. IP or address) so each
 * key gets its own DO and they scale horizontally.
 */

export const RATE_LIMITER_WINDOW_MS = 60_000;

export type RateLimitCheckRequest = {
	limit: number;
	windowMs?: number;
	now?: number;
};

export type RateLimitCheckResponse = {
	ok: boolean;
	current: number;
	limit: number;
	resetMs: number;
};

export class RateLimiter extends DurableObject {
	async check(req: RateLimitCheckRequest): Promise<RateLimitCheckResponse> {
		const limit = req.limit;
		const windowMs = req.windowMs ?? RATE_LIMITER_WINDOW_MS;
		const now = req.now ?? Date.now();
		const windowKey = Math.floor(now / windowMs);
		const key = `w:${windowKey}`;

		// state.storage operations are serialized via the DO input gate, but use
		// an explicit transaction for clarity and so a future caller doing
		// multi-key updates inherits atomic-block semantics.
		const result = await this.ctx.storage.transaction(async (txn) => {
			const current = (await txn.get<number>(key)) ?? 0;
			if (current >= limit) {
				return { ok: false, current };
			}
			await txn.put(key, current + 1);
			return { ok: true, current: current + 1 };
		});

		const resetMs = (windowKey + 1) * windowMs - now;
		return { ok: result.ok, current: result.current, limit, resetMs };
	}
}

/**
 * Helper to call the DO. Callers pass a stable key (e.g. IP, address) which
 * picks the DO instance via idFromName. Different keys hit independent DOs,
 * so a hot key cannot starve unrelated limiters.
 */
export async function checkRateLimit(
	namespace: DurableObjectNamespace,
	key: string,
	limit: number,
	windowMs: number = RATE_LIMITER_WINDOW_MS,
): Promise<RateLimitCheckResponse> {
	const id = namespace.idFromName(key);
	const stub = namespace.get(id) as unknown as RateLimiter;
	return stub.check({ limit, windowMs });
}
