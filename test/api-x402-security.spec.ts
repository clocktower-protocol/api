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

/**
 * REST API is free — x402 applies to MCP only.
 */
describe('x402 security - REST is free', () => {
	it('returns non-402 for unauthenticated REST reads', async () => {
		const res = await fetchWorker('/api/catalog', {
			headers: { 'CF-Connecting-IP': '203.0.113.99' },
		});
		expect(res.status).not.toBe(402);
		expect(res.status).toBe(200);
	});

	it('returns non-402 for unauthenticated REST writes (may 400 on bad body)', async () => {
		const res = await fetchWorker('/api/check_subscribe_readiness', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'CF-Connecting-IP': '203.0.113.98',
			},
			body: JSON.stringify({}),
		});
		expect(res.status).not.toBe(402);
	});
});