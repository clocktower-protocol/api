import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';

async function fetchWorker(
	pathname: string,
	init: RequestInit = {},
	envOverrides: Partial<Env> = {},
) {
	const ctx = createExecutionContext();
	const req = new Request(`http://example.com${pathname}`, init);
	const testEnv = { ...env, API_REQUIRE_BASIC_AUTH: 'false', ...envOverrides } as Env;
	const res = await worker.fetch(req, testEnv, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

describe('API_ENABLED kill switch', () => {
	it('returns 503 API_DISABLED for /api routes when API_ENABLED=false', async () => {
		const res = await fetchWorker('/api/protocol/state', {}, { API_ENABLED: 'false' });
		expect(res.status).toBe(503);

		const body = (await res.json()) as { error: string; code: string };
		expect(body.code).toBe('API_DISABLED');
		expect(body.error).toMatch(/temporarily unavailable/i);
	});

	it('blocks write routes when API_ENABLED=false', async () => {
		const res = await fetchWorker(
			'/api/prepare/subscribe',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ from: '0x0000000000000000000000000000000000000001' }),
			},
			{ API_ENABLED: 'false' },
		);
		expect(res.status).toBe(503);
		const writeBody = (await res.json()) as { code: string };
		expect(writeBody.code).toBe('API_DISABLED');
	});

	it('still allows GET /api/status when API_ENABLED=false', async () => {
		const res = await fetchWorker('/api/status', {}, { API_ENABLED: 'false' });
		expect(res.status).toBe(200);

		const body = (await res.json()) as {
			status: string;
			apiEnabled: boolean;
			service: string;
		};
		expect(body.status).toBe('disabled');
		expect(body.apiEnabled).toBe(false);
		expect(body.service).toBe('clocktower-rest-api');
	});

	it('does not block MCP or worker root when API_ENABLED=false', async () => {
		const root = await fetchWorker('/', {}, { API_ENABLED: 'false' });
		expect(root.status).toBe(200);
		const rootBody = (await root.json()) as { apiEnabled: boolean };
		expect(rootBody.apiEnabled).toBe(false);

		// PUT /mcp is rejected by MCP validation (405), not the REST kill switch (503).
		const mcp = await fetchWorker('/mcp', { method: 'PUT' }, { API_ENABLED: 'false' });
		expect(mcp.status).toBe(405);
	});

	it('serves /api routes when API_ENABLED is unset or true', async () => {
		const unset = await fetchWorker('/api/protocol/state', {}, {});
		expect(unset.status).not.toBe(503);

		const enabled = await fetchWorker('/api/protocol/state', {}, { API_ENABLED: 'true' });
		expect(enabled.status).not.toBe(503);
	});
});