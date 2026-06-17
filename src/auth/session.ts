import { getEntitlementSubscriptionId, isEntitlementAuthEnabled } from '../config/entitlementBuilder.js';
import { getAccountSubscriptions } from '../tools/read.js';
import { STATUS_TYPES } from '../utils.js';

export type SessionRecord = {
	address: `0x${string}`;
	createdAt: number;
	expiresAt: number;
	lastEntitlementCheck: number;
};

const SESSION_PREFIX = 'session:';
const NONCE_PREFIX = 'nonce:';
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_NONCE_TTL_MS = 5 * 60 * 1000;
const ENTITLEMENT_RECHECK_MS = 30 * 60 * 1000;

function sessionKey(tokenHash: string): string {
	return `${SESSION_PREFIX}${tokenHash}`;
}

function nonceKey(nonce: string): string {
	return `${NONCE_PREFIX}${nonce}`;
}

export async function storeNonce(env: Env, nonce: string): Promise<void> {
	if (!env.SESSIONS_KV) {
		throw new Error('SESSIONS_KV binding is not configured');
	}
	await env.SESSIONS_KV.put(nonceKey(nonce), '1', { expirationTtl: Math.ceil(DEFAULT_NONCE_TTL_MS / 1000) });
}

export async function consumeNonce(env: Env, nonce: string): Promise<boolean> {
	if (!env.SESSIONS_KV) {
		throw new Error('SESSIONS_KV binding is not configured');
	}
	const key = nonceKey(nonce);
	const value = await env.SESSIONS_KV.get(key);
	if (!value) {
		return false;
	}
	await env.SESSIONS_KV.delete(key);
	return true;
}

async function hashToken(token: string): Promise<string> {
	const data = new TextEncoder().encode(token);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export function generateSessionToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return `cts_${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function generateNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSession(
	env: Env,
	address: `0x${string}`,
): Promise<{ token: string; expiresAt: number }> {
	if (!env.SESSIONS_KV) {
		throw new Error('SESSIONS_KV binding is not configured');
	}

	const token = generateSessionToken();
	const tokenHash = await hashToken(token);
	const now = Date.now();
	const record: SessionRecord = {
		address: address.toLowerCase() as `0x${string}`,
		createdAt: now,
		expiresAt: now + DEFAULT_SESSION_TTL_MS,
		lastEntitlementCheck: now,
	};

	await env.SESSIONS_KV.put(sessionKey(tokenHash), JSON.stringify(record), {
		expirationTtl: Math.ceil(DEFAULT_SESSION_TTL_MS / 1000),
	});

	return { token, expiresAt: record.expiresAt };
}

export async function loadSession(env: Env, token: string): Promise<SessionRecord | null> {
	if (!env.SESSIONS_KV) {
		return null;
	}
	const tokenHash = await hashToken(token);
	const raw = await env.SESSIONS_KV.get(sessionKey(tokenHash));
	if (!raw) {
		return null;
	}
	try {
		return JSON.parse(raw) as SessionRecord;
	} catch {
		return null;
	}
}

export async function refreshSessionEntitlement(
	env: Env,
	session: SessionRecord,
	token: string,
): Promise<SessionRecord | null> {
	const entitlementId = getEntitlementSubscriptionId(env);
	if (!entitlementId) {
		return null;
	}

	const now = Date.now();
	if (now - session.lastEntitlementCheck < ENTITLEMENT_RECHECK_MS) {
		return session;
	}

	const entitled = await isAddressEntitled(env, session.address, entitlementId);
	if (!entitled) {
		return null;
	}

	const updated: SessionRecord = { ...session, lastEntitlementCheck: now };
	await updateSessionRecord(env, token, updated);
	return updated;
}

export async function isAddressEntitled(
	env: Env,
	address: `0x${string}`,
	entitlementId: `0x${string}`,
): Promise<boolean> {
	const result = await getAccountSubscriptions(env, true, address);
	return result.subscriptions.some(
		(entry) =>
			entry.subscription.id.toLowerCase() === entitlementId.toLowerCase() &&
			entry.status === STATUS_TYPES.ACTIVE,
	);
}

export async function verifyEntitlementForAddress(
	env: Env,
	address: `0x${string}`,
): Promise<boolean> {
	if (!isEntitlementAuthEnabled(env)) {
		return false;
	}
	const entitlementId = getEntitlementSubscriptionId(env)!;
	return isAddressEntitled(env, address, entitlementId);
}

export function parseBearerToken(request: Request): string | null {
	const header = request.headers.get('Authorization');
	if (!header?.startsWith('Bearer ')) {
		return null;
	}
	const token = header.slice('Bearer '.length).trim();
	return token.length > 0 ? token : null;
}

export async function updateSessionRecord(
	env: Env,
	token: string,
	record: SessionRecord,
): Promise<void> {
	if (!env.SESSIONS_KV) {
		return;
	}
	const tokenHash = await hashToken(token);
	const ttlSeconds = Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000));
	await env.SESSIONS_KV.put(sessionKey(tokenHash), JSON.stringify(record), {
		expirationTtl: ttlSeconds,
	});
}