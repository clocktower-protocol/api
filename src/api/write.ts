/**
 * Write Endpoints
 *
 * These handlers are called after x402 payment verification (via the official @x402/hono middleware).
 * They delegate to the existing transaction preparation logic in src/tx/.
 */

import { jsonResponse } from './responses.js';
import type { Context } from 'hono';
import { z } from 'zod';
import { parseUnits } from 'viem';
import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import { resolveChain } from '../chain.js';
import { createClocktowerClient } from '../client.js';
import { normalizeSubscriptionAmount } from '../tx/amount.js';
import { parseApprovedTokenRecord } from '../validation.js';
import { convertTokenNativeToProtocolAmount } from '../utils.js';

// Import tx functions
import {
  checkSubscribeReadiness,
  checkRemitReadiness,
  prepareCreateSubscription,
  prepareSubscribe,
  prepareCancelSubscription,
  prepareUnsubscribe,
  prepareUnsubscribeByProvider,
  prepareEditDetails,
  prepareRemit,
} from '../tx/prepare.js';
import { getRequestId } from '../tx/prepare-response.js';
import { getTransactionStatus } from '../tx/status.js';
import { enforceWriteRateLimitForAddress } from '../rateLimit.js';
import { getActiveLane } from '../requestLane.js';
import { clientSafeMessage } from '../sanitizeUpstream.js';

// Import validation schemas
import {
  subscribeInputSchema,
  subscriptionActionInputSchema,
  unsubscribeByProviderInputSchema,
  editDetailsInputSchema,
  createSubscriptionInputSchema,
  remitInputSchema,
  toWriteSubscription,
  toWriteDetails,
} from '../validation-write.js';

/* =====================================================
   Write Handlers
   All handlers assume the caller has already passed x402
   payment verification via the official @x402/hono middleware.
   ===================================================== */

// 1. Check subscribe readiness
export async function handleCheckSubscribeReadiness(c: Context) {
  try {
    const body = await c.req.json();
    const schema = z.object({
      from: z.string(),
      subscription: subscribeInputSchema.shape.subscription,
    });
    const parsed = schema.parse(body);

    await enforceWriteRateLimitForAddress(
      c.env,
      parsed.from as `0x${string}`,
      getActiveLane(),
    );

    const chain = resolveChain(c.env);
    const result = await checkSubscribeReadiness(
      c.env,
      chain,
      parsed.from as `0x${string}`,
      toWriteSubscription(parsed.subscription)
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'check_subscribe_readiness');
  }
}

// 2. Prepare create subscription
export async function handlePrepareCreateSubscription(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = createSubscriptionInputSchema.parse(body);

    // Fetch token decimals from the protocol
    const chain = resolveChain(c.env);
    const client = createClocktowerClient(chain);

    const approvedToken = parseApprovedTokenRecord(
      await client.readContract({
        address: chain.contractAddress,
        abi: CLOCKTOWER_READ_ABI,
        functionName: 'approvedERC20',
        args: [parsed.token],
      }),
    );

    // Convert user human amount string (e.g. "100.5") using the token's actual decimals
    // into protocol internal units (always 18 decimals).
    const nativeAmount = parseUnits(parsed.amount, approvedToken.decimals);
    const protocolAmount = convertTokenNativeToProtocolAmount(nativeAmount, approvedToken.decimals);

    const result = await prepareCreateSubscription(
      c.env,
      parsed.from,
      protocolAmount,
      parsed.token,
      toWriteDetails(parsed.details),
      parsed.frequency,
      parsed.dueDay,
      {
        readinessOnly: parsed.readinessOnly,
        simulateFromAddress: parsed.simulateFromAddress,
      },
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_create_subscription');
  }
}

// 3. Prepare subscribe
export async function handlePrepareSubscribe(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = subscribeInputSchema.parse(body);

    let subscription = parsed.subscription;

    const normalizedSubscription = await normalizeSubscriptionAmount(c.env, parsed.subscription);

    const result = await prepareSubscribe(
      c.env,
      parsed.from,
      toWriteSubscription(normalizedSubscription),
      {
        readinessOnly: parsed.readinessOnly,
        simulateFromAddress: parsed.simulateFromAddress,
      },
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_subscribe');
  }
}

// 4. Prepare cancel subscription
export async function handlePrepareCancelSubscription(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = subscriptionActionInputSchema.parse(body);

    const normalizedSubscription = await normalizeSubscriptionAmount(c.env, parsed.subscription);

    const result = await prepareCancelSubscription(
      c.env,
      parsed.from,
      toWriteSubscription(normalizedSubscription),
      {
        readinessOnly: parsed.readinessOnly,
        simulateFromAddress: parsed.simulateFromAddress,
      },
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_cancel_subscription');
  }
}

// 5. Prepare unsubscribe
export async function handlePrepareUnsubscribe(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = subscriptionActionInputSchema.parse(body);

    const normalizedSubscription = await normalizeSubscriptionAmount(c.env, parsed.subscription);

    const result = await prepareUnsubscribe(
      c.env,
      parsed.from,
      toWriteSubscription(normalizedSubscription),
      {
        readinessOnly: parsed.readinessOnly,
        simulateFromAddress: parsed.simulateFromAddress,
      },
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_unsubscribe');
  }
}

// 6. Prepare unsubscribe by provider
export async function handlePrepareUnsubscribeByProvider(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = unsubscribeByProviderInputSchema.parse(body);

    const normalizedSubscription = await normalizeSubscriptionAmount(c.env, parsed.subscription);

    const result = await prepareUnsubscribeByProvider(
      c.env,
      parsed.from,
      toWriteSubscription(normalizedSubscription),
      parsed.subscriber,
      {
        readinessOnly: parsed.readinessOnly,
        simulateFromAddress: parsed.simulateFromAddress,
      },
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_unsubscribe_by_provider');
  }
}

// 7. Prepare edit details
export async function handlePrepareEditDetails(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = editDetailsInputSchema.parse(body);

    const result = await prepareEditDetails(
      c.env,
      parsed.from,
      parsed.id,
      toWriteDetails(parsed.details),
      {
        readinessOnly: parsed.readinessOnly,
        simulateFromAddress: parsed.simulateFromAddress,
      },
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_edit_details');
  }
}

// 8. Check remit readiness
export async function handleCheckRemitReadiness(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = remitInputSchema.parse(body);

    await enforceWriteRateLimitForAddress(c.env, parsed.from, getActiveLane());

    const result = await checkRemitReadiness(c.env, parsed.from);

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'check_remit_readiness');
  }
}

// 9. Prepare remit
export async function handlePrepareRemit(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = remitInputSchema.parse(body);

    const result = await prepareRemit(c.env, parsed.from, {
      readinessOnly: parsed.readinessOnly,
      simulateFromAddress: parsed.simulateFromAddress,
    });

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_remit');
  }
}

// 10. Get transaction status
export async function handleGetTransactionStatus(c: Context) {
  try {
    const body = await c.req.json();
    const schema = z.object({
      txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    });
    const parsed = schema.parse(body);

    const result = await getTransactionStatus(c.env, parsed.txHash as `0x${string}`);

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'get_transaction_status');
  }
}

/* =====================================================
   Shared Error Handler for Write Endpoints
   ===================================================== */
function handleWriteError(err: any, operation: string) {
  const requestId = getRequestId(err);

  // If the error is already one of our structured error responses, return it directly
  // (preserve appropriate status based on the error code for consistency with read handlers)
  if (err && typeof err === 'object' && 'error' in err && 'code' in err) {
    const status = err.code === 'NOT_FOUND' ? 404 : 400;
    return jsonResponse(requestId ? { ...err, requestId } : err, status);
  }

  // Zod validation errors → return rich validation error with issues array
  if (err instanceof z.ZodError) {
    return jsonResponse({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      ...(requestId ? { requestId } : {}),
      issues: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    }, 400);
  }

  const message = err?.message || String(err);
  const withRequestId = (body: Record<string, unknown>, status: number) =>
    jsonResponse(requestId ? { ...body, requestId } : body, status);

  // Common domain errors from the tx layer (map to appropriate error codes)
  if (message.includes('Subscription not found')) {
    return withRequestId(
      { error: 'Subscription not found on chain', code: 'NOT_FOUND' },
      404,
    );
  }
  if (message.includes('Token is paused')) {
    return withRequestId(
      { error: 'Token is paused on protocol', code: 'VALIDATION_ERROR' },
      400,
    );
  }
  if (message.includes('Amount below token minimum')) {
    return withRequestId(
      {
        error: clientSafeMessage(message, 'Amount below token minimum'),
        code: 'VALIDATION_ERROR',
      },
      400,
    );
  }
  if (message.includes('Write rate limit exceeded')) {
    return withRequestId({ error: message, code: 'VALIDATION_ERROR' }, 400);
  }
  if (message.includes('Remit not due') || message.includes('No due subscriptions')) {
    return withRequestId(
      {
        error: clientSafeMessage(message, 'Remit readiness check failed'),
        code: 'VALIDATION_ERROR',
      },
      400,
    );
  }
  if (message.includes('Simulation failed')) {
    return withRequestId(
      { error: clientSafeMessage(message, 'Simulation failed'), code: 'VALIDATION_ERROR' },
      400,
    );
  }

  console.error(`[write] ${operation} failed`, { requestId, err });

  return withRequestId({ error: 'Upstream error', code: 'UPSTREAM_ERROR' }, 500);
}

