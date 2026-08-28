import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { createApiKey } from '../src/auth/apiKeys.js';
import { handleGetCatalog } from '../src/api/catalog.js';
import { DEFAULT_TIER_LIMITS } from '../src/config/rateLimits.js';

const adminSecret = 'test-admin-secret-32chars-long!!';

const unpaidEnv = {
	...env,
	API_REQUIRE_BASIC_AUTH: 'false',
	DEVELOPER_KEYS_ENABLED: 'true',
	DEVELOPER_KEYS_ADMIN_SECRET: adminSecret,
	MCP_X402_ENABLED: 'false',
	FREE_RATE_LIMIT_RPM: '100',
	FREE_EXPENSIVE_RATE_LIMIT_RPM: '50',
	FREE_WRITE_RATE_LIMIT_RPM: '50',
	FREE_WRITE_DAILY_LIMIT: '20',
	FREE_DAILY_REQUEST_LIMIT: '1000',
	FREE_SUBGRAPH_DAILY_LIMIT: '1000',
} as Env;

async function fetchWorker(envOverride: Env, pathname: string, init: RequestInit = {}) {
	const ctx = createExecutionContext();
	const req = new Request(`http://example.com${pathname}`, init);
	const res = await worker.fetch(req, envOverride, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

function mcpJson(method: string, params: unknown = {}, ip = '203.0.113.10') {
	return {
		method: 'POST' as const,
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'CF-Connecting-IP': ip,
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	};
}

function toolsCall(name: string, args: Record<string, unknown> = {}, ip = '203.0.113.11') {
	return mcpJson('tools/call', { name, arguments: args }, ip);
}

describe('MCP unpaid access (MCP_X402_ENABLED off)', () => {
	it('does not return a payment challenge on initialize', async () => {
		const res = await fetchWorker(
			unpaidEnv,
			'/mcp',
			mcpJson(
				'initialize',
				{
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'test', version: '1.0.0' },
				},
				'203.0.113.12',
			),
		);
		expect(res.status).not.toBe(402);
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).not.toMatch(/PAYMENT_REQUIRED/);
		expect(text.length).toBeGreaterThan(0);
	});

	it('returns 401 for an invalid ctk_ key (not free fallback)', async () => {
		const res = await fetchWorker(unpaidEnv, '/mcp', {
			...mcpJson('initialize', {}, '203.0.113.13'),
			headers: {
				...mcpJson('initialize').headers,
				Authorization: `Bearer ctk_${'ab'.repeat(32)}`,
				'CF-Connecting-IP': '203.0.113.13',
			},
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as { code?: string };
		expect(body.code).toBe('UNAUTHORIZED');
	});

	it('sets X-Clocktower-Lane developer for a valid ctk_ key', async () => {
		if (!env.SESSIONS_KV) return;
		const { token } = await createApiKey(unpaidEnv, `mcp-${crypto.randomUUID()}`);
		const res = await fetchWorker(unpaidEnv, '/mcp', {
			...mcpJson(
				'initialize',
				{
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'test', version: '1.0.0' },
				},
				'203.0.113.14',
			),
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				Authorization: `Bearer ${token}`,
				'CF-Connecting-IP': '203.0.113.14',
			},
		});
		expect(res.status).not.toBe(401);
		expect(res.status).not.toBe(402);
		expect(res.headers.get('X-Clocktower-Lane')).toBe('developer');
	});

	it('sets X-Clocktower-Lane free when no Authorization is sent', async () => {
		const res = await fetchWorker(
			unpaidEnv,
			'/mcp',
			mcpJson(
				'initialize',
				{
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'test', version: '1.0.0' },
				},
				'203.0.113.15',
			),
		);
		expect(res.status).not.toBe(402);
		expect(res.headers.get('X-Clocktower-Lane')).toBe('free');
	});

	it('rejects free-tier search includeDetails at HTTP', async () => {
		const res = await fetchWorker(
			unpaidEnv,
			'/mcp',
			toolsCall('search_subscriptions', { includeDetails: true, first: 5 }, '203.0.113.16'),
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code?: string; error?: string };
		expect(body.code).toBe('VALIDATION_ERROR');
		expect(body.error).toMatch(/includeDetails/);
	});

	it('rejects free-tier search first above 10', async () => {
		const res = await fetchWorker(
			unpaidEnv,
			'/mcp',
			toolsCall('search_subscriptions', { first: 11 }, '203.0.113.17'),
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code?: string; error?: string };
		expect(body.code).toBe('VALIDATION_ERROR');
		expect(body.error).toMatch(/1–10/);
	});

	it('enforces free write daily on MCP prepare tools/call', async () => {
		const tight = {
			...unpaidEnv,
			FREE_WRITE_DAILY_LIMIT: '2',
			FREE_WRITE_RATE_LIMIT_RPM: '100',
			FREE_RATE_LIMIT_RPM: '100',
		} as Env;
		const ip = '203.0.113.18';
		const statuses: number[] = [];
		for (let i = 0; i < 3; i++) {
			const res = await fetchWorker(
				tight,
				'/mcp',
				toolsCall('prepare_subscribe', { from: '0x' + '1'.repeat(40) }, ip),
			);
			statuses.push(res.status);
		}
		expect(statuses[0]).not.toBe(429);
		expect(statuses[1]).not.toBe(429);
		expect(statuses[2]).toBe(429);
	});
});

describe('MCP x402 on (MCP_X402_ENABLED=true)', () => {
	const paidEnv = { ...unpaidEnv, MCP_X402_ENABLED: 'true' } as Env;

	it('does not treat invalid ctk_ as MCP auth (no 401)', async () => {
		const res = await fetchWorker(paidEnv, '/mcp', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				Authorization: `Bearer ctk_${'cd'.repeat(32)}`,
				'CF-Connecting-IP': '203.0.113.19',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'test', version: '1.0.0' },
				},
			}),
		});
		expect(res.status).not.toBe(401);
		expect(res.headers.get('X-Clocktower-Lane')).not.toBe('developer');
	});
});

describe('catalog MCP access shape', () => {
	it('reports free/developer MCP auth when x402 is off', async () => {
		const res = handleGetCatalog({ ...env, MCP_X402_ENABLED: 'false' } as Env);
		const body = (await res.json()) as {
			access?: { mcp?: { auth?: string; x402?: boolean } };
		};
		expect(body.access?.mcp?.auth).toMatch(/ctk_/);
		expect(body.access?.mcp?.x402).toBe(false);
	});

	it('reports x402 MCP auth when enabled', async () => {
		const res = handleGetCatalog({ ...env, MCP_X402_ENABLED: 'true' } as Env);
		const body = (await res.json()) as {
			access?: { mcp?: { auth?: string; limits?: unknown } };
		};
		expect(body.access?.mcp?.auth).toMatch(/x402/);
		expect(body.access?.mcp?.limits).toEqual(DEFAULT_TIER_LIMITS.mcp);
	});
});
