/**
 * Tier-aware rate limit configuration and route classification.
 */

export type AccessLane = 'free' | 'developer' | 'builder' | 'mcp';

export type RouteClass = 'cheap' | 'expensive' | 'readiness' | 'write';

export type TierLimitConfig = {
	globalRpm: number;
	expensiveRpm: number;
	subgraphDaily: number;
	writeRpm: number;
	/**
	 * Total requests per UTC day for this lane+identity.
	 * Use Number.MAX_SAFE_INTEGER when unlimited (or not enforced).
	 */
	dailyTotalRequests: number;
};

export const DEFAULT_TIER_LIMITS: Record<AccessLane, TierLimitConfig> = {
	free: {
		globalRpm: 20,
		expensiveRpm: 3,
		subgraphDaily: 100,
		writeRpm: 2,
		dailyTotalRequests: 500,
	},
	developer: {
		globalRpm: 80,
		expensiveRpm: 40,
		subgraphDaily: 3_000,
		writeRpm: 15,
		dailyTotalRequests: 10_000,
	},
	builder: {
		globalRpm: 120,
		expensiveRpm: 120,
		subgraphDaily: 10_000,
		writeRpm: 30,
		dailyTotalRequests: Number.MAX_SAFE_INTEGER,
	},
	mcp: {
		globalRpm: 300,
		expensiveRpm: 300,
		subgraphDaily: Number.MAX_SAFE_INTEGER,
		writeRpm: 60,
		dailyTotalRequests: Number.MAX_SAFE_INTEGER,
	},
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

function globalRpmEnv(env: Env, lane: AccessLane): string | undefined {
	switch (lane) {
		case 'free':
			return env.FREE_RATE_LIMIT_RPM;
		case 'developer':
			return env.DEVELOPER_RATE_LIMIT_RPM;
		case 'builder':
			return env.BUILDER_RATE_LIMIT_RPM;
		case 'mcp':
			return env.MCP_RATE_LIMIT_RPM;
	}
}

function expensiveRpmEnv(env: Env, lane: AccessLane): string | undefined {
	switch (lane) {
		case 'free':
			return env.FREE_EXPENSIVE_RATE_LIMIT_RPM;
		case 'developer':
			return env.DEVELOPER_EXPENSIVE_RATE_LIMIT_RPM;
		case 'builder':
			return env.BUILDER_EXPENSIVE_RATE_LIMIT_RPM;
		case 'mcp':
			return env.MCP_EXPENSIVE_RATE_LIMIT_RPM;
	}
}

function subgraphDailyEnv(env: Env, lane: AccessLane): string | undefined {
	switch (lane) {
		case 'free':
			return env.FREE_SUBGRAPH_DAILY_LIMIT;
		case 'developer':
			return env.DEVELOPER_SUBGRAPH_DAILY_LIMIT;
		case 'builder':
			return env.BUILDER_SUBGRAPH_DAILY_LIMIT;
		case 'mcp':
			return undefined;
	}
}

function writeRpmEnv(env: Env, lane: AccessLane): string | undefined {
	switch (lane) {
		case 'free':
			return env.FREE_WRITE_RATE_LIMIT_RPM;
		case 'developer':
			return env.DEVELOPER_WRITE_RATE_LIMIT_RPM;
		case 'builder':
			return env.BUILDER_WRITE_RATE_LIMIT_RPM;
		case 'mcp':
			return env.MCP_WRITE_RATE_LIMIT_RPM ?? env.WRITE_RATE_LIMIT_REQUESTS_PER_MINUTE;
	}
}

function dailyTotalEnv(env: Env, lane: AccessLane): string | undefined {
	switch (lane) {
		case 'free':
			return env.FREE_DAILY_REQUEST_LIMIT;
		case 'developer':
			return env.DEVELOPER_DAILY_REQUEST_LIMIT;
		case 'builder':
			return env.BUILDER_DAILY_REQUEST_LIMIT;
		case 'mcp':
			return undefined;
	}
}

export function getTierLimits(env: Env, lane: AccessLane): TierLimitConfig {
	const defaults = DEFAULT_TIER_LIMITS[lane];
	return {
		globalRpm: parseEnvLimit(globalRpmEnv(env, lane), defaults.globalRpm),
		expensiveRpm: parseEnvLimit(expensiveRpmEnv(env, lane), defaults.expensiveRpm),
		subgraphDaily: parseEnvLimit(subgraphDailyEnv(env, lane), defaults.subgraphDaily),
		writeRpm: parseEnvLimit(writeRpmEnv(env, lane), defaults.writeRpm),
		dailyTotalRequests: parseEnvLimit(dailyTotalEnv(env, lane), defaults.dailyTotalRequests),
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
		return 'Get a free developer API key for higher limits, or use MCP with x402 for agents.';
	}
	if (lane === 'developer') {
		return 'Developer API key rate limit exceeded. Reduce request volume or retry after the window resets.';
	}
	if (lane === 'builder') {
		return 'Rate limit exceeded for your Builder session. Retry after the window resets.';
	}
	return 'Rate limit exceeded. Retry after the window resets.';
}

/** Search pagination cap by lane (cost amplification control). */
export function getSearchMaxFirst(lane: AccessLane): number {
	if (lane === 'free') return 10;
	if (lane === 'developer') return 25;
	return 50;
}