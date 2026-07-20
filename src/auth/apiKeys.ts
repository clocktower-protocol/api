/**
 * Developer API keys (REST only). Secrets are hashed (SHA-256); plaintext
 * returned once on create. Stored in SESSIONS_KV under apikey:* prefixes.
 */

export const API_KEY_PREFIX = 'ctk_';
export const API_KEY_ID_PREFIX = 'key_';

export type ApiKeyRecord = {
	id: string;
	subjectId: string;
	/** Full SHA-256 hex of the secret (not the secret itself); used for revoke. */
	tokenHash: string;
	/** First 8 hex chars of token hash for debugging. */
	tokenHashPrefix: string;
	label?: string;
	createdAt: number;
	revokedAt?: number;
	lastUsedAt?: number;
};

/** Public metadata returned by list endpoints (no full hash required by clients). */
export type ApiKeyPublicMeta = {
	id: string;
	subjectId: string;
	tokenHashPrefix: string;
	label?: string;
	createdAt: number;
	revokedAt?: number;
	lastUsedAt?: number;
};

type HashIndexRecord = {
	id: string;
	subjectId: string;
	revokedAt?: number;
};

type SubjectIndex = {
	keyIds: string[];
};

const HASH_PREFIX = 'apikey:';
const META_PREFIX = 'apikey-meta:';
const SUBJECT_PREFIX = 'apikey-subject:';
const DEFAULT_MAX_KEYS_PER_SUBJECT = 5;

function hashKey(tokenHash: string): string {
	return `${HASH_PREFIX}${tokenHash}`;
}

function metaKey(id: string): string {
	return `${META_PREFIX}${id}`;
}

function subjectKey(subjectId: string): string {
	return `${SUBJECT_PREFIX}${subjectId}`;
}

async function sha256Hex(value: string): Promise<string> {
	const data = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function requireKv(env: Env): KVNamespace {
	if (!env.SESSIONS_KV) {
		throw new Error('SESSIONS_KV binding is not configured');
	}
	return env.SESSIONS_KV;
}

export function toPublicMeta(record: ApiKeyRecord): ApiKeyPublicMeta {
	return {
		id: record.id,
		subjectId: record.subjectId,
		tokenHashPrefix: record.tokenHashPrefix,
		createdAt: record.createdAt,
		...(record.label !== undefined ? { label: record.label } : {}),
		...(record.revokedAt !== undefined ? { revokedAt: record.revokedAt } : {}),
		...(record.lastUsedAt !== undefined ? { lastUsedAt: record.lastUsedAt } : {}),
	};
}

export function isDeveloperKeysEnabled(env: Env): boolean {
	if (env.DEVELOPER_KEYS_ENABLED === 'false') {
		return false;
	}
	if (env.DEVELOPER_KEYS_ENABLED === 'true') {
		return true;
	}
	return Boolean(env.DEVELOPER_KEYS_ADMIN_SECRET && env.DEVELOPER_KEYS_ADMIN_SECRET.length > 0);
}

export function getMaxKeysPerSubject(env: Env): number {
	const raw = env.DEVELOPER_MAX_KEYS_PER_SUBJECT;
	if (raw === undefined) {
		return DEFAULT_MAX_KEYS_PER_SUBJECT;
	}
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_KEYS_PER_SUBJECT;
}

export function generateApiKeyToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return `${API_KEY_PREFIX}${Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')}`;
}

export function generateApiKeyId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return `${API_KEY_ID_PREFIX}${Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')}`;
}

export function isApiKeyToken(token: string): boolean {
	return token.startsWith(API_KEY_PREFIX) && token.length > API_KEY_PREFIX.length + 16;
}

/** Constant-time string comparison for secrets (admin secret, etc.). */
export function timingSafeEqualString(a: string, b: string): boolean {
	const encoder = new TextEncoder();
	const aBytes = encoder.encode(a);
	const bBytes = encoder.encode(b);
	const len = Math.max(aBytes.length, bBytes.length);
	let diff = aBytes.length ^ bBytes.length;
	for (let i = 0; i < len; i++) {
		const aByte = i < aBytes.length ? aBytes[i] : 0;
		const bByte = i < bBytes.length ? bBytes[i] : 0;
		diff |= aByte ^ bByte;
	}
	return diff === 0;
}

export function verifyAdminSecret(request: Request, env: Env): boolean {
	const expected = env.DEVELOPER_KEYS_ADMIN_SECRET;
	if (!expected || expected.length < 16) {
		return false;
	}
	const header = request.headers.get('Authorization');
	if (header?.startsWith('Bearer ')) {
		const token = header.slice('Bearer '.length).trim();
		if (timingSafeEqualString(token, expected)) {
			return true;
		}
	}
	const alt = request.headers.get('X-Clocktower-Admin-Key')?.trim();
	if (alt && timingSafeEqualString(alt, expected)) {
		return true;
	}
	return false;
}

async function listActiveKeyIds(kv: KVNamespace, subjectId: string): Promise<string[]> {
	const subjectRaw = await kv.get(subjectKey(subjectId));
	const subjectIndex: SubjectIndex = subjectRaw
		? (JSON.parse(subjectRaw) as SubjectIndex)
		: { keyIds: [] };
	const activeIds: string[] = [];
	for (const id of subjectIndex.keyIds) {
		const meta = await kv.get(metaKey(id));
		if (!meta) continue;
		const rec = JSON.parse(meta) as ApiKeyRecord;
		if (!rec.revokedAt) {
			activeIds.push(id);
		}
	}
	return activeIds;
}

export async function createApiKey(
	env: Env,
	subjectId: string,
	label?: string,
): Promise<{ id: string; token: string; record: ApiKeyRecord }> {
	const kv = requireKv(env);
	const trimmedSubject = subjectId.trim();
	if (!trimmedSubject || trimmedSubject.length > 200) {
		throw new Error('Invalid subjectId');
	}
	if (label !== undefined && label.length > 100) {
		throw new Error('label too long (max 100)');
	}

	const maxKeys = getMaxKeysPerSubject(env);
	const activeIds = await listActiveKeyIds(kv, trimmedSubject);
	if (activeIds.length >= maxKeys) {
		const err = new Error(`Maximum of ${maxKeys} active API keys per subject`);
		(err as Error & { code?: string }).code = 'MAX_KEYS';
		throw err;
	}

	const token = generateApiKeyToken();
	const tokenHash = await sha256Hex(token);
	const id = generateApiKeyId();
	const now = Date.now();
	const record: ApiKeyRecord = {
		id,
		subjectId: trimmedSubject,
		tokenHash,
		tokenHashPrefix: tokenHash.slice(0, 8),
		createdAt: now,
		...(label !== undefined && label.length > 0 ? { label } : {}),
	};
	const hashIndex: HashIndexRecord = {
		id,
		subjectId: trimmedSubject,
	};

	await kv.put(hashKey(tokenHash), JSON.stringify(hashIndex));
	await kv.put(metaKey(id), JSON.stringify(record));
	await kv.put(
		subjectKey(trimmedSubject),
		JSON.stringify({ keyIds: [...activeIds, id] } satisfies SubjectIndex),
	);

	return { id, token, record };
}

export async function loadApiKeyByToken(
	env: Env,
	token: string,
): Promise<ApiKeyRecord | null> {
	if (!env.SESSIONS_KV || !isApiKeyToken(token)) {
		return null;
	}
	const tokenHash = await sha256Hex(token);
	const raw = await env.SESSIONS_KV.get(hashKey(tokenHash));
	if (!raw) {
		return null;
	}
	const index = JSON.parse(raw) as HashIndexRecord;
	if (index.revokedAt) {
		return null;
	}
	const metaRaw = await env.SESSIONS_KV.get(metaKey(index.id));
	if (!metaRaw) {
		return null;
	}
	const record = JSON.parse(metaRaw) as ApiKeyRecord;
	if (record.revokedAt) {
		return null;
	}
	return record;
}

export async function touchApiKeyLastUsed(env: Env, record: ApiKeyRecord): Promise<void> {
	if (!env.SESSIONS_KV) return;
	const updated: ApiKeyRecord = { ...record, lastUsedAt: Date.now() };
	await env.SESSIONS_KV.put(metaKey(record.id), JSON.stringify(updated));
}

export async function listApiKeysForSubject(
	env: Env,
	subjectId: string,
): Promise<ApiKeyRecord[]> {
	const kv = requireKv(env);
	const raw = await kv.get(subjectKey(subjectId.trim()));
	if (!raw) {
		return [];
	}
	const index = JSON.parse(raw) as SubjectIndex;
	const out: ApiKeyRecord[] = [];
	for (const id of index.keyIds) {
		const meta = await kv.get(metaKey(id));
		if (!meta) continue;
		out.push(JSON.parse(meta) as ApiKeyRecord);
	}
	return out;
}

export async function revokeApiKey(env: Env, id: string): Promise<ApiKeyRecord | null> {
	const kv = requireKv(env);
	const metaRaw = await kv.get(metaKey(id));
	if (!metaRaw) {
		return null;
	}
	const record = JSON.parse(metaRaw) as ApiKeyRecord;
	if (record.revokedAt) {
		return record;
	}
	const now = Date.now();
	const revoked: ApiKeyRecord = { ...record, revokedAt: now };
	await kv.put(metaKey(id), JSON.stringify(revoked));
	if (record.tokenHash) {
		await kv.delete(hashKey(record.tokenHash));
	}
	return revoked;
}
