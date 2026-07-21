/**
 * Scheduled abuse checks via Analytics Engine SQL API.
 * Requires CF_ACCOUNT_ID + CF_API_TOKEN (Account Analytics Engine read) and
 * optional ALERT_WEBHOOK_URL. No-ops when unset.
 */

export type AlertFinding = {
	kind: string;
	message: string;
	detail?: unknown;
};

function parseThreshold(env: Env, key: keyof Env, fallback: number): number {
	const raw = env[key];
	if (typeof raw !== 'string' || !raw) return fallback;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function runAnalyticsSql(
	env: Env,
	sql: string,
): Promise<{ success: boolean; data?: unknown; errors?: unknown }> {
	const accountId = env.CF_ACCOUNT_ID?.trim();
	const token = env.CF_API_TOKEN?.trim();
	if (!accountId || !token) {
		return { success: false, errors: 'CF_ACCOUNT_ID or CF_API_TOKEN not configured' };
	}

	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'text/plain',
		},
		body: sql,
	});

	const text = await res.text();
	try {
		return JSON.parse(text) as { success: boolean; data?: unknown; errors?: unknown };
	} catch {
		return { success: res.ok, data: text, errors: res.ok ? undefined : text };
	}
}

/**
 * Query last ~24h of API_ANALYTICS for high prepare volume and 429 rates.
 * Dataset table name matches wrangler analytics_engine_datasets.dataset.
 */
export async function collectAbuseFindings(env: Env): Promise<AlertFinding[]> {
	const dataset = env.API_ANALYTICS_DATASET || 'api_analytics';
	const writeThreshold = parseThreshold(env, 'ALERT_WRITE_COUNT_24H', 80);
	const rateLimitThreshold = parseThreshold(env, 'ALERT_429_COUNT_24H', 50);

	const findings: AlertFinding[] = [];

	// blob1 = lane, blob2 = route, blob3 = routeClass, blob6 = keyId
	// double3 = isWrite, double4 = is429
	const writeSql = `
SELECT
  index1 AS identity,
  blob6 AS keyId,
  blob1 AS lane,
  SUM(_sample_interval * double3) AS writeEvents
FROM ${dataset}
WHERE timestamp > NOW() - INTERVAL '1' DAY
  AND double3 > 0
GROUP BY identity, keyId, lane
HAVING writeEvents >= ${writeThreshold}
ORDER BY writeEvents DESC
LIMIT 20
FORMAT JSON
`.trim();

	const rateLimitSql = `
SELECT
  index1 AS identity,
  blob6 AS keyId,
  blob1 AS lane,
  SUM(_sample_interval * double4) AS rateLimited
FROM ${dataset}
WHERE timestamp > NOW() - INTERVAL '1' DAY
  AND double4 > 0
GROUP BY identity, keyId, lane
HAVING rateLimited >= ${rateLimitThreshold}
ORDER BY rateLimited DESC
LIMIT 20
FORMAT JSON
`.trim();

	const writeResult = await runAnalyticsSql(env, writeSql);
	if (writeResult.success && writeResult.data) {
		const rows = normalizeSqlRows(writeResult.data);
		for (const row of rows) {
			findings.push({
				kind: 'high_write_volume',
				message: `High prepare/readiness volume (24h): identity=${row.identity} keyId=${row.keyId || 'n/a'} writes≈${row.writeEvents}`,
				detail: row,
			});
		}
	} else if (writeResult.errors && env.CF_ACCOUNT_ID) {
		findings.push({
			kind: 'alert_query_error',
			message: 'Failed to query Analytics Engine for write volume',
			detail: writeResult.errors,
		});
	}

	const rlResult = await runAnalyticsSql(env, rateLimitSql);
	if (rlResult.success && rlResult.data) {
		const rows = normalizeSqlRows(rlResult.data);
		for (const row of rows) {
			findings.push({
				kind: 'high_429_volume',
				message: `High 429 volume (24h): identity=${row.identity} keyId=${row.keyId || 'n/a'} count≈${row.rateLimited}`,
				detail: row,
			});
		}
	}

	return findings;
}

function normalizeSqlRows(data: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(data)) {
		return data as Array<Record<string, unknown>>;
	}
	if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) {
		return (data as { data: Array<Record<string, unknown>> }).data;
	}
	// ClickHouse JSONEachRow style sometimes nested
	if (typeof data === 'string') {
		try {
			const parsed = JSON.parse(data) as unknown;
			return normalizeSqlRows(parsed);
		} catch {
			return [];
		}
	}
	return [];
}

export async function postAlertWebhook(
	env: Env,
	findings: AlertFinding[],
): Promise<{ posted: boolean; status?: number }> {
	const url = env.ALERT_WEBHOOK_URL?.trim();
	if (!url || findings.length === 0) {
		return { posted: false };
	}

	const body = {
		text: `[clocktower-api] ${findings.length} abuse/usage finding(s)`,
		findings,
		ts: new Date().toISOString(),
	};

	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	return { posted: res.ok, status: res.status };
}

export async function runScheduledAlerts(env: Env): Promise<{
	findings: AlertFinding[];
	posted: boolean;
}> {
	if (env.OBSERVABILITY_ENABLED === 'false') {
		return { findings: [], posted: false };
	}
	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
		console.log(
			JSON.stringify({
				type: 'api_alert_skip',
				ts: new Date().toISOString(),
				reason: 'CF_ACCOUNT_ID/CF_API_TOKEN not set; skip AE SQL alerts',
			}),
		);
		return { findings: [], posted: false };
	}

	const findings = await collectAbuseFindings(env);
	// Don't webhook query errors alone as spam if only query failed with empty real findings
	const actionable = findings.filter((f) => f.kind !== 'alert_query_error');
	const toPost = actionable.length > 0 ? actionable : findings.slice(0, 1);

	if (toPost.length === 0) {
		console.log(
			JSON.stringify({
				type: 'api_alert_ok',
				ts: new Date().toISOString(),
				message: 'No abuse findings',
			}),
		);
		return { findings: [], posted: false };
	}

	console.log(
		JSON.stringify({
			type: 'api_alert_findings',
			ts: new Date().toISOString(),
			count: toPost.length,
			findings: toPost,
		}),
	);

	const { posted } = await postAlertWebhook(env, toPost);
	return { findings: toPost, posted };
}
