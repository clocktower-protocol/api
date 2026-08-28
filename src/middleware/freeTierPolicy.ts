import type { AccessLane } from '../config/rateLimits.js';
import {
	getSearchMaxFirst,
	mcpToolArgumentsFromJsonRpc,
	mcpToolNameFromBody,
} from '../config/rateLimits.js';

/** Free-tier max page size for GET /api/subscriptions search. */
export const FREE_SEARCH_MAX_FIRST = 10;
/** Developer-tier max page size for search. */
export const DEVELOPER_SEARCH_MAX_FIRST = 25;

/**
 * Shared search pagination / includeDetails rules for REST query params and MCP tools.
 * Returns an error message when the call is not allowed for this lane.
 */
export function getSearchArgsPolicyError(
	lane: AccessLane,
	first?: number,
	includeDetails?: boolean,
): string | null {
	if (lane !== 'free' && lane !== 'developer') {
		return null;
	}
	const maxFirst = getSearchMaxFirst(lane);
	if (first != null && Number.isInteger(first) && first > maxFirst) {
		return `${lane === 'free' ? 'Free' : 'Developer'} tier search first must be 1–${maxFirst}`;
	}
	if (lane === 'free' && includeDetails === true) {
		return 'Free tier does not support includeDetails=true; use a developer API key or Builder session';
	}
	return null;
}

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
		const first =
			firstRaw !== null && Number.isInteger(Number(firstRaw)) ? Number(firstRaw) : undefined;
		const includeDetails = url.searchParams.get('includeDetails') === 'true';
		const error = getSearchArgsPolicyError(lane, first, includeDetails);
		if (error) {
			return Response.json(
				{ error, code: 'VALIDATION_ERROR' },
				{ status: 400, headers: { 'X-Clocktower-Lane': lane } },
			);
		}
	}

	return null;
}

/** HTTP 400 when unpaid MCP `search_subscriptions` exceeds free/developer caps. */
export function mcpSearchPolicyResponse(lane: AccessLane, body: unknown): Response | null {
	if (mcpToolNameFromBody(body) !== 'search_subscriptions') {
		return null;
	}
	const args = mcpToolArgumentsFromJsonRpc(body) ?? {};
	const firstRaw = args.first;
	const first = typeof firstRaw === 'number' ? firstRaw : undefined;
	const includeDetails = args.includeDetails === true;
	const error = getSearchArgsPolicyError(lane, first, includeDetails);
	if (!error) {
		return null;
	}
	return Response.json(
		{ error, code: 'VALIDATION_ERROR' },
		{ status: 400, headers: { 'X-Clocktower-Lane': lane } },
	);
}

/** @deprecated Prefer enforceLanePolicy('free', …) */
export function enforceFreeTierPolicy(
	method: string,
	pathname: string,
	request?: Request,
): Response | null {
	return enforceLanePolicy('free', method, pathname, request);
}
