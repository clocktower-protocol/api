import { describe, expect, it } from 'vitest';
import { handleApiCorsPreflight, withApiCorsHeaders } from '../src/cors.js';
import { isOriginAllowed, normalizeOrigin, parseAllowedOrigins } from '../src/origins.js';

const envWithCors = {
	API_CORS_ALLOWED_ORIGINS: 'https://app.example.com,https://localhost:5173',
} as Env;

describe('origins helpers', () => {
	it('normalizes origins case-insensitively for scheme/host', () => {
		expect(normalizeOrigin('https://App.Example.COM')).toBe('https://app.example.com');
	});

	it('parseAllowedOrigins supports wildcard', () => {
		expect(parseAllowedOrigins('*').wildcard).toBe(true);
	});

	it('isOriginAllowed matches configured origins', () => {
		expect(isOriginAllowed('https://app.example.com', envWithCors.API_CORS_ALLOWED_ORIGINS)).toBe(true);
		expect(isOriginAllowed('https://evil.example.com', envWithCors.API_CORS_ALLOWED_ORIGINS)).toBe(false);
	});
});

describe('API CORS', () => {
	it('returns 204 preflight for allowed origin', () => {
		const req = new Request('https://worker.example/api/protocol/state', {
			method: 'OPTIONS',
			headers: { Origin: 'https://app.example.com' },
		});

		const res = handleApiCorsPreflight(req, envWithCors);
		expect(res?.status).toBe(204);
		expect(res?.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
		expect(res?.headers.get('Access-Control-Allow-Headers')).toContain('X-Payment');
	});

	it('rejects preflight for disallowed origin', () => {
		const req = new Request('https://worker.example/api/protocol/state', {
			method: 'OPTIONS',
			headers: { Origin: 'https://evil.example.com' },
		});

		const res = handleApiCorsPreflight(req, envWithCors);
		expect(res?.status).toBe(403);
	});

	it('adds CORS headers to responses when enabled', () => {
		const req = new Request('https://worker.example/api/catalog', {
			headers: { Origin: 'https://localhost:5173' },
		});
		const base = Response.json({ ok: true });

		const res = withApiCorsHeaders(req, base, envWithCors);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://localhost:5173');
	});

	it('does not add CORS headers when env is unset', () => {
		const req = new Request('https://worker.example/api/catalog', {
			headers: { Origin: 'https://app.example.com' },
		});
		const base = Response.json({ ok: true });

		const res = withApiCorsHeaders(req, base, {} as Env);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});
});