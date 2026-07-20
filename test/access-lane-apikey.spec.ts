import { describe, expect, it } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { createApiKey, revokeApiKey } from '../src/auth/apiKeys.js';
import { resolveApiAccess } from '../src/middleware/accessLane.js';

const adminSecret = 'test-admin-secret-32chars-long!!';

const testEnv = {
	...env,
	API_REQUIRE_BASIC_AUTH: 'false',
	DEVELOPER_KEYS_ENABLED: 'true',
	DEVELOPER_KEYS_ADMIN_SECRET: adminSecret,
} as Env;

async function fetchWorker(pathname: string, init: RequestInit = {}) {
	const ctx = createExecutionContext();
	const req = new Request(`http://example.com${pathname}`, init);
	const res = await worker.fetch(req, testEnv, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

describe('developer API key access lane', () => {
	it('resolves valid ctk_ key to developer lane', async () => {
		if (!env.SESSIONS_KV) return;
		const { token } = await createApiKey(testEnv, `subj-${crypto.randomUUID()}`);
		const req = new Request('http://example.com/api/catalog', {
			headers: { Authorization: `Bearer ${token}` },
		});
		const access = await resolveApiAccess(req, testEnv);
		expect(access.authError).toBeUndefined();
		expect(access.lane).toBe('developer');
		expect(access.apiKey?.id).toBeTruthy();
	});

	it('returns 401 for invalid ctk_ key (not free)', async () => {
		const res = await fetchWorker('/api/catalog', {
			headers: {
				Authorization: `Bearer ctk_${'ab'.repeat(32)}`,
				'CF-Connecting-IP': '203.0.113.99',
			},
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as { code?: string };
		expect(body.code).toBe('UNAUTHORIZED');
	});

	it('sets X-Clocktower-Lane developer on successful key request', async () => {
		if (!env.SESSIONS_KV) return;
		const { token } = await createApiKey(testEnv, `subj-${crypto.randomUUID()}`);
		const res = await fetchWorker('/api/catalog', {
			headers: {
				Authorization: `Bearer ${token}`,
				'CF-Connecting-IP': '203.0.113.100',
			},
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('X-Clocktower-Lane')).toBe('developer');
	});

	it('rejects revoked keys with 401', async () => {
		if (!env.SESSIONS_KV) return;
		const { token, id } = await createApiKey(testEnv, `subj-${crypto.randomUUID()}`);
		await revokeApiKey(testEnv, id);
		const res = await fetchWorker('/api/catalog', {
			headers: {
				Authorization: `Bearer ${token}`,
				'CF-Connecting-IP': '203.0.113.101',
			},
		});
		expect(res.status).toBe(401);
	});

	it('admin can create and list keys', async () => {
		if (!env.SESSIONS_KV) return;
		const subjectId = `portal-${crypto.randomUUID()}`;
		const createRes = await fetchWorker('/api/developer/keys', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${adminSecret}`,
				'Content-Type': 'application/json',
				'CF-Connecting-IP': '203.0.113.102',
			},
			body: JSON.stringify({ subjectId, label: 'test' }),
		});
		expect(createRes.status).toBe(201);
		const created = (await createRes.json()) as { token?: string; id?: string };
		expect(created.token?.startsWith('ctk_')).toBe(true);

		const listRes = await fetchWorker(
			`/api/developer/keys?subjectId=${encodeURIComponent(subjectId)}`,
			{
				headers: {
					Authorization: `Bearer ${adminSecret}`,
					'CF-Connecting-IP': '203.0.113.102',
				},
			},
		);
		expect(listRes.status).toBe(200);
		const listed = (await listRes.json()) as { keys: Array<{ id: string }> };
		expect(listed.keys.some((k) => k.id === created.id)).toBe(true);

		const delRes = await fetchWorker(`/api/developer/keys/${created.id}`, {
			method: 'DELETE',
			headers: {
				Authorization: `Bearer ${adminSecret}`,
				'CF-Connecting-IP': '203.0.113.102',
			},
		});
		expect(delRes.status).toBe(200);
	});

	it('rejects key management without admin secret', async () => {
		const res = await fetchWorker('/api/developer/keys', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'CF-Connecting-IP': '203.0.113.103',
			},
			body: JSON.stringify({ subjectId: 'x' }),
		});
		expect(res.status).toBe(401);
	});
});
