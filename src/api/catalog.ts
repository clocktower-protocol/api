import { DEFAULT_TIER_LIMITS } from '../config/rateLimits.js';
import { isApiEnabled } from '../config/apiAccess.js';
import { isMcpX402Enabled } from '../config/mcpX402.js';
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
					note: isMcpX402Enabled(env)
						? 'Free developer tier. Keys are minted via admin/portal (POST /developer/keys). MCP uses x402 when MCP_X402_ENABLED=true.'
						: 'Free developer tier. Keys are minted via admin/portal (POST /developer/keys). The same keys authenticate MCP when x402 is off.',
					management: {
						create: `${apiOrigin}/developer/keys`,
						list: `${apiOrigin}/developer/keys`,
						listBySubject: `${apiOrigin}/developer/keys?subjectId=`,
						get: `${apiOrigin}/developer/keys/:id`,
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
			mcp: isMcpX402Enabled(env)
				? {
						auth: 'x402 (USDC on Base)',
						limits: DEFAULT_TIER_LIMITS.mcp,
					}
				: {
						auth: 'none (free IP) or Bearer ctk_… (developer). Invalid ctk_ → 401. No SIWE/Builder.',
						x402: false,
						limits: {
							free: DEFAULT_TIER_LIMITS.free,
							developer: DEFAULT_TIER_LIMITS.developer,
						},
						note: 'Set MCP_X402_ENABLED=true to restore per-tool USDC payments.',
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