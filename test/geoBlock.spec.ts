import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { enforceGeoBlock, isNewYorkBlocked } from '../src/geoBlock.js';

function requestWithGeo(
	url: string,
	geo: { country?: string; region?: string; cfCountry?: string; cfRegion?: string },
): Request {
	const headers = new Headers();
	if (geo.country) {
		headers.set('cf-ipcountry', geo.country);
	}
	if (geo.region) {
		headers.set('cf-ipregion', geo.region);
	}

	const init: RequestInit & { cf?: { country?: string; regionCode?: string } } = { headers };
	if (geo.cfCountry !== undefined || geo.cfRegion !== undefined) {
		init.cf = {
			country: geo.cfCountry,
			regionCode: geo.cfRegion,
		};
	}

	return new Request(url, init);
}

async function fetchWorker(pathname: string, init: RequestInit = {}) {
	const ctx = createExecutionContext();
	const req = new Request(`http://example.com${pathname}`, init);
	const res = await worker.fetch(req, env, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

describe('isNewYorkBlocked', () => {
	it('blocks US + New York from CF headers (fallback when no request.cf)', () => {
		const request = requestWithGeo('http://example.com/mcp', {
			country: 'US',
			region: 'New York',
		});
		expect(isNewYorkBlocked(request)).toBe(true);
	});

	it('blocks US + NY from request.cf', () => {
		const request = requestWithGeo('http://example.com/mcp', {
			cfCountry: 'US',
			cfRegion: 'NY',
		});
		expect(isNewYorkBlocked(request)).toBe(true);
	});

	it('allows other US states', () => {
		const request = requestWithGeo('http://example.com/mcp', {
			country: 'US',
			region: 'California',
		});
		expect(isNewYorkBlocked(request)).toBe(false);
	});

	it('allows non-US locations', () => {
		const request = requestWithGeo('http://example.com/mcp', {
			country: 'CA',
			region: 'Ontario',
		});
		expect(isNewYorkBlocked(request)).toBe(false);
	});

	it('allows requests with no geo data', () => {
		expect(isNewYorkBlocked(new Request('http://example.com/mcp'))).toBe(false);
	});

	it('trusts request.cf over conflicting client-set headers (NY in cf wins)', () => {
		// Attacker tries to bypass NY block by sending non-NY CF-* headers,
		// but the server-populated cf-object correctly reports NY.
		const request = requestWithGeo('http://example.com/mcp', {
			country: 'US',
			region: 'California',
			cfCountry: 'US',
			cfRegion: 'NY',
		});
		expect(isNewYorkBlocked(request)).toBe(true);
	});

	it('trusts request.cf over conflicting client-set headers (non-NY in cf wins)', () => {
		// Conversely: attacker can't *cause* a block by spoofing NY headers when
		// CF says they are elsewhere.
		const request = requestWithGeo('http://example.com/mcp', {
			country: 'US',
			region: 'New York',
			cfCountry: 'US',
			cfRegion: 'CA',
		});
		expect(isNewYorkBlocked(request)).toBe(false);
	});
});

describe('enforceGeoBlock', () => {
	it('returns 403 JSON for New York', async () => {
		const request = requestWithGeo('http://example.com/mcp', {
			cfCountry: 'US',
			cfRegion: 'NY',
		});
		const response = enforceGeoBlock(request);

		expect(response?.status).toBe(403);
		expect(response?.headers.get('Cache-Control')).toBe('no-cache');
		await expect(response?.json()).resolves.toEqual({
			error: 'Access restricted',
			message: 'Our service is not available in New York State.',
		});
	});

	it('returns null when not blocked', () => {
		const request = requestWithGeo('http://example.com/mcp', {
			country: 'US',
			region: 'Texas',
		});
		expect(enforceGeoBlock(request)).toBeNull();
	});
});

describe('worker geo blocking', () => {
	it('returns 403 on /mcp for New York', async () => {
		const res = await fetchWorker('/mcp', {
			method: 'POST',
			headers: {
				'cf-ipcountry': 'US',
				'cf-ipregion': 'New York',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
		});

		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error).toBe('Access restricted');
	});

	it('returns 403 on health routes for New York', async () => {
		const res = await fetchWorker('/', {
			headers: {
				'cf-ipcountry': 'US',
				'cf-ipregion': 'New York',
			},
		});

		expect(res.status).toBe(403);
	});

	it('allows non-New York requests to reach health routes', async () => {
		const res = await fetchWorker('/', {
			headers: {
				'cf-ipcountry': 'US',
				'cf-ipregion': 'California',
			},
		});

		expect(res.status).toBe(200);
	});
});
