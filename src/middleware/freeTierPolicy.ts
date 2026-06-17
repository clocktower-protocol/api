import { classifyRoute } from '../config/rateLimits.js';

const PROVIDER_WRITE_PATHS = new Set([
	'/api/prepare/cancel_subscription',
	'/api/prepare/unsubscribe_by_provider',
	'/api/prepare/edit_details',
]);

/**
 * Free-tier endpoint policy. Cross-account and provider reads are allowed
 * (expensive bucket handles abuse). Provider management writes are denied.
 */
export function enforceFreeTierPolicy(method: string, pathname: string): Response | null {
	const path = pathname.split('?')[0];

	if (method === 'POST' && PROVIDER_WRITE_PATHS.has(path)) {
		return Response.json(
			{
				error: 'Provider management writes require a Builder entitlement session',
				code: 'FORBIDDEN',
				upgradeHint:
					'Subscribe to the Clocktower Builder entitlement subscription and authenticate via SIWE.',
			},
			{ status: 403, headers: { 'X-Clocktower-Lane': 'free' } },
		);
	}

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