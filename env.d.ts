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
		SESSIONS_KV?: KVNamespace;
		RPC_CACHE_KV?: KVNamespace;
		ALCHEMY_API_KEY: string;
		ALCHEMY_URL: string;
		CLOCKTOWER_ADDRESS: string;
		CDP_API_KEY_ID: string;
		CDP_API_KEY_SECRET: string;
		X402_RECIPIENT: string;
		/** When 'true', use in-memory mock facilitator (Vitest only). */
		X402_USE_MOCK_FACILITATOR?: string;
		// Subgraph (The Graph) configuration for history + provider detail endpoints.
		// These are injected via wrangler secret put (or .dev.vars locally).
		// See clocktower-proxy for similar GRAPH_* handling pattern.
		GRAPH_BASE_URL?: string;            // Primary (Base mainnet) subgraph endpoint
		GRAPH_BASE_SEPOLIA_URL?: string;    // Sepolia subgraph endpoint
		GRAPH_API_KEY?: string;             // Bearer token for Authorization header
		RATE_LIMIT_REQUESTS_PER_MINUTE?: string;
		WRITE_RATE_LIMIT_REQUESTS_PER_MINUTE?: string;
		FREE_RATE_LIMIT_RPM?: string;
		FREE_EXPENSIVE_RATE_LIMIT_RPM?: string;
		FREE_SUBGRAPH_DAILY_LIMIT?: string;
		FREE_WRITE_RATE_LIMIT_RPM?: string;
		FREE_WRITE_DAILY_LIMIT?: string;
		FREE_DAILY_REQUEST_LIMIT?: string;
		DEVELOPER_RATE_LIMIT_RPM?: string;
		DEVELOPER_EXPENSIVE_RATE_LIMIT_RPM?: string;
		DEVELOPER_SUBGRAPH_DAILY_LIMIT?: string;
		DEVELOPER_WRITE_RATE_LIMIT_RPM?: string;
		DEVELOPER_WRITE_DAILY_LIMIT?: string;
		DEVELOPER_DAILY_REQUEST_LIMIT?: string;
		DEVELOPER_MAX_KEYS_PER_SUBJECT?: string;
		/** When 'false', reject ctk_ keys and disable mint. Default enabled when admin secret set. */
		DEVELOPER_KEYS_ENABLED?: string;
		/** Shared secret for portal/admin key management routes. */
		DEVELOPER_KEYS_ADMIN_SECRET?: string;
		BUILDER_RATE_LIMIT_RPM?: string;
		BUILDER_EXPENSIVE_RATE_LIMIT_RPM?: string;
		BUILDER_SUBGRAPH_DAILY_LIMIT?: string;
		BUILDER_WRITE_RATE_LIMIT_RPM?: string;
		BUILDER_WRITE_DAILY_LIMIT?: string;
		BUILDER_DAILY_REQUEST_LIMIT?: string;
		MCP_RATE_LIMIT_RPM?: string;
		MCP_EXPENSIVE_RATE_LIMIT_RPM?: string;
		MCP_WRITE_RATE_LIMIT_RPM?: string;
		MCP_WRITE_DAILY_LIMIT?: string;
		/** Legacy single Builder entitlement subscription ID. */
		BUILDER_SUB_ID?: string;
		/** Comma-separated Builder entitlement subscription IDs (multiple plans, same API access). */
		BUILDER_SUB_IDS?: string;
		ENABLE_AUTH?: string;
		API_REQUIRE_BASIC_AUTH?: string;   // Controls whether Basic Auth is required for /api routes (x402 is always required)
		/** Set to 'false' to disable REST /api routes (MCP /mcp stays up). GET /api/status remains available. */
		API_ENABLED?: string;
		CFP_USERNAME?: string;
		CFP_PASSWORD?: string;
		CFP_ALLOWED_ORIGINS?: string;
		/** Comma-separated browser origins allowed to call /api with CORS. Unset = CORS disabled. */
		API_CORS_ALLOWED_ORIGINS?: string;
		/** Public REST hostname (default api.clocktower.finance). */
		API_HOST?: string;
		/** Public MCP hostname (default mcp.clocktower.finance). */
		MCP_HOST?: string;
		/** SIWE message domain for Builder auth (default api.clocktower.finance). */
		SIWE_DOMAIN?: string;
	}
}

interface Env extends Cloudflare.Env {}
