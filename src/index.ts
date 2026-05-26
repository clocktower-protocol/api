import { enforceBasicAuth } from './auth.js';
import { enforceOriginAllowlist } from './csrf.js';
import { enforceGeoBlock } from './geoBlock.js';
import { ClocktowerMCP } from './mcp.js';
import { RateLimiter } from './RateLimiter.js';
import { enforceRateLimit } from './rateLimit.js';
import { withSecurityHeaders } from './securityHeaders.js';
import { validateMcpRequest } from './validation.js';

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

	// === Stage 0: Basic REST API scaffolding ===
	// All /api routes are protected by the same security layers as /mcp
	// (geo block is already applied above for all requests).
	if (url.pathname.startsWith('/api')) {
		const unauthorized = enforceBasicAuth(request, env);
		if (unauthorized) {
			return unauthorized;
		}

		const rateLimited = await enforceRateLimit(request, env);
		if (rateLimited) {
			return rateLimited;
		}

		// Placeholder response for Stage 0.
		// Real endpoints will be added in later stages.
		return Response.json(
			{
				status: 'not_implemented',
				message: 'The REST API is under development. Use the MCP endpoint at /mcp.',
			},
			{ status: 501 },
		);
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
