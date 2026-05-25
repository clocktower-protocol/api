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

/**
 * Constant-time string comparison. Operates on UTF-8 byte representations
 * and always processes max(a.len, b.len) bytes so timing leaks neither which
 * bytes matched nor which input was longer.
 */
function timingSafeEqual(a: string, b: string): boolean {
	const encoder = new TextEncoder();
	const aBytes = encoder.encode(a);
	const bBytes = encoder.encode(b);
	const len = Math.max(aBytes.length, bBytes.length);
	let diff = aBytes.length ^ bBytes.length;
	for (let i = 0; i < len; i++) {
		const aByte = i < aBytes.length ? aBytes[i] : 0;
		const bByte = i < bBytes.length ? bBytes[i] : 0;
		diff |= aByte ^ bByte;
	}
	return diff === 0;
}

export function enforceBasicAuth(request: Request, env: Env): Response | null {
	if (env.ENABLE_AUTH !== 'true') {
		return null;
	}

	const username = env.CFP_USERNAME ?? '';
	const password = env.CFP_PASSWORD ?? '';

	const authorization = request.headers.get('authorization');
	if (!authorization) {
		return new Response('Please provide username and password.', {
			status: 401,
			headers: { 'WWW-Authenticate': `Basic realm="${REALM}"` },
		});
	}

	const [providedUser, providedPass] = parseCredentials(authorization);

	// Compare both fields without short-circuiting so timing does not leak
	// which one was wrong or the matched prefix length.
	const userOk = timingSafeEqual(providedUser, username);
	const passOk = timingSafeEqual(providedPass, password);
	if (!(userOk && passOk)) {
		return new Response('Invalid username or password.', {
			status: 401,
			headers: { 'WWW-Authenticate': `Basic realm="${REALM}"` },
		});
	}

	return null;
}
