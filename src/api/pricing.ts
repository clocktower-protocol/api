/**
 * Pricing configuration for the REST API (x402).
 *
 * Centralized here for consistency across read ($0.01) and write ($0.02) endpoints.
 */

export const API_PRICES = {
  // Read endpoints (same pricing as the MCP tools for consistency)
  protocolState: 0.01,
  getSubscription: 0.01,
  getAccountSubscriptions: 0.01,
  getSubscribers: 0.01,
  getApprovedToken: 0.01,
  getSubscriptionsDue: 0.01,

  // === History & Profile endpoints (Phase 0+ of subgraph integration plan) ===
  // These query The Graph subgraph for SubLog / DetailsLog / ProvDetailsLog / CallerLog.
  // Pricing is intentionally higher than simple reads to cover subgraph query costs,
  // bandwidth, and to discourage abuse of large history pulls.
  //
  // Cost model rationale (see implementation plan for full calculation):
  //   - Base fee covers the GraphQL round-trip + x402 overhead.
  //   - Per-batch adder covers larger result sets (The Graph charges by query complexity + data transfer).
  //   - All history calls are hard-limited server-side (default max 100-200 records) + optional pagination.
  //   - Prices are in USD (USDC on Base). Adjust as real subgraph billing data is gathered.
  subscriptionHistory: 0.05,      // Base for a history batch (first ~50 events). +$0.01 per extra 50 (capped).
  accountActivity: 0.05,          // Combined history across an account's subs (subscriber + provider view).
  subscriptionDetailsHistory: 0.03, // Lighter: only DetailsLog (url/description changes) for one subscription.
  providerProfile: 0.02,          // Latest ProvDetailsLog only (company, domain, email, etc.). Very cheap.

  // Write endpoints (higher price as they involve simulation + intent storage)
  checkSubscribeReadiness: 0.01,
  prepareCreateSubscription: 0.02,
  prepareSubscribe: 0.02,
  prepareCancelSubscription: 0.02,
  prepareUnsubscribe: 0.02,
  prepareUnsubscribeByProvider: 0.02,
  prepareEditDetails: 0.02,
  submitSignedTransactions: 0.02,
  getTransactionStatus: 0.01,
} as const;

export type ApiEndpoint = keyof typeof API_PRICES;

// Note: New history/profile prices (subscriptionHistory, accountActivity, etc.)
// are intentionally part of ApiEndpoint so they can be referenced uniformly
// in withX402Payment calls and tests.
