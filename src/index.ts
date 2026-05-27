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

		return ClocktowerMCP.serve('/mcp', { binding: 'CLOCKTOWER_MCP' }).fetch(request, env, ctx);
	}

	// === API Routes (powered by Hono) ===
	// x402 is now the primary payment/auth mechanism for the REST API.
	// Basic Auth is still supported for convenience during development/testing.
	//
	// Control:
	//   - API_REQUIRE_BASIC_AUTH=true  → Basic Auth is required for /api (current default)
	//   - API_REQUIRE_BASIC_AUTH=false → Basic Auth is optional for /api (x402 is still mandatory)
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

		// Hand off to the Hono router for /api routes.
		// Individual routes use withX402Payment(...) so x402 is non-bypassable.
		return api.fetch(request, env, ctx);
	}

	return Response.json({
		status: 'ok',
		name: 'clocktower-mcp',
		mcp: '/mcp',
	});
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return withSecurityHeaders(await handleRequest(request, env, ctx));
	},
};

export { ClocktowerMCP, RateLimiter };
