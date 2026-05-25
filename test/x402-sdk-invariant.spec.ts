import { describe, expect, it } from 'vitest';
import { withX402 } from 'agents/x402';

/**
 * Regression guard for M1.
 *
 * `agents/x402`'s `paidTool` wrapper must:
 *   1. verify the payment payload up front (cheap, no on-chain effect),
 *   2. run the handler,
 *   3. only call `settlePayment` (the actual on-chain USDC transfer) if the
 *      handler did not throw and did not return `{ isError: true }`.
 *
 * Our M1 fix in `src/tx/prepare.ts` relies on this invariant: paused-token and
 * failed-simulation cases throw, which means the SDK skips settlement and the
 * caller is not charged for a doomed prepare. If this test fails after a
 * `agents` package bump, re-read `node_modules/agents/dist/mcp/x402.js` and
 * confirm the wrapper still has the same shape. If it doesn't, the throws in
 * `prepare.ts` no longer prevent users from being charged for failures.
 *
 * We assert against `withX402.toString()` rather than executing the wrapper
 * because (a) the resourceServer is a closure variable we can't otherwise spy
 * on, and (b) Function.prototype.toString returns the real function source for
 * non-bundled CJS/ESM dependencies, which is how `agents` is shipped today.
 */
describe('agents/x402 verify-only-settle invariant', () => {
	const src = withX402.toString();

	it('contains the verify and settle calls separately', () => {
		expect(src).toContain('verifyPayment');
		expect(src).toContain('settlePayment');
	});

	it('gates settlePayment behind a `failed` flag', () => {
		expect(src).toMatch(/if\s*\(\s*!\s*failed\s*\)/);
	});

	it('marks thrown handlers and isError results as failed', () => {
		expect(src).toMatch(/catch[\s\S]*?failed\s*=\s*true/);
		expect(src).toMatch(/isError[\s\S]*?failed\s*=\s*true/);
	});
});
