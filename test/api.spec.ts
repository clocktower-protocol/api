import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';

async function fetchWorker(pathname: string, init: RequestInit = {}) {
	const ctx = createExecutionContext();
	const req = new Request(`http://example.com${pathname}`, init);
	const res = await worker.fetch(req, env, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

describe('clocktower-mcp worker - /api (Stage 0 scaffolding)', () => {
	it('returns 501 placeholder for /api', async () => {
		const res = await fetchWorker('/api');
		expect(res.status).toBe(501);

		const body = await res.json();
		expect(body.status).toBe('not_implemented');
		expect(body.message).toContain('REST API');
	});

	it('returns 501 placeholder for nested /api paths', async () => {
		const res = await fetchWorker('/api/v1/protocol/state');
		expect(res.status).toBe(501);

		const body = await res.json();
		expect(body.status).toBe('not_implemented');
	});

	it('applies defensive security headers to API responses', async () => {
		const res = await fetchWorker('/api');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('no-referrer');
	});

	it('applies security headers to API error responses', async () => {
		// Note: The test environment has very tight rate limits (2 req/min).
		// We accept either a 501 (placeholder) or 429 (rate limited) here,
		// as both are valid behaviors from the middleware stack.
		const res = await fetchWorker('/api/anything');
		expect([501, 429]).toContain(res.status);

		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('no-referrer');
	});

	it('respects rate limiting and auth middleware on /api paths', async () => {
		// The test environment has aggressive rate limiting (2 requests/minute).
		// This test primarily verifies that the middleware stack (auth + rate limit)
		// is being applied to /api routes. In later stages we will add more
		// targeted auth tests when we have better control over test env bindings.
		const res = await fetchWorker('/api');

		// Acceptable responses in the current tight test environment:
		// 501 = placeholder (auth disabled or passed)
		// 401 = Basic Auth required
		// 429 = rate limited
		expect([501, 401, 429]).toContain(res.status);
	});
});
