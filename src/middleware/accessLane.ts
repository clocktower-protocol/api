import type { AccessLane } from '../config/rateLimits.js';
import { isEntitlementAuthEnabled } from '../config/entitlementBuilder.js';
import {
	loadSession,
	parseBearerToken,
	refreshSessionEntitlement,
	type SessionRecord,
	verifyEntitlementForAddress,
} from '../auth/session.js';

export type ResolvedAccess = {
	lane: AccessLane;
	session: SessionRecord | null;
	token: string | null;
};

export async function resolveApiAccess(request: Request, env: Env): Promise<ResolvedAccess> {
	const token = parseBearerToken(request);
	if (!token || !isEntitlementAuthEnabled(env)) {
		return { lane: 'free', session: null, token: null };
	}

	const session = await loadSession(env, token);
	if (!session) {
		return { lane: 'free', session: null, token: null };
	}

	if (session.expiresAt <= Date.now()) {
		return { lane: 'free', session: null, token: null };
	}

	const refreshed = await refreshSessionEntitlement(env, session, token);
	if (!refreshed) {
		return { lane: 'free', session: null, token: null };
	}

	const entitled = await verifyEntitlementForAddress(env, refreshed.address);
	if (!entitled) {
		return { lane: 'free', session: null, token: null };
	}

	return { lane: 'builder', session: refreshed, token };
}

export function getRateLimitIdentity(access: ResolvedAccess, request: Request): string {
	if (access.lane === 'builder' && access.session) {
		return `addr:${access.session.address}`;
	}
	const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
	return `ip:${ip}`;
}