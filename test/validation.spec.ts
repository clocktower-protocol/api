import { describe, expect, it } from 'vitest';
import {
	addressSchema,
	bytes32Schema,
	dayNumberSchema,
	frequencySchema,
	MAX_DAY_NUMBER,
	MAX_JSON_DEPTH,
	normalizeHex,
	parseApprovedTokenRecord,
	parseSubscriptionRecord,
	validateEnv,
	validateJsonDepth,
	validateMcpRequest,
} from '../src/validation.js';

const validEnv = {
	ALCHEMY_API_KEY: 'test-alchemy-key',
	ALCHEMY_URL: 'https://base-mainnet.g.alchemy.com/v2/',
	CLOCKTOWER_ADDRESS: '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
	CDP_API_KEY_ID: 'test-cdp-key-id',
	CDP_API_KEY_SECRET: 'test-cdp-key-secret',
	X402_RECIPIENT: '0x0000000000000000000000000000000000000001',
} as Env;

describe('tool schemas', () => {
	it('normalizes addresses to lowercase', () => {
		expect(addressSchema.parse('0xFaF5fc2f77b21BC188f492b827D366B03a07c61f')).toBe(
			'0xfaf5fc2f77b21bc188f492b827d366b03a07c61f',
		);
	});

	it('rejects invalid addresses and bytes32 values', () => {
		expect(() => addressSchema.parse('0x123')).toThrow();
		expect(() => bytes32Schema.parse('0x123')).toThrow();
	});

	it('bounds dayNumber and frequency', () => {
		expect(dayNumberSchema.parse(MAX_DAY_NUMBER)).toBe(MAX_DAY_NUMBER);
		expect(() => dayNumberSchema.parse(MAX_DAY_NUMBER + 1)).toThrow();
		expect(frequencySchema.parse(3)).toBe(3);
		expect(() => frequencySchema.parse(4)).toThrow();
	});
});

describe('validateEnv', () => {
	it('accepts a valid env', () => {
		expect(() => validateEnv(validEnv)).not.toThrow();
	});

	it('rejects missing alchemy key', () => {
		expect(() => validateEnv({ ...validEnv, ALCHEMY_API_KEY: '' })).toThrow('ALCHEMY_API_KEY');
	});

	it('rejects invalid contract address', () => {
		expect(() => validateEnv({ ...validEnv, CLOCKTOWER_ADDRESS: '0x123' })).toThrow('CLOCKTOWER_ADDRESS');
	});

	it('rejects missing CDP credentials', () => {
		expect(() => validateEnv({ ...validEnv, CDP_API_KEY_ID: '' })).toThrow('CDP_API_KEY_ID');
	});

	it('rejects ALCHEMY_URL without trailing slash', () => {
		expect(() =>
			validateEnv({ ...validEnv, ALCHEMY_URL: 'https://base-mainnet.g.alchemy.com/v2' }),
		).toThrow(/trailing/);
	});
});

describe('validateMcpRequest', () => {
	it('rejects unsupported methods', async () => {
		const request = new Request('http://example.com/mcp', { method: 'PATCH' });
		const response = await validateMcpRequest(request);
		expect(response?.status).toBe(405);
	});

	it('rejects non-json content type on POST', async () => {
		const request = new Request('http://example.com/mcp', {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: '{}',
		});
		const response = await validateMcpRequest(request);
		expect(response?.status).toBe(415);
	});

	it('rejects invalid JSON bodies', async () => {
		const request = new Request('http://example.com/mcp', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{',
		});
		const response = await validateMcpRequest(request);
		expect(response?.status).toBe(400);
	});

	it('rejects deeply nested JSON bodies', async () => {
		let nested: Record<string, unknown> = { ok: true };
		for (let i = 0; i <= MAX_JSON_DEPTH; i += 1) {
			nested = { nested };
		}

		const request = new Request('http://example.com/mcp', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(nested),
		});
		const response = await validateMcpRequest(request);
		expect(response?.status).toBe(400);
	});

	it('allows GET requests without a body', async () => {
		const request = new Request('http://example.com/mcp', { method: 'GET' });
		expect(await validateMcpRequest(request)).toBeNull();
	});
});

describe('contract response parsing', () => {
	it('parses tuple subscription records and normalizes hex fields', () => {
		const parsed = parseSubscriptionRecord([
			'0x' + '11'.repeat(32),
			1000n,
			'0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
			'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			false,
			1,
			15,
		]);

		expect(parsed.id).toBe(normalizeHex('0x' + '11'.repeat(32)));
		expect(parsed.provider).toBe('0xfaf5fc2f77b21bc188f492b827d366b03a07c61f');
		expect(parsed.frequency).toBe(1);
	});

	it('rejects malformed subscription records', () => {
		expect(() => parseSubscriptionRecord([1, 2, 3])).toThrow();
	});

	it('parses approved token records', () => {
		const parsed = parseApprovedTokenRecord([
			'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			6,
			false,
			1000n,
		]);

		expect(parsed.decimals).toBe(6);
		expect(parsed.tokenAddress).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
	});
});

describe('validateJsonDepth', () => {
	it('accepts objects within the depth limit', () => {
		expect(validateJsonDepth({ a: { b: { c: 1 } } })).toBe(true);
	});
});
