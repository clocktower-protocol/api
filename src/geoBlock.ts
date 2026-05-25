const RESTRICTED_MESSAGE = 'Our service is not available in New York State.';

export function isNewYorkBlocked(request: Request): boolean {
	const country = request.headers.get('cf-ipcountry');
	const region = request.headers.get('cf-ipregion');
	const cf = request.cf;
	const cfCountry = cf?.country;
	const cfRegion = cf?.regionCode;

	return (
		(country === 'US' && region === 'New York') ||
		(cfCountry === 'US' && cfRegion === 'NY')
	);
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
