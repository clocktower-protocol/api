/**
 * Production hostname routing for the single Worker deployment.
 *
 * - api.clocktower.finance → REST (paths omit the /api prefix)
 * - mcp.clocktower.finance → MCP at / and /mcp
 * - legacy hosts (workers.dev, localhost, tests) → path-based /api and /mcp
 */

export const DEFAULT_API_HOST = 'api.clocktower.finance';
export const DEFAULT_MCP_HOST = 'mcp.clocktower.finance';
export const DEFAULT_SIWE_DOMAIN = 'api.clocktower.finance';

export type RequestSurface = 'api' | 'mcp' | 'legacy';

export function getApiHost(env: Env): string {
	return (env.API_HOST?.trim() || DEFAULT_API_HOST).toLowerCase();
}

export function getMcpHost(env: Env): string {
	return (env.MCP_HOST?.trim() || DEFAULT_MCP_HOST).toLowerCase();
}

export function getSiweDomain(env: Env): string {
	return env.SIWE_DOMAIN?.trim() || DEFAULT_SIWE_DOMAIN;
}

export function getPublicApiOrigin(env: Env): string {
	return `https://${getApiHost(env)}`;
}

export function getPublicMcpOrigin(env: Env): string {
	return `https://${getMcpHost(env)}`;
}

export function classifyRequestSurface(hostname: string, env: Env): RequestSurface {
	const host = hostname.toLowerCase();
	if (host === getApiHost(env)) {
		return 'api';
	}
	if (host === getMcpHost(env)) {
		return 'mcp';
	}
	return 'legacy';
}

export function isApiPath(pathname: string): boolean {
	return pathname === '/api' || pathname.startsWith('/api/');
}

export function isMcpPath(pathname: string): boolean {
	return pathname === '/mcp' || pathname.startsWith('/mcp/');
}

/**
 * Rewrites outward-facing paths on dedicated hosts into the internal Hono/MCP
 * paths the handlers already expect (/api/*, /mcp).
 */
export function normalizePathname(pathname: string, surface: RequestSurface): string {
	if (surface === 'api') {
		if (isApiPath(pathname) || pathname === '/') {
			return pathname;
		}
		return `/api${pathname}`;
	}

	if (surface === 'mcp') {
		if (isMcpPath(pathname)) {
			return pathname;
		}
		if (pathname === '/') {
			return '/mcp';
		}
	}

	return pathname;
}

export function isRoutableOnSurface(pathname: string, surface: RequestSurface): boolean {
	if (surface === 'legacy') {
		return true;
	}
	if (surface === 'api') {
		return pathname === '/' || isApiPath(pathname);
	}
	return isMcpPath(pathname);
}

export function shouldHandleApiRoute(pathname: string, surface: RequestSurface): boolean {
	if (surface === 'api') {
		return pathname === '/' || isApiPath(pathname);
	}
	return isApiPath(pathname);
}

export function surfaceMismatchResponse(
	surface: RequestSurface,
	pathname: string,
	env: Env,
): Response | null {
	if (surface === 'api' && isMcpPath(pathname)) {
		return Response.json(
			{
				error: 'Not Found',
				code: 'NOT_FOUND',
				hint: `MCP is served at ${getPublicMcpOrigin(env)}`,
			},
			{ status: 404 },
		);
	}
	if (surface === 'mcp' && isApiPath(pathname)) {
		return Response.json(
			{
				error: 'Not Found',
				code: 'NOT_FOUND',
				hint: `REST API is served at ${getPublicApiOrigin(env)}`,
			},
			{ status: 404 },
		);
	}
	if (!isRoutableOnSurface(pathname, surface)) {
		return Response.json({ error: 'Not Found', code: 'NOT_FOUND' }, { status: 404 });
	}
	return null;
}

export function rewriteRequestForSurface(
	request: Request,
	env: Env,
): { request: Request; surface: RequestSurface; pathname: string } {
	const url = new URL(request.url);
	const surface = classifyRequestSurface(url.hostname, env);
	const pathname = normalizePathname(url.pathname, surface);

	if (pathname === url.pathname) {
		return { request, surface, pathname };
	}

	const rewritten = new URL(request.url);
	rewritten.pathname = pathname;
	return {
		request: new Request(rewritten.toString(), request),
		surface,
		pathname,
	};
}