import { Errors, jsonResponse } from './responses.js';
import type { ChainConfig } from '../chain.js';
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

import {
  getSubscriptionHistory,
  getAccountActivity,
  getProviderProfile,
  getSubscriptionDetails,
  getSubscriptionDetailsHistory,
} from '../tools/history.js';
import { listApprovedTokens } from '../tools/read.js';
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

export async function handleGetProtocolState(env: Env, chain?: ChainConfig) {
  try {
    const data = await getProtocolState(env, chain);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_protocol_state failed', err);
    return Errors.upstream('Failed to fetch protocol state');
  }
}

export async function handleGetSubscription(env: Env, idParam: string, chain?: ChainConfig) {
  const parseResult = bytes32Schema.safeParse(idParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid subscription id (must be 32-byte hex)');
  }

  try {
    const data = await getSubscription(env, parseResult.data as `0x${string}`, chain);
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
  chain?: ChainConfig,
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
      chain,
    );
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_account_subscriptions failed', err);
    return Errors.upstream('Failed to fetch account subscriptions');
  }
}

export async function handleGetSubscribers(env: Env, idParam: string, chain?: ChainConfig) {
  const parseResult = bytes32Schema.safeParse(idParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid subscription id (must be 32-byte hex)');
  }

  try {
    const data = await getSubscribers(env, parseResult.data as `0x${string}`, chain);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_subscribers failed', err);
    return Errors.upstream('Failed to fetch subscribers');
  }
}

export async function handleGetApprovedToken(env: Env, tokenParam: string, chain?: ChainConfig) {
  const parseResult = addressSchema.safeParse(tokenParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid token address');
  }

  try {
    const data = await getApprovedToken(env, parseResult.data as `0x${string}`, chain);
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
  chain?: ChainConfig,
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
    const data = await getSubscriptionsDue(env, options, chain);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_subscriptions_due failed', err);
    return Errors.upstream('Failed to fetch due subscriptions');
  }
}

/**
 * Returns approved tokens enriched with on-chain minimum and paused state.
 */
export async function handleListApprovedTokens(env: Env, chain?: ChainConfig) {
  try {
    const data = await listApprovedTokens(env, chain);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('list_approved_tokens failed', err);
    return Errors.upstream('Failed to list approved tokens');
  }
}

export async function handleGetSubscriptionDetails(env: Env, idParam: string, chain?: ChainConfig) {
  const parseResult = bytes32Schema.safeParse(idParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid subscription id');
  }

  try {
    const data = await getSubscriptionDetails(
      env,
      parseResult.data as `0x${string}`,
      chain?.chainId,
    );
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_subscription_details failed', err);
    const msg = err?.message?.includes('Subgraph')
      ? 'Subgraph backend unavailable or misconfigured'
      : 'Failed to fetch subscription details';
    return Errors.upstream(msg);
  }
}

export async function handleGetFeeBalance(
  env: Env,
  idParam: string,
  addressParam: string,
  chain?: ChainConfig,
) {
  const idParse = bytes32Schema.safeParse(idParam);
  if (!idParse.success) {
    return Errors.validation('Invalid subscription id');
  }

  const addressParse = addressSchema.safeParse(addressParam);
  if (!addressParse.success) {
    return Errors.validation('Invalid address');
  }

  try {
    const data = await getFeeBalance(env, idParse.data as `0x${string}`, addressParse.data as `0x${string}`, chain);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_fee_balance failed', err);
    return Errors.upstream('Failed to fetch fee balance');
  }
}

export async function handleGetAccount(env: Env, addressParam: string, chain?: ChainConfig) {
  const parseResult = addressSchema.safeParse(addressParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid address');
  }

  try {
    const data = await getAccount(env, parseResult.data as `0x${string}`, chain);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_account failed', err);
    return Errors.upstream('Failed to fetch account');
  }
}

// === History & Profile handlers (subgraph-backed) ===

export async function handleGetSubscriptionHistory(env: Env, idParam: string, query: any, chain?: ChainConfig) {
  const parseResult = bytes32Schema.safeParse(idParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid subscription id');
  }

  try {
    const data = await getSubscriptionHistory(
      env,
      parseResult.data as `0x${string}`,
      chain?.chainId,
      {
        first: query.first ? Number(query.first) : undefined,
        skip: query.skip ? Number(query.skip) : undefined,
      }
    );
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_subscription_history failed', err);
    const msg = err?.message?.includes('Subgraph') ? 'Subgraph backend unavailable or misconfigured' : 'Failed to fetch subscription history';
    return Errors.upstream(msg);
  }
}

export async function handleGetAccountActivity(env: Env, addressParam: string, query: any, chain?: ChainConfig) {
  const parseResult = addressSchema.safeParse(addressParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid address');
  }

  try {
    const data = await getAccountActivity(
      env,
      parseResult.data as `0x${string}`,
      chain?.chainId,
      {
        first: query.first ? Number(query.first) : undefined,
        skip: query.skip ? Number(query.skip) : undefined,
      }
    );
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_account_activity failed', err);
    const msg = err?.message?.includes('Subgraph') ? 'Subgraph backend unavailable or misconfigured' : 'Failed to fetch account activity';
    return Errors.upstream(msg);
  }
}

export async function handleGetProviderProfile(env: Env, addressParam: string, chain?: ChainConfig) {
  const parseResult = addressSchema.safeParse(addressParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid address');
  }

  try {
    const data = await getProviderProfile(env, parseResult.data as `0x${string}`, chain?.chainId);
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_provider_profile failed', err);
    const msg = err?.message?.includes('Subgraph') ? 'Subgraph backend unavailable or misconfigured' : 'Failed to fetch provider profile';
    return Errors.upstream(msg);
  }
}

export async function handleGetSubscriptionDetailsHistory(env: Env, idParam: string, query: any, chain?: ChainConfig) {
  const parseResult = bytes32Schema.safeParse(idParam);
  if (!parseResult.success) {
    return Errors.validation('Invalid subscription id');
  }

  try {
    const data = await getSubscriptionDetailsHistory(
      env,
      parseResult.data as `0x${string}`,
      chain?.chainId,
      {
        first: query.first ? Number(query.first) : undefined,
        skip: query.skip ? Number(query.skip) : undefined,
      }
    );
    return jsonResponse(data);
  } catch (err: any) {
    console.error('get_subscription_details_history failed', err);
    const msg = err?.message?.includes('Subgraph') ? 'Subgraph backend unavailable or misconfigured' : 'Failed to fetch details history';
    return Errors.upstream(msg);
  }
}
