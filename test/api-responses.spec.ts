import { describe, expect, it, vi } from 'vitest';
import { Errors, jsonResponse } from '../src/api/responses.js';
import { restChainErrorResponse } from '../src/api/restChain.js';
import { UnsupportedChainError } from '../src/chain.js';
import { handleCheckSubscribeReadiness } from '../src/api/write.js';

describe('jsonResponse', () => {
	it('does not serialize Error stack traces to the client', async () => {
		const err = new Error('secret boom');
		err.stack = 'Error: secret boom\n    at leak (/internal/file.ts:1:1)';
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const res = jsonResponse(err, 500);
		const body = (await res.json()) as { error?: string; code?: string };
		expect(res.status).toBe(500);
		expect(body.code).toBe('UPSTREAM_ERROR');
		expect(body.error).toBe('Upstream error');
		expect(JSON.stringify(body)).not.toContain('secret boom');
		expect(JSON.stringify(body)).not.toContain('/internal/file.ts');
		log.mockRestore();
	});
});

describe('restChainErrorResponse', () => {
	it('rebuilds unsupported-chain messages from the query, not the exception', async () => {
		const res = restChainErrorResponse(new UnsupportedChainError('internal detail'), '1');
		const body = (await res.json()) as { error?: string; code?: string };
		expect(res.status).toBe(400);
		expect(body.code).toBe('VALIDATION_ERROR');
		expect(body.error).toBe('Unsupported chainId 1');
		expect(body.error).not.toContain('internal');
	});

	it('uses a generic parse message instead of the thrown Error text', async () => {
		const res = restChainErrorResponse(new Error('chainId must be a positive integer'), '0');
		const body = (await res.json()) as { error?: string };
		expect(body.error).toBe('chainId must be a decimal chain id or CAIP-2 eip155:<id>');
		expect(body.error).not.toContain('positive integer');
	});
});

describe('write error responses', () => {
	it('returns validation issues without exception text on bad input', async () => {
		const res = await handleCheckSubscribeReadiness({
			req: { json: async () => ({ from: 'bad', subscription: {} }) },
			env: {},
		} as any);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code?: string };
		expect(body.code).toBe('VALIDATION_ERROR');
		expect(JSON.stringify(body)).not.toContain('at ');
		expect(JSON.stringify(body)).not.toMatch(/\.ts:\d+/);
	});

	it('maps unexpected failures to a generic upstream error', async () => {
		const boom = new Error('RPC URL https://example.invalid/v2/SECRETKEY leak');
		boom.stack = 'Error: RPC URL\n    at internal.ts:9:1';
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const res = await handleCheckSubscribeReadiness({
			req: {
				json: async () => ({
					from: '0x1234567890123456789012345678901234567890',
					subscription: {
						id: `0x${'11'.repeat(32)}`,
						amount: '10',
						provider: '0x1234567890123456789012345678901234567890',
						token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
						cancelled: false,
						frequency: 1,
						dueDay: 1,
					},
				}),
				header: () => {
					throw boom;
				},
			},
			env: {},
		} as any);
		const text = await res.text();
		expect(res.status).toBe(500);
		expect(text).toContain('Upstream error');
		expect(text).not.toContain('SECRETKEY');
		expect(text).not.toContain('internal.ts');
		expect(text).not.toContain('example.invalid');
		log.mockRestore();
	});
});

describe('Errors helpers', () => {
	it('validation errors stay generic objects', async () => {
		const res = Errors.validation('Invalid Ethereum address');
		const body = await res.json();
		expect(body).toEqual({ error: 'Invalid Ethereum address', code: 'VALIDATION_ERROR' });
	});
});
