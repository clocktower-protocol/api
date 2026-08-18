/**
 * Write Endpoints
 *
 * REST prepare/readiness handlers. Access is free with tiered rate limits, or
 * Builder SIWE session (see src/index.ts). MCP remains x402-gated.
 * They delegate to the existing transaction preparation logic in src/tx/.
 */

import { jsonResponse } from './responses.js';
import type { Context } from 'hono';
import { z } from 'zod';
import { parseUnits } from 'viem';
import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import { UnsupportedChainError } from '../chain.js';
import { requestChain } from './restChain.js';
import { createClocktowerClient } from '../client.js';
import type { AccessLane } from '../config/rateLimits.js';
import { normalizeSubscriptionAmount } from '../tx/amount.js';
import { parseApprovedTokenRecord } from '../validation.js';
import { convertTokenNativeToProtocolAmount } from '../utils.js';

// Import tx functions
import {
  checkSubscribeReadiness,
  checkRemitReadiness,
  prepareCreateSubscription,
  prepareSubscribe,
  prepareSubscribeById,
  prepareCancelSubscription,
  prepareCancelSubscriptionById,
  prepareUnsubscribe,
  prepareUnsubscribeById,
  prepareUnsubscribeByProvider,
  prepareUnsubscribeByProviderById,
  prepareEditDetails,
  prepareRemit,
  loadWriteSubscriptionById,
} from '../tx/prepare.js';
import { getRequestId, type PrepareOptions } from '../tx/prepare-response.js';
import { getTransactionStatus } from '../tx/status.js';
import { enforceWriteRateLimitForAddress } from '../rateLimit.js';
import { parseAccessLane } from '../requestLane.js';
import { clientSafeMessage } from '../sanitizeUpstream.js';

/** Server-set lane from Worker middleware (never trust client-supplied elevation). */
function requestLane(c: Context): AccessLane {
  return parseAccessLane(c.req.header('X-Clocktower-Lane'));
}

function prepareOpts(c: Context, parsed: {
  readinessOnly?: boolean;
  simulateFromAddress?: `0x${string}`;
  infiniteApproval?: boolean;
}): PrepareOptions {
  return {
    readinessOnly: parsed.readinessOnly,
    simulateFromAddress: parsed.simulateFromAddress,
    infiniteApproval: parsed.infiniteApproval,
    lane: requestLane(c),
    chain: requestChain(c),
  };
}

// Import validation schemas
import {
  subscribeInputSchema,
  subscribeByIdInputSchema,
  checkSubscribeReadinessByIdInputSchema,
  subscriptionActionInputSchema,
  subscriptionActionByIdInputSchema,
  unsubscribeByProviderInputSchema,
  unsubscribeByProviderByIdInputSchema,
  editDetailsInputSchema,
  createSubscriptionInputSchema,
  remitInputSchema,
  toWriteSubscription,
  toWriteDetails,
} from '../validation-write.js';

/* =====================================================
   Write Handlers
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
      requestLane(c),
    );

    const chain = requestChain(c);
    const normalizedSubscription = await normalizeSubscriptionAmount(
      c.env,
      parsed.subscription,
      chain,
    );
    const result = await checkSubscribeReadiness(
      c.env,
      chain,
      parsed.from as `0x${string}`,
      toWriteSubscription(normalizedSubscription),
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'check_subscribe_readiness');
  }
}

// 1b. Check subscribe readiness by id only
export async function handleCheckSubscribeReadinessById(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = checkSubscribeReadinessByIdInputSchema.parse(body);

    await enforceWriteRateLimitForAddress(
      c.env,
      parsed.from as `0x${string}`,
      requestLane(c),
    );

    const chain = requestChain(c);
    const subscription = await loadWriteSubscriptionById(c.env, parsed.id, chain);
    const result = await checkSubscribeReadiness(
      c.env,
      chain,
      parsed.from as `0x${string}`,
      subscription,
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'check_subscribe_readiness_by_id');
  }
}

// 2. Prepare create subscription
export async function handlePrepareCreateSubscription(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = createSubscriptionInputSchema.parse(body);

    // Fetch token decimals from the protocol
    const chain = requestChain(c);
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
      prepareOpts(c, parsed),
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

    const chain = requestChain(c);
    const normalizedSubscription = await normalizeSubscriptionAmount(
      c.env,
      parsed.subscription,
      chain,
    );

    const result = await prepareSubscribe(
      c.env,
      parsed.from,
      toWriteSubscription(normalizedSubscription),
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_subscribe');
  }
}

// 3b. Prepare subscribe by id only
export async function handlePrepareSubscribeById(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = subscribeByIdInputSchema.parse(body);

    const result = await prepareSubscribeById(
      c.env,
      parsed.from,
      parsed.id,
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_subscribe_by_id');
  }
}

// 4. Prepare cancel subscription
export async function handlePrepareCancelSubscription(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = subscriptionActionInputSchema.parse(body);

    const chain = requestChain(c);
    const normalizedSubscription = await normalizeSubscriptionAmount(
      c.env,
      parsed.subscription,
      chain,
    );

    const result = await prepareCancelSubscription(
      c.env,
      parsed.from,
      toWriteSubscription(normalizedSubscription),
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_cancel_subscription');
  }
}

// 4b. Prepare cancel by id only
export async function handlePrepareCancelSubscriptionById(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = subscriptionActionByIdInputSchema.parse(body);

    const result = await prepareCancelSubscriptionById(
      c.env,
      parsed.from,
      parsed.id,
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_cancel_subscription_by_id');
  }
}

// 5. Prepare unsubscribe
export async function handlePrepareUnsubscribe(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = subscriptionActionInputSchema.parse(body);

    const chain = requestChain(c);
    const normalizedSubscription = await normalizeSubscriptionAmount(
      c.env,
      parsed.subscription,
      chain,
    );

    const result = await prepareUnsubscribe(
      c.env,
      parsed.from,
      toWriteSubscription(normalizedSubscription),
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_unsubscribe');
  }
}

// 5b. Prepare unsubscribe by id only
export async function handlePrepareUnsubscribeById(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = subscriptionActionByIdInputSchema.parse(body);

    const result = await prepareUnsubscribeById(
      c.env,
      parsed.from,
      parsed.id,
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_unsubscribe_by_id');
  }
}

// 6. Prepare unsubscribe by provider
export async function handlePrepareUnsubscribeByProvider(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = unsubscribeByProviderInputSchema.parse(body);

    const chain = requestChain(c);
    const normalizedSubscription = await normalizeSubscriptionAmount(
      c.env,
      parsed.subscription,
      chain,
    );

    const result = await prepareUnsubscribeByProvider(
      c.env,
      parsed.from,
      toWriteSubscription(normalizedSubscription),
      parsed.subscriber,
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_unsubscribe_by_provider');
  }
}

// 6b. Prepare unsubscribe by provider using id only
export async function handlePrepareUnsubscribeByProviderById(c: Context) {
  try {
    const body = await c.req.json();
    const parsed = unsubscribeByProviderByIdInputSchema.parse(body);

    const result = await prepareUnsubscribeByProviderById(
      c.env,
      parsed.from,
      parsed.id,
      parsed.subscriber,
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_unsubscribe_by_provider_by_id');
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
      prepareOpts(c, parsed),
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

    await enforceWriteRateLimitForAddress(c.env, parsed.from, requestLane(c));

    const result = await checkRemitReadiness(c.env, parsed.from, requestChain(c));

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

    const result = await prepareRemit(c.env, parsed.from, prepareOpts(c, parsed));

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

    const result = await getTransactionStatus(c.env, parsed.txHash as `0x${string}`, requestChain(c));

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

  if (err instanceof UnsupportedChainError || message.includes('chainId must')) {
    return withRequestId({ error: message, code: 'VALIDATION_ERROR' }, 400);
  }

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

