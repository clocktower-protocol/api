import { Hono } from 'hono';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequirements, PaymentPayload } from '@x402/core/types';

import { buildX402Config, X402_NETWORK } from '../x402.js';
import { Errors } from './responses.js';
import { API_PRICES, type ApiEndpoint } from './pricing.js';

type Env = any; // Avoid circular imports during early stages

let facilitatorClient: HTTPFacilitatorClient | null = null;

function getFacilitatorClient(env: Env): HTTPFacilitatorClient {
  if (!facilitatorClient) {
    const config = buildX402Config(env);
    facilitatorClient = new HTTPFacilitatorClient({
      url: config.facilitator?.url ?? 'https://x402.org/facilitator',
      createAuthHeaders: config.facilitator?.createAuthHeaders,
    });
    // Note: Scheme registration for ExactEvm is handled internally by
    // the facilitator client in recent versions when using verify/settle.
  }
  return facilitatorClient;
}

export type X402ProtectedHandler = (c: any) => Promise<Response>;

/**
 * Higher-order wrapper that protects a handler with x402 payment.
 *
 * Usage:
 *   const protectedHandler = withX402Payment(
 *     API_PRICES.protocolState,
 *     'Get protocol state',
 *     async (c) => { ... }
 *   );
 *
 * This follows the critical invariant:
 *   - Verify payment first
 *   - Run handler
 *   - Only settle if handler succeeds
 */
export function withX402Payment(
  priceUSD: number,
  description: string,
  handler: X402ProtectedHandler
): X402ProtectedHandler {
  return async (c: any) => {
    const env: Env = c.env;
    const request = c.req.raw;

    const facilitator = getFacilitatorClient(env);
    const recipient = env.X402_RECIPIENT as `0x${string}`;

    // Build payment requirements
    const requirements: PaymentRequirements[] = [
      {
        scheme: 'exact',
        network: 'eip155:8453', // Base mainnet
        payTo: recipient,
        amount: (BigInt(Math.floor(priceUSD * 1_000_000)) * 1_000_000_000_000n).toString(), // USDC 6 decimals
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
        description,
        maxTimeoutSeconds: 300,
      },
    ];

    // Check for payment header
    const paymentHeader = request.headers.get('X-Payment') || request.headers.get('x-payment');

    if (!paymentHeader) {
      // Return raw x402 402 response
      const paymentRequired = {
        x402Version: 1,
        accepts: requirements,
        error: 'Payment required',
      };

      const res = new Response(JSON.stringify(paymentRequired), {
        status: 402,
        headers: {
          'Content-Type': 'application/json',
          'X-Payment-Required': encodePaymentRequiredHeader(paymentRequired as any),
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
        JSON.stringify({ x402Version: 1, error: 'Payment verification error' }),
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
