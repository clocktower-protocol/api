import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import { createLogger } from 'vite';

// Create a filtered logger that suppresses the extremely common (and harmless)
// "Sourcemap for ... points to missing source files" warnings coming from
// packages like @modelcontextprotocol/sdk and Miniflare.
const logger = createLogger();
const originalWarn = logger.warn.bind(logger);

logger.warn = (msg: any, options?: any) => {
	const message = typeof msg === 'string' ? msg : String(msg);
	if (
		message.includes('Sourcemap') &&
		(message.includes('points to missing source files') ||
			message.includes('Failed to parse source map'))
	) {
		return; // suppress these noisy warnings
	}
	originalWarn(msg, options);
};

export default defineConfig({
	esbuild: {
		sourcemap: false,
	},

	optimizeDeps: {
		esbuildOptions: {
			sourcemap: false,
		},
	},

	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc', environment: 'test' },
			miniflare: {
				bindings: {
					ALCHEMY_API_KEY: 'test-alchemy-key',
					CDP_API_KEY_ID: 'test-cdp-key-id',
					CDP_API_KEY_SECRET: 'test-cdp-key-secret',
					X402_RECIPIENT: '0x0000000000000000000000000000000000000001',
					X402_USE_MOCK_FACILITATOR: 'true',
					// Mirrors wrangler.jsonc env.test.vars (not always merged onto cloudflare:test env)
					RATE_LIMIT_REQUESTS_PER_MINUTE: '2',
					API_REQUIRE_BASIC_AUTH: 'false',
					ENABLE_AUTH: 'false',
				},
			},
		}),
	],

	test: {
		// Use the filtered custom logger defined above
		// (this is the currently recommended way to handle sourcemap spam from dependencies)
	},
	customLogger: logger,
});
