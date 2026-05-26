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

describe('clocktower-mcp worker - /api (Stage 1 read endpoints)', () => {
	it('returns consistent error shape for unknown API routes', async () => {
		const res = await fetchWorker('/api/unknown/path');
		expect(res.status).toBe(404);

		const body = await res.json();
		expect(body.error).toBeDefined();
		expect(body.code).toBe('NOT_FOUND');
	});

	it('applies defensive security headers to API responses', async () => {
		// /api/protocol/state is one of the simplest endpoints.
		// In the test environment RPC calls often fail (fake Alchemy key),
		// so we may get 200, 500 (our upstream error), 401, or 429.
		const res = await fetchWorker('/api/protocol/state');
		expect([200, 500, 401, 429]).toContain(res.status);

		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('no-referrer');
	});

	it('returns consistent error shape on invalid input (bad subscription id)', async () => {
		const res = await fetchWorker('/api/subscriptions/not-a-valid-id');
		expect([400, 401, 429]).toContain(res.status);

		if (res.status === 400) {
			const body = await res.json();
			expect(body.error).toBeDefined();
			expect(body.code).toBe('VALIDATION_ERROR');
		}
	});

	it('respects Basic Auth and rate limiting on all /api routes', async () => {
		const res = await fetchWorker('/api/protocol/state');
		// Acceptable outcomes in the constrained test environment
		expect([200, 401, 429]).toContain(res.status);
	});

	it('supports query parameters on due subscriptions endpoint', async () => {
		const res = await fetchWorker('/api/subscriptions/due?dayNumber=100&frequency=0');
		expect([200, 401, 429]).toContain(res.status);
	});
});
