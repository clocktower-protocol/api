import { enforceBasicAuth } from './auth.js';
import { enforceOriginAllowlist } from './csrf.js';
import { enforceGeoBlock } from './geoBlock.js';
import { ClocktowerMCP } from './mcp.js';
import { RateLimiter } from './RateLimiter.js';
import { enforceMcpRateLimit, enforceTierRateLimits } from './rateLimit.js';
import { withSecurityHeaders } from './securityHeaders.js';
import { validateEnv, validateMcpRequest } from './validation.js';
import { createApiApp, createApiAppForEnv } from './api/app.js';
import { handleApiCorsPreflight, withApiCorsHeaders } from './cors.js';
import { getRateLimitIdentity, resolveApiAccess } from './middleware/accessLane.js';
import { enforceBuilderPolicy, rewriteMePath } from './middleware/entitlementPolicy.js';
import { enforceFreeTierPolicy } from './middleware/freeTierPolicy.js';
import { clearActiveLane, setActiveLane } from './requestLane.js';
import { isApiEnabled, isApiHealthCheckPath } from './config/apiAccess.js';
import { Errors } from './api/responses.js';
import type { AccessLane } from './config/rateLimits.js';

/** Once per isolate, same idea as validateEnv in the MCP durable object on first init. */
let apiEnvValidated = false;

function ensureApiEnvValidated(env: Env): Response | null {
	if (apiEnvValidated) {
		return null;
	}
	try {
		validateEnv(env);
		apiEnvValidated = true;
		return null;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return Response.json(
			{ error: message, code: 'CONFIG_ERROR' },
			{ status: 500, headers: { 'Content-Type': 'application/json' } },
		);
	}
}

const productionApi = createApiApp();
let mockApi: ReturnType<typeof createApiApp> | null = null;

function getApi(env: Env): ReturnType<typeof createApiApp> {
	if (env.X402_USE_MOCK_FACILITATOR === 'true') {
		if (!mockApi) {
			mockApi = createApiAppForEnv(env);
		}
		return mockApi;
	}
	return productionApi;
}

function withLaneHeaders(response: Response, lane: AccessLane): Response {
	const headers = new Headers(response.headers);
	headers.set('X-Clocktower-Lane', lane);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

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

		const forbiddenOrigin = enforceOriginAllowlist(request, env);
		if (forbiddenOrigin) {
			return forbiddenOrigin;
		}

		const unauthorized = enforceBasicAuth(request, env);
		if (unauthorized) {
			return unauthorized;
		}

		setActiveLane('mcp');
		try {
			const rateLimited = await enforceMcpRateLimit(request, env);
			if (rateLimited) {
				return rateLimited;
			}

			const mcpHandler = ClocktowerMCP.serve('/mcp');
			return await mcpHandler.fetch(request, env, ctx);
		} finally {
			clearActiveLane();
		}
	}

	if (url.pathname.startsWith('/api')) {
		const corsPreflight = handleApiCorsPreflight(request, env);
		if (corsPreflight) {
			return withSecurityHeaders(corsPreflight);
		}

		if (!isApiEnabled(env) && !isApiHealthCheckPath(request.method, url.pathname)) {
			return withSecurityHeaders(
				withApiCorsHeaders(request, Errors.apiDisabled(), env),
			);
		}

		const configError = ensureApiEnvValidated(env);
		if (configError) {
			return withSecurityHeaders(withApiCorsHeaders(request, configError, env));
		}

		const requireBasicAuth = env.API_REQUIRE_BASIC_AUTH !== 'false';

		if (requireBasicAuth) {
			const unauthorized = enforceBasicAuth(request, env);
			if (unauthorized) {
				return withSecurityHeaders(withApiCorsHeaders(request, unauthorized, env));
			}
		}

		const access = await resolveApiAccess(request, env);
		setActiveLane(access.lane);

		try {
			if (access.lane === 'free') {
				const policyBlocked = enforceFreeTierPolicy(request.method, url.pathname);
				if (policyBlocked) {
					return withSecurityHeaders(withApiCorsHeaders(request, policyBlocked, env));
				}
			} else if (access.session) {
				const policyBlocked = await enforceBuilderPolicy(request, env, access.session);
				if (policyBlocked) {
					return withSecurityHeaders(withApiCorsHeaders(request, policyBlocked, env));
				}
			}

			const identity = getRateLimitIdentity(access, request);
			const rateLimited = await enforceTierRateLimits(request, env, access.lane, identity);
			if (rateLimited) {
				return withSecurityHeaders(withApiCorsHeaders(request, rateLimited, env));
			}

			let apiRequest = request;
			if (access.lane === 'builder' && access.session && url.pathname.includes('/me')) {
				const rewritten = new URL(request.url);
				rewritten.pathname = rewriteMePath(url.pathname, access.session);
				apiRequest = new Request(rewritten.toString(), request);
			}

			const headers = new Headers(apiRequest.headers);
			headers.set('X-Clocktower-Lane', access.lane);
			// Preserve method/body — spreading a Request drops POST (becomes GET → 404 on write routes).
			apiRequest = new Request(apiRequest, { headers });

			const apiResponse = await getApi(env).fetch(apiRequest, env, ctx);
			return withSecurityHeaders(
				withApiCorsHeaders(request, withLaneHeaders(apiResponse, access.lane), env),
			);
		} finally {
			clearActiveLane();
		}
	}

	return Response.json({
		status: 'ok',
		name: 'clocktower-mcp',
		mcp: '/mcp',
		rest: '/api',
		apiEnabled: isApiEnabled(env),
		note: 'REST API is free with tiered rate limits. MCP requires x402.',
		access: {
			rest: 'free (rate-limited) or builder session',
			mcp: 'x402 required',
		},
	});
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return withSecurityHeaders(await handleRequest(request, env, ctx));
	},
};

export { ClocktowerMCP, RateLimiter };