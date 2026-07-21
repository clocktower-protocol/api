import { describe, expect, it, vi, afterEach } from 'vitest';
import { collectAbuseFindings, postAlertWebhook } from '../src/observability/alerts.js';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('scheduled alerts', () => {
	it('skips SQL when credentials missing', async () => {
		const findings = await collectAbuseFindings({} as Env);
		expect(findings.length).toBe(0);
	});

	it('parses write-volume findings from SQL API', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(
					JSON.stringify({
						success: true,
						data: [
							{
								identity: 'key:key_1',
								keyId: 'key_1',
								lane: 'developer',
								writeEvents: 90,
							},
						],
					}),
					{ status: 200 },
				),
			),
		);

		const findings = await collectAbuseFindings({
			CF_ACCOUNT_ID: 'acc',
			CF_API_TOKEN: 'tok',
			ALERT_WRITE_COUNT_24H: '80',
			ALERT_429_COUNT_24H: '99999',
		} as Env);

		expect(findings.some((f) => f.kind === 'high_write_volume')).toBe(true);
	});

	it('posts webhook when URL set', async () => {
		const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		const result = await postAlertWebhook(
			{ ALERT_WEBHOOK_URL: 'https://hooks.example/alert' } as Env,
			[{ kind: 'test', message: 'hello' }],
		);
		expect(result.posted).toBe(true);
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
