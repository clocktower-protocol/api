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
		expect(body).toEqual({
			status: 'ok',
			name: 'clocktower-mcp',
			mcp: '/mcp',
		});
	});

	it('returns health JSON for non-mcp routes', async () => {
		const res = await fetchWorker('/health');
		expect(res.status).toBe(200);

		const body = (await res.json()) as { status: string; mcp: string };
		expect(body.status).toBe('ok');
		expect(body.mcp).toBe('/mcp');
	});
});
