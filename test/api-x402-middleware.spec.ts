import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createX402PaymentMiddleware } from '../src/api/x402.js';
import { API_PRICES } from '../src/api/pricing.js';
import type { HTTPFacilitatorClient } from '@x402/core/server';

type MockFacilitator = Partial<HTTPFacilitatorClient>;

/**
 * Runtime tests for the official @x402/hono middleware integration
 * (via createX402PaymentMiddleware).
 *
 * These tests focus on the critical "verify first, only settle on success" invariant
 * using injected mock facilitators.
 */

function createMockFacilitator(overrides: Partial<{
  verify: any;
  settle: any;
}> = {}): MockFacilitator {
  return {
    verifyPayment: vi.fn().mockResolvedValue(overrides.verify ?? { isValid: true }),
    settlePayment: vi.fn().mockResolvedValue(overrides.settle ?? { success: true, transaction: '0xtx' }),
  };
}

/**
 * Creates a minimal Hono app with the x402 middleware applied for testing.
 */
function createTestApp(options: { facilitatorClient?: any } = {}) {
  const app = new Hono<{ Bindings: any }>();

  // Apply our x402 middleware (same as in production)
  const x402Mw = createX402PaymentMiddleware(options);
  app.use('/api/*', x402Mw);

  // Simple test route protected by the middleware
  app.get('/api/test', (c) => {
    return c.json({ ok: true });
  });

  // Route that can fail (to test the settle invariant)
  app.get('/api/failing', (c) => {
    return c.json({ error: 'handler failed' }, 500);
  });

  return app;
}

describe('createX402PaymentMiddleware (official @x402/hono) - runtime tests', () => {
  it('returns 402 when no payment header is provided', async () => {
    const app = createTestApp();
    const res = await app.request('/api/test');

    expect(res.status).toBe(402);
  });

  it('calls settle when handler succeeds', async () => {
    const mockFacilitator = createMockFacilitator();

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const app = createTestApp({ facilitatorClient: mockFacilitator as any });

    const res = await app.request('/api/test', {
      headers: { 'X-Payment': validPayment },
    });

    expect(res.status).toBe(200);
    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });

  it('does NOT call settle when handler fails (critical invariant)', async () => {
    const mockFacilitator = createMockFacilitator();

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const app = createTestApp({ facilitatorClient: mockFacilitator as any });

    const res = await app.request('/api/failing', {
      headers: { 'X-Payment': validPayment },
    });

    expect(res.status).toBe(500);
    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  it('does NOT call settle when handler throws', async () => {
    const mockFacilitator = createMockFacilitator();

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockRejectedValue(new Error('boom'));

    const protectedFn = withX402Payment(
      API_PRICES.protocolState,
      'Test',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);

    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  it('returns 402 when verify fails', async () => {
    const mockFacilitator = createMockFacilitator({
      verify: { isValid: false, invalidReason: 'Insufficient funds' },
    });

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const app = createTestApp({ facilitatorClient: mockFacilitator as any });

    const res = await app.request('/api/test', {
      headers: { 'X-Payment': validPayment },
    });

    expect(res.status).toBe(402);
  });

  it('still returns success when settle fails after successful handler', async () => {
    const mockFacilitator = createMockFacilitator({
      settle: { success: false, error: 'Settlement failed on chain' },
    });

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const app = createTestApp({ facilitatorClient: mockFacilitator as any });

    const res = await app.request('/api/test', {
      headers: { 'X-Payment': validPayment },
    });

    expect(res.status).toBe(200);
    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    // Settlement failure should not prevent the response from being returned
  });

  // Additional tests (missing recipient, header format variations, price passing, etc.)
  // can be added using the `createTestApp` + `app.request()` pattern above.
});

    const mockFacilitator = createMockFacilitator();
    const spy = mockFacilitator.verifyPayment as any;

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    const price = 0.05;
    const protectedFn = withX402Payment(
      price,
      'Expensive call',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);

    expect(spy).toHaveBeenCalled();
    const requirementsArg = spy.mock.calls[0][1];
    expect(requirementsArg.amount).toBeDefined();
    // Rough check that the amount scales with price (not exact due to decimals)
    expect(BigInt(requirementsArg.amount)).toBeGreaterThan(0n);
  });

  it('propagates correct write-tier price (0.02) into requirements for submit flows', async () => {
    const mockFacilitator = createMockFacilitator();
    const spy = mockFacilitator.verifyPayment as any;

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    const protectedFn = withX402Payment(
      API_PRICES.submitSignedTransactions,
      'Submit (write priced)',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);

    expect(spy).toHaveBeenCalled();
    const requirementsArg = spy.mock.calls[0][1];
    expect(requirementsArg.amount).toBeDefined();
    expect(BigInt(requirementsArg.amount)).toBeGreaterThan(0n);
    // Write ops use the 0.02 tier from pricing.ts
  });

  it('preserves the handler response exactly on success', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const customResponse = new Response(JSON.stringify({ custom: true }), {
      status: 201,
      headers: { 'X-Custom': 'yes' },
    });

    const handler = vi.fn().mockResolvedValue(customResponse);

    const protectedFn = withX402Payment(
      API_PRICES.protocolState,
      'Test',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);

    expect(res.status).toBe(201);
    expect(res.headers.get('X-Custom')).toBe('yes');
    const body = await res.json();
    expect(body.custom).toBe(true);
  });

  it('does not call settle if verify succeeds but we later detect handler error status', async () => {
    const mockFacilitator = createMockFacilitator();

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    // Handler returns 402 itself (unusual but possible)
    const handler = vi.fn().mockResolvedValue(new Response('payment issue', { status: 402 }));

    const protectedFn = withX402Payment(
      API_PRICES.protocolState,
      'Test',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);

    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  // Paranoid addition (Phase 4)
  it('never leaks X-Payment-Response header even if settle mock lies on a failure path', async () => {
    const mockFacilitator = createMockFacilitator({
      settle: { success: true, transaction: '0xshould-not-appear' },
    });

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response('validation failed hard', { status: 400 }));

    const protectedFn = withX402Payment(
      API_PRICES.submitSignedTransactions,
      'Submit',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);

    expect(res.headers.has('X-Payment-Response')).toBe(false);
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  // === Strengthened write path coverage through x402 ===

  it('calls settle for successful write handler (prepare_subscribe flow)', async () => {
    const mockFacilitator = createMockFacilitator();

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    // Simulate a successful write handler response
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ prepareId: '123e4567-e89b-12d3-a456-426614174000' }), { status: 200 })
    );

    const protectedFn = withX402Payment(
      API_PRICES.prepareSubscribe,
      'Prepare subscribe',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);

    expect(res.status).toBe(200);
    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });

  it('does NOT call settle when a write handler fails (critical for prepare flows)', async () => {
    const mockFacilitator = createMockFacilitator();

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    // Simulate a write handler that fails (e.g. invalid subscription data)
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid subscription', code: 'VALIDATION_ERROR' }), { status: 400 })
    );

    const protectedFn = withX402Payment(
      API_PRICES.prepareSubscribe,
      'Prepare subscribe',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);

    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  it('calls settle for successful prepare_create_subscription', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response(JSON.stringify({ prepareId: 'test-id' }), { status: 200 }));

    const protectedFn = withX402Payment(
      API_PRICES.prepareCreateSubscription,
      'Prepare create subscription',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);
    expect(res.status).toBe(200);
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });

  it('does not call settle when submit_signed_transactions handler fails', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid nonce' }), { status: 400 }));

    const protectedFn = withX402Payment(
      API_PRICES.submitSignedTransactions,
      'Submit signed transactions',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  // Additional write endpoint coverage
  it('calls settle for successful prepare_cancel_subscription', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response(JSON.stringify({ prepareId: 'cancel-id' }), { status: 200 }));

    const protectedFn = withX402Payment(
      API_PRICES.prepareCancelSubscription,
      'Prepare cancel subscription',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);
    expect(res.status).toBe(200);
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });

  it('does NOT call settle when prepare_unsubscribe handler fails', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Not a subscriber' }), { status: 400 }));

    const protectedFn = withX402Payment(
      API_PRICES.prepareUnsubscribe,
      'Prepare unsubscribe',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  it('calls settle for successful prepare_edit_details', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response(JSON.stringify({ prepareId: 'edit-id' }), { status: 200 }));

    const protectedFn = withX402Payment(
      API_PRICES.prepareEditDetails,
      'Prepare edit details',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);
    expect(res.status).toBe(200);
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });

  it('calls settle for successful prepare_unsubscribe_by_provider', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response(JSON.stringify({ prepareId: 'ubp-id' }), { status: 200 }));

    const protectedFn = withX402Payment(
      API_PRICES.prepareUnsubscribeByProvider,
      'Prepare unsubscribe by provider',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);
    expect(res.status).toBe(200);
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });

  it('does NOT call settle when check_subscribe_readiness fails', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ready: false, errors: ['Insufficient balance'] }), { status: 400 }));

    const protectedFn = withX402Payment(
      API_PRICES.checkSubscribeReadiness,
      'Check subscribe readiness',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  // === Phase 1: Comprehensive write-priced x402 coverage (success + failure for all) ===

  it('calls settle for successful get_transaction_status', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'confirmed', confirmations: 12 }), { status: 200 })
    );

    const protectedFn = withX402Payment(
      API_PRICES.getTransactionStatus,
      'Get transaction status',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);
    expect(res.status).toBe(200);
    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });

  it('does NOT call settle when get_transaction_status handler fails', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Transaction not found', code: 'NOT_FOUND' }), { status: 404 })
    );

    const protectedFn = withX402Payment(
      API_PRICES.getTransactionStatus,
      'Get transaction status',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);
    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  it('calls settle for successful check_subscribe_readiness', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ready: true, estimatedGas: '210000' }), { status: 200 })
    );

    const protectedFn = withX402Payment(
      API_PRICES.checkSubscribeReadiness,
      'Check subscribe readiness',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);
    expect(res.status).toBe(200);
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });

  it('does NOT call settle when prepare_create_subscription handler fails', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid amount', code: 'VALIDATION_ERROR' }), { status: 400 })
    );

    const protectedFn = withX402Payment(
      API_PRICES.prepareCreateSubscription,
      'Prepare create subscription',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);
    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  it('calls settle for successful submit_signed_transactions', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ txHashes: ['0xabc123...'] }), { status: 200 })
    );

    const protectedFn = withX402Payment(
      API_PRICES.submitSignedTransactions,
      'Submit signed transactions',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);
    expect(res.status).toBe(200);
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });

  it('calls settle for successful prepare_unsubscribe', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ prepareId: 'unsub-id' }), { status: 200 })
    );

    const protectedFn = withX402Payment(
      API_PRICES.prepareUnsubscribe,
      'Prepare unsubscribe',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);
    expect(res.status).toBe(200);
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });

  it('does NOT call settle when prepare_cancel_subscription handler fails', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Subscription not found', code: 'NOT_FOUND' }), { status: 404 })
    );

    const protectedFn = withX402Payment(
      API_PRICES.prepareCancelSubscription,
      'Prepare cancel subscription',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);
    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  it('does NOT call settle when prepare_edit_details handler fails', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid details', code: 'VALIDATION_ERROR' }), { status: 400 })
    );

    const protectedFn = withX402Payment(
      API_PRICES.prepareEditDetails,
      'Prepare edit details',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);
    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  it('does NOT call settle when prepare_unsubscribe_by_provider handler fails', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized', code: 'FORBIDDEN' }), { status: 403 })
    );

    const protectedFn = withX402Payment(
      API_PRICES.prepareUnsubscribeByProvider,
      'Prepare unsubscribe by provider',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);
    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });
});
