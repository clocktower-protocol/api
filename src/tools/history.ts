/**
 * History & Provider Profile module
 *
 * This module provides high-level endpoints that internally query The Graph subgraph
 * for rich historical data (SubLog, DetailsLog, ProvDetailsLog, etc.).
 *
 * All functions in this module are expected to be wrapped with x402 payment
 * in both the MCP and REST surfaces.
 *
 * Design goals for Phase 2:
 * - High-level, clean shapes (matching frontend expectations)
 * - Server-side limits + pagination
 * - Cost-aware batch pricing support
 * - Caching (Cloudflare Cache API preferred in Workers)
 * - No leakage of GRAPH_* secrets in errors
 */

import dayjs from 'dayjs';
import { APPROVED_TOKENS } from '../config/approvedTokens.js';
import { formatEther } from 'viem'; // Already a dependency via other modules

// Note: Env interface is globally available via env.d.ts augmentation

// ============================================
// Types (modeled after frontend/src/types/subscription.d.ts for parity)
// ============================================

export interface SubLog {
  internal_id: string;
  provider: string;
  subscriber: string;
  timestamp: string;
  amount: string;
  token: string;
  subScriptEvent: string; // numeric string from subgraph
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: string;
}

export interface DetailsLog {
  internal_id: string;
  provider: string;
  timestamp: string;
  url: string;
  description: string;
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: string;
}

export interface ProvDetailsLog {
  provider: string;
  timestamp: string;
  description: string;
  company: string;
  url: string;
  domain: string;
  email: string;
  misc: string;
}

export interface CallerLog {
  timestamp: string;
  checkedDay: string;
  caller: string;
  isFinished: boolean;
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: string;
}

// ============================================
// Formatting Helpers (frontend parity)
// ============================================

const SUBSCRIPT_EVENT_LOOKUP = [
  'Create', 'Cancel', 'ProvPaid', 'Fail', 'ProvRefund',
  'SubPaid', 'Subscribed', 'Unsubscribed', 'Feefill', 'SubRefund'
];

function getTokenTicker(tokenAddress: string): string {
  const normalized = tokenAddress.toLowerCase();
  const match = APPROVED_TOKENS.find(t => t.address.toLowerCase() === normalized);
  return match ? match.symbol : 'TOKEN';
}

function formatAmount(amount: string, tokenAddress: string): string {
  try {
    const formatted = formatEther(BigInt(amount));
    const ticker = getTokenTicker(tokenAddress);
    return `${parseFloat(formatted).toFixed(2)} ${ticker}`;
  } catch {
    return amount;
  }
}

function formatTimestamp(timestamp: string): string {
  return dayjs.unix(Number(timestamp)).format('MM/DD/YYYY h:mm:ss A');
}

export function formatSubLogEvent(log: SubLog, isProviderView = false) {
  const eventIndex = Number(log.subScriptEvent);
  let eventName = SUBSCRIPT_EVENT_LOOKUP[eventIndex] || `Event ${eventIndex}`;

  // Frontend-style filtering / labeling
  if (isProviderView && eventIndex === 5) eventName = 'SubPaid (internal)';
  if (!isProviderView && eventIndex === 2) eventName = 'ProvPaid (internal)';

  return {
    ...log,
    eventName,
    formattedAmount: formatAmount(log.amount, log.token),
    formattedTimestamp: formatTimestamp(log.timestamp),
    tokenTicker: getTokenTicker(log.token),
  };
}

// ============================================
// Caching + Subgraph Query Helpers
// ============================================

/**
 * Cache key generator for subgraph queries.
 */
function getCacheKey(chainId: number, query: string, variables: Record<string, any>): string {
  const varString = JSON.stringify(variables);
  // Simple hash for cache key
  const hash = btoa(query + varString).slice(0, 32);
  return `subgraph:${chainId}:${hash}`;
}

/**
 * Internal helper to execute a GraphQL query against the configured subgraph.
 * Includes Cloudflare Cache API support.
 */
async function querySubgraph(
  env: Env,
  chainId: number,
  query: string,
  variables: Record<string, unknown>,
  cacheTtlSeconds = 45
): Promise<any> {
  const isMainnet = chainId === 8453;

  const baseUrl = isMainnet
    ? env.GRAPH_BASE_URL
    : env.GRAPH_BASE_SEPOLIA_URL;

  const apiKey = env.GRAPH_API_KEY;

  if (!baseUrl) {
    throw new Error('Subgraph URL not configured for this chain');
  }

  const cacheKey = getCacheKey(chainId, query, variables);

  // Try Cache API first (Workers runtime)
  const cache = (caches as any).default;
  if (cache) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return (await cachedResponse.json()) as any;
    }
  }

  const url = baseUrl;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[history] Subgraph error', res.status, text);
      throw new Error(`Subgraph request failed: ${res.status}`);
    }

    const json = await res.json();

    if (json.errors) {
      console.error('[history] Subgraph GraphQL errors', json.errors);
      throw new Error('Subgraph returned errors');
    }

    // Store in cache
    if (cache) {
      const responseToCache = new Response(JSON.stringify(json.data), {
        headers: { 'Content-Type': 'application/json' },
      });
      await cache.put(cacheKey, responseToCache);
    }

    return json.data as any;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Subgraph request timed out');
    }
    throw err;
  }
}

// ============================================
// GraphQL Queries (ported/adapted from frontend)
// ============================================

const GET_SUB_LOG = `
  query GetSubLog($subscriptionId: Bytes!, $first: Int, $skip: Int) {
    subLogs(
      where: { internal_id: $subscriptionId }
      first: $first
      skip: $skip
      orderBy: timestamp
      orderDirection: desc
    ) {
      internal_id
      provider
      subscriber
      timestamp
      amount
      token
      subScriptEvent
      blockNumber
      blockTimestamp
      transactionHash
    }
  }
`;

const GET_LATEST_PROV_DETAILS = `
  query GetLatestProvDetails($provider: Bytes!, $first: Int!) {
    provDetailsLogs(
      where: { provider: $provider }
      first: $first
      orderBy: timestamp
      orderDirection: desc
    ) {
      provider
      timestamp
      description
      company
      url
      domain
      email
      misc
    }
  }
`;

const GET_SUB_LOGS_AS_SUBSCRIBER = `
  query GetSubLogsAsSubscriber($subscriber: Bytes!, $first: Int, $skip: Int) {
    subLogs(
      where: { subscriber: $subscriber }
      first: $first
      skip: $skip
      orderBy: timestamp
      orderDirection: desc
    ) {
      internal_id
      provider
      subscriber
      timestamp
      amount
      token
      subScriptEvent
      blockNumber
      blockTimestamp
      transactionHash
    }
  }
`;

const GET_SUB_LOGS_AS_PROVIDER = `
  query GetSubLogsAsProvider($provider: Bytes!, $first: Int, $skip: Int) {
    subLogs(
      where: { provider: $provider }
      first: $first
      skip: $skip
      orderBy: timestamp
      orderDirection: desc
    ) {
      internal_id
      provider
      subscriber
      timestamp
      amount
      token
      subScriptEvent
      blockNumber
      blockTimestamp
      transactionHash
    }
  }
`;

const GET_DETAILS_LOG = `
  query GetDetailsLog($subscriptionId: Bytes!, $first: Int, $skip: Int) {
    detailsLogs(
      where: { internal_id: $subscriptionId }
      first: $first
      skip: $skip
      orderBy: timestamp
      orderDirection: desc
    ) {
      internal_id
      provider
      timestamp
      url
      description
      blockNumber
      blockTimestamp
      transactionHash
    }
  }
`;

// ============================================
// High-Level Functions (Phase 2)
// ============================================

export interface HistoryOptions {
  first?: number;
  skip?: number;
  // Future: sinceTimestamp, cursor, etc.
}

const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 200;

/**
 * Get activity history for a specific subscription.
 * Currently returns SubLog entries.
 */
export async function getSubscriptionHistory(
  env: Env,
  subscriptionId: `0x${string}`,
  chainId: number = 8453,
  options: HistoryOptions = {}
) {
  const first = Math.min(options.first ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
  const skip = options.skip ?? 0;

  const data = await querySubgraph(env, chainId, GET_SUB_LOG, {
    subscriptionId: subscriptionId.toLowerCase(),
    first,
    skip,
  });

  const rawEvents: SubLog[] = data?.subLogs ?? [];

  // Apply frontend-style formatting + provider/subscriber view logic
  const formattedEvents = rawEvents.map(event =>
    formatSubLogEvent(event, false) // default to subscriber view; caller can re-format if needed
  );

  return {
    chainId,
    subscriptionId,
    events: formattedEvents,
    hasMore: rawEvents.length === first,
    count: formattedEvents.length,
    rawCount: rawEvents.length,
  };
}

/**
 * Get the latest provider profile details.
 * Returns the most recent ProvDetailsLog entry.
 */
export async function getProviderProfile(
  env: Env,
  provider: `0x${string}`,
  chainId: number = 8453
) {
  const data = await querySubgraph(env, chainId, GET_LATEST_PROV_DETAILS, {
    provider: provider.toLowerCase(),
    first: 1,
  });

  const latest: ProvDetailsLog | null = data?.provDetailsLogs?.[0] ?? null;

  return {
    chainId,
    provider,
    profile: latest,
    // Convenience field for the "most recent" profile data
    latestProfile: latest
      ? {
          description: latest.description,
          company: latest.company,
          url: latest.url,
          domain: latest.domain,
          email: latest.email,
          misc: latest.misc,
          updatedAt: formatTimestamp(latest.timestamp),
        }
      : null,
  };
}

/**
 * Get combined activity for an account across all their subscriptions
 * (both as a subscriber and as a provider/creator).
 */
export async function getAccountActivity(
  env: Env,
  account: `0x${string}`,
  chainId: number = 8453,
  options: HistoryOptions = {}
) {
  const first = Math.min(options.first ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
  const skip = options.skip ?? 0;

  const [asSubscriberData, asProviderData] = await Promise.all([
    querySubgraph(env, chainId, GET_SUB_LOGS_AS_SUBSCRIBER, {
      subscriber: account.toLowerCase(),
      first,
      skip,
    }),
    querySubgraph(env, chainId, GET_SUB_LOGS_AS_PROVIDER, {
      provider: account.toLowerCase(),
      first,
      skip,
    }),
  ]);

  const subscriberEvents: SubLog[] = asSubscriberData?.subLogs ?? [];
  const providerEvents: SubLog[] = asProviderData?.subLogs ?? [];

  // Merge and deduplicate by transactionHash + internal_id (simple approach)
  const allEvents = [...subscriberEvents, ...providerEvents];
  const seen = new Set<string>();
  const uniqueEvents = allEvents.filter((e) => {
    const key = `${e.transactionHash}:${e.internal_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by timestamp desc
  uniqueEvents.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

  // Apply limit after merge
  const limitedEvents = uniqueEvents.slice(0, first);

  const formatted = limitedEvents.map((event) =>
    formatSubLogEvent(event)
  );

  return {
    chainId,
    account,
    events: formatted,
    hasMore: uniqueEvents.length > first,
    count: formatted.length,
    breakdown: {
      asSubscriber: subscriberEvents.length,
      asProvider: providerEvents.length,
    },
  };
}

/**
 * Get history of description / URL changes for a subscription (DetailsLog).
 */
export async function getSubscriptionDetailsHistory(
  env: Env,
  subscriptionId: `0x${string}`,
  chainId: number = 8453,
  options: HistoryOptions = {}
) {
  const first = Math.min(options.first ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
  const skip = options.skip ?? 0;

  const data = await querySubgraph(env, chainId, GET_DETAILS_LOG, {
    subscriptionId: subscriptionId.toLowerCase(),
    first,
    skip,
  });

  const events: DetailsLog[] = data?.detailsLogs ?? [];

  const formattedEvents = events.map((event) => ({
    ...event,
    formattedTimestamp: formatTimestamp(event.timestamp),
  }));

  return {
    chainId,
    subscriptionId,
    events: formattedEvents,
    hasMore: events.length === first,
    count: formattedEvents.length,
  };
}

// TODO (rest of Phase 2 + later):
// - getAccountActivity (combined view across subs)
// - getSubscriptionDetailsHistory (DetailsLog)
// - Better pagination (timestamp cursor)
// - Cost/batch pricing helpers exposed for pricing.ts
// - getCallerHistory support

export const HISTORY_DEFAULT_LIMIT = DEFAULT_HISTORY_LIMIT;
export const HISTORY_MAX_LIMIT = MAX_HISTORY_LIMIT;

// ============================================
// Cost / Batch Pricing Helpers (for reference in pricing.ts)
// ============================================

/**
 * Suggested pricing model for history queries.
 *
 * This is a helper to keep pricing logic near the history code.
 * The actual prices are defined in src/api/pricing.ts.
 *
 * Cost model rationale:
 * - Base fee covers the GraphQL round-trip + x402 overhead + small result set.
 * - Per-batch adder covers larger result sets (The Graph charges based on
 *   query complexity + data transfer on paid plans).
 * - We hard-limit server-side to prevent abuse and runaway costs.
 */
export function calculateSuggestedHistoryPrice(recordCount: number): number {
  const BASE_PRICE = 0.03;           // USD for first ~50 records
  const PER_50_RECORDS = 0.01;       // USD for every additional 50 records

  if (recordCount <= 50) return BASE_PRICE;

  const extraBatches = Math.ceil((recordCount - 50) / 50);
  return BASE_PRICE + (extraBatches * PER_50_RECORDS);
}

/**
 * Recommended maximum number of records to return in a single history call
 * before forcing the client to paginate.
 */
export const RECOMMENDED_HISTORY_BATCH_SIZE = 100;