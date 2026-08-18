import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';

const prodEnv = {
	...env,
	API_HOST: 'api.clocktower.finance',
	MCP_HOST: 'mcp.clocktower.finance',
	SIWE_DOMAIN: 'api.clocktower.finance',
	API_REQUIRE_BASIC_AUTH: 'false',
	FREE_RATE_LIMIT_RPM: '20',
} as Env;

async function fetchWorker(url: string, init: RequestInit = {}) {
	const ctx = createExecutionContext();
	const req = new Request(url, init);
	const res = await worker.fetch(req, prodEnv, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

describe('production hostname routing', () => {
	it('serves REST catalog without /api prefix on api host', async () => {
		const res = await fetchWorker('https://api.clocktower.finance/catalog', {
			headers: { 'CF-Connecting-IP': '203.0.113.40' },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.hosts.api).toBe('https://api.clocktower.finance');
		expect(body.siweDomain).toBe('api.clocktower.finance');
		expect(body.chainId).toBe(8453);
		expect(body.chains).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					chainId: 8453,
					caip2: 'eip155:8453',
					rest: true,
					mcp: true,
					default: true,
				}),
			]),
		);
	});

	it('rejects REST paths on mcp host', async () => {
		const res = await fetchWorker('https://mcp.clocktower.finance/catalog');
		expect(res.status).toBe(404);
	});

	it('rejects MCP paths on api host', async () => {
		const res = await fetchWorker('https://api.clocktower.finance/mcp');
		expect(res.status).toBe(404);
	});

	it('includes production hosts in legacy root discovery', async () => {
		const res = await fetchWorker('https://example.com/');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.hosts).toEqual({
			api: 'https://api.clocktower.finance',
			mcp: 'https://mcp.clocktower.finance',
		});
	});
});