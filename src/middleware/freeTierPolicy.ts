import { classifyRoute } from '../config/rateLimits.js';

/**
 * Free-tier endpoint policy. Same REST surface as Builder; only rate limits differ.
 * Cross-account reads and all prepare writes are allowed (write bucket + on-chain auth).
 */
export function enforceFreeTierPolicy(method: string, pathname: string): Response | null {
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

	// Cap search pagination on free tier.
	if (method === 'GET' && path === '/api/subscriptions') {
		// Enforcement of first≤10 happens at handler level via query clamp; policy pass-through here.
	}

	void classifyRoute(method, pathname);
	return null;
}