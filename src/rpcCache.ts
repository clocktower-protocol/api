/**
 * KV-backed cache for relatively stable RPC reads.
 */

type CacheEntry<T> = {
	value: T;
	expiresAt: number;
};

const isolateCache = new Map<string, CacheEntry<unknown>>();

export async function getCachedRpc<T>(
	env: Env,
	key: string,
	ttlSeconds: number,
	fetcher: () => Promise<T>,
): Promise<T> {
	const now = Date.now();
	const mem = isolateCache.get(key) as CacheEntry<T> | undefined;
	if (mem && mem.expiresAt > now) {
		return mem.value;
	}

	if (env.RPC_CACHE_KV) {
		const raw = await env.RPC_CACHE_KV.get(key, { cacheTtl: ttlSeconds });
		if (raw) {
			try {
				const parsed = JSON.parse(raw) as T;
				isolateCache.set(key, { value: parsed, expiresAt: now + ttlSeconds * 1000 });
				return parsed;
			} catch {
				// fall through
			}
		}
	}

	const value = await fetcher();
	isolateCache.set(key, { value, expiresAt: now + ttlSeconds * 1000 });

	if (env.RPC_CACHE_KV) {
		await env.RPC_CACHE_KV.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
	}

	return value;
}

export function withPublicCacheHeaders(response: Response, maxAgeSeconds = 30): Response {
	const headers = new Headers(response.headers);
	headers.set('Cache-Control', `public, max-age=${maxAgeSeconds}`);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}