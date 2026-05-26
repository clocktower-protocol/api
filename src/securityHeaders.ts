/**
 * Defensive response headers applied at the Worker boundary.
 *
 * The MCP server is a JSON / SSE API today, so most of these are inert; the
 * value is forward-compat. If/when an HTML surface is added, the headers are
 * already in place. They're also cheap signal for security scanners that
 * grade endpoints by header presence.
 *
 * Choices:
 *   - `X-Content-Type-Options: nosniff` — stops MIME sniffing turning a JSON
 *     response into something the browser tries to render.
 *   - `X-Frame-Options: DENY` — prevents framing of any response. There is no
 *     legitimate same-origin embed of `/mcp`.
 *   - `Referrer-Policy: no-referrer` — never leak the MCP path or query
 *     string to third parties.
 *
 * Deliberately omitted:
 *   - `Strict-Transport-Security` — typically owned by the Cloudflare edge
 *     config so we don't double-set it from the Worker.
 *   - `Content-Security-Policy` — only meaningful for HTML, which this
 *     service does not serve.
 */
const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'no-referrer',
};

/**
 * Returns a response with the security headers merged in. Existing values are
 * preserved, so a downstream handler can override per-response if needed.
 *
 * 101 Switching Protocols (WebSocket upgrade) responses are passed through
 * unchanged because reconstructing them via `new Response(...)` would drop
 * the workerd-specific `webSocket` linkage.
 */
export function withSecurityHeaders(response: Response): Response {
	if (response.status === 101) {
		return response;
	}

	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!headers.has(name)) {
			headers.set(name, value);
		}
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
