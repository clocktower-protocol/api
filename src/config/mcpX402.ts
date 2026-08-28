/**
 * MCP x402 payments are opt-in. Unset or any value other than 'true' means
 * unpaid MCP with REST-style free IP / developer API key access.
 */
export function isMcpX402Enabled(env: Env): boolean {
	return env.MCP_X402_ENABLED === 'true';
}

/** Parse the Worker-authoritative lane header set on /mcp when x402 is off. */
export function parseMcpAccessLane(extra: unknown): 'free' | 'developer' {
	const extraInfo = extra as
		| { requestInfo?: { headers?: Record<string, string> } }
		| undefined;
	const headers = extraInfo?.requestInfo?.headers ?? {};
	const raw =
		headers['x-clocktower-lane'] ??
		headers['X-Clocktower-Lane'] ??
		headers['X-CLOCKTOWER-LANE'];
	if (typeof raw === 'string' && raw.toLowerCase() === 'developer') {
		return 'developer';
	}
	return 'free';
}
