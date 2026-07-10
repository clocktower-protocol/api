import { enforceBasicAuth } from './auth.js';
import { enforceOriginAllowlist } from './csrf.js';
import { enforceGeoBlock } from './geoBlock.js';
import { ClocktowerMCP } from './mcp.js';
import { RateLimiter } from './RateLimiter.js';
import { enforceMcpRateLimit, enforceTierRateLimits } from './rateLimit.js';
import { withSecurityHeaders } from './securityHeaders.js';
import { validateApiPostRequest, validateEnv, validateMcpRequest } from './validation.js';
import { createApiApp, createApiAppForEnv } from './api/app.js';
import { handleApiCorsPreflight, withApiCorsHeaders } from './cors.js';
import { getRateLimitIdentity, resolveApiAccess } from './middleware/accessLane.js';
import { enforceBuilderPolicy, rewriteMePath } from './middleware/entitlementPolicy.js';
import { enforceFreeTierPolicy } from './middleware/freeTierPolicy.js';
import { isApiEnabled, isApiHealthCheckPath } from './config/apiAccess.js';
import {
	getPublicApiOrigin,
	getPublicMcpOrigin,
	rewriteRequestForSurface,
	shouldHandleApiRoute,
	surfaceMismatchResponse,
	type RequestSurface,
} from './config/hostnames.js';
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

	const { request: routedRequest, surface, pathname } = rewriteRequestForSurface(request, env);
	const mismatch = surfaceMismatchResponse(surface, pathname, env);
	if (mismatch) {
		return mismatch;
	}

	if (pathname === '/mcp') {
		const invalidRequest = await validateMcpRequest(routedRequest);
		if (invalidRequest) {
			return invalidRequest;
		}

		const forbiddenOrigin = enforceOriginAllowlist(routedRequest, env);
		if (forbiddenOrigin) {
			return forbiddenOrigin;
		}

		const unauthorized = enforceBasicAuth(routedRequest, env);
		if (unauthorized) {
			return unauthorized;
		}

		const rateLimited = await enforceMcpRateLimit(routedRequest, env);
		if (rateLimited) {
			return rateLimited;
		}

		const mcpHandler = ClocktowerMCP.serve('/mcp');
		return await mcpHandler.fetch(routedRequest, env, ctx);
	}

	if (shouldHandleApiRoute(pathname, surface)) {
		const corsPreflight = handleApiCorsPreflight(routedRequest, env);
		if (corsPreflight) {
			return withSecurityHeaders(corsPreflight);
		}

		if (routedRequest.method === 'POST') {
			const invalidPost = await validateApiPostRequest(routedRequest);
			if (invalidPost) {
				return withSecurityHeaders(withApiCorsHeaders(routedRequest, invalidPost, env));
			}
		}

		if (!isApiEnabled(env) && !isApiHealthCheckPath(routedRequest.method, pathname)) {
			return withSecurityHeaders(
				withApiCorsHeaders(routedRequest, Errors.apiDisabled(), env),
			);
		}

		const configError = ensureApiEnvValidated(env);
		if (configError) {
			return withSecurityHeaders(withApiCorsHeaders(routedRequest, configError, env));
		}

		const requireBasicAuth = env.API_REQUIRE_BASIC_AUTH !== 'false';

		if (requireBasicAuth) {
			const unauthorized = enforceBasicAuth(routedRequest, env);
			if (unauthorized) {
				return withSecurityHeaders(withApiCorsHeaders(routedRequest, unauthorized, env));
			}
		}

		const access = await resolveApiAccess(routedRequest, env);

		if (access.lane === 'free') {
			const policyBlocked = enforceFreeTierPolicy(routedRequest.method, pathname, routedRequest);
			if (policyBlocked) {
				return withSecurityHeaders(withApiCorsHeaders(routedRequest, policyBlocked, env));
			}
		} else if (access.session) {
			const policyBlocked = await enforceBuilderPolicy(routedRequest, env, access.session);
			if (policyBlocked) {
				return withSecurityHeaders(withApiCorsHeaders(routedRequest, policyBlocked, env));
			}
		}

		const identity = getRateLimitIdentity(access, routedRequest);
		const rateLimited = await enforceTierRateLimits(routedRequest, env, access.lane, identity);
		if (rateLimited) {
			return withSecurityHeaders(withApiCorsHeaders(routedRequest, rateLimited, env));
		}

		let apiRequest = routedRequest;
		if (access.lane === 'builder' && access.session && pathname.includes('/me')) {
			const rewritten = new URL(routedRequest.url);
			rewritten.pathname = rewriteMePath(pathname, access.session);
			apiRequest = new Request(rewritten.toString(), routedRequest);
		}

		const headers = new Headers(apiRequest.headers);
		// Server-authoritative lane for handlers (write RPM, free-tier search caps).
		headers.set('X-Clocktower-Lane', access.lane);
		// Preserve method/body — spreading a Request drops POST (becomes GET → 404 on write routes).
		apiRequest = new Request(apiRequest, { headers });

		const apiResponse = await getApi(env).fetch(apiRequest, env, ctx);
		return withSecurityHeaders(
			withApiCorsHeaders(routedRequest, withLaneHeaders(apiResponse, access.lane), env),
		);
	}

	return Response.json(buildDiscoveryPayload(env, surface));
}

function buildDiscoveryPayload(env: Env, surface: RequestSurface) {
	const payload: Record<string, unknown> = {
		status: 'ok',
		name: 'clocktower-mcp',
		hosts: {
			api: getPublicApiOrigin(env),
			mcp: getPublicMcpOrigin(env),
		},
		mcp: `${getPublicMcpOrigin(env)}/`,
		rest: getPublicApiOrigin(env),
		apiEnabled: isApiEnabled(env),
		surface,
		note: 'REST API is free with tiered rate limits. MCP requires x402.',
		access: {
			rest: 'free (rate-limited) or builder session',
			mcp: 'x402 required',
		},
	};

	if (surface === 'legacy') {
		payload.legacyPaths = { rest: '/api', mcp: '/mcp' };
	}

	return payload;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return withSecurityHeaders(await handleRequest(request, env, ctx));
	},
};

export { ClocktowerMCP, RateLimiter };