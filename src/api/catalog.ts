import { DEFAULT_TIER_LIMITS } from '../config/rateLimits.js';
import { isApiEnabled } from '../config/apiAccess.js';
import { isEntitlementAuthEnabled } from '../config/entitlementBuilder.js';
import { jsonResponse } from './responses.js';
import { API_ROUTE_MANIFEST } from './x402.js';

export function handleGetCatalog(env: Env) {
	return jsonResponse({
		version: '2',
		chainId: 8453,
		access: {
			rest: {
				free: {
					auth: 'none',
					limits: DEFAULT_TIER_LIMITS.free,
					note: 'Cross-account and provider reads allowed under expensive bucket',
				},
				builder: {
					auth: 'SIWE session (Bearer token)',
					enabled: 'BUILDER_SUB_ID configured',
					limits: DEFAULT_TIER_LIMITS.builder,
					authEndpoints: ['/api/auth/challenge', '/api/auth/verify'],
				},
			},
			mcp: {
				auth: 'x402 (USDC on Base)',
				limits: DEFAULT_TIER_LIMITS.mcp,
			},
		},
		apiEnabled: isApiEnabled(env),
		builderAuthEnabled: isEntitlementAuthEnabled(env),
		routes: API_ROUTE_MANIFEST.map(({ method, path, description }) => ({
			method,
			path,
			description,
		})),
	});
}