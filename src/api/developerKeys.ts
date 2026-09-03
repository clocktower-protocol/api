import {
	createApiKey,
	getApiKeyById,
	getMaxKeysPerSubject,
	isDeveloperKeysEnabled,
	listAllApiKeys,
	listApiKeysForSubject,
	revokeApiKey,
	toPublicMeta,
	verifyAdminSecret,
} from '../auth/apiKeys.js';
import { checkRateLimit, RATE_LIMITER_WINDOW_MS } from '../RateLimiter.js';
import { getClientIp } from '../rateLimit.js';
import { recordAdminAudit } from '../observability/accessLog.js';
import { Errors, jsonResponse } from './responses.js';

async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
	if (!isDeveloperKeysEnabled(env)) {
		return jsonResponse(
			{ error: 'Developer API keys are disabled', code: 'DEVELOPER_KEYS_DISABLED' },
			403,
		);
	}
	if (!env.DEVELOPER_KEYS_ADMIN_SECRET || env.DEVELOPER_KEYS_ADMIN_SECRET.length < 16) {
		return jsonResponse(
			{ error: 'Developer key admin is not configured', code: 'ADMIN_NOT_CONFIGURED' },
			503,
		);
	}
	if (!verifyAdminSecret(request, env)) {
		return jsonResponse({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
	}
	return null;
}

/** Rate-limit admin key creation per IP and subject. */
async function enforceCreateLimits(
	env: Env,
	ip: string,
	subjectId: string,
): Promise<Response | null> {
	const ipResult = await checkRateLimit(
		env.RATE_LIMITER,
		`devkey-create-ip:${ip}`,
		10,
		RATE_LIMITER_WINDOW_MS,
	);
	if (!ipResult.ok) {
		return jsonResponse(
			{ error: 'Key creation rate limit exceeded (IP)', code: 'RATE_LIMITED' },
			429,
		);
	}
	const subjectResult = await checkRateLimit(
		env.RATE_LIMITER,
		`devkey-create-subject:${subjectId}`,
		5,
		RATE_LIMITER_WINDOW_MS,
	);
	if (!subjectResult.ok) {
		return jsonResponse(
			{ error: 'Key creation rate limit exceeded (subject)', code: 'RATE_LIMITED' },
			429,
		);
	}
	return null;
}

export async function handleCreateDeveloperKey(request: Request, env: Env): Promise<Response> {
	const denied = await requireAdmin(request, env);
	if (denied) return denied;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Errors.validation('Invalid JSON body');
	}
	if (typeof body !== 'object' || body === null) {
		return Errors.validation('Body must be a JSON object');
	}
	const { subjectId, label } = body as { subjectId?: unknown; label?: unknown };
	if (typeof subjectId !== 'string' || !subjectId.trim()) {
		return Errors.validation('subjectId is required (string)');
	}
	if (label !== undefined && typeof label !== 'string') {
		return Errors.validation('label must be a string');
	}

	const ip = getClientIp(request);
	const limited = await enforceCreateLimits(env, ip, subjectId.trim());
	if (limited) return limited;

	try {
		const { id, token, record } = await createApiKey(env, subjectId, label);
		recordAdminAudit(env, {
			action: 'create',
			status: 201,
			subjectId: subjectId.trim(),
			keyId: id,
			ip,
		});
		return jsonResponse(
			{
				id,
				token,
				key: toPublicMeta(record),
				warning: 'Store this token now; it will not be shown again.',
			},
			201,
		);
	} catch (err: unknown) {
		const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
		if (code === 'MAX_KEYS') {
			recordAdminAudit(env, {
				action: 'create',
				status: 409,
				subjectId: subjectId.trim(),
				ip,
				code: 'MAX_KEYS',
			});
			return jsonResponse(
				{
					error: `Maximum of ${getMaxKeysPerSubject(env)} active API keys per subject`,
					code: 'MAX_KEYS',
				},
				409,
			);
		}
		if (err instanceof Error && err.message === 'Invalid subjectId') {
			recordAdminAudit(env, {
				action: 'create',
				status: 400,
				subjectId: subjectId.trim(),
				ip,
				code: 'VALIDATION_ERROR',
			});
			return Errors.validation('Invalid subjectId');
		}
		if (err instanceof Error && err.message === 'label too long (max 100)') {
			recordAdminAudit(env, {
				action: 'create',
				status: 400,
				subjectId: subjectId.trim(),
				ip,
				code: 'VALIDATION_ERROR',
			});
			return Errors.validation('label too long (max 100)');
		}
		console.error('create developer key failed', err);
		recordAdminAudit(env, {
			action: 'create',
			status: 500,
			subjectId: subjectId.trim(),
			ip,
			code: 'INTERNAL',
		});
		return jsonResponse({ error: 'Failed to create API key', code: 'INTERNAL' }, 500);
	}
}

export async function handleListDeveloperKeys(request: Request, env: Env): Promise<Response> {
	const denied = await requireAdmin(request, env);
	if (denied) return denied;

	const url = new URL(request.url);
	const subjectId = url.searchParams.get('subjectId')?.trim() ?? '';
	const ip = getClientIp(request);
	try {
		if (subjectId) {
			const keys = await listApiKeysForSubject(env, subjectId);
			recordAdminAudit(env, {
				action: 'list',
				status: 200,
				subjectId,
				ip,
			});
			return jsonResponse({
				subjectId,
				keys: keys.map(toPublicMeta),
			});
		}

		const { keys, truncated } = await listAllApiKeys(env);
		recordAdminAudit(env, {
			action: 'list',
			status: 200,
			ip,
		});
		return jsonResponse({
			keys: keys.map(toPublicMeta),
			truncated,
		});
	} catch (err: unknown) {
		console.error('list developer keys failed', err);
		recordAdminAudit(env, {
			action: 'list',
			status: 500,
			subjectId: subjectId || undefined,
			ip,
			code: 'INTERNAL',
		});
		return jsonResponse({ error: 'Failed to list API keys', code: 'INTERNAL' }, 500);
	}
}

export async function handleGetDeveloperKey(
	request: Request,
	env: Env,
	id: string,
): Promise<Response> {
	const denied = await requireAdmin(request, env);
	if (denied) return denied;

	if (!id?.startsWith('key_')) {
		return Errors.validation('Invalid key id');
	}

	const ip = getClientIp(request);
	try {
		const record = await getApiKeyById(env, id);
		if (!record) {
			recordAdminAudit(env, {
				action: 'list',
				status: 404,
				keyId: id,
				ip,
				code: 'NOT_FOUND',
			});
			return jsonResponse({ error: 'Key not found', code: 'NOT_FOUND' }, 404);
		}
		recordAdminAudit(env, {
			action: 'list',
			status: 200,
			subjectId: record.subjectId,
			keyId: id,
			ip,
		});
		return jsonResponse({ key: toPublicMeta(record) });
	} catch (err: unknown) {
		console.error('get developer key failed', err);
		recordAdminAudit(env, {
			action: 'list',
			status: 500,
			keyId: id,
			ip,
			code: 'INTERNAL',
		});
		return jsonResponse({ error: 'Failed to look up API key', code: 'INTERNAL' }, 500);
	}
}

export async function handleRevokeDeveloperKey(
	request: Request,
	env: Env,
	id: string,
): Promise<Response> {
	const denied = await requireAdmin(request, env);
	if (denied) return denied;

	if (!id?.startsWith('key_')) {
		return Errors.validation('Invalid key id');
	}

	const ip = getClientIp(request);
	try {
		const revoked = await revokeApiKey(env, id);
		if (!revoked) {
			recordAdminAudit(env, {
				action: 'revoke',
				status: 404,
				keyId: id,
				ip,
				code: 'NOT_FOUND',
			});
			return jsonResponse({ error: 'Key not found', code: 'NOT_FOUND' }, 404);
		}
		recordAdminAudit(env, {
			action: 'revoke',
			status: 200,
			subjectId: revoked.subjectId,
			keyId: id,
			ip,
		});
		return jsonResponse({ key: toPublicMeta(revoked), revoked: true });
	} catch (err: unknown) {
		console.error('revoke developer key failed', err);
		recordAdminAudit(env, {
			action: 'revoke',
			status: 500,
			keyId: id,
			ip,
			code: 'INTERNAL',
		});
		return jsonResponse({ error: 'Failed to revoke API key', code: 'INTERNAL' }, 500);
	}
}
