import { enforceBasicAuth } from './auth.js';
import { enforceOriginAllowlist } from './csrf.js';
import { enforceGeoBlock } from './geoBlock.js';
import { ClocktowerMCP } from './mcp.js';
import { RateLimiter } from './RateLimiter.js';
import { enforceRateLimit } from './rateLimit.js';
import { validateMcpRequest } from './validation.js';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

		return Response.json({
			status: 'ok',
			name: 'clocktower-mcp',
			mcp: '/mcp',
		});
	},
};

export { ClocktowerMCP, RateLimiter };
