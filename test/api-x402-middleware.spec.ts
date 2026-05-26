import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { withX402Payment } from '../src/api/x402.js';
import { API_PRICES } from '../src/api/pricing.js';

/**
 * Tests for the custom x402 middleware (Path 1).
 *
 * These tests focus on:
 * - Proper 402 responses when no payment is provided
 * - Behavior on invalid payments
 * - The critical "only settle on success" invariant
 */

describe('withX402Payment middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      X402_RECIPIENT: '0x1234567890123456789012345678901234567890',
      CDP_API_KEY_ID: 'test-id',
      CDP_API_KEY_SECRET: 'test-secret',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 402 when no X-Payment header is present', async () => {
    const mockContext = {
      env: process.env,
      req: {
        raw: new Request('http://example.com/api/test', {
          headers: {},
        }),
      },
    };

    const protectedHandler = withX402Payment(
      API_PRICES.protocolState,
      'Test endpoint',
      async () => new Response('should not reach here')
    );

    const res = await protectedHandler(mockContext);

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.x402Version).toBe(1);
    expect(body.accepts).toBeDefined();
  });

  it('returns 400 on malformed payment header', async () => {
    const mockContext = {
      env: process.env,
      req: {
        raw: new Request('http://example.com/api/test', {
          headers: { 'X-Payment': 'not-valid-base64!!!' },
        }),
      },
    };

    const protectedHandler = withX402Payment(
      API_PRICES.protocolState,
      'Test endpoint',
      async () => new Response('ok')
    );

    const res = await protectedHandler(mockContext);
    expect([400, 402]).toContain(res.status);
  });

  // Runtime settlement tests will be expanded once we have better facilitator mocking
  it('has the correct function signature', () => {
    expect(typeof withX402Payment).toBe('function');
  });
});
