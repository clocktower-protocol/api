const REALM = 'Secure Clocktower MCP';

function parseCredentials(authorization: string): [string, string] {
	const parts = authorization.split(' ');
	if (parts.length !== 2 || parts[0] !== 'Basic' || !parts[1]) {
		return ['', ''];
	}

	try {
		const plainAuth = atob(parts[1]);
		const colonIndex = plainAuth.indexOf(':');
		if (colonIndex === -1) {
			return [plainAuth, ''];
		}

		return [plainAuth.slice(0, colonIndex), plainAuth.slice(colonIndex + 1)];
	} catch {
		return ['', ''];
	}
}

export function enforceBasicAuth(request: Request, env: Env): Response | null {
	if (env.ENABLE_AUTH !== 'true') {
		return null;
	}

	const username = env.CFP_USERNAME;
	const password = env.CFP_PASSWORD;

	const authorization = request.headers.get('authorization');
	if (!authorization) {
		return new Response('Please provide username and password.', {
			status: 401,
			headers: { 'WWW-Authenticate': `Basic realm="${REALM}"` },
		});
	}

	const [providedUser, providedPass] = parseCredentials(authorization);
	if (providedUser !== username || providedPass !== password) {
		return new Response('Invalid username or password.', {
			status: 401,
			headers: { 'WWW-Authenticate': `Basic realm="${REALM}"` },
		});
	}

	return null;
}
