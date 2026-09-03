import type { AccessLane } from '../config/rateLimits.js';
import { isEntitlementAuthEnabled } from '../config/entitlementBuilder.js';
import {
	isApiKeyToken,
	isDeveloperKeysEnabled,
	loadApiKeyByToken,
	type ApiKeyRecord,
} from '../auth/apiKeys.js';
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
	/** Key metadata (public id / subject). Not the ctk_ secret. */
	developerKey: ApiKeyRecord | null;
	token: string | null;
	/**
	 * When set, the Worker must return this response and not continue as free.
	 * Used for invalid/revoked ctk_ keys (401) so attackers cannot fall back to free.
	 */
	authError?: Response;
};

function unauthorizedApiKey(message: string): Response {
	return Response.json(
		{ error: message, code: 'UNAUTHORIZED' },
		{ status: 401, headers: { 'X-Clocktower-Lane': 'developer' } },
	);
}

export async function resolveApiAccess(request: Request, env: Env): Promise<ResolvedAccess> {
	const token = parseBearerToken(request);
	if (!token) {
		return { lane: 'free', session: null, developerKey: null, token: null };
	}

	// Developer API keys (ctk_…) — REST only; never treated as free on failure.
	if (isApiKeyToken(token)) {
		if (!isDeveloperKeysEnabled(env)) {
			return {
				lane: 'free',
				session: null,
				developerKey: null,
				token,
				authError: unauthorizedApiKey('Developer API keys are disabled'),
			};
		}
		const record = await loadApiKeyByToken(env, token);
		if (!record) {
			return {
				lane: 'free',
				session: null,
				developerKey: null,
				token,
				authError: unauthorizedApiKey('Invalid or revoked API key'),
			};
		}
		return {
			lane: 'developer',
			session: null,
			developerKey: record,
			token,
		};
	}

	// Builder SIWE sessions (cts_…)
	if (!isEntitlementAuthEnabled(env)) {
		return { lane: 'free', session: null, developerKey: null, token: null };
	}

	const session = await loadSession(env, token);
	if (!session) {
		return { lane: 'free', session: null, developerKey: null, token: null };
	}

	if (session.expiresAt <= Date.now()) {
		return { lane: 'free', session: null, developerKey: null, token: null };
	}

	const refreshed = await refreshSessionEntitlement(env, session, token);
	if (!refreshed) {
		return { lane: 'free', session: null, developerKey: null, token: null };
	}

	const entitledId = await verifyEntitlementForAddress(env, refreshed.address);
	if (!entitledId) {
		return { lane: 'free', session: null, developerKey: null, token: null };
	}

	return { lane: 'builder', session: refreshed, developerKey: null, token };
}

export function getRateLimitIdentity(access: ResolvedAccess, request: Request): string {
	if (access.lane === 'builder' && access.session) {
		return `addr:${access.session.address}`;
	}
	if (access.lane === 'developer' && access.developerKey) {
		return `key:${access.developerKey.id}`;
	}
	const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
	return `ip:${ip}`;
}

/** Public key id / subject for logs. Never the bearer secret or tokenHash. */
export function accessLogKeyFields(access: ResolvedAccess): {
	keyId?: string;
	subjectId?: string;
} {
	const record = access.developerKey;
	if (!record) {
		return {};
	}
	return {
		keyId: record.id,
		subjectId: record.subjectId,
	};
}
