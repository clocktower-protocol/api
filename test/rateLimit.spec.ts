import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { getRateLimit } from '../src/rateLimit.js';

/** Stable test env: miniflare bindings + overrides so local .dev.vars cannot skew results. */
const rateLimitEnv = {
	...env,
	ENABLE_AUTH: 'false',
	RATE_LIMIT_REQUESTS_PER_MINUTE: '2',
} as Env;

async function fetchWorker(pathname: string, init: RequestInit = {}) {
	const ctx = createExecutionContext();
	const req = new Request(`http://example.com${pathname}`, init);
	const res = await worker.fetch(req, rateLimitEnv, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

describe('rate limiting', () => {
	it('uses configured requests per minute from env', () => {
		expect(getRateLimit(rateLimitEnv)).toBe(2);
	});

	it('returns 429 after exceeding the configured limit on /api routes', async () => {
		// Use /api (not /mcp) so we exercise worker rate limiting without requiring
		// the MCP_OBJECT durable-object binding in the test environment.
		const init = {
			method: 'GET',
			headers: { 'CF-Connecting-IP': '203.0.113.10' },
		};

		const first = await fetchWorker('/api/protocol/state', init);
		const second = await fetchWorker('/api/protocol/state', init);
		const third = await fetchWorker('/api/protocol/state', init);

		expect(first.status).not.toBe(429);
		expect(second.status).not.toBe(429);
		expect(third.status).toBe(429);

		const body = await third.json();
		expect(body).toMatchObject({
			error: 'Rate limit exceeded',
			limit: 2,
		});
	});

	it('does not rate limit health routes', async () => {
		for (let i = 0; i < 5; i += 1) {
			const res = await fetchWorker('/');
			expect(res.status).toBe(200);
		}
	});
});
