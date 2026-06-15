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

import { normalizeOrigin, parseAllowedOrigins } from './origins.js';

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

	const { wildcard, set } = parseAllowedOrigins(env.CFP_ALLOWED_ORIGINS);
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
