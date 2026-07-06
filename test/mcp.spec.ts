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

describe('clocktower-mcp worker', () => {
	it('returns health JSON from root', async () => {
		const res = await fetchWorker('/');
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body).toMatchObject({
			status: 'ok',
			name: 'clocktower-mcp',
			mcp: 'https://mcp.clocktower.finance/',
			rest: 'https://api.clocktower.finance',
			hosts: {
				api: 'https://api.clocktower.finance',
				mcp: 'https://mcp.clocktower.finance',
			},
			surface: 'legacy',
		});
		// The note can change over time during the x402 transition
		expect(typeof body.note).toBe('string');
	});

	it('returns health JSON for non-mcp routes', async () => {
		const res = await fetchWorker('/health');
		expect(res.status).toBe(200);

		const body = (await res.json()) as { status: string; mcp: string };
		expect(body.status).toBe('ok');
		expect(body.mcp).toBe('https://mcp.clocktower.finance/');
	});

	it('applies defensive security headers to root JSON', async () => {
		const res = await fetchWorker('/');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('no-referrer');
	});

	it('applies defensive security headers to error responses', async () => {
		// PUT is rejected by validateMcpRequest with 405; ensures the headers
		// are added to non-200 paths too (i.e. the wrapper runs unconditionally
		// at the worker boundary, not just on the success path).
		const res = await fetchWorker('/mcp', { method: 'PUT' });
		expect(res.status).toBe(405);
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('no-referrer');
	});
});
