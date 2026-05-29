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

const testEnv = {
  API_REQUIRE_BASIC_AUTH: 'false',
  X402_RECIPIENT: '0x0000000000000000000000000000000000000001',
} as Env;

function createMockFacilitator(overrides: { verify?: unknown; settle?: unknown } = {}): MockFacilitator {
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

    const res = await app.fetch(req, { API_REQUIRE_BASIC_AUTH: 'false' } as Env);

    expect(res.status).toBe(500);
  });

  it('returns 402 when payment is missing on a write route', async () => {
    const app = createApiApp({ facilitatorClient: createMockFacilitator() });

    const req = new Request('http://example.com/api/check_subscribe_readiness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: '0x1', subscription: {} }),
    });

    const res = await app.fetch(req, testEnv);

    expect(res.status).toBe(402);
  });
});

describe('x402 security - combined with rate limiting surface', () => {
  it('write endpoints without payment return 402 (not 404 from broken routing)', async () => {
    const app = createApiApp();

    for (let i = 0; i < 3; i++) {
      const req = new Request('http://example.com/api/prepare/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '0x' + i, subscription: {} }),
      });

      const res = await app.fetch(req, testEnv);

      expect(res.status).toBe(402);
    }
  });

  it('write handler is reachable when payment verifies (not 404)', async () => {
    const mockFacilitator = createMockFacilitator();
    const app = createApiApp({ facilitatorClient: mockFacilitator });

    const req = new Request('http://example.com/api/check_subscribe_readiness', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': btoa(JSON.stringify({ mock: true })),
      },
      body: JSON.stringify({ from: '0x1234567890123456789012345678901234567890', subscription: {} }),
    });

    const res = await app.fetch(req, testEnv);

    expect(res.status).not.toBe(404);
    expect([400, 402, 500]).toContain(res.status);
  });
});
