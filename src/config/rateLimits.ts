/**
 * Tier-aware rate limit configuration and route classification.
 */

export type AccessLane = 'free' | 'builder' | 'mcp';

export type RouteClass = 'cheap' | 'expensive' | 'readiness' | 'write';

export type TierLimitConfig = {
	globalRpm: number;
	expensiveRpm: number;
	subgraphDaily: number;
	writeRpm: number;
};

export const DEFAULT_TIER_LIMITS: Record<AccessLane, TierLimitConfig> = {
	free: { globalRpm: 20, expensiveRpm: 3, subgraphDaily: 100, writeRpm: 2 },
	builder: { globalRpm: 120, expensiveRpm: 120, subgraphDaily: 10_000, writeRpm: 30 },
	mcp: { globalRpm: 300, expensiveRpm: 300, subgraphDaily: Number.MAX_SAFE_INTEGER, writeRpm: 60 },
};

const READINESS_PATHS = new Set([
	'/api/check_subscribe_readiness',
	'/api/check_remit_readiness',
]);

const WRITE_PATH_PREFIX = '/api/prepare/';

const EXPENSIVE_GET_PATTERNS: Array<{ pattern: RegExp; note: string }> = [
	{ pattern: /^\/api\/subscriptions$/, note: 'search' },
	{ pattern: /^\/api\/subscriptions\/[^/]+\/details$/, note: 'details' },
	{ pattern: /^\/api\/subscriptions\/[^/]+\/history$/, note: 'history' },
	{ pattern: /^\/api\/subscriptions\/[^/]+\/details-history$/, note: 'details-history' },
	{ pattern: /^\/api\/subscriptions\/[^/]+\/subscribers$/, note: 'subscribers' },
	{ pattern: /^\/api\/accounts\/[^/]+\/activity$/, note: 'activity' },
	{ pattern: /^\/api\/accounts\/[^/]+\/subscriptions$/, note: 'account-subs' },
	{ pattern: /^\/api\/accounts\/[^/]+$/, note: 'account' },
	{ pattern: /^\/api\/providers\/[^/]+$/, note: 'provider' },
];

export function isSubgraphRoute(routeClass: RouteClass): boolean {
	return routeClass === 'expensive';
}

export function parseEnvLimit(
	value: string | undefined,
	fallback: number,
): number {
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getTierLimits(env: Env, lane: AccessLane): TierLimitConfig {
	const defaults = DEFAULT_TIER_LIMITS[lane];
	return {
		globalRpm: parseEnvLimit(
			lane === 'free'
				? env.FREE_RATE_LIMIT_RPM
				: lane === 'builder'
					? env.BUILDER_RATE_LIMIT_RPM
					: env.MCP_RATE_LIMIT_RPM,
			defaults.globalRpm,
		),
		expensiveRpm: parseEnvLimit(
			lane === 'free' ? env.FREE_EXPENSIVE_RATE_LIMIT_RPM : undefined,
			defaults.expensiveRpm,
		),
		subgraphDaily: parseEnvLimit(
			lane === 'free'
				? env.FREE_SUBGRAPH_DAILY_LIMIT
				: lane === 'builder'
					? env.BUILDER_SUBGRAPH_DAILY_LIMIT
					: undefined,
			defaults.subgraphDaily,
		),
		writeRpm: parseEnvLimit(
			lane === 'free'
				? env.FREE_WRITE_RATE_LIMIT_RPM
				: lane === 'builder'
					? env.BUILDER_WRITE_RATE_LIMIT_RPM
					: env.MCP_WRITE_RATE_LIMIT_RPM ?? env.WRITE_RATE_LIMIT_REQUESTS_PER_MINUTE,
			defaults.writeRpm,
		),
	};
}

/** Routes that consume the per-tier write RPM bucket (prepare + readiness checks). */
export function usesWriteRateBucket(routeClass: RouteClass): boolean {
	return routeClass === 'write' || routeClass === 'readiness';
}

export function classifyRoute(method: string, pathname: string): RouteClass {
	const path = pathname.split('?')[0];

	if (method === 'POST') {
		if (READINESS_PATHS.has(path)) {
			return 'readiness';
		}
		if (path.startsWith(WRITE_PATH_PREFIX)) {
			return 'write';
		}
	}

	if (method === 'GET') {
		for (const { pattern } of EXPENSIVE_GET_PATTERNS) {
			if (pattern.test(path)) {
				return 'expensive';
			}
		}
	}

	return 'cheap';
}

export function getUpgradeHint(lane: AccessLane): string {
	if (lane === 'free') {
		return 'Subscribe to the Clocktower Builder entitlement subscription for higher limits, or use MCP with x402 for agents.';
	}
	if (lane === 'builder') {
		return 'Rate limit exceeded for your Builder session. Retry after the window resets.';
	}
	return 'Rate limit exceeded. Retry after the window resets.';
}