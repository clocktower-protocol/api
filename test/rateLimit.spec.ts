import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { getRateLimit } from '../src/rateLimit.js';

async function fetchWorker(pathname: string, init: RequestInit = {}) {
	const ctx = createExecutionContext();
	const req = new Request(`http://example.com${pathname}`, init);
	const res = await worker.fetch(req, env, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

describe('rate limiting', () => {
	it('uses configured requests per minute from env', () => {
		expect(getRateLimit(env)).toBe(2);
	});

	it('returns 429 after exceeding the configured limit on /mcp', async () => {
		const init = {
			method: 'POST',
			headers: {
				'CF-Connecting-IP': '203.0.113.10',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
		};

		const first = await fetchWorker('/mcp', init);
		const second = await fetchWorker('/mcp', init);
		const third = await fetchWorker('/mcp', init);

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
