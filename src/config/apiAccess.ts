/**
 * REST API access controls (kill switch, health-check exemptions).
 */

export function isApiEnabled(env: Env): boolean {
	return env.API_ENABLED !== 'false';
}

/** Allowed when API_ENABLED=false so monitors can distinguish "up" vs "down". */
export function isApiHealthCheckPath(method: string, pathname: string): boolean {
	return method === 'GET' && pathname === '/api/status';
}