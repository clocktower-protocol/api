import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { checkRateLimit, RATE_LIMITER_WINDOW_MS, type RateLimiter } from '../src/RateLimiter.js';

const testEnv = env as Env;

function getStub(key: string): RateLimiter {
	const id = testEnv.RATE_LIMITER.idFromName(key);
	return testEnv.RATE_LIMITER.get(id) as unknown as RateLimiter;
}

describe('RateLimiter (Durable Object)', () => {
	it('allows the first N requests then blocks', async () => {
		const key = `t1:${crypto.randomUUID()}`;
		const limit = 3;

		for (let i = 0; i < limit; i += 1) {
			const r = await checkRateLimit(testEnv.RATE_LIMITER, key, limit);
			expect(r.ok).toBe(true);
			expect(r.current).toBe(i + 1);
		}

		const blocked = await checkRateLimit(testEnv.RATE_LIMITER, key, limit);
		expect(blocked.ok).toBe(false);
		expect(blocked.current).toBe(limit);
	});

	it('isolates buckets per key', async () => {
		const a = `t2a:${crypto.randomUUID()}`;
		const b = `t2b:${crypto.randomUUID()}`;
		const limit = 2;

		const r1 = await checkRateLimit(testEnv.RATE_LIMITER, a, limit);
		const r2 = await checkRateLimit(testEnv.RATE_LIMITER, a, limit);
		const r3 = await checkRateLimit(testEnv.RATE_LIMITER, a, limit);
		expect(r1.ok && r2.ok).toBe(true);
		expect(r3.ok).toBe(false);

		// b should have its own counter, unaffected by a's exhaustion.
		const r4 = await checkRateLimit(testEnv.RATE_LIMITER, b, limit);
		expect(r4.ok).toBe(true);
		expect(r4.current).toBe(1);
	});

	it('counts concurrent calls atomically (no TOCTOU race past the limit)', async () => {
		const key = `t3:${crypto.randomUUID()}`;
		const limit = 5;

		// Fire 20 calls simultaneously against a limit of 5.
		const results = await Promise.all(
			Array.from({ length: 20 }, () => checkRateLimit(testEnv.RATE_LIMITER, key, limit)),
		);

		const allowed = results.filter((r) => r.ok).length;
		expect(allowed).toBe(limit);
	});

	it('resets the counter when a new window starts', async () => {
		const key = `t4:${crypto.randomUUID()}`;
		const stub = getStub(key);
		const limit = 2;
		const windowMs = RATE_LIMITER_WINDOW_MS;
		const base = windowMs * 1000;

		const a = await stub.check({ limit, windowMs, now: base });
		const b = await stub.check({ limit, windowMs, now: base + 1 });
		const c = await stub.check({ limit, windowMs, now: base + 2 });
		expect(a.ok).toBe(true);
		expect(b.ok).toBe(true);
		expect(c.ok).toBe(false);
		expect(c.current).toBe(limit);

		// Crossing into the next window resets the counter back to 1.
		const d = await stub.check({ limit, windowMs, now: base + windowMs });
		expect(d.ok).toBe(true);
		expect(d.current).toBe(1);

		const e = await stub.check({ limit, windowMs, now: base + windowMs + 1 });
		expect(e.ok).toBe(true);
		expect(e.current).toBe(2);

		const f = await stub.check({ limit, windowMs, now: base + windowMs + 2 });
		expect(f.ok).toBe(false);
	});
});
