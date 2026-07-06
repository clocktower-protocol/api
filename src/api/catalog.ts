import { DEFAULT_TIER_LIMITS } from '../config/rateLimits.js';
import { isApiEnabled } from '../config/apiAccess.js';
import {
	getEntitlementSubscriptionIds,
	isEntitlementAuthEnabled,
} from '../config/entitlementBuilder.js';
import {
	getPublicApiOrigin,
	getPublicMcpOrigin,
	getSiweDomain,
} from '../config/hostnames.js';
import { jsonResponse } from './responses.js';
import { API_ROUTE_MANIFEST } from './x402.js';

export function handleGetCatalog(env: Env) {
	const apiOrigin = getPublicApiOrigin(env);
	return jsonResponse({
		version: '2',
		chainId: 8453,
		hosts: {
			api: apiOrigin,
			mcp: getPublicMcpOrigin(env),
		},
		siweDomain: getSiweDomain(env),
		pathNote:
			'On api host, omit the /api prefix (e.g. GET /catalog). Legacy workers.dev URLs keep /api.',
		access: {
			rest: {
				free: {
					auth: 'none',
					limits: DEFAULT_TIER_LIMITS.free,
					note: 'Cross-account and provider reads allowed under expensive bucket',
				},
				builder: {
					auth: 'SIWE session (Bearer token)',
					enabled: isEntitlementAuthEnabled(env),
					entitlementSubscriptionIds: getEntitlementSubscriptionIds(env),
					note: 'Any ACTIVE subscription to a configured entitlement ID grants the same Builder access',
					limits: DEFAULT_TIER_LIMITS.builder,
					authEndpoints: [`${apiOrigin}/auth/challenge`, `${apiOrigin}/auth/verify`],
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