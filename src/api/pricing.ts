/**
 * Stage 2: Pricing configuration for the REST API (x402).
 *
 * These prices are defined here so they can be referenced consistently
 * when we later protect routes with the x402 middleware.
 */

export const API_PRICES = {
  // Read endpoints (same pricing as the MCP tools for consistency)
  protocolState: 0.01,
  getSubscription: 0.01,
  getAccountSubscriptions: 0.01,
  getSubscribers: 0.01,
  getApprovedToken: 0.01,
  getSubscriptionsDue: 0.01,
} as const;

export type ApiEndpoint = keyof typeof API_PRICES;
