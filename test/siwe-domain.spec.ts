import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';

const entitledEnv = {
	...env,
	API_HOST: 'api.clocktower.finance',
	SIWE_DOMAIN: 'api.clocktower.finance',
	BUILDER_SUB_ID: `0x${'ab'.repeat(32)}`,
	API_REQUIRE_BASIC_AUTH: 'false',
} as Env;

async function fetchWorker(url: string, init: RequestInit = {}) {
	const ctx = createExecutionContext();
	const req = new Request(url, init);
	const res = await worker.fetch(req, entitledEnv, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

describe('SIWE domain', () => {
	it('embeds api.clocktower.finance in auth challenge messages', async () => {
		const res = await fetchWorker('https://api.clocktower.finance/auth/challenge', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ address: '0x0000000000000000000000000000000000000001' }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.message).toContain('api.clocktower.finance wants you to sign in');
	});
});