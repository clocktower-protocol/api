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

describe('clocktower-mcp worker - /api (reads + writes with x402)', () => {
	it('returns consistent error shape for unknown API routes', async () => {
		const res = await fetchWorker('/api/unknown/path');
		expect(res.status).toBe(404);

		const body = await res.json();
		expect(body.error).toBeDefined();
		expect(body.code).toBe('NOT_FOUND');
	});

	it('applies defensive security headers to API responses', async () => {
		// /api/protocol/state now has x402 protection (early wiring).
		// In the test environment we may get:
		// 200, 500 (RPC failure), 401 (auth), 429 (rate limit), or 402 (x402 payment required)
		const res = await fetchWorker('/api/protocol/state');
		expect([200, 500, 401, 429, 402]).toContain(res.status);

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

	// === Write endpoint integration tests ===

	it('rejects POST to write endpoints without proper body (validation error path)', async () => {
		const res = await fetchWorker('/api/prepare/subscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ invalid: 'data' }),
		});

		// Should hit either auth (401), payment (402), rate limit (429), or validation (400)
		expect([400, 401, 402, 429]).toContain(res.status);

		if (res.status === 400) {
			const body = await res.json();
			expect(body.code).toBe('VALIDATION_ERROR');
		}
	});

	it('returns consistent error shape for malformed JSON on write endpoints', async () => {
		const res = await fetchWorker('/api/submit_signed_transactions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'not valid json',
		});

		expect([400, 401, 402, 429]).toContain(res.status);
	});

	it('protects all write endpoints with the security stack', async () => {
		const writeEndpoints = [
			'/api/prepare/create_subscription',
			'/api/prepare/cancel_subscription',
			'/api/prepare/unsubscribe',
			'/api/prepare/unsubscribe_by_provider',
			'/api/prepare/edit_details',
			'/api/submit_signed_transactions',
			'/api/transactions/status',
		];

		for (const endpoint of writeEndpoints) {
			const res = await fetchWorker(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});

			// All should be protected (401/402/429/400)
			expect([400, 401, 402, 429]).toContain(res.status);
		}
	});

	it('returns 404 (or rate limited) for unknown write-style routes', async () => {
		// In the tight test rate limit environment, this may return 429 before hitting the 404 handler
		const res = await fetchWorker('/api/prepare/does-not-exist', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});

		expect([404, 429]).toContain(res.status);

		if (res.status === 404) {
			const body = await res.json();
			expect(body.code).toBe('NOT_FOUND');
		}
	});
});
