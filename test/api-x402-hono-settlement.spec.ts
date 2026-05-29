import { describe, expect, it } from 'vitest';
import { paymentMiddlewareFromHTTPServer } from '@x402/hono';

/**
 * Regression guard for REST x402 settlement (parity with MCP M1 / agents/x402).
 *
 * @x402/hono's paymentMiddlewareFromHTTPServer verifies payment, runs the handler,
 * and only calls processSettlement when the handler response status is below 400.
 * Our write handlers return 4xx/5xx JSON (they do not throw) on validation and
 * upstream errors — settlement must be skipped for those responses.
 *
 * If this fails after an @x402/hono bump, re-read node_modules/@x402/hono and
 * confirm the status >= 400 cancellation path remains.
 */
describe('@x402/hono verify-only-settle invariant', () => {
	const src = paymentMiddlewareFromHTTPServer.toString();

	it('verifies payment before running the handler', () => {
		expect(src).toContain('processHTTPRequest');
	});

	it('cancels settlement when the handler response status is >= 400', () => {
		expect(src).toContain('res.status >= 400');
		expect(src).toContain('cancellationDispatcher.cancel');
		expect(src).toMatch(/handler_failed|handler_threw/);
	});

	it('calls processSettlement only after a successful handler response', () => {
		expect(src).toContain('processSettlement');
		const settleIndex = src.indexOf('processSettlement');
		const statusCheckIndex = src.indexOf('res.status >= 400');
		expect(statusCheckIndex).toBeGreaterThan(-1);
		expect(settleIndex).toBeGreaterThan(statusCheckIndex);
	});
});
