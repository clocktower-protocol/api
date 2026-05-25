/**
 * CSRF defense for the Basic-Auth-protected /mcp endpoint.
 *
 * Why: when ENABLE_AUTH=true, the browser caches Basic credentials for the
 * Worker's origin. A malicious site can then attempt cross-origin POSTs that
 * the browser will automatically attach those credentials to. Even though we
 * require JSON content-type (which forces a preflight), the Worker is the
 * canonical defense — adding an Origin allowlist closes the gap.
 *
 * Semantics:
 *   - ENABLE_AUTH=false / unset: no CSRF check (auth is open, no creds to abuse).
 *   - ENABLE_AUTH=true + no Origin header: allowed (server-to-server clients).
 *   - ENABLE_AUTH=true + Origin set:
 *       * CFP_ALLOWED_ORIGINS="*" -> any Origin allowed (NOT recommended).
 *       * Origin in CFP_ALLOWED_ORIGINS list -> allowed.
 *       * Otherwise (including unset CFP_ALLOWED_ORIGINS) -> 403.
 *
 * Origin values are compared exactly (scheme + host + port), case-insensitively
 * for the scheme/host. We do NOT use Referer (easily stripped) or
 * Sec-Fetch-Site (not universally available outside browsers we care about).
 */

function parseAllowedOrigins(env: Env): { wildcard: boolean; set: Set<string> } {
	const raw = env.CFP_ALLOWED_ORIGINS;
	if (!raw) {
		return { wildcard: false, set: new Set() };
	}
	const entries = raw
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	if (entries.includes('*')) {
		return { wildcard: true, set: new Set() };
	}
	return { wildcard: false, set: new Set(entries.map(normalizeOrigin).filter((s): s is string => s !== null)) };
}

function normalizeOrigin(value: string): string | null {
	try {
		const u = new URL(value);
		// Origin = scheme + "://" + host + (":" + port if non-default)
		return u.origin.toLowerCase();
	} catch {
		return null;
	}
}

export function enforceOriginAllowlist(request: Request, env: Env): Response | null {
	if (env.ENABLE_AUTH !== 'true') {
		return null;
	}

	const originHeader = request.headers.get('origin');
	if (!originHeader) {
		// No Origin = non-browser client. Browsers always send Origin on
		// cross-origin requests; same-origin POSTs with credentials may or may
		// not include Origin, but that case is not a CSRF risk.
		return null;
	}

	const normalized = normalizeOrigin(originHeader);
	if (normalized === null) {
		return forbidden('Invalid Origin header');
	}

	const { wildcard, set } = parseAllowedOrigins(env);
	if (wildcard) {
		return null;
	}

	if (set.has(normalized)) {
		return null;
	}

	return forbidden('Origin not allowed');
}

function forbidden(message: string): Response {
	return Response.json({ error: 'Forbidden', message }, { status: 403 });
}
