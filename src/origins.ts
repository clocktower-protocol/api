/**
 * Shared Origin parsing for CSRF (MCP) and CORS (REST API) allowlists.
 */

export type ParsedAllowedOrigins = {
	wildcard: boolean;
	set: Set<string>;
};

export function normalizeOrigin(value: string): string | null {
	try {
		const u = new URL(value);
		return u.origin.toLowerCase();
	} catch {
		return null;
	}
}

export function parseAllowedOrigins(raw: string | undefined): ParsedAllowedOrigins {
	if (!raw) {
		return { wildcard: false, set: new Set() };
	}

	const entries = raw
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	if (entries.includes('*')) {
		return { wildcard: true, set: new Set() };
	}

	return {
		wildcard: false,
		set: new Set(entries.map(normalizeOrigin).filter((s): s is string => s !== null)),
	};
}

export function isOriginAllowed(originHeader: string | null, rawAllowlist: string | undefined): boolean {
	if (!originHeader) {
		return false;
	}

	const normalized = normalizeOrigin(originHeader);
	if (normalized === null) {
		return false;
	}

	const { wildcard, set } = parseAllowedOrigins(rawAllowlist);
	if (wildcard) {
		return true;
	}

	return set.has(normalized);
}