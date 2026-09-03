/**
 * Structured access logs (Workers Logs / Logpush) + Analytics Engine data points.
 * Never log full API keys or admin secrets — keyId / identity only.
 */

import { classifyRoute, type AccessLane, type RouteClass } from '../config/rateLimits.js';
import { getClientIp } from '../rateLimit.js';

export type AccessLogEvent = {
	type: 'api_access';
	ts: string;
	method: string;
	route: string;
	routeClass: RouteClass | 'other';
	lane: AccessLane | 'admin' | 'unknown';
	identity: string;
	keyId?: string;
	subjectId?: string;
	status: number;
	code?: string;
	bucket?: string;
	durationMs: number;
	requestId?: string;
	cfRay?: string | null;
};

export type AdminAuditEvent = {
	type: 'api_key_admin';
	ts: string;
	action: 'create' | 'list' | 'revoke';
	status: number;
	subjectId?: string;
	keyId?: string;
	ip: string;
	code?: string;
};

/** Blob layout for Analytics Engine (query by alias in SQL). */
export const AE_BLOBS = {
	lane: 0,
	route: 1,
	routeClass: 2,
	code: 3,
	identity: 4,
	keyId: 5,
	subjectId: 6,
	method: 7,
} as const;

/** Double layout: status, durationMs, isWrite, is429, is401, isError */
export const AE_DOUBLES = {
	status: 0,
	durationMs: 1,
	isWrite: 2,
	is429: 3,
	is401: 4,
	isError: 5,
} as const;

function observabilityEnabled(env: Env): boolean {
	return env.OBSERVABILITY_ENABLED !== 'false';
}

export function buildAccessEvent(input: {
	request: Request;
	pathname: string;
	lane: AccessLogEvent['lane'];
	identity: string;
	keyId?: string;
	subjectId?: string;
	status: number;
	code?: string;
	bucket?: string;
	durationMs: number;
	requestId?: string;
	routeClass?: RouteClass | 'other';
}): AccessLogEvent {
	const routeClass =
		input.routeClass ??
		(input.pathname.startsWith('/api/') || input.pathname === '/api'
			? classifyRoute(input.request.method, input.pathname)
			: 'other');

	return {
		type: 'api_access',
		ts: new Date().toISOString(),
		method: input.request.method,
		route: input.pathname.split('?')[0],
		routeClass,
		lane: input.lane,
		identity: input.identity,
		...(input.keyId ? { keyId: input.keyId } : {}),
		...(input.subjectId ? { subjectId: input.subjectId } : {}),
		status: input.status,
		...(input.code ? { code: input.code } : {}),
		...(input.bucket ? { bucket: input.bucket } : {}),
		durationMs: input.durationMs,
		...(input.requestId ? { requestId: input.requestId } : {}),
		cfRay: input.request.headers.get('cf-ray'),
	};
}

function toLogPayload(event: AccessLogEvent): Record<string, string | number | null | undefined> {
	return {
		type: event.type,
		ts: event.ts,
		method: event.method,
		route: event.route,
		routeClass: event.routeClass,
		lane: event.lane,
		identity: event.identity,
		keyId: event.keyId,
		subjectId: event.subjectId,
		status: event.status,
		code: event.code,
		bucket: event.bucket,
		durationMs: event.durationMs,
		requestId: event.requestId,
		cfRay: event.cfRay,
	};
}

export function recordAccess(env: Env, event: AccessLogEvent): void {
	if (!observabilityEnabled(env)) return;

	// Allowlisted fields only — never stringify a key record (tokenHash) or bearer token.
	console.log(JSON.stringify(toLogPayload(event)));

	const dataset = env.API_ANALYTICS;
	if (!dataset || typeof dataset.writeDataPoint !== 'function') return;

	const isWrite = event.routeClass === 'write' || event.routeClass === 'readiness' ? 1 : 0;
	// index1: high-cardinality filter key (API key id or identity)
	const index = event.keyId || event.identity || 'unknown';

	try {
		dataset.writeDataPoint({
			indexes: [index.slice(0, 96)],
			blobs: [
				event.lane,
				event.route.slice(0, 100),
				event.routeClass,
				event.code ?? '',
				event.identity.slice(0, 96),
				event.keyId ?? '',
				event.subjectId ?? '',
				event.method,
			],
			doubles: [
				event.status,
				event.durationMs,
				isWrite,
				event.status === 429 ? 1 : 0,
				event.status === 401 ? 1 : 0,
				event.status >= 400 ? 1 : 0,
			],
		});
	} catch {
		// Observability must never break the request path.
	}
}

export function recordAdminAudit(env: Env, event: Omit<AdminAuditEvent, 'type' | 'ts'>): void {
	if (!observabilityEnabled(env)) return;
	const full: AdminAuditEvent = {
		type: 'api_key_admin',
		ts: new Date().toISOString(),
		...event,
	};
	console.log(JSON.stringify(full));

	const dataset = env.API_ANALYTICS;
	if (!dataset || typeof dataset.writeDataPoint !== 'function') return;
	try {
		dataset.writeDataPoint({
			indexes: [(event.subjectId || event.ip || 'admin').slice(0, 96)],
			blobs: [
				'admin',
				`admin:${event.action}`,
				'admin',
				event.code ?? '',
				event.ip,
				event.keyId ?? '',
				event.subjectId ?? '',
				event.action.toUpperCase(),
			],
			doubles: [
				event.status,
				0,
				event.action === 'create' || event.action === 'revoke' ? 1 : 0,
				event.status === 429 ? 1 : 0,
				event.status === 401 ? 1 : 0,
				event.status >= 400 ? 1 : 0,
			],
		});
	} catch {
		// ignore
	}
}

/** Extract error code/bucket from a JSON error response body (best-effort, non-consuming). */
export async function peekErrorMeta(
	response: Response,
): Promise<{ code?: string; bucket?: string; requestId?: string }> {
	if (response.status < 400) return {};
	try {
		const clone = response.clone();
		const body = (await clone.json()) as {
			code?: string;
			bucket?: string;
			requestId?: string;
		};
		return {
			...(body.code ? { code: body.code } : {}),
			...(body.bucket ? { bucket: body.bucket } : {}),
			...(body.requestId ? { requestId: body.requestId } : {}),
		};
	} catch {
		return {};
	}
}

export function clientIpFromRequest(request: Request): string {
	return getClientIp(request);
}
