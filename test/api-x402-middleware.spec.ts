/**
 * This file previously contained low-level unit tests for the custom x402 middleware.
 *
 * After migrating to the official @x402/hono middleware in src/api/x402.ts,
 * these tests were removed as the core "verify first, settle only on success"
 * behavior is now provided and tested by the @x402 libraries themselves.
 *
 * High-level security and integration tests live in api-x402-security.spec.ts
 * and exercise the real production app via createApiApp().
 */
export {};
