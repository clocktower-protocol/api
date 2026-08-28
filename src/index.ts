import { enforceBasicAuth } from './auth.js';
import { enforceOriginAllowlist } from './csrf.js';
import { enforceGeoBlock } from './geoBlock.js';
import { ClocktowerMCP } from './mcp.js';
import { RateLimiter } from './RateLimiter.js';
import {
	enforceAuthFailRateLimit,
	enforceMcpRateLimit,
	enforceSecondaryIpRateLimit,
	enforceTierRateLimits,
} from './rateLimit.js';
import { withSecurityHeaders } from './securityHeaders.js';
import { validateApiPostRequest, validateEnv, validateMcpRequest } from './validation.js';
import { createApiApp, createApiAppForEnv } from './api/app.js';
import { handleApiCorsPreflight, withApiCorsHeaders } from './cors.js';
import { getRateLimitIdentity, resolveApiAccess } from './middleware/accessLane.js';
import { enforceBuilderPolicy, rewriteMePath } from './middleware/entitlementPolicy.js';
import { enforceLanePolicy, mcpSearchPolicyResponse } from './middleware/freeTierPolicy.js';
import { isApiKeyToken, verifyAdminSecret } from './auth/apiKeys.js';
import { parseBearerToken } from './auth/session.js';
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
import { classifyMcpJsonRpc, type RouteClass } from './config/rateLimits.js';
import { isMcpX402Enabled } from './config/mcpX402.js';
import {
	buildAccessEvent,
	peekErrorMeta,
	recordAccess,
} from './observability/accessLog.js';
import { runScheduledAlerts } from './observability/alerts.js';

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

async function respondRest(
	env: Env,
	request: Request,
	pathname: string,
	response: Response,
	meta: {
		lane: AccessLane | 'admin' | 'unknown';
		identity: string;
		keyId?: string;
		subjectId?: string;
		started: number;
	},
): Promise<Response> {
	const errMeta = await peekErrorMeta(response);
	recordAccess(
		env,
		buildAccessEvent({
			request,
			pathname,
			lane: meta.lane,
			identity: meta.identity,
			keyId: meta.keyId,
			subjectId: meta.subjectId,
			status: response.status,
			code: errMeta.code,
			bucket: errMeta.bucket,
			durationMs: Date.now() - meta.started,
			requestId: errMeta.requestId,
		}),
	);
	return response;
}

async function handleRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const started = Date.now();
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
		return handleMcpPath(routedRequest, env, ctx, started);
	}

	if (shouldHandleApiRoute(pathname, surface)) {
		const corsPreflight = handleApiCorsPreflight(routedRequest, env);
		if (corsPreflight) {
			return withSecurityHeaders(corsPreflight);
		}

		const logMetaBase = {
			started,
			identity: `ip:${routedRequest.headers.get('CF-Connecting-IP') ?? 'unknown'}`,
		};

		if (routedRequest.method === 'POST') {
			const invalidPost = await validateApiPostRequest(routedRequest);
			if (invalidPost) {
				const res = withSecurityHeaders(withApiCorsHeaders(routedRequest, invalidPost, env));
				return respondRest(env, routedRequest, pathname, res, {
					...logMetaBase,
					lane: 'unknown',
				});
			}
		}

		if (!isApiEnabled(env) && !isApiHealthCheckPath(routedRequest.method, pathname)) {
			const res = withSecurityHeaders(
				withApiCorsHeaders(routedRequest, Errors.apiDisabled(), env),
			);
			return respondRest(env, routedRequest, pathname, res, {
				...logMetaBase,
				lane: 'unknown',
			});
		}

		const configError = ensureApiEnvValidated(env);
		if (configError) {
			const res = withSecurityHeaders(withApiCorsHeaders(routedRequest, configError, env));
			return respondRest(env, routedRequest, pathname, res, {
				...logMetaBase,
				lane: 'unknown',
			});
		}

		const requireBasicAuth = env.API_REQUIRE_BASIC_AUTH !== 'false';

		if (requireBasicAuth) {
			const unauthorized = enforceBasicAuth(routedRequest, env);
			if (unauthorized) {
				const res = withSecurityHeaders(withApiCorsHeaders(routedRequest, unauthorized, env));
				return respondRest(env, routedRequest, pathname, res, {
					...logMetaBase,
					lane: 'unknown',
				});
			}
		}

		// Portal/admin key management: admin secret is not a user lane; do not apply free/dev limits.
		const isDeveloperKeysAdminPath =
			pathname === '/api/developer/keys' ||
			pathname.startsWith('/api/developer/keys/');
		if (isDeveloperKeysAdminPath && verifyAdminSecret(routedRequest, env)) {
			const apiResponse = await getApi(env).fetch(routedRequest, env, ctx);
			const res = withSecurityHeaders(
				withApiCorsHeaders(routedRequest, withLaneHeaders(apiResponse, 'free'), env),
			);
			return respondRest(env, routedRequest, pathname, res, {
				...logMetaBase,
				lane: 'admin',
				identity: 'admin',
			});
		}

		const access = await resolveApiAccess(routedRequest, env);
		const keyId = access.apiKey?.id;
		const subjectId = access.apiKey?.subjectId;
		const identity = getRateLimitIdentity(access, routedRequest);

		if (access.authError) {
			const bearer = parseBearerToken(routedRequest);
			if (bearer && isApiKeyToken(bearer)) {
				const authLimited = await enforceAuthFailRateLimit(routedRequest, env);
				if (authLimited) {
					const res = withSecurityHeaders(withApiCorsHeaders(routedRequest, authLimited, env));
					return respondRest(env, routedRequest, pathname, res, {
						started,
						lane: 'developer',
						identity,
						keyId,
						subjectId,
					});
				}
			}
			const res = withSecurityHeaders(withApiCorsHeaders(routedRequest, access.authError, env));
			return respondRest(env, routedRequest, pathname, res, {
				started,
				lane: 'developer',
				identity,
				keyId,
				subjectId,
			});
		}

		// Secondary IP ceiling for all REST traffic (multi-key / free DoS bound).
		const ipCeiling = await enforceSecondaryIpRateLimit(routedRequest, env);
		if (ipCeiling) {
			const res = withSecurityHeaders(withApiCorsHeaders(routedRequest, ipCeiling, env));
			return respondRest(env, routedRequest, pathname, res, {
				started,
				lane: access.lane,
				identity,
				keyId,
				subjectId,
			});
		}

		if (access.lane === 'free' || access.lane === 'developer') {
			const policyBlocked = enforceLanePolicy(
				access.lane,
				routedRequest.method,
				pathname,
				routedRequest,
			);
			if (policyBlocked) {
				const res = withSecurityHeaders(withApiCorsHeaders(routedRequest, policyBlocked, env));
				return respondRest(env, routedRequest, pathname, res, {
					started,
					lane: access.lane,
					identity,
					keyId,
					subjectId,
				});
			}
		} else if (access.session) {
			const policyBlocked = await enforceBuilderPolicy(routedRequest, env, access.session);
			if (policyBlocked) {
				const res = withSecurityHeaders(withApiCorsHeaders(routedRequest, policyBlocked, env));
				return respondRest(env, routedRequest, pathname, res, {
					started,
					lane: access.lane,
					identity,
					keyId,
					subjectId,
				});
			}
		}

		const rateLimited = await enforceTierRateLimits(routedRequest, env, access.lane, identity);
		if (rateLimited) {
			const res = withSecurityHeaders(withApiCorsHeaders(routedRequest, rateLimited, env));
			return respondRest(env, routedRequest, pathname, res, {
				started,
				lane: access.lane,
				identity,
				keyId,
				subjectId,
			});
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
		const res = withSecurityHeaders(
			withApiCorsHeaders(routedRequest, withLaneHeaders(apiResponse, access.lane), env),
		);
		return respondRest(env, routedRequest, pathname, res, {
			started,
			lane: access.lane,
			identity,
			keyId,
			subjectId,
		});
	}

	return Response.json(buildDiscoveryPayload(env, surface));
}

async function peekJsonBody(request: Request): Promise<unknown | undefined> {
	if (request.method !== 'POST') {
		return undefined;
	}
	try {
		const text = await request.clone().text();
		if (!text) {
			return undefined;
		}
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

async function respondMcp(
	env: Env,
	request: Request,
	response: Response,
	meta: {
		lane: AccessLane | 'unknown';
		identity: string;
		keyId?: string;
		subjectId?: string;
		started: number;
		routeClass?: RouteClass | 'other';
	},
): Promise<Response> {
	const errMeta = await peekErrorMeta(response);
	recordAccess(
		env,
		buildAccessEvent({
			request,
			pathname: '/mcp',
			lane: meta.lane,
			identity: meta.identity,
			keyId: meta.keyId,
			subjectId: meta.subjectId,
			status: response.status,
			code: errMeta.code,
			bucket: errMeta.bucket,
			durationMs: Date.now() - meta.started,
			requestId: errMeta.requestId,
			routeClass: meta.routeClass,
		}),
	);
	return response;
}

async function handleMcpPath(
	routedRequest: Request,
	env: Env,
	ctx: ExecutionContext,
	started: number,
): Promise<Response> {
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

	const mcpHandler = ClocktowerMCP.serve('/mcp');
	const ip = routedRequest.headers.get('CF-Connecting-IP') ?? 'unknown';
	const ipIdentity = `ip:${ip}`;

	if (isMcpX402Enabled(env)) {
		const rateLimited = await enforceMcpRateLimit(routedRequest, env);
		if (rateLimited) {
			return respondMcp(env, routedRequest, rateLimited, {
				started,
				lane: 'mcp',
				identity: ipIdentity,
			});
		}
		const response = await mcpHandler.fetch(routedRequest, env, ctx);
		return respondMcp(env, routedRequest, response, {
			started,
			lane: 'mcp',
			identity: ipIdentity,
		});
	}

	const access = await resolveApiAccess(routedRequest, env);
	const keyId = access.apiKey?.id;
	const subjectId = access.apiKey?.subjectId;
	const identity = getRateLimitIdentity(access, routedRequest);

	if (access.lane === 'builder') {
		const forbidden = Response.json(
			{
				error:
					'MCP does not accept Builder sessions; use a developer API key or omit Authorization',
				code: 'FORBIDDEN',
			},
			{ status: 403 },
		);
		return respondMcp(env, routedRequest, forbidden, {
			started,
			lane: 'builder',
			identity,
			keyId,
			subjectId,
		});
	}

	if (access.authError) {
		const bearer = parseBearerToken(routedRequest);
		if (bearer && isApiKeyToken(bearer)) {
			const authLimited = await enforceAuthFailRateLimit(routedRequest, env);
			if (authLimited) {
				return respondMcp(env, routedRequest, authLimited, {
					started,
					lane: 'developer',
					identity,
					keyId,
					subjectId,
				});
			}
		}
		return respondMcp(env, routedRequest, access.authError, {
			started,
			lane: 'developer',
			identity,
			keyId,
			subjectId,
		});
	}

	const ipCeiling = await enforceSecondaryIpRateLimit(routedRequest, env);
	if (ipCeiling) {
		return respondMcp(env, routedRequest, ipCeiling, {
			started,
			lane: access.lane,
			identity,
			keyId,
			subjectId,
		});
	}

	const rpcBody = await peekJsonBody(routedRequest);
	const routeClass = classifyMcpJsonRpc(rpcBody);
	const searchBlocked = mcpSearchPolicyResponse(access.lane, rpcBody);
	if (searchBlocked) {
		return respondMcp(env, routedRequest, searchBlocked, {
			started,
			lane: access.lane,
			identity,
			keyId,
			subjectId,
			routeClass,
		});
	}

	const rateLimited = await enforceTierRateLimits(
		routedRequest,
		env,
		access.lane,
		identity,
		routeClass,
	);
	if (rateLimited) {
		return respondMcp(env, routedRequest, rateLimited, {
			started,
			lane: access.lane,
			identity,
			keyId,
			subjectId,
			routeClass,
		});
	}

	const headers = new Headers(routedRequest.headers);
	headers.set('X-Clocktower-Lane', access.lane);
	const mcpRequest = new Request(routedRequest, { headers });
	const mcpResponse = await mcpHandler.fetch(mcpRequest, env, ctx);
	return respondMcp(env, routedRequest, withLaneHeaders(mcpResponse, access.lane), {
		started,
		lane: access.lane,
		identity,
		keyId,
		subjectId,
		routeClass,
	});
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
		note: isMcpX402Enabled(env)
			? 'REST: free (IP), developer API key (ctk_…), or Builder SIWE. MCP requires x402.'
			: 'REST: free (IP), developer API key (ctk_…), or Builder SIWE. MCP: free IP or developer API key (same limits as REST).',
		access: {
			rest: 'free | developer API key | builder session',
			mcp: isMcpX402Enabled(env)
				? 'x402 required'
				: 'free IP or developer API key (ctk_…); x402 when MCP_X402_ENABLED=true',
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

	async scheduled(
		_controller: ScheduledController,
		env: Env,
		ctx: ExecutionContext,
	): Promise<void> {
		ctx.waitUntil(
			runScheduledAlerts(env).catch((err) => {
				console.log(
					JSON.stringify({
						type: 'api_alert_error',
						ts: new Date().toISOString(),
						error: err instanceof Error ? err.message : String(err),
					}),
				);
			}),
		);
	},
};

export { ClocktowerMCP, RateLimiter };
