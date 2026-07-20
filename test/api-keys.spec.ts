import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
	createApiKey,
	generateApiKeyToken,
	isApiKeyToken,
	isDeveloperKeysEnabled,
	listApiKeysForSubject,
	loadApiKeyByToken,
	revokeApiKey,
	toPublicMeta,
	verifyAdminSecret,
} from '../src/auth/apiKeys.js';

describe('api keys', () => {
	it('generates ctk_ tokens with high entropy', () => {
		const token = generateApiKeyToken();
		expect(isApiKeyToken(token)).toBe(true);
		expect(token.startsWith('ctk_')).toBe(true);
		expect(token.length).toBeGreaterThan(40);
	});

	it('enables developer keys when admin secret set', () => {
		expect(
			isDeveloperKeysEnabled({
				DEVELOPER_KEYS_ADMIN_SECRET: 'x'.repeat(32),
			} as Env),
		).toBe(true);
		expect(
			isDeveloperKeysEnabled({
				DEVELOPER_KEYS_ENABLED: 'false',
				DEVELOPER_KEYS_ADMIN_SECRET: 'x'.repeat(32),
			} as Env),
		).toBe(false);
	});

	it('verifies admin secret via Bearer or header', () => {
		const secret = 'test-admin-secret-32chars-long!!';
		const envLocal = { DEVELOPER_KEYS_ADMIN_SECRET: secret } as Env;
		const okBearer = new Request('http://localhost/api/developer/keys', {
			headers: { Authorization: `Bearer ${secret}` },
		});
		const okHeader = new Request('http://localhost/api/developer/keys', {
			headers: { 'X-Clocktower-Admin-Key': secret },
		});
		const bad = new Request('http://localhost/api/developer/keys', {
			headers: { Authorization: 'Bearer wrong' },
		});
		expect(verifyAdminSecret(okBearer, envLocal)).toBe(true);
		expect(verifyAdminSecret(okHeader, envLocal)).toBe(true);
		expect(verifyAdminSecret(bad, envLocal)).toBe(false);
	});

	it('creates, loads, and revokes keys in KV', async () => {
		if (!env.SESSIONS_KV) {
			// Pool workers must bind SESSIONS_KV for this suite.
			expect(env.SESSIONS_KV).toBeTruthy();
			return;
		}

		const subject = `test-subject-${crypto.randomUUID()}`;
		const { token, id, record } = await createApiKey(
			env as Env,
			subject,
			'integration',
		);
		expect(id.startsWith('key_')).toBe(true);
		expect(record.subjectId).toBe(subject);
		expect(toPublicMeta(record).tokenHashPrefix).toHaveLength(8);

		const loaded = await loadApiKeyByToken(env as Env, token);
		expect(loaded?.id).toBe(id);

		const listed = await listApiKeysForSubject(env as Env, subject);
		expect(listed.some((k) => k.id === id)).toBe(true);

		const revoked = await revokeApiKey(env as Env, id);
		expect(revoked?.revokedAt).toBeTypeOf('number');

		const after = await loadApiKeyByToken(env as Env, token);
		expect(after).toBeNull();
	});

	it('enforces max keys per subject', async () => {
		if (!env.SESSIONS_KV) return;

		const subject = `max-keys-${crypto.randomUUID()}`;
		const limitedEnv = {
			...env,
			DEVELOPER_MAX_KEYS_PER_SUBJECT: '2',
		} as Env;

		await createApiKey(limitedEnv, subject, 'a');
		await createApiKey(limitedEnv, subject, 'b');
		await expect(createApiKey(limitedEnv, subject, 'c')).rejects.toMatchObject({
			code: 'MAX_KEYS',
		});
	});
});
