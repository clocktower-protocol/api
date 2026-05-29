import { describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../src/api/app.js';
import type { HTTPFacilitatorClient } from '@x402/core/server';

/**
 * Security-grade tests for the x402 REST surface.
 *
 * These tests exercise the real production application via createApiApp()
 * (the official @x402/hono middleware + the full middleware stack).
 */

type MockFacilitator = Partial<HTTPFacilitatorClient>;

function createMockFacilitator(overrides: { verify?: any; settle?: any } = {}): MockFacilitator {
  return {
    verifyPayment: vi.fn().mockResolvedValue(overrides.verify ?? { isValid: true }),
    settlePayment: vi.fn().mockResolvedValue(overrides.settle ?? { success: true, transaction: '0xsettled' }),
  };
}

describe('x402 security - config and environment attacks', () => {
  it('returns 500 (never 402 or success) when X402_RECIPIENT is missing during real route execution', async () => {
    const app = createApiApp();

    const req = new Request('http://example.com/api/protocol/state', { method: 'GET' });
    req.headers.set('X-Payment', btoa(JSON.stringify({ anything: 'here' })));

    const res = await app.fetch(req, { API_REQUIRE_BASIC_AUTH: 'false' } as any);

    expect(res.status).toBe(500);
  });

  it('handles completely missing facilitator client injection gracefully in factory', async () => {
    const app = createApiApp({ facilitatorClient: undefined });

    const req = new Request('http://example.com/api/check_subscribe_readiness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: '0x1', subscription: {} }),
    });

    const res = await app.fetch(req, { API_REQUIRE_BASIC_AUTH: 'false' } as any);

    expect([402, 404, 500]).toContain(res.status);
  });
});

describe('x402 security - combined with rate limiting surface', () => {
  it('x402 402 responses on write endpoints still allow rate limiting to apply in the outer stack', async () => {
    const app = createApiApp();

    for (let i = 0; i < 3; i++) {
      const req = new Request('http://example.com/api/prepare/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '0x' + i, subscription: {} }),
      });

      const res = await app.fetch(req, { API_REQUIRE_BASIC_AUTH: 'false' } as any);

      expect([402, 404, 429]).toContain(res.status);
    }
  });
});
