import { enforceBasicAuth } from './auth.js';
import { enforceOriginAllowlist } from './csrf.js';
import { enforceGeoBlock } from './geoBlock.js';
import { ClocktowerMCP } from './mcp.js';
import { RateLimiter } from './RateLimiter.js';
import { enforceRateLimit } from './rateLimit.js';
import { withSecurityHeaders } from './securityHeaders.js';
import { validateMcpRequest } from './validation.js';
import { api } from './api/app.js';

async function handleRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const geoBlocked = enforceGeoBlock(request);
	if (geoBlocked) {
		return geoBlocked;
	}

	const url = new URL(request.url);

	if (url.pathname === '/mcp') {
		const invalidRequest = await validateMcpRequest(request);
		if (invalidRequest) {
			return invalidRequest;
		}

		// CSRF defense runs before auth so we never even compare credentials
		// for a cross-origin browser POST that wouldn't be allowed anyway.
		const forbiddenOrigin = enforceOriginAllowlist(request, env);
		if (forbiddenOrigin) {
			return forbiddenOrigin;
		}

		const unauthorized = enforceBasicAuth(request, env);
		if (unauthorized) {
			return unauthorized;
		}

		const rateLimited = await enforceRateLimit(request, env);
		if (rateLimited) {
			return rateLimited;
		}

		// Mount the MCP server (stateful via Durable Objects)
		const mcpHandler = ClocktowerMCP.serve("/mcp");
		return mcpHandler.fetch(request, env, ctx);
	}

	// === API Routes (powered by Hono) ===
	// x402 micropayments are the primary and authoritative payment/auth layer.
	// All routes inside the Hono app are protected by the official @x402/hono middleware.
	// making x402 non-bypassable.
	//
	// Basic Auth (`API_REQUIRE_BASIC_AUTH`) is an optional extra gate that can
	// be enabled for manual developer testing. It is disabled by default in the
	// test environment. x402 is always required.
	if (url.pathname.startsWith('/api')) {
		const requireBasicAuth = env.API_REQUIRE_BASIC_AUTH !== 'false';

		if (requireBasicAuth) {
			const unauthorized = enforceBasicAuth(request, env);
			if (unauthorized) {
				return unauthorized;
			}
		}

		const rateLimited = await enforceRateLimit(request, env);
		if (rateLimited) {
			return rateLimited;
		}

		try {
			return await api.fetch(request, env, ctx);
		} catch (err) {
			// Safety net for unauthenticated API requests.
			// The official @x402/hono middleware can sometimes throw during
			// lazy initialization (or on malformed payments) instead of returning
			// a clean 402. In those cases we fall back to 402 for requests that
			// have no payment header, so that the rate limiting + x402 behavior
			// (and normal unauthenticated traffic) remains predictable.
			const hasPayment = request.headers.has('X-Payment') ||
				request.headers.has('PAYMENT-SIGNATURE') ||
				request.headers.has('x-payment');

			if (!hasPayment) {
				console.error('[x402] Unauthenticated /api request caused error in middleware → returning clean 402:', err);
				return new Response(JSON.stringify({ error: 'Payment required' }), {
					status: 402,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// If a payment header was present, re-throw so the normal error path
			// (or the x402 layer itself) can handle it.
			throw err;
		}
	}

	return Response.json({
		status: 'ok',
		name: 'clocktower-mcp',
		mcp: '/mcp',
		rest: '/api',
		note: 'REST API uses x402 as the primary and required layer.',
	});
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return withSecurityHeaders(await handleRequest(request, env, ctx));
	},
};

export { ClocktowerMCP, RateLimiter };
