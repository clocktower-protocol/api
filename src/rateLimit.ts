import { checkRateLimit, RATE_LIMITER_WINDOW_MS } from './RateLimiter.js';

const WINDOW_MS = RATE_LIMITER_WINDOW_MS;
const DEFAULT_REQUESTS_PER_MINUTE = 60;

export function getRateLimit(env: Env): number {
	const configured = env.RATE_LIMIT_REQUESTS_PER_MINUTE;
	if (configured === undefined) {
		return DEFAULT_REQUESTS_PER_MINUTE;
	}

	const parsed = Number.parseInt(configured, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUESTS_PER_MINUTE;
}

export async function enforceRateLimit(request: Request, env: Env): Promise<Response | null> {
	const limit = getRateLimit(env);
	const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

	const result = await checkRateLimit(env.RATE_LIMITER, `ip:${ip}`, limit, WINDOW_MS);
	if (!result.ok) {
		return Response.json(
			{
				error: 'Rate limit exceeded',
				limit,
				windowSeconds: WINDOW_MS / 1000,
			},
			{
				status: 429,
				headers: {
					'Retry-After': String(Math.ceil(result.resetMs / 1000)),
				},
			},
		);
	}

	return null;
}

const DEFAULT_WRITE_REQUESTS_PER_MINUTE = 10;

export function getWriteRateLimit(env: Env): number {
	const configured = env.WRITE_RATE_LIMIT_REQUESTS_PER_MINUTE;
	if (configured === undefined) {
		return DEFAULT_WRITE_REQUESTS_PER_MINUTE;
	}
	const parsed = Number.parseInt(configured, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WRITE_REQUESTS_PER_MINUTE;
}

export async function enforceWriteRateLimitForAddress(
	env: Env,
	address: string,
): Promise<void> {
	const limit = getWriteRateLimit(env);
	const result = await checkRateLimit(
		env.RATE_LIMITER,
		`wr:${address.toLowerCase()}`,
		limit,
		WINDOW_MS,
	);
	if (!result.ok) {
		throw new Error(`Write rate limit exceeded (${limit} requests per minute)`);
	}
}
