import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc', environment: 'test' },
			// Test-only stand-ins for credential-shaped env vars. Kept out of
			// `wrangler.jsonc` so that source-controlled config never carries
			// *_KEY_* / *_SECRET shaped values, even placeholder ones. These
			// bindings are visible only to vitest-pool-workers' miniflare
			// runtime and are never consulted by `wrangler deploy`.
			miniflare: {
				bindings: {
					ALCHEMY_API_KEY: 'test-alchemy-key',
					CDP_API_KEY_ID: 'test-cdp-key-id',
					CDP_API_KEY_SECRET: 'test-cdp-key-secret',
					X402_RECIPIENT: '0x0000000000000000000000000000000000000001',
				},
			},
		}),
	],

	// Suppress the very noisy "Sourcemap ... points to missing source files"
	// warnings that come from @modelcontextprotocol/sdk (and a few other deps).
	// These are harmless but flood the test output.
	test: {
		onConsoleLog(log) {
			if (log.includes('Sourcemap for') && log.includes('points to missing source files')) {
				return false; // suppress the line
			}
		},
	},
});
