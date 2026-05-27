import { Errors, jsonResponse } from './responses.js';
import {
  getApprovedToken,
  getProtocolState,
  getSubscription,
  getAccountSubscriptions,
  getSubscribers,
  getSubscriptionsDue,
  getFeeBalance,
  getAccount,
  addressSchema,
  bytes32Schema,
} from '../tools/read.js';
import { APPROVED_TOKENS } from '../config/approvedTokens.js';
import { z } from 'zod';

// Re-export useful schemas for routes
export { bytes32Schema, addressSchema } from '../tools/read.js';

// Additional schemas needed for the REST surface
export const bySubscriberSchema = z
  .string()
  .transform((val) => val === 'true')
  .or(z.boolean())
  .default(false);

export const dayNumberSchema = z.coerce.number().int().nonnegative().optional();
export const frequencySchema = z.coerce.number().int().min(0).max(3).optional();

type Env = any; // Using any here to avoid import cycles in early stages

export async function handleGetProtocolState(env: Env) {
  try {
    const data = await getProtocolState(env);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_protocol_state failed', err);
    return Errors.upstream('Failed to fetch protocol state');
  }
}

export async function handleGetSubscription(env: Env, idParam: string) {
  const parseResult = bytes32Schema.safeParse(idParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid subscription id (must be 32-byte hex)');
  }

  try {
    const data = await getSubscription(env, parseResult.data as `0x${string}`);
    return jsonResponse(data);
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      return Errors.notFound('Subscription not found');
    }
    console.error('get_subscription failed', err);
    return Errors.upstream('Failed to fetch subscription');
  }
}

export async function handleGetAccountSubscriptions(
  env: Env,
  addressParam: string,
  bySubscriberParam: string | null,
) {
  const addressParse = addressSchema.safeParse(addressParam);
  if (!addressParse.success) {
    return Errors.validation('Invalid Ethereum address');
  }

  const bySubscriberParse = bySubscriberSchema.safeParse(bySubscriberParam ?? 'false');
  if (!bySubscriberParse.success) {
    return Errors.validation('Invalid bySubscriber parameter');
  }

  try {
    const data = await getAccountSubscriptions(
      env,
      bySubscriberParse.data,
      addressParse.data as `0x${string}`,
    );
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_account_subscriptions failed', err);
    return Errors.upstream('Failed to fetch account subscriptions');
  }
}

export async function handleGetSubscribers(env: Env, idParam: string) {
  const parseResult = bytes32Schema.safeParse(idParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid subscription id (must be 32-byte hex)');
  }

  try {
    const data = await getSubscribers(env, parseResult.data as `0x${string}`);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_subscribers failed', err);
    return Errors.upstream('Failed to fetch subscribers');
  }
}

export async function handleGetApprovedToken(env: Env, tokenParam: string) {
  const parseResult = addressSchema.safeParse(tokenParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid token address');
  }

  try {
    const data = await getApprovedToken(env, parseResult.data as `0x${string}`);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_approved_token failed', err);
    return Errors.upstream('Failed to fetch approved token');
  }
}

export async function handleGetSubscriptionsDue(
  env: Env,
  dayNumberParam: string | null,
  frequencyParam: string | null,
) {
  const options: { dayNumber?: number; frequency?: number } = {};

  if (dayNumberParam) {
    const dayParse = dayNumberSchema.safeParse(dayNumberParam);
    if (!dayParse.success) {
      return Errors.validation('Invalid dayNumber');
    }
    options.dayNumber = dayParse.data;
  }

  if (frequencyParam) {
    const freqParse = frequencySchema.safeParse(frequencyParam);
    if (!freqParse.success) {
      return Errors.validation('Invalid frequency');
    }
    options.frequency = freqParse.data;
  }

  try {
    const data = await getSubscriptionsDue(env, options);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_subscriptions_due failed', err);
    return Errors.upstream('Failed to fetch due subscriptions');
  }
}

/**
 * Returns the lightly-managed list of approved tokens.
 * This is static configuration because the contract does not expose
 * an enumerable list of approvedERC20 entries.
 */
export function handleListApprovedTokens() {
  return jsonResponse({
    chainId: 8453,
    tokens: APPROVED_TOKENS,
  });
}

export async function handleGetFeeBalance(env: Env, idParam: string, addressParam: string) {
  const idParse = bytes32Schema.safeParse(idParam);
  if (!idParse.success) {
    return Errors.validation('Invalid subscription id');
  }

  const addressParse = addressSchema.safeParse(addressParam);
  if (!addressParse.success) {
    return Errors.validation('Invalid address');
  }

  try {
    const data = await getFeeBalance(env, idParse.data as `0x${string}`, addressParse.data as `0x${string}`);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_fee_balance failed', err);
    return Errors.upstream('Failed to fetch fee balance');
  }
}

export async function handleGetAccount(env: Env, addressParam: string) {
  const parseResult = addressSchema.safeParse(addressParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid address');
  }

  try {
    const data = await getAccount(env, parseResult.data as `0x${string}`);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_account failed', err);
    return Errors.upstream('Failed to fetch account');
  }
}
