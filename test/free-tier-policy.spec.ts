import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { enforceFreeTierPolicy } from '../src/middleware/freeTierPolicy.js';

const testEnv = {
	...env,
	API_REQUIRE_BASIC_AUTH: 'false',
	FREE_RATE_LIMIT_RPM: '20',
} as Env;

async function fetchWorker(pathname: string, init: RequestInit = {}) {
	const ctx = createExecutionContext();
	const req = new Request(`http://example.com${pathname}`, init);
	const res = await worker.fetch(req, testEnv, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

describe('free tier policy', () => {
	it('denies provider management writes', () => {
		const res = enforceFreeTierPolicy('POST', '/api/prepare/cancel_subscription');
		expect(res?.status).toBe(403);
	});

	it('denies :me routes without session', () => {
		const res = enforceFreeTierPolicy('GET', '/api/accounts/me');
		expect(res?.status).toBe(403);
	});

	it('allows cross-account reads at middleware level', () => {
		const res = enforceFreeTierPolicy('GET', '/api/accounts/0x0000000000000000000000000000000000000001');
		expect(res).toBeNull();
	});

	it('does not require x402 on REST protocol state', async () => {
		const res = await fetchWorker('/api/protocol/state', {
			headers: { 'CF-Connecting-IP': '203.0.113.50' },
		});
		expect(res.status).not.toBe(402);
		expect(res.headers.get('X-Clocktower-Lane')).toBe('free');
	});
});