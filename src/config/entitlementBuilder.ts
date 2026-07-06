/**
 * Builder entitlement subscription policy.
 * See SUBSCRIPTION_ENTITLEMENT_AUTH.md for product rationale.
 */

export type EntitlementRouteRule =
	| { kind: 'always' }
	| { kind: 'me_only' }
	| { kind: 'content_read'; param: 'id' }
	| { kind: 'content_history'; param: 'id' }
	| { kind: 'subscriber_write' }
	| { kind: 'denied' };

export type EntitlementRoute = {
	method: 'GET' | 'POST';
	pathPattern: RegExp;
	rule: EntitlementRouteRule;
};

export const BUILDER_ENTITLEMENT_ROUTES: EntitlementRoute[] = [
	{ method: 'GET', pathPattern: /^\/api\/catalog$/, rule: { kind: 'always' } },
	{ method: 'GET', pathPattern: /^\/api\/protocol\/state$/, rule: { kind: 'always' } },
	{ method: 'GET', pathPattern: /^\/api\/status$/, rule: { kind: 'always' } },
	{ method: 'GET', pathPattern: /^\/api\/approved-tokens$/, rule: { kind: 'always' } },
	{ method: 'GET', pathPattern: /^\/api\/approved-tokens\/[^/]+$/, rule: { kind: 'always' } },
	{ method: 'GET', pathPattern: /^\/api\/subscriptions$/, rule: { kind: 'always' } },
	{ method: 'GET', pathPattern: /^\/api\/subscriptions\/due$/, rule: { kind: 'always' } },
	{ method: 'GET', pathPattern: /^\/api\/accounts\/me$/, rule: { kind: 'me_only' } },
	{ method: 'GET', pathPattern: /^\/api\/accounts\/me\/subscriptions$/, rule: { kind: 'me_only' } },
	{ method: 'GET', pathPattern: /^\/api\/accounts\/me\/activity$/, rule: { kind: 'me_only' } },
	{ method: 'GET', pathPattern: /^\/api\/subscriptions\/[^/]+$/, rule: { kind: 'content_read', param: 'id' } },
	{ method: 'GET', pathPattern: /^\/api\/subscriptions\/[^/]+\/details$/, rule: { kind: 'content_read', param: 'id' } },
	{ method: 'GET', pathPattern: /^\/api\/subscriptions\/[^/]+\/history$/, rule: { kind: 'content_history', param: 'id' } },
	{ method: 'GET', pathPattern: /^\/api\/subscriptions\/[^/]+\/fee-balance$/, rule: { kind: 'content_history', param: 'id' } },
	{ method: 'GET', pathPattern: /^\/api\/subscriptions\/[^/]+\/subscribers$/, rule: { kind: 'denied' } },
	{ method: 'GET', pathPattern: /^\/api\/accounts\/[^/]+$/, rule: { kind: 'denied' } },
	{ method: 'GET', pathPattern: /^\/api\/accounts\/[^/]+\/subscriptions$/, rule: { kind: 'denied' } },
	{ method: 'GET', pathPattern: /^\/api\/accounts\/[^/]+\/activity$/, rule: { kind: 'denied' } },
	{ method: 'GET', pathPattern: /^\/api\/providers\/[^/]+$/, rule: { kind: 'denied' } },
	{ method: 'GET', pathPattern: /^\/api\/subscriptions\/[^/]+\/details-history$/, rule: { kind: 'denied' } },
	{ method: 'POST', pathPattern: /^\/api\/check_subscribe_readiness$/, rule: { kind: 'subscriber_write' } },
	{ method: 'POST', pathPattern: /^\/api\/check_remit_readiness$/, rule: { kind: 'subscriber_write' } },
	{ method: 'POST', pathPattern: /^\/api\/prepare\/create_subscription$/, rule: { kind: 'subscriber_write' } },
	{ method: 'POST', pathPattern: /^\/api\/prepare\/subscribe$/, rule: { kind: 'subscriber_write' } },
	{ method: 'POST', pathPattern: /^\/api\/prepare\/unsubscribe$/, rule: { kind: 'subscriber_write' } },
	{ method: 'POST', pathPattern: /^\/api\/prepare\/remit$/, rule: { kind: 'subscriber_write' } },
	{ method: 'POST', pathPattern: /^\/api\/transactions\/status$/, rule: { kind: 'subscriber_write' } },
	{ method: 'POST', pathPattern: /^\/api\/prepare\/cancel_subscription$/, rule: { kind: 'subscriber_write' } },
	{ method: 'POST', pathPattern: /^\/api\/prepare\/unsubscribe_by_provider$/, rule: { kind: 'subscriber_write' } },
	{ method: 'POST', pathPattern: /^\/api\/prepare\/edit_details$/, rule: { kind: 'subscriber_write' } },
];

const ENTITLEMENT_ID_PATTERN = /^0x[a-fA-F0-9]{64}$/;

function normalizeEntitlementId(id: string): `0x${string}` | null {
	const trimmed = id.trim();
	if (!ENTITLEMENT_ID_PATTERN.test(trimmed)) {
		return null;
	}
	return trimmed.toLowerCase() as `0x${string}`;
}

/**
 * All configured Builder entitlement subscription IDs. A wallet ACTIVE on any
 * ID receives the same Builder lane (Option A — identical API access).
 *
 * Sources (merged, de-duplicated):
 *   - BUILDER_SUB_IDS — comma-separated list (preferred for multiple plans)
 *   - BUILDER_SUB_ID — legacy single ID (still supported)
 */
export function getEntitlementSubscriptionIds(env: Env): `0x${string}`[] {
	const raw: string[] = [];

	const list = env.BUILDER_SUB_IDS?.trim();
	if (list) {
		raw.push(...list.split(',').map((entry) => entry.trim()).filter(Boolean));
	}

	const single = env.BUILDER_SUB_ID?.trim();
	if (single) {
		raw.push(single);
	}

	const seen = new Set<string>();
	const ids: `0x${string}`[] = [];
	for (const entry of raw) {
		const normalized = normalizeEntitlementId(entry);
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		ids.push(normalized);
	}

	return ids;
}

export function isEntitlementAuthEnabled(env: Env): boolean {
	return getEntitlementSubscriptionIds(env).length > 0;
}

/** @deprecated Prefer getEntitlementSubscriptionIds — returns the first configured ID. */
export function getEntitlementSubscriptionId(env: Env): `0x${string}` | null {
	return getEntitlementSubscriptionIds(env)[0] ?? null;
}

export function isConfiguredEntitlementSubscriptionId(
	env: Env,
	subscriptionId: string,
): boolean {
	const target = subscriptionId.toLowerCase();
	return getEntitlementSubscriptionIds(env).some((id) => id.toLowerCase() === target);
}

export function findEntitlementRoute(method: string, pathname: string): EntitlementRoute | null {
	const path = pathname.split('?')[0];
	for (const route of BUILDER_ENTITLEMENT_ROUTES) {
		if (route.method === method && route.pathPattern.test(path)) {
			return route;
		}
	}
	return null;
}

export function extractSubscriptionId(pathname: string): string | null {
	const path = pathname.split('?')[0];
	const match = path.match(/^\/api\/subscriptions\/([^/]+)/);
	return match?.[1] ?? null;
}