import type { AccessLane } from './config/rateLimits.js';

/**
 * Parse the server-set access lane header. Clients cannot elevate themselves:
 * the Worker overwrites `X-Clocktower-Lane` before dispatching to handlers.
 * Unknown / missing values fall back to free (strictest write RPM among API lanes).
 */
export function parseAccessLane(value: string | null | undefined): AccessLane {
	if (value === 'builder' || value === 'mcp' || value === 'free' || value === 'developer') {
		return value;
	}
	return 'free';
}
