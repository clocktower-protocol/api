import { checkRateLimit, RATE_LIMITER_WINDOW_MS } from './RateLimiter.js';
import {
	type AccessLane,
	classifyRoute,
	getTierLimits,
	getUpgradeHint,
	isSubgraphRoute,
	usesWriteRateBucket,
	type RouteClass,
	type TierLimitConfig,
} from './config/rateLimits.js';

const WINDOW_MS = RATE_LIMITER_WINDOW_MS;
const DAY_MS = 86_400_000;
const DEFAULT_REQUESTS_PER_MINUTE = 60;

export type RateLimitResult = {
	ok: boolean;
	limit: number;
	current: number;
	resetMs: number;
	bucket: string;
};

export function getRateLimit(env: Env): number {
	const configured = env.RATE_LIMIT_REQUESTS_PER_MINUTE;
	if (configured === undefined) {
		return DEFAULT_REQUESTS_PER_MINUTE;
	}

	const parsed = Number.parseInt(configured, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUESTS_PER_MINUTE;
}

function dailyWindowKey(now = Date.now()): string {
	return new Date(now).toISOString().slice(0, 10);
}

async function checkBucket(
	env: Env,
	bucket: string,
	limit: number,
	windowMs: number = WINDOW_MS,
): Promise<RateLimitResult> {
	const result = await checkRateLimit(env.RATE_LIMITER, bucket, limit, windowMs);
	return {
		ok: result.ok,
		limit: result.limit,
		current: result.current,
		resetMs: result.resetMs,
		bucket,
	};
}

function buildRateLimitResponse(
	lane: AccessLane,
	result: RateLimitResult,
): Response {
	return Response.json(
		{
			error: 'Rate limit exceeded',
			code: 'RATE_LIMITED',
			lane,
			limit: result.limit,
			bucket: result.bucket,
			windowSeconds: WINDOW_MS / 1000,
			upgradeHint: getUpgradeHint(lane),
		},
		{
			status: 429,
			headers: {
				'Retry-After': String(Math.ceil(result.resetMs / 1000)),
				'X-Clocktower-Lane': lane,
				'X-RateLimit-Limit': String(result.limit),
				'X-RateLimit-Remaining': String(Math.max(0, result.limit - result.current)),
			},
		},
	);
}

export async function enforceTierRateLimits(
	request: Request,
	env: Env,
	lane: AccessLane,
	identityKey: string,
): Promise<Response | null> {
	const url = new URL(request.url);
	const routeClass = classifyRoute(request.method, url.pathname);
	const limits = getTierLimits(env, lane);

	const globalBucket = `${lane}:${identityKey}`;
	const global = await checkBucket(env, globalBucket, limits.globalRpm);
	if (!global.ok) {
		return buildRateLimitResponse(lane, global);
	}

	// Daily total request budget (volume / bandwidth proxy). Skip when unlimited.
	if (Number.isFinite(limits.dailyTotalRequests) && limits.dailyTotalRequests < Number.MAX_SAFE_INTEGER) {
		const day = dailyWindowKey();
		const dailyTotal = await checkBucket(
			env,
			`${lane}:${identityKey}:day:${day}`,
			limits.dailyTotalRequests,
			DAY_MS,
		);
		if (!dailyTotal.ok) {
			return buildRateLimitResponse(lane, dailyTotal);
		}
	}

	if (routeClass === 'expensive') {
		const expensive = await checkBucket(
			env,
			`${lane}:${identityKey}:expensive`,
			limits.expensiveRpm,
		);
		if (!expensive.ok) {
			return buildRateLimitResponse(lane, expensive);
		}

		if (isSubgraphRoute(routeClass) && Number.isFinite(limits.subgraphDaily)) {
			const day = dailyWindowKey();
			const daily = await checkBucket(
				env,
				`${lane}:${identityKey}:subgraph-day:${day}`,
				limits.subgraphDaily,
				DAY_MS,
			);
			if (!daily.ok) {
				return buildRateLimitResponse(lane, daily);
			}
		}
	}

	if (usesWriteRateBucket(routeClass)) {
		const write = await checkBucket(
			env,
			`${lane}:${identityKey}:write`,
			limits.writeRpm,
		);
		if (!write.ok) {
			return buildRateLimitResponse(lane, write);
		}
	}

	return null;
}

/** @deprecated Use enforceTierRateLimits with lane 'free' or legacy global IP limit. */
export async function enforceRateLimit(request: Request, env: Env): Promise<Response | null> {
	const limit = getRateLimit(env);
	const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
	return enforceTierRateLimits(request, env, 'free', `ip:${ip}`);
}

export async function enforceMcpRateLimit(request: Request, env: Env): Promise<Response | null> {
	const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
	return enforceTierRateLimits(request, env, 'mcp', `ip:${ip}`);
}

const DEFAULT_WRITE_REQUESTS_PER_MINUTE = 10;

export function getWriteRateLimit(env: Env, lane: AccessLane = 'free'): number {
	return getTierLimits(env, lane).writeRpm;
}

export async function enforceWriteRateLimitForAddress(
	env: Env,
	address: string,
	lane: AccessLane = 'free',
): Promise<void> {
	const limit = getWriteRateLimit(env, lane);
	const prefix =
		lane === 'mcp'
			? 'mcp'
			: lane === 'builder'
				? 'builder'
				: lane === 'developer'
					? 'developer'
					: 'free';
	const result = await checkRateLimit(
		env.RATE_LIMITER,
		`${prefix}:wr:${address.toLowerCase()}`,
		limit,
		WINDOW_MS,
	);
	if (!result.ok) {
		throw new Error(`Write rate limit exceeded (${limit} requests per minute)`);
	}
}

/** Secondary IP ceiling so multi-key abuse from one IP is bounded. */
export async function enforceSecondaryIpRateLimit(
	request: Request,
	env: Env,
	limitRpm = 300,
): Promise<Response | null> {
	const ip = getClientIp(request);
	const result = await checkBucket(env, `ip-ceiling:${ip}`, limitRpm);
	if (!result.ok) {
		return buildRateLimitResponse('free', { ...result, bucket: result.bucket });
	}
	return null;
}

/** Limit invalid API-key presentation attempts per IP (DoS / stuffing). */
export async function enforceAuthFailRateLimit(
	request: Request,
	env: Env,
	limitRpm = 30,
): Promise<Response | null> {
	const ip = getClientIp(request);
	const result = await checkBucket(env, `auth-fail:${ip}`, limitRpm);
	if (!result.ok) {
		return Response.json(
			{
				error: 'Too many failed authentication attempts',
				code: 'AUTH_RATE_LIMITED',
				limit: result.limit,
				bucket: result.bucket,
			},
			{
				status: 429,
				headers: {
					'Retry-After': String(Math.ceil(result.resetMs / 1000)),
					'X-RateLimit-Limit': String(result.limit),
				},
			},
		);
	}
	return null;
}

export function getClientIp(request: Request): string {
	return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

export { classifyRoute, getTierLimits, type AccessLane, type RouteClass, type TierLimitConfig };