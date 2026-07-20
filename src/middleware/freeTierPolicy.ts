import type { AccessLane } from '../config/rateLimits.js';
import { getSearchMaxFirst } from '../config/rateLimits.js';

/** Free-tier max page size for GET /api/subscriptions search. */
export const FREE_SEARCH_MAX_FIRST = 10;
/** Developer-tier max page size for search. */
export const DEVELOPER_SEARCH_MAX_FIRST = 25;

/**
 * Cost / amplification policy for free and developer REST lanes.
 * Cross-account reads and prepare writes are allowed (rate buckets + on-chain auth).
 */
export function enforceLanePolicy(
	lane: AccessLane,
	method: string,
	pathname: string,
	request?: Request,
): Response | null {
	if (lane !== 'free' && lane !== 'developer') {
		return null;
	}

	const path = pathname.split('?')[0];
	const maxFirst = getSearchMaxFirst(lane);

	// :me requires a wallet-bound session (Builder only today).
	if (path.includes('/me')) {
		return Response.json(
			{
				error:
					lane === 'developer'
						? 'Developer API keys cannot use :me routes; use an explicit wallet address'
						: 'Use an explicit wallet address on the free tier, or authenticate with a Builder session for :me routes',
				code: 'FORBIDDEN',
			},
			{ status: 403, headers: { 'X-Clocktower-Lane': lane } },
		);
	}

	if (method === 'GET' && path === '/api/subscriptions' && request) {
		const url = new URL(request.url);
		const firstRaw = url.searchParams.get('first');
		if (firstRaw !== null) {
			const first = Number(firstRaw);
			if (Number.isInteger(first) && first > maxFirst) {
				return Response.json(
					{
						error: `${lane === 'free' ? 'Free' : 'Developer'} tier search first must be 1–${maxFirst}`,
						code: 'VALIDATION_ERROR',
					},
					{ status: 400, headers: { 'X-Clocktower-Lane': lane } },
				);
			}
		}
		if (lane === 'free' && url.searchParams.get('includeDetails') === 'true') {
			return Response.json(
				{
					error:
						'Free tier does not support includeDetails=true; use a developer API key or Builder session',
					code: 'VALIDATION_ERROR',
				},
				{ status: 400, headers: { 'X-Clocktower-Lane': 'free' } },
			);
		}
	}

	return null;
}

/** @deprecated Prefer enforceLanePolicy('free', …) */
export function enforceFreeTierPolicy(
	method: string,
	pathname: string,
	request?: Request,
): Response | null {
	return enforceLanePolicy('free', method, pathname, request);
}
