/**
 * Opt-in CORS for browser SPAs calling /api directly.
 *
 * Controlled by API_CORS_ALLOWED_ORIGINS (comma-separated origins).
 * When unset, no CORS headers are emitted (default-deny for browsers).
 */

import { isOriginAllowed, normalizeOrigin } from './origins.js';

const CORS_ALLOW_METHODS = 'GET, POST, OPTIONS';
const CORS_ALLOW_HEADERS = 'Content-Type, Authorization, X-Payment, PAYMENT-SIGNATURE, x-payment';

export function isApiCorsEnabled(env: Env): boolean {
	return Boolean(env.API_CORS_ALLOWED_ORIGINS?.trim());
}

export function handleApiCorsPreflight(request: Request, env: Env): Response | null {
	if (request.method !== 'OPTIONS') {
		return null;
	}

	const origin = request.headers.get('Origin');
	if (!origin || !isOriginAllowed(origin, env.API_CORS_ALLOWED_ORIGINS)) {
		return new Response(null, { status: 403 });
	}

	return new Response(null, {
		status: 204,
		headers: buildCorsHeaders(origin),
	});
}

export function withApiCorsHeaders(request: Request, response: Response, env: Env): Response {
	if (!isApiCorsEnabled(env)) {
		return response;
	}

	const origin = request.headers.get('Origin');
	if (!origin || !isOriginAllowed(origin, env.API_CORS_ALLOWED_ORIGINS)) {
		return response;
	}

	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(buildCorsHeaders(origin))) {
		headers.set(name, value);
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function buildCorsHeaders(origin: string): Record<string, string> {
	const normalized = normalizeOrigin(origin) ?? origin;
	return {
		'Access-Control-Allow-Origin': normalized,
		'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
		'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
		'Vary': 'Origin',
	};
}