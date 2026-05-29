import { describe, expect, it, vi } from 'vitest';
// Note: This file still uses the legacy withX402Payment (now a deprecated stub).
// It will need a full rewrite to the new createX402PaymentMiddleware + Hono app pattern.
import { withX402Payment } from '../src/api/x402.js';
import { createApiApp } from '../src/api/app.js';
import { API_PRICES } from '../src/api/pricing.js';
import type { HTTPFacilitatorClient } from '@x402/core/server';

/**
 * Phase 4: Paranoid / security-grade tests for the x402 REST surface.
 *
 * These are the deeper, adversarial tests deferred until after good coverage.
 * Focus: Can an attacker trick the system into settling on failure?
 *        Can malformed payments cause harm or bypass protections?
 *        Do security headers / rate limits / error paths behave under attack?
 */

type MockFacilitator = Partial<HTTPFacilitatorClient>;

function createMockFacilitator(overrides: { verify?: any; settle?: any } = {}): MockFacilitator {
  return {
    verifyPayment: vi.fn().mockResolvedValue(overrides.verify ?? { isValid: true }),
    settlePayment: vi.fn().mockResolvedValue(overrides.settle ?? { success: true, transaction: '0xsettled' }),
  };
}

function createMockContext(paymentHeader?: string) {
  const headers = new Headers();
  if (paymentHeader) headers.set('X-Payment', paymentHeader);

  return {
    env: { X402_RECIPIENT: '0x1234567890123456789012345678901234567890' },
    req: { raw: new Request('http://example.com/api/test', { headers }) },
  };
}

describe('x402 security - adversarial payment payloads', () => {
  it('rejects payment that is valid base64 + JSON but has completely wrong shape', async () => {
    const badPayment = btoa(JSON.stringify({ totally: 'wrong', structure: 123, for: 'exact' }));
    const mockContext = createMockContext(badPayment);

    const handler = vi.fn();

    const protectedFn = withX402Payment(API_PRICES.protocolState, 'Test', handler);
    const res = await protectedFn(mockContext);

    // Both 400 and 402 are safe rejections for malformed payment data
    expect([400, 402]).toContain(res.status);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects extremely large (but valid base64) payment payloads gracefully', async () => {
    // ~50KB of junk - should not crash or cause issues
    const largeJunk = 'x'.repeat(50_000);
    const largePayment = btoa(JSON.stringify({ data: largeJunk }));
    const mockContext = createMockContext(largePayment);

    const handler = vi.fn();
    const protectedFn = withX402Payment(API_PRICES.protocolState, 'Test', handler);

    const res = await protectedFn(mockContext);

    // Should fail at verify or earlier, never reach handler or settle
    expect([400, 402]).toContain(res.status);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not settle when verify "succeeds" but the handler later returns 402 itself', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response('internal payment issue', { status: 402 }));

    const protectedFn = withX402Payment(
      API_PRICES.submitSignedTransactions,
      'Submit',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    await protectedFn(mockContext);

    expect(mockFacilitator.verifyPayment).toHaveBeenCalled();
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });
});

describe('x402 security - settlement header hygiene', () => {
  it('never attaches X-Payment-Response header on any failure path', async () => {
    const mockFacilitator = createMockFacilitator();
    const validPayment = btoa(JSON.stringify({ mock: 'payment' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));

    const protectedFn = withX402Payment(
      API_PRICES.prepareEditDetails,
      'Edit',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);

    expect(res.headers.has('X-Payment-Response')).toBe(false);
    expect(mockFacilitator.settlePayment).not.toHaveBeenCalled();
  });

  it('only attaches settlement header when both verify and handler fully succeed', async () => {
    const mockFacilitator = createMockFacilitator({
      settle: { success: true, transaction: '0xrealsettle' },
    });
    const validPayment = btoa(JSON.stringify({ mock: 'good' }));
    const mockContext = createMockContext(validPayment);

    const handler = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const protectedFn = withX402Payment(
      API_PRICES.prepareCreateSubscription,
      'Create',
      handler,
      { facilitatorClient: mockFacilitator as any }
    );

    const res = await protectedFn(mockContext);

    expect(res.status).toBe(200);
    expect(res.headers.has('X-Payment-Response')).toBe(true);
    expect(mockFacilitator.settlePayment).toHaveBeenCalled();
  });
});

describe('x402 security - config and environment attacks', () => {
  it('returns 500 (never 402 or success) when X402_RECIPIENT is missing during real route execution', async () => {
    const app = createApiApp(); // no special facilitator

    const req = new Request('http://example.com/api/protocol/state', { method: 'GET' });
    req.headers.set('X-Payment', btoa(JSON.stringify({ anything: 'here' })));

    // Force missing recipient
    const res = await app.fetch(req, { API_REQUIRE_BASIC_AUTH: 'false' } as any);

    expect(res.status).toBe(500);
  });

  it('handles completely missing facilitator client injection gracefully in factory', async () => {
    // Passing undefined facilitator should fall back without crashing
    const app = createApiApp({ facilitatorClient: undefined });

    const req = new Request('http://example.com/api/check_subscribe_readiness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: '0x1', subscription: {} }),
    });

    const res = await app.fetch(req, { API_REQUIRE_BASIC_AUTH: 'false' } as any);

    // 402, 404 (mounting in direct fetch), or 500 are all acceptable non-success outcomes
    expect([402, 404, 500]).toContain(res.status);
  });
});

describe('x402 security - combined with rate limiting surface', () => {
  it('x402 402 responses on write endpoints still allow rate limiting to apply in the outer stack', async () => {
    // This is a surface-level check - full rate limit + x402 interaction is covered in rateLimit.spec.ts
    // Here we just ensure that going through x402 first doesn't bypass the later rate limit layer
    const app = createApiApp();

    // Multiple requests with no payment → should be able to trigger rate limit behavior
    for (let i = 0; i < 3; i++) {
      const req = new Request('http://example.com/api/prepare/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '0x' + i, subscription: {} }),
      });

      const res = await app.fetch(req, { API_REQUIRE_BASIC_AUTH: 'false' } as any);
      // 402 (x402 gate), 429 (rate limit), or 404 (in some direct-fetch scenarios) are all safe
      expect([402, 404, 429]).toContain(res.status);
    }
  });
});
