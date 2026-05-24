import { describe, expect, it } from 'vitest';
import { enforceBasicAuth } from '../src/auth.js';

const baseEnv = {
	ENABLE_AUTH: 'true',
	CFP_USERNAME: 'test-user',
	CFP_PASSWORD: 'test-pass',
} as Env;

function basicAuthHeader(username: string, password: string): string {
	const encoded = btoa(`${username}:${password}`);
	return `Basic ${encoded}`;
}

describe('enforceBasicAuth', () => {
	it('skips auth when ENABLE_AUTH is not true', () => {
		const request = new Request('http://example.com/mcp');
		const env = { ...baseEnv, ENABLE_AUTH: 'false' } as Env;

		expect(enforceBasicAuth(request, env)).toBeNull();
	});

	it('skips auth when ENABLE_AUTH is unset', () => {
		const request = new Request('http://example.com/mcp');
		const env = { CFP_USERNAME: 'test-user', CFP_PASSWORD: 'test-pass' } as Env;

		expect(enforceBasicAuth(request, env)).toBeNull();
	});

	it('returns 401 when Authorization header is missing', () => {
		const request = new Request('http://example.com/mcp');
		const response = enforceBasicAuth(request, baseEnv);

		expect(response?.status).toBe(401);
		expect(response?.headers.get('WWW-Authenticate')).toContain('Basic realm=');
	});

	it('returns 401 for invalid credentials', () => {
		const request = new Request('http://example.com/mcp', {
			headers: { Authorization: basicAuthHeader('wrong', 'creds') },
		});
		const response = enforceBasicAuth(request, baseEnv);

		expect(response?.status).toBe(401);
	});

	it('allows valid credentials', () => {
		const request = new Request('http://example.com/mcp', {
			headers: { Authorization: basicAuthHeader('test-user', 'test-pass') },
		});

		expect(enforceBasicAuth(request, baseEnv)).toBeNull();
	});

	it('supports passwords containing colons', () => {
		const env = {
			ENABLE_AUTH: 'true',
			CFP_USERNAME: 'user',
			CFP_PASSWORD: 'pass:with:colons',
		} as Env;
		const request = new Request('http://example.com/mcp', {
			headers: { Authorization: basicAuthHeader('user', 'pass:with:colons') },
		});

		expect(enforceBasicAuth(request, env)).toBeNull();
	});
});
