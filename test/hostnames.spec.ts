import { describe, expect, it } from 'vitest';
import {
	classifyRequestSurface,
	getSiweDomain,
	normalizePathname,
	rewriteRequestForSurface,
	shouldHandleApiRoute,
	surfaceMismatchResponse,
} from '../src/config/hostnames.js';

const prodEnv = {
	API_HOST: 'api.clocktower.finance',
	MCP_HOST: 'mcp.clocktower.finance',
	SIWE_DOMAIN: 'api.clocktower.finance',
} as Env;

describe('hostnames config', () => {
	it('defaults SIWE domain to api.clocktower.finance', () => {
		expect(getSiweDomain({} as Env)).toBe('api.clocktower.finance');
		expect(getSiweDomain(prodEnv)).toBe('api.clocktower.finance');
	});

	it('classifies production subdomains', () => {
		expect(classifyRequestSurface('api.clocktower.finance', prodEnv)).toBe('api');
		expect(classifyRequestSurface('mcp.clocktower.finance', prodEnv)).toBe('mcp');
		expect(classifyRequestSurface('example.com', prodEnv)).toBe('legacy');
	});

	it('normalizes api host paths without /api prefix', () => {
		expect(normalizePathname('/catalog', 'api')).toBe('/api/catalog');
		expect(normalizePathname('/protocol/state', 'api')).toBe('/api/protocol/state');
		expect(normalizePathname('/auth/challenge', 'api')).toBe('/api/auth/challenge');
		expect(normalizePathname('/', 'api')).toBe('/');
		expect(normalizePathname('/api/status', 'api')).toBe('/api/status');
	});

	it('normalizes mcp host root to /mcp', () => {
		expect(normalizePathname('/', 'mcp')).toBe('/mcp');
		expect(normalizePathname('/mcp', 'mcp')).toBe('/mcp');
	});

	it('keeps legacy paths unchanged', () => {
		expect(normalizePathname('/api/catalog', 'legacy')).toBe('/api/catalog');
		expect(normalizePathname('/mcp', 'legacy')).toBe('/mcp');
	});

	it('rewrites request URLs for dedicated hosts', () => {
		const request = new Request('https://api.clocktower.finance/catalog');
		const routed = rewriteRequestForSurface(request, prodEnv);
		expect(routed.surface).toBe('api');
		expect(routed.pathname).toBe('/api/catalog');
		expect(new URL(routed.request.url).pathname).toBe('/api/catalog');
	});

	it('routes api host root through the API handler', () => {
		expect(shouldHandleApiRoute('/', 'api')).toBe(true);
		expect(shouldHandleApiRoute('/', 'legacy')).toBe(false);
	});

	it('rejects cross-surface paths on dedicated hosts', () => {
		const apiMismatch = surfaceMismatchResponse('api', '/mcp', prodEnv);
		expect(apiMismatch?.status).toBe(404);

		const mcpMismatch = surfaceMismatchResponse('mcp', '/api/catalog', prodEnv);
		expect(mcpMismatch?.status).toBe(404);
	});
});