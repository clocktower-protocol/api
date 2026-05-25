const RESTRICTED_MESSAGE = 'Our service is not available in New York State.';

const NY_REGION_VALUES = new Set(['NY', 'New York', 'new york', 'ny']);

/**
 * Geo classification trusts `request.cf` first and falls back to the CF-* HTTP
 * headers only when `request.cf` is fully absent (e.g. local dev under
 * miniflare without an injected cf-object, or routing through a non-CF
 * gateway in testing).
 *
 * The headers are accepted from clients on inbound requests, so anything that
 * reaches the Worker outside the Cloudflare edge could spoof them; the
 * `request.cf` object is server-populated by Cloudflare and cannot be set by
 * the client.
 */
function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function classify(request: Request): { country?: string; region?: string } {
	const cf = request.cf as { country?: unknown; regionCode?: unknown } | undefined;
	const cfCountry = asString(cf?.country);
	const cfRegion = asString(cf?.regionCode);
	if (cfCountry !== undefined || cfRegion !== undefined) {
		return { country: cfCountry, region: cfRegion };
	}

	const country = request.headers.get('cf-ipcountry') ?? undefined;
	const region = request.headers.get('cf-ipregion') ?? undefined;
	return { country, region };
}

export function isNewYorkBlocked(request: Request): boolean {
	const { country, region } = classify(request);
	if (country !== 'US') {
		return false;
	}
	if (region === undefined) {
		return false;
	}
	return NY_REGION_VALUES.has(region);
}

export function enforceGeoBlock(request: Request): Response | null {
	if (!isNewYorkBlocked(request)) {
		return null;
	}

	return Response.json(
		{
			error: 'Access restricted',
			message: RESTRICTED_MESSAGE,
		},
		{
			status: 403,
			headers: { 'Cache-Control': 'no-cache' },
		},
	);
}
