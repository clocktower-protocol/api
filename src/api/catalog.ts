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
import { getDefaultRestChainId, listChainCatalog } from '../chain.js';
import { isDeveloperKeysEnabled } from '../auth/apiKeys.js';
import { jsonResponse } from './responses.js';
import { API_ROUTE_MANIFEST } from './x402.js';

export function handleGetCatalog(env: Env) {
	const apiOrigin = getPublicApiOrigin(env);
	const developerEnabled = isDeveloperKeysEnabled(env);
	const defaultChainId = getDefaultRestChainId(env);
	return jsonResponse({
		version: '3',
		chainId: defaultChainId,
		chains: listChainCatalog(env),
		hosts: {
			api: apiOrigin,
			mcp: getPublicMcpOrigin(env),
		},
		siweDomain: getSiweDomain(env),
		pathNote:
			'On api host, omit the /api prefix (e.g. GET /catalog). Legacy workers.dev URLs keep /api. Protocol routes accept optional ?chainId= (decimal or CAIP-2 eip155:<id>); omitted uses DEFAULT_REST_CHAIN_ID.',
		access: {
			rest: {
				free: {
					auth: 'none',
					limits: DEFAULT_TIER_LIMITS.free,
					note: 'Highly metered; cross-account reads under expensive bucket',
				},
				developer: {
					auth: 'API key (Authorization: Bearer ctk_…)',
					enabled: developerEnabled,
					limits: DEFAULT_TIER_LIMITS.developer,
					note: 'Free developer tier. Keys are minted via admin/portal (POST /developer/keys). MCP is separate (x402).',
					management: {
						create: `${apiOrigin}/developer/keys`,
						list: `${apiOrigin}/developer/keys?subjectId=`,
						revoke: `${apiOrigin}/developer/keys/:id`,
						adminAuth: 'Bearer <DEVELOPER_KEYS_ADMIN_SECRET> or X-Clocktower-Admin-Key',
					},
				},
				builder: {
					auth: 'SIWE session (Bearer cts_…)',
					enabled: isEntitlementAuthEnabled(env),
					entitlementSubscriptionIds: getEntitlementSubscriptionIds(env),
					note: 'Optional higher tier when entitlement IDs are configured; off when none set',
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
		developerKeysEnabled: developerEnabled,
		builderAuthEnabled: isEntitlementAuthEnabled(env),
		routes: API_ROUTE_MANIFEST.map(({ method, path, description }) => ({
			method,
			path,
			description,
		})),
	});
}