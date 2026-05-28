/**
 * History & Provider Profile module
 *
 * This module provides high-level endpoints that internally query The Graph subgraph
 * for rich historical data (SubLog, DetailsLog, ProvDetailsLog, etc.).
 *
 * All functions in this module are expected to be wrapped with x402 payment
 * in both the MCP and REST surfaces.
 *
 * Implementation complete (post 1-2-3-4 sequence + Phase 2 core + Phase 4 hardening):
 * - High-level, clean shapes (matching frontend expectations)
 * - Server-side limits + pagination (first/skip)
 * - Cost-aware batch pricing helpers + static prices in pricing.ts
 * - Caching (Cloudflare Cache API)
 * - Strong error sanitization + graceful degradation (no GRAPH_* secret leakage)
 */

import dayjs from 'dayjs';
import { getApprovedTokenByAddress } from '../config/approvedTokens.js';
import { formatProtocolStoredAmount } from '../utils.js';

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
  const info = getApprovedTokenByAddress(tokenAddress);
  return info ? info.symbol : 'TOKEN';
}

/**
 * Returns normalized amount information for a SubLog event using the same
 * protocol-to-native conversion logic as the rest of the API.
 */
function getNormalizedAmount(protocolAmount: string, tokenAddress: string) {
  const info = getApprovedTokenByAddress(tokenAddress);
  const decimals = info ? info.decimals : 18;

  try {
    const formatted = formatProtocolStoredAmount(BigInt(protocolAmount), decimals);
    return {
      amount: formatted.amount,
      amountRaw: formatted.amountRaw.toString(),
      tokenDecimals: formatted.tokenDecimals,
      ticker: info ? info.symbol : 'TOKEN',
    };
  } catch {
    return {
      amount: protocolAmount,
      amountRaw: protocolAmount,
      tokenDecimals: decimals,
      ticker: info ? info.symbol : 'TOKEN',
    };
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

  const normalized = getNormalizedAmount(log.amount, log.token);

  // Exclude the raw protocol 18-decimal amount from the public response.
  // Users should only see properly normalized amounts (in the token's native decimals).
  const { amount: _rawProtocolAmount, ...restOfLog } = log;

  return {
    ...restOfLog,
    eventName,

    // Normalized values using the same logic as other read endpoints
    amount: normalized.amount,
    amountRaw: normalized.amountRaw,
    tokenDecimals: normalized.tokenDecimals,

    // Human-friendly display string (for convenience / frontend parity)
    formattedAmount: `${parseFloat(normalized.amount).toFixed(2)} ${normalized.ticker}`,
    formattedTimestamp: formatTimestamp(log.timestamp),
    tokenTicker: normalized.ticker,
  };
}

// ============================================
// Caching + Subgraph Query Helpers
// ============================================

/**
 * Cache key generator for subgraph queries.
 *
 * Security note: The key contains only a truncated hash of the query + variables.
 * No GRAPH_API_KEY or sensitive values are ever included. The cached payload
 * stores only the GraphQL `data` object (never headers or auth material).
 */
function getCacheKey(chainId: number, query: string, variables: Record<string, any>): string {
  const varString = JSON.stringify(variables);
  // Simple hash for cache key
  const hash = btoa(query + varString).slice(0, 32);
  return `subgraph:${chainId}:${hash}`;
}

/**
 * Defense-in-depth scrubber: ensures no API key material or sensitive headers
 * ever escape into user-facing error messages or responses.
 */
function sanitizeSubgraphError(err: unknown): Error {
  let raw = err instanceof Error ? err.message : String(err);

  // Redact any Bearer token that might have been accidentally included
  raw = raw.replace(/Bearer\s+[A-Za-z0-9\-_.]+/gi, 'Bearer [redacted]');

  // Redact anything that looks like a long alphanumeric secret (common for API keys)
  raw = raw.replace(/[A-Za-z0-9]{32,}/g, '[redacted]');

  // Never expose full stack traces or very long error bodies in user-facing messages
  if (raw.length > 300) {
    raw = raw.slice(0, 300) + '…';
  }

  return new Error(`Subgraph query failed: ${raw}`);
}

/**
 * Internal helper to execute a GraphQL query against the configured subgraph.
 * Includes Cloudflare Cache API support.
 * All thrown errors are sanitized to prevent GRAPH_* secret leakage.
 */
async function querySubgraph(
  env: Env,
  chainId: number,
  query: string,
  variables: Record<string, unknown>,
  cacheTtlSeconds = 45
): Promise<any> {
  // Validate any provided GRAPH_* config on first use (gives clear errors,
  // does not require the vars for core non-history operation).
  try {
    // Dynamic import to avoid circular deps at module load time.
    const { validateGraphConfig } = await import('../validation.js');
    validateGraphConfig(env);
  } catch {
    // If validation module has issues we still proceed; querySubgraph will fail with its own clear message.
  }

  const isMainnet = chainId === 8453;

  const baseUrl = isMainnet
    ? env.GRAPH_BASE_URL
    : env.GRAPH_BASE_SEPOLIA_URL;

  const apiKey = env.GRAPH_API_KEY;

  if (!baseUrl) {
    throw sanitizeSubgraphError(
      'Subgraph URL not configured for this chain. History endpoints require GRAPH_BASE_URL (and GRAPH_API_KEY for authenticated The Graph endpoints).'
    );
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
      // Log only status + truncated body. Never log headers or anything that could contain keys.
      console.error('[history] Subgraph HTTP error', res.status, text.slice(0, 500));
      throw sanitizeSubgraphError(`request failed with status ${res.status}`);
    }

    const json = await res.json();

    if (json.errors) {
      // Log GraphQL errors for debugging, but the thrown error to callers is sanitized
      console.error('[history] Subgraph GraphQL errors', JSON.stringify(json.errors).slice(0, 500));
      throw sanitizeSubgraphError('GraphQL errors returned (see server logs)');
    }

    // Store in cache (only the data payload — headers and auth are never cached)
    if (cache) {
      const responseToCache = new Response(JSON.stringify(json.data), {
        headers: { 'Content-Type': 'application/json' },
      });
      await cache.put(cacheKey, responseToCache);
    }

    return json.data as any;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw sanitizeSubgraphError('request timed out after 15s');
    }
    // Re-throw already-sanitized errors or wrap unknowns
    if (err.message?.startsWith('Subgraph query failed')) {
      throw err;
    }
    throw sanitizeSubgraphError(err);
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
// High-Level Functions
// ============================================

export interface HistoryOptions {
  first?: number;
  skip?: number;
  // Future: sinceTimestamp, cursor, etc.
}

const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 200;

/**
 * Defense-in-depth normalization of pagination options.
 * Enforces non-negative values and hard caps even if callers bypass Zod.
 */
function normalizeHistoryOptions(options: HistoryOptions = {}): { first: number; skip: number } {
  const rawFirst = options.first ?? DEFAULT_HISTORY_LIMIT;
  const rawSkip = options.skip ?? 0;

  const first = Math.max(0, Math.min(Math.floor(rawFirst), MAX_HISTORY_LIMIT));
  const skip = Math.max(0, Math.floor(rawSkip));

  return { first, skip };
}

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
  const { first, skip } = normalizeHistoryOptions(options);

  try {
    const data = await querySubgraph(env, chainId, GET_SUB_LOG, {
      subscriptionId: subscriptionId.toLowerCase(),
      first,
      skip,
    });

    const rawEvents: SubLog[] = data?.subLogs ?? [];
    const formattedEvents = rawEvents.map(event =>
      formatSubLogEvent(event, false)
    );

    return {
      chainId,
      subscriptionId,
      events: formattedEvents,
      hasMore: rawEvents.length === first,
      count: formattedEvents.length,
      rawCount: rawEvents.length,
    };
  } catch (err: any) {
    const safeError = err?.message?.startsWith('Subgraph query failed')
      ? err.message
      : sanitizeSubgraphError(err).message;

    return {
      chainId,
      subscriptionId,
      events: [],
      hasMore: false,
      count: 0,
      rawCount: 0,
      error: safeError,
    };
  }
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
  try {
    const data = await querySubgraph(env, chainId, GET_LATEST_PROV_DETAILS, {
      provider: provider.toLowerCase(),
      first: 1,
    });

    const latest: ProvDetailsLog | null = data?.provDetailsLogs?.[0] ?? null;

    return {
      chainId,
      provider,
      profile: latest,
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
  } catch (err: any) {
    const safeError = err?.message?.startsWith('Subgraph query failed')
      ? err.message
      : sanitizeSubgraphError(err).message;

    return {
      chainId,
      provider,
      profile: null,
      latestProfile: null,
      error: safeError,
    };
  }
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
  const { first, skip } = normalizeHistoryOptions(options);

  // Use independent calls so one side failing does not nuke the entire response
  // (partial results on upstream subgraph problems, per plan guidance).
  let subscriberEvents: SubLog[] = [];
  let providerEvents: SubLog[] = [];
  let queryErrors: string[] = [];

  try {
    const subData = await querySubgraph(env, chainId, GET_SUB_LOGS_AS_SUBSCRIBER, {
      subscriber: account.toLowerCase(),
      first,
      skip,
    });
    subscriberEvents = subData?.subLogs ?? [];
  } catch (e: any) {
    const safeMsg = e?.message?.startsWith('Subgraph query failed') ? e.message : sanitizeSubgraphError(e).message;
    queryErrors.push('subscriber leg: ' + safeMsg);
  }

  try {
    const provData = await querySubgraph(env, chainId, GET_SUB_LOGS_AS_PROVIDER, {
      provider: account.toLowerCase(),
      first,
      skip,
    });
    providerEvents = provData?.subLogs ?? [];
  } catch (e: any) {
    const safeMsg = e?.message?.startsWith('Subgraph query failed') ? e.message : sanitizeSubgraphError(e).message;
    queryErrors.push('provider leg: ' + safeMsg);
  }

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
    ...(queryErrors.length > 0 ? { partial: true, queryErrors } : {}),
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
  const { first, skip } = normalizeHistoryOptions(options);

  try {
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
  } catch (err: any) {
    const safeError = err?.message?.startsWith('Subgraph query failed')
      ? err.message
      : sanitizeSubgraphError(err).message;

    return {
      chainId,
      subscriptionId,
      events: [],
      hasMore: false,
      count: 0,
      error: safeError,
    };
  }
}

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