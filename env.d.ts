/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * Augment the global `Cloudflare.Env` namespace so that:
 *   - The Worker handler `fetch(req, env, ctx)` sees a typed `Env`.
 *   - The `env` exported by `cloudflare:test` is typed against the same
 *     bindings, eliminating "Cloudflare.Env not assignable to Env" errors
 *     in test files.
 *
 * This file is intentionally a script (no top-level imports/exports) so
 * the `Env` alias below is globally visible to every source and test file.
 */
declare namespace Cloudflare {
	interface Env {
		CLOCKTOWER_MCP: DurableObjectNamespace;
		RATE_LIMITER: DurableObjectNamespace;
		PREPARE_INTENTS: KVNamespace;
		ALCHEMY_API_KEY: string;
		ALCHEMY_URL: string;
		CLOCKTOWER_ADDRESS: string;
		CDP_API_KEY_ID: string;
		CDP_API_KEY_SECRET: string;
		X402_RECIPIENT: string;
		RATE_LIMIT_REQUESTS_PER_MINUTE?: string;
		WRITE_RATE_LIMIT_REQUESTS_PER_MINUTE?: string;
		PREPARE_INTENT_TTL_SECONDS?: string;
		ENABLE_AUTH?: string;
		CFP_USERNAME?: string;
		CFP_PASSWORD?: string;
		CFP_ALLOWED_ORIGINS?: string;
	}
}

interface Env extends Cloudflare.Env {}
