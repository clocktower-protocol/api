import { HTTPFacilitatorClient } from '@x402/core/server';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequirements, PaymentPayload } from '@x402/core/types';

import { buildX402Config } from '../x402.js';
import { Errors } from './responses.js';

/**
 * x402 Payment Wrapper (Path 1 - Low-level using @x402/core primitives)
 *
 * Current limitations and assumptions:
 * - Hardcoded to USDC on Base mainnet (eip155:8453)
 * - Uses the "exact" scheme only
 * - Returns raw x402 402 responses where practical
 * - Does NOT yet support multiple assets or networks
 * - Settlement metadata attached via X-Payment-Response header on success
 *
 * This implementation prioritizes:
 * - The critical "verify first, only settle on success" invariant
 * - Testability (facilitator can be injected for deterministic tests)
 * - Staying close to the raw x402 protocol
 */

type Env = any;

// We keep a cached real client for production use.
let realFacilitatorClient: HTTPFacilitatorClient | null = null;

function createRealFacilitatorClient(env: Env): HTTPFacilitatorClient {
  const config = buildX402Config(env);
  return new HTTPFacilitatorClient({
    url: config.facilitator?.url ?? 'https://x402.org/facilitator',
    createAuthHeaders: config.facilitator?.createAuthHeaders,
  });
}

function getFacilitatorClient(env: Env): HTTPFacilitatorClient {
  if (!realFacilitatorClient) {
    realFacilitatorClient = createRealFacilitatorClient(env);
  }
  return realFacilitatorClient;
}

export type X402ProtectedHandler = (c: any) => Promise<Response>;

export type X402Options = {
  /** For testing: inject a mock facilitator client */
  facilitatorClient?: HTTPFacilitatorClient;
};

/**
 * Higher-order wrapper that protects a handler with x402 payment.
 *
 * Usage (production):
 *   const protectedHandler = withX402Payment(
 *     API_PRICES.protocolState,
 *     'Get protocol state',
 *     async (c) => { ... }
 *   );
 *
 * For tests, you can pass a mock facilitator:
 *   withX402Payment(price, desc, handler, { facilitatorClient: mockClient })
 *
 * This follows the critical invariant:
 *   - Verify payment first
 *   - Run handler
 *   - Only settle if handler succeeds
 */
export function withX402Payment(
  priceUSD: number,
  description: string,
  handler: X402ProtectedHandler,
  options: X402Options = {}
): X402ProtectedHandler {
  return async (c: any) => {
    const env: Env = c.env;
    const request = c.req.raw;

    const facilitator = options.facilitatorClient ?? getFacilitatorClient(env);
    const recipient = env.X402_RECIPIENT as `0x${string}`;

    if (!recipient) {
      console.error('[x402] X402_RECIPIENT is not configured');
      return Errors.upstream('Payment configuration error');
    }

    // Currently hardcoded to USDC on Base (6 decimals).
    // This is a deliberate simplification for the current phase.
    const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const USDC_DECIMALS = 6;

    // Safer amount conversion (avoid floating point precision issues)
    const amountInAtomicUnits = (
      BigInt(Math.floor(priceUSD * 1_000_000)) * BigInt(10 ** (USDC_DECIMALS - 6))
    ).toString();

    const requirements: PaymentRequirements[] = [
      {
        scheme: 'exact',
        network: 'eip155:8453',
        payTo: recipient,
        amount: amountInAtomicUnits,
        asset: USDC_ADDRESS,
        description,
        maxTimeoutSeconds: 300,
      },
    ];

    // Check for payment header
    const paymentHeader = request.headers.get('X-Payment') || request.headers.get('x-payment');

    if (!paymentHeader) {
      // Raw x402 Payment Required response (as close to spec as practical)
      const paymentRequiredBody = {
        x402Version: 1,
        accepts: requirements,
        error: 'Payment required to access this resource',
      };

      const res = new Response(JSON.stringify(paymentRequiredBody), {
        status: 402,
        headers: {
          'Content-Type': 'application/json',
          'X-Payment-Required': encodePaymentRequiredHeader(paymentRequiredBody as any),
        },
      });
      return res;
    }

    // Decode and verify payment
    let paymentPayload: PaymentPayload;
    try {
      paymentPayload = JSON.parse(atob(paymentHeader));
    } catch {
      return Errors.validation('Invalid payment payload');
    }

    try {
      const verifyResult = await facilitator.verifyPayment(paymentPayload, requirements[0]);

      if (!verifyResult.isValid) {
        // Return a 402 that follows the raw protocol shape
        return new Response(
          JSON.stringify({
            x402Version: 1,
            error: verifyResult.invalidReason || 'Payment verification failed',
          }),
          { status: 402 }
        );
      }
    } catch (err) {
      console.error('[x402] verifyPayment failed', err);
      return new Response(
        JSON.stringify({
          x402Version: 1,
          error: 'Payment verification error',
        }),
        { status: 402 }
      );
    }

    // Run the protected handler
    let result: Response;
    let handlerFailed = false;

    try {
      result = await handler(c);
      if (result.status >= 400) {
        handlerFailed = true;
      }
    } catch (err) {
      handlerFailed = true;
      result = Errors.upstream('Handler execution failed');
    }

    // Only settle if the handler succeeded
    if (!handlerFailed) {
      try {
        const settleResult = await facilitator.settlePayment(paymentPayload, requirements[0]);
        if (settleResult.success) {
          // Optionally attach settlement info
          result.headers.set('X-Payment-Response', JSON.stringify({
            success: true,
            transaction: settleResult.transaction,
          }));
        }
      } catch (err) {
        console.error('[x402] settlePayment failed', err);
        // We still return the successful handler result even if settlement had issues
      }
    }

    return result;
  };
}
