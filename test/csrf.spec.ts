import { describe, expect, it } from 'vitest';
import { enforceOriginAllowlist } from '../src/csrf.js';

const authEnv = (overrides: Partial<Env> = {}): Env =>
	({
		ENABLE_AUTH: 'true',
		CFP_USERNAME: 'u',
		CFP_PASSWORD: 'p',
		...overrides,
	}) as Env;

function postWithOrigin(origin: string | null): Request {
	const headers = new Headers({ 'Content-Type': 'application/json' });
	if (origin !== null) {
		headers.set('Origin', origin);
	}
	return new Request('http://example.com/mcp', {
		method: 'POST',
		headers,
		body: '{}',
	});
}

describe('enforceOriginAllowlist', () => {
	it('passes through when ENABLE_AUTH is not true (no creds to abuse)', () => {
		const env = authEnv({ ENABLE_AUTH: undefined });
		const req = postWithOrigin('https://evil.example.com');
		expect(enforceOriginAllowlist(req, env)).toBeNull();
	});

	it('allows requests with no Origin header (server-to-server)', () => {
		const env = authEnv({ CFP_ALLOWED_ORIGINS: 'https://app.example.com' });
		const req = postWithOrigin(null);
		expect(enforceOriginAllowlist(req, env)).toBeNull();
	});

	it('rejects Origin set when CFP_ALLOWED_ORIGINS is unset (default-deny)', async () => {
		const env = authEnv();
		const req = postWithOrigin('https://evil.example.com');
		const res = enforceOriginAllowlist(req, env);
		expect(res?.status).toBe(403);
		await expect(res?.json()).resolves.toMatchObject({ error: 'Forbidden' });
	});

	it('allows Origin in the allowlist', () => {
		const env = authEnv({
			CFP_ALLOWED_ORIGINS: 'https://app.example.com,https://admin.example.com',
		});
		const req = postWithOrigin('https://app.example.com');
		expect(enforceOriginAllowlist(req, env)).toBeNull();
	});

	it('rejects Origin not in the allowlist', () => {
		const env = authEnv({ CFP_ALLOWED_ORIGINS: 'https://app.example.com' });
		const req = postWithOrigin('https://evil.example.com');
		expect(enforceOriginAllowlist(req, env)?.status).toBe(403);
	});

	it('normalizes scheme/host case', () => {
		const env = authEnv({ CFP_ALLOWED_ORIGINS: 'https://App.Example.COM' });
		const req = postWithOrigin('HTTPS://app.example.com');
		expect(enforceOriginAllowlist(req, env)).toBeNull();
	});

	it('treats different ports as different origins', () => {
		const env = authEnv({ CFP_ALLOWED_ORIGINS: 'https://app.example.com' });
		const req = postWithOrigin('https://app.example.com:8443');
		expect(enforceOriginAllowlist(req, env)?.status).toBe(403);
	});

	it('treats different schemes as different origins', () => {
		const env = authEnv({ CFP_ALLOWED_ORIGINS: 'https://app.example.com' });
		const req = postWithOrigin('http://app.example.com');
		expect(enforceOriginAllowlist(req, env)?.status).toBe(403);
	});

	it('rejects malformed Origin header', () => {
		const env = authEnv({ CFP_ALLOWED_ORIGINS: 'https://app.example.com' });
		const req = postWithOrigin('not a url');
		expect(enforceOriginAllowlist(req, env)?.status).toBe(403);
	});

	it('* wildcard allows any Origin', () => {
		const env = authEnv({ CFP_ALLOWED_ORIGINS: '*' });
		const req = postWithOrigin('https://anywhere.example.com');
		expect(enforceOriginAllowlist(req, env)).toBeNull();
	});

	it('handles whitespace and ignores invalid entries in the list', () => {
		const env = authEnv({
			CFP_ALLOWED_ORIGINS: ' https://app.example.com ,,not-a-url, https://admin.example.com',
		});
		const ok = postWithOrigin('https://admin.example.com');
		expect(enforceOriginAllowlist(ok, env)).toBeNull();

		const bad = postWithOrigin('https://other.example.com');
		expect(enforceOriginAllowlist(bad, env)?.status).toBe(403);
	});
});
