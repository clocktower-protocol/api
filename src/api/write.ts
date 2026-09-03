/**
 * Write Endpoints
 *
 * REST prepare/readiness handlers. Access is free with tiered rate limits, or
 * Builder SIWE session (see src/index.ts). MCP uses the same free/developer
 * lanes when x402 is off; x402 when MCP_X402_ENABLED=true.
 * They delegate to the existing transaction preparation logic in src/tx/.
 */

import { Errors, jsonResponse } from './responses.js';
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
import { createRequestId, getRequestId, type PrepareOptions } from '../tx/prepare-response.js';
import { getTransactionStatus } from '../tx/status.js';
import { enforceWriteRateLimitForAddress } from '../rateLimit.js';
import { parseAccessLane } from '../requestLane.js';

/** Server-set lane from Worker middleware (never trust client-supplied elevation). */
function requestLane(c: Context): AccessLane {
  return parseAccessLane(c.req.header('X-Clocktower-Lane'));
}

async function parseWriteJson<T>(c: Context, schema: z.ZodType<T>): Promise<T | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return Errors.validation('Invalid JSON body');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      400,
    );
  }
  return parsed.data;
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
    const schema = z.object({
      from: z.string(),
      subscription: subscribeInputSchema.shape.subscription,
    });
    const parsed = await parseWriteJson(c, schema);
    if (parsed instanceof Response) return parsed;

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
  } catch (err: unknown) {
    return handleWriteError(err, 'check_subscribe_readiness');
  }
}

// 1b. Check subscribe readiness by id only
export async function handleCheckSubscribeReadinessById(c: Context) {
  try {
    const parsed = await parseWriteJson(c, checkSubscribeReadinessByIdInputSchema);
    if (parsed instanceof Response) return parsed;

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
  } catch (err: unknown) {
    return handleWriteError(err, 'check_subscribe_readiness_by_id');
  }
}

// 2. Prepare create subscription
export async function handlePrepareCreateSubscription(c: Context) {
  try {
    const parsed = await parseWriteJson(c, createSubscriptionInputSchema);
    if (parsed instanceof Response) return parsed;

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
  } catch (err: unknown) {
    return handleWriteError(err, 'prepare_create_subscription');
  }
}

// 3. Prepare subscribe
export async function handlePrepareSubscribe(c: Context) {
  try {
    const parsed = await parseWriteJson(c, subscribeInputSchema);
    if (parsed instanceof Response) return parsed;

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
  } catch (err: unknown) {
    return handleWriteError(err, 'prepare_subscribe');
  }
}

// 3b. Prepare subscribe by id only
export async function handlePrepareSubscribeById(c: Context) {
  try {
    const parsed = await parseWriteJson(c, subscribeByIdInputSchema);
    if (parsed instanceof Response) return parsed;

    const result = await prepareSubscribeById(
      c.env,
      parsed.from,
      parsed.id,
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: unknown) {
    return handleWriteError(err, 'prepare_subscribe_by_id');
  }
}

// 4. Prepare cancel subscription
export async function handlePrepareCancelSubscription(c: Context) {
  try {
    const parsed = await parseWriteJson(c, subscriptionActionInputSchema);
    if (parsed instanceof Response) return parsed;

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
  } catch (err: unknown) {
    return handleWriteError(err, 'prepare_cancel_subscription');
  }
}

// 4b. Prepare cancel by id only
export async function handlePrepareCancelSubscriptionById(c: Context) {
  try {
    const parsed = await parseWriteJson(c, subscriptionActionByIdInputSchema);
    if (parsed instanceof Response) return parsed;

    const result = await prepareCancelSubscriptionById(
      c.env,
      parsed.from,
      parsed.id,
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: unknown) {
    return handleWriteError(err, 'prepare_cancel_subscription_by_id');
  }
}

// 5. Prepare unsubscribe
export async function handlePrepareUnsubscribe(c: Context) {
  try {
    const parsed = await parseWriteJson(c, subscriptionActionInputSchema);
    if (parsed instanceof Response) return parsed;

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
  } catch (err: unknown) {
    return handleWriteError(err, 'prepare_unsubscribe');
  }
}

// 5b. Prepare unsubscribe by id only
export async function handlePrepareUnsubscribeById(c: Context) {
  try {
    const parsed = await parseWriteJson(c, subscriptionActionByIdInputSchema);
    if (parsed instanceof Response) return parsed;

    const result = await prepareUnsubscribeById(
      c.env,
      parsed.from,
      parsed.id,
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: unknown) {
    return handleWriteError(err, 'prepare_unsubscribe_by_id');
  }
}

// 6. Prepare unsubscribe by provider
export async function handlePrepareUnsubscribeByProvider(c: Context) {
  try {
    const parsed = await parseWriteJson(c, unsubscribeByProviderInputSchema);
    if (parsed instanceof Response) return parsed;

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
  } catch (err: unknown) {
    return handleWriteError(err, 'prepare_unsubscribe_by_provider');
  }
}

// 6b. Prepare unsubscribe by provider using id only
export async function handlePrepareUnsubscribeByProviderById(c: Context) {
  try {
    const parsed = await parseWriteJson(c, unsubscribeByProviderByIdInputSchema);
    if (parsed instanceof Response) return parsed;

    const result = await prepareUnsubscribeByProviderById(
      c.env,
      parsed.from,
      parsed.id,
      parsed.subscriber,
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: unknown) {
    return handleWriteError(err, 'prepare_unsubscribe_by_provider_by_id');
  }
}

// 7. Prepare edit details
export async function handlePrepareEditDetails(c: Context) {
  try {
    const parsed = await parseWriteJson(c, editDetailsInputSchema);
    if (parsed instanceof Response) return parsed;

    const result = await prepareEditDetails(
      c.env,
      parsed.from,
      parsed.id,
      toWriteDetails(parsed.details),
      prepareOpts(c, parsed),
    );

    return jsonResponse(result);
  } catch (err: unknown) {
    return handleWriteError(err, 'prepare_edit_details');
  }
}

// 8. Check remit readiness
export async function handleCheckRemitReadiness(c: Context) {
  try {
    const parsed = await parseWriteJson(c, remitInputSchema);
    if (parsed instanceof Response) return parsed;

    await enforceWriteRateLimitForAddress(c.env, parsed.from, requestLane(c));

    const result = await checkRemitReadiness(c.env, parsed.from, requestChain(c));

    return jsonResponse(result);
  } catch (err: unknown) {
    return handleWriteError(err, 'check_remit_readiness');
  }
}

// 9. Prepare remit
export async function handlePrepareRemit(c: Context) {
  try {
    const parsed = await parseWriteJson(c, remitInputSchema);
    if (parsed instanceof Response) return parsed;

    const result = await prepareRemit(c.env, parsed.from, prepareOpts(c, parsed));

    return jsonResponse(result);
  } catch (err: unknown) {
    return handleWriteError(err, 'prepare_remit');
  }
}

// 10. Get transaction status
export async function handleGetTransactionStatus(c: Context) {
  try {
    const parsed = await parseWriteJson(
      c,
      z.object({
        txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      }),
    );
    if (parsed instanceof Response) return parsed;

    const result = await getTransactionStatus(c.env, parsed.txHash as `0x${string}`, requestChain(c));

    return jsonResponse(result);
  } catch (err: unknown) {
    return handleWriteError(err, 'get_transaction_status');
  }
}

/* =====================================================
   Shared Error Handler for Write Endpoints
   ===================================================== */
function handleWriteError(err: unknown, operation: string) {
  const prepareRequestId = getRequestId(err);
  const message = err instanceof Error ? err.message : '';

  if (err instanceof z.ZodError) {
    return Errors.validation('Validation failed');
  }

  if (err instanceof UnsupportedChainError) {
    return Errors.validation('Unsupported or disabled chainId');
  }
  if (message.includes('chainId must')) {
    return Errors.validation('chainId must be a decimal chain id or CAIP-2 eip155:<id>');
  }

  if (message.includes('Subscription not found')) {
    return Errors.notFound('Subscription not found on chain');
  }
  if (message.includes('Token is paused')) {
    return Errors.validation('Token is paused on protocol');
  }
  if (message.includes('Amount below token minimum')) {
    return Errors.validation('Amount below token minimum');
  }
  if (message.includes('Write rate limit exceeded')) {
    return Errors.validation('Write rate limit exceeded');
  }
  if (message.includes('Remit not due') || message.includes('No due subscriptions')) {
    return Errors.validation('Remit readiness check failed');
  }
  if (message.includes('Simulation failed')) {
    const requestId = createRequestId();
    console.error(`[write] ${operation} simulation failed`, {
      requestId,
      prepareRequestId,
      err,
    });
    return jsonResponse(
      { error: 'Simulation failed', code: 'VALIDATION_ERROR', requestId },
      400,
    );
  }

  const requestId = createRequestId();
  console.error(`[write] ${operation} failed`, { requestId, prepareRequestId, err });
  return jsonResponse({ error: 'Upstream error', code: 'UPSTREAM_ERROR', requestId }, 500);
}

