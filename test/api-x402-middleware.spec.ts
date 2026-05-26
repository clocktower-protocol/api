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

    // Should still return 402 instead of crashing
    expect(res.status).toBe(402);
  });
});
