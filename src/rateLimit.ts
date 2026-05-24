const WINDOW_MS = 60_000;
const DEFAULT_REQUESTS_PER_MINUTE = 60;

export function getRateLimit(request: Request, env: Env): number {
	const configured = env.RATE_LIMIT_REQUESTS_PER_MINUTE;
	if (configured === undefined) {
		return DEFAULT_REQUESTS_PER_MINUTE;
	}

	const parsed = Number.parseInt(configured, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUESTS_PER_MINUTE;
}

export async function enforceRateLimit(request: Request, env: Env): Promise<Response | null> {
	const limit = getRateLimit(request, env);
	const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
	const windowKey = Math.floor(Date.now() / WINDOW_MS);
	const key = `rl:${ip}:${windowKey}`;

	const current = Number.parseInt((await env.RATE_LIMIT.get(key)) ?? '0', 10);
	if (current >= limit) {
		return Response.json(
			{
				error: 'Rate limit exceeded',
				limit,
				windowSeconds: WINDOW_MS / 1000,
			},
			{
				status: 429,
				headers: {
					'Retry-After': String(Math.ceil(WINDOW_MS / 1000)),
				},
			},
		);
	}

	await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 120 });
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
	const windowKey = Math.floor(Date.now() / WINDOW_MS);
	const key = `wrl:${address.toLowerCase()}:${windowKey}`;

	const current = Number.parseInt((await env.RATE_LIMIT.get(key)) ?? '0', 10);
	if (current >= limit) {
		throw new Error(`Write rate limit exceeded (${limit} requests per minute)`);
	}

	await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 120 });
}
