import { classifyRoute } from '../config/rateLimits.js';

/** Free-tier max page size for GET /api/subscriptions search. */
export const FREE_SEARCH_MAX_FIRST = 10;

/**
 * Free-tier endpoint policy. Same REST surface as Builder; only rate limits differ.
 * Cross-account reads and all prepare writes are allowed (write bucket + on-chain auth).
 *
 * Search cost controls (first / includeDetails) are also enforced in the discovery
 * handler via the server-set lane header; this middleware rejects abusive free queries early.
 */
export function enforceFreeTierPolicy(
	method: string,
	pathname: string,
	request?: Request,
): Response | null {
	const path = pathname.split('?')[0];

	// Block :me routes without a session — callers must use explicit addresses on free lane.
	if (path.includes('/me')) {
		return Response.json(
			{
				error: 'Use an explicit wallet address on the free tier, or authenticate with a Builder session for :me routes',
				code: 'FORBIDDEN',
			},
			{ status: 403, headers: { 'X-Clocktower-Lane': 'free' } },
		);
	}

	// Cap search pagination / detail expansion on free tier (cost amplification).
	if (method === 'GET' && path === '/api/subscriptions' && request) {
		const url = new URL(request.url);
		const firstRaw = url.searchParams.get('first');
		if (firstRaw !== null) {
			const first = Number(firstRaw);
			if (Number.isInteger(first) && first > FREE_SEARCH_MAX_FIRST) {
				return Response.json(
					{
						error: `Free tier search first must be 1–${FREE_SEARCH_MAX_FIRST}`,
						code: 'VALIDATION_ERROR',
					},
					{ status: 400, headers: { 'X-Clocktower-Lane': 'free' } },
				);
			}
		}
		if (url.searchParams.get('includeDetails') === 'true') {
			return Response.json(
				{
					error: 'Free tier does not support includeDetails=true; omit it or authenticate as Builder',
					code: 'VALIDATION_ERROR',
				},
				{ status: 400, headers: { 'X-Clocktower-Lane': 'free' } },
			);
		}
	}

	void classifyRoute(method, pathname);
	return null;
}
