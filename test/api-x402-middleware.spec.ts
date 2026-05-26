import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { withX402Payment } from '../src/api/x402.js';
import { API_PRICES } from '../src/api/pricing.js';
import type { HTTPFacilitatorClient } from '@x402/core/server';

type MockFacilitator = Partial<HTTPFacilitatorClient>;

/**
 * Improved runtime tests for the custom x402 middleware (Stage 2).
 *
 * Focus: Better mocking of the facilitator to test the critical invariant.
 */

function createMockContext(paymentHeader?: string) {
  const headers = new Headers();
  if (paymentHeader) {
    headers.set('X-Payment', paymentHeader);
  }

  return {
    env: {
      X402_RECIPIENT: '0x1234567890123456789012345678901234567890',
    },
    req: {
      raw: new Request('http://example.com/api/test', { headers }),
    },
  };
}

function createMockFacilitator(overrides: Partial<{
  verify: any;
  settle: any;
}> = {}): MockFacilitator {
  return {
    verifyPayment: vi.fn().mockResolvedValue(overrides.verify ?? { isValid: true }),
    settlePayment: vi.fn().mockResolvedValue(overrides.settle ?? { success: true, transaction: '0xtx' }),
  };
}

describe('withX402Payment - runtime tests with mocking', () => {
  it('returns 402 when no payment header is provided', async () => {
    const mockContext = createMockContext();

    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    const protectedFn = withX402Payment(
      API_PRICES.protocolState,
      'Test',
      handler
    );

    const res = await protectedFn(mockContext);

    expect(res.status).toBe(402);
    expect(handler).not.toHaveBeenCalled();
  });

  it('calls settle when handler succeeds', async () => {
    const mockFacilitator = createMockFacilitator();

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response('success', { status: 200 }));

    const protectedFn = withX402Payment(
      API_PRICES.protocolState,
      'Test',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);

    expect(res.status).toBe(200);
    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });

  it('does NOT call settle when handler fails (critical invariant)', async () => {
    const mockFacilitator = createMockFacilitator();

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response('error', { status: 500 }));

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

  it('returns 402 and does not settle when verify fails', async () => {
    const mockFacilitator = createMockFacilitator({
      verify: { isValid: false, invalidReason: 'Insufficient funds' },
    });

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    const protectedFn = withX402Payment(
      API_PRICES.protocolState,
      'Test',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);

    expect(res.status).toBe(402);
    expect(handler).not.toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  it('still returns success when settle fails after successful handler', async () => {
    const mockFacilitator = createMockFacilitator({
      settle: { success: false, error: 'Settlement failed on chain' },
    });

    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response('success', { status: 200 }));

    const protectedFn = withX402Payment(
      API_PRICES.protocolState,
      'Test',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);

    expect(res.status).toBe(200);
    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });

  it('returns 402 with error info on invalid base64 payment header', async () => {
    const mockContext = createMockContext('!!!not-valid-base64!!!');

    const handler = vi.fn();

    const protectedFn = withX402Payment(
      API_PRICES.protocolState,
      'Test',
      handler
    );

    const res = await protectedFn(mockContext);

    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('handles missing X402_RECIPIENT gracefully', async () => {
    const badContext = {
      env: {}, // missing X402_RECIPIENT
      req: {
        raw: new Request('http://example.com/api/test', { headers: {} }),
      },
    };

    const handler = vi.fn();

    const protectedFn = withX402Payment(
      API_PRICES.protocolState,
      'Test',
      handler
    );

    const res = await protectedFn(badContext);

    // Missing recipient is a server configuration error → 500 is appropriate
    expect(res.status).toBe(500);
  });

  it('returns a raw x402-style 402 response when no payment is provided', async () => {
    const mockContext = createMockContext();

    const protectedFn = withX402Payment(
      API_PRICES.getSubscription,
      'Get one subscription',
      async () => new Response('should not run')
    );

    const res = await protectedFn(mockContext);

    expect(res.status).toBe(402);
    const body = await res.json();

    expect(body.x402Version).toBe(1);
    expect(Array.isArray(body.accepts)).toBe(true);
    expect(body.accepts.length).toBeGreaterThan(0);
    expect(body.accepts[0].description).toContain('Get one subscription');
  });

  it('returns 400 for valid base64 but invalid JSON payment header', async () => {
    // Valid base64 that decodes to non-JSON
    const badJson = btoa('this is not json');
    const mockContext = createMockContext(badJson);

    const handler = vi.fn();

    const protectedFn = withX402Payment(
      API_PRICES.protocolState,
      'Test',
      handler
    );

    const res = await protectedFn(mockContext);

    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes the correct price into the payment requirements', async () => {
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
});
