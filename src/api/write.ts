/**
 * Write Endpoints
 *
 * These handlers are called after x402 payment verification (via withX402Payment wrapper).
 * They delegate to the existing transaction preparation/submission logic in src/tx/.
 */

import { jsonResponse, Errors } from './responses.js';
import type { Context } from 'hono';
import { z } from 'zod';

// Import tx functions
import {
  checkSubscribeReadiness,
  prepareCreateSubscription,
  prepareSubscribe,
  prepareCancelSubscription,
  prepareUnsubscribe,
  prepareUnsubscribeByProvider,
  prepareEditDetails,
} from '../tx/prepare.js';
import {
  submitSignedTransactions,
  getTransactionStatus,
} from '../tx/submit.js';

// Import validation schemas
import {
  subscribeInputSchema,
  subscriptionActionInputSchema,
  unsubscribeByProviderInputSchema,
  editDetailsInputSchema,
  createSubscriptionInputSchema,
  toWriteSubscription,
  toWriteDetails,
} from '../validation-write.js';

// For check readiness we need the chain resolver
import { resolveChain } from '../chain.js';

/* =====================================================
   Write Handlers
   All handlers assume the caller has already passed x402
   payment verification via the withX402Payment wrapper.
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

    const result = await prepareCreateSubscription(
      c.env,
      parsed.from,
      parsed.amount,
      parsed.token,
      toWriteDetails(parsed.details),
      parsed.frequency,
      parsed.dueDay
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

    const result = await prepareSubscribe(
      c.env,
      parsed.from,
      toWriteSubscription(parsed.subscription)
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

    const result = await prepareCancelSubscription(
      c.env,
      parsed.from,
      toWriteSubscription(parsed.subscription)
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

    const result = await prepareUnsubscribe(
      c.env,
      parsed.from,
      toWriteSubscription(parsed.subscription)
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

    const result = await prepareUnsubscribeByProvider(
      c.env,
      parsed.from,
      toWriteSubscription(parsed.subscription),
      parsed.subscriber
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
      toWriteDetails(parsed.details)
    );

    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'prepare_edit_details');
  }
}

// 8. Submit signed transactions
export async function handleSubmitSignedTransactions(c: Context) {
  try {
    const body = await c.req.json();
    const schema = z.object({
      prepareId: z.string().uuid(),
      signedTransactions: z.array(z.string().regex(/^0x[a-fA-F0-9]+$/)).min(1).max(5),
    });
    const parsed = schema.parse(body);

    const result = await submitSignedTransactions(
      c.env,
      parsed.prepareId,
      parsed.signedTransactions as `0x${string}`[]
    );

    // Consistent success shape for submit
    return jsonResponse(result);
  } catch (err: any) {
    return handleWriteError(err, 'submit_signed_transactions');
  }
}

// 9. Get transaction status
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
  // If the error is already one of our structured error responses, return it directly
  if (err && typeof err === 'object' && 'error' in err && 'code' in err) {
    return jsonResponse(err, 400);
  }

  // Zod validation errors → return rich validation error with issues array
  if (err instanceof z.ZodError) {
    return jsonResponse({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      issues: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    }, 400);
  }

  const message = err?.message || String(err);

  // Common domain errors from the tx layer (map to appropriate error codes)
  if (message.includes('Subscription not found')) {
    return Errors.notFound('Subscription not found on chain');
  }
  if (message.includes('Token is paused')) {
    return Errors.validation('Token is paused on protocol');
  }
  if (message.includes('Amount below token minimum')) {
    return Errors.validation(message);
  }
  if (message.includes('Prepare intent not found')) {
    return Errors.notFound('Prepare intent not found or expired');
  }
  if (message.includes('Signed transaction signer does not match')) {
    return Errors.validation('Signed transaction signer does not match prepare intent');
  }
  if (message.includes('Invalid nonce')) {
    return Errors.validation('Invalid nonce for signed transaction');
  }

  // Let the x402 wrapper know this failed so it does NOT settle the payment
  console.error(`[write] ${operation} failed`, err);

  return Errors.upstream(message || `Failed to ${operation}`);
}

