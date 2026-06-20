import { paymentMiddleware, x402ResourceServer } from '@x402/hono';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';

import { buildX402Config } from '../x402.js';
import { createMockFacilitatorClient } from './mockFacilitator.js';
import { API_PRICES, type ApiEndpoint } from './pricing.js';

/** USDC on Base mainnet */
const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const BASE_NETWORK = 'eip155:8453' as const;

export type RouteManifestEntry = {
  method: 'GET' | 'POST';
  path: string;
  priceKey: ApiEndpoint;
  description: string;
};

export const API_ROUTE_MANIFEST: RouteManifestEntry[] = [
  { method: 'GET', path: '/api/catalog', priceKey: 'catalog', description: 'Get REST API route catalog and pricing' },
  { method: 'GET', path: '/api/protocol/state', priceKey: 'protocolState', description: 'Get Clocktower protocol state' },
  { method: 'GET', path: '/api/subscriptions/due', priceKey: 'getSubscriptionsDue', description: 'Get subscriptions due' },
  { method: 'GET', path: '/api/subscriptions', priceKey: 'searchSubscriptions', description: 'Search and discover subscriptions' },
  { method: 'GET', path: '/api/subscriptions/:id/details', priceKey: 'subscriptionDetails', description: 'Get current subscription url and description' },
  { method: 'GET', path: '/api/subscriptions/:id', priceKey: 'getSubscription', description: 'Get subscription by ID' },
  { method: 'GET', path: '/api/subscriptions/:id/subscribers', priceKey: 'getSubscribers', description: 'Get subscribers for subscription' },
  { method: 'GET', path: '/api/accounts/:address/subscriptions', priceKey: 'getAccountSubscriptions', description: 'Get subscriptions for account' },
  { method: 'GET', path: '/api/accounts/:address', priceKey: 'getAccount', description: 'Get full account overview' },
  { method: 'GET', path: '/api/approved-tokens', priceKey: 'getApprovedToken', description: 'List approved tokens' },
  { method: 'GET', path: '/api/approved-tokens/:token', priceKey: 'getApprovedToken', description: 'Get approved token config' },
  { method: 'GET', path: '/api/subscriptions/:id/fee-balance', priceKey: 'feeBalance', description: 'Get fee balance' },
  { method: 'GET', path: '/api/subscriptions/:id/history', priceKey: 'subscriptionHistory', description: 'Get subscription history' },
  { method: 'GET', path: '/api/accounts/:address/activity', priceKey: 'accountActivity', description: 'Get combined account activity history' },
  { method: 'GET', path: '/api/providers/:address', priceKey: 'providerProfile', description: 'Get provider profile' },
  { method: 'GET', path: '/api/subscriptions/:id/details-history', priceKey: 'subscriptionDetailsHistory', description: 'Get subscription details history' },
  { method: 'POST', path: '/api/check_subscribe_readiness', priceKey: 'checkSubscribeReadiness', description: 'Check subscribe readiness' },
  { method: 'POST', path: '/api/prepare/create_subscription', priceKey: 'prepareCreateSubscription', description: 'Prepare create subscription' },
  { method: 'POST', path: '/api/prepare/subscribe', priceKey: 'prepareSubscribe', description: 'Prepare subscribe' },
  { method: 'POST', path: '/api/prepare/cancel_subscription', priceKey: 'prepareCancelSubscription', description: 'Prepare cancel subscription' },
  { method: 'POST', path: '/api/prepare/unsubscribe', priceKey: 'prepareUnsubscribe', description: 'Prepare unsubscribe' },
  { method: 'POST', path: '/api/prepare/unsubscribe_by_provider', priceKey: 'prepareUnsubscribeByProvider', description: 'Prepare unsubscribe by provider' },
  { method: 'POST', path: '/api/prepare/edit_details', priceKey: 'prepareEditDetails', description: 'Prepare edit details' },
  { method: 'POST', path: '/api/check_remit_readiness', priceKey: 'checkRemitReadiness', description: 'Check remit readiness' },
  { method: 'POST', path: '/api/prepare/remit', priceKey: 'prepareRemit', description: 'Prepare remit' },
  { method: 'POST', path: '/api/transactions/status', priceKey: 'getTransactionStatus', description: 'Get transaction status' },
];

function buildRoutesConfig(
  recipient: `0x${string}`,
): Record<string, { accepts: object[]; description: string; mimeType: string }> {
  const config: Record<string, { accepts: object[]; description: string; mimeType: string }> = {};

  for (const { method, path, priceKey, description } of API_ROUTE_MANIFEST) {
    const key = `${method} ${path}`;
    config[key] = {
      accepts: [{
        scheme: 'exact',
        price: `$${API_PRICES[priceKey]}`,
        network: BASE_NETWORK,
        payTo: recipient,
        asset: BASE_USDC_ADDRESS,
      }],
      description,
      mimeType: 'application/json',
    };
  }

  return config;
}

function resolveFacilitatorClient(
  env: Env,
  options: { facilitatorClient?: unknown },
): unknown {
  if (options.facilitatorClient !== undefined) {
    return options.facilitatorClient;
  }
  if (env.X402_USE_MOCK_FACILITATOR === 'true') {
    return createMockFacilitatorClient();
  }
  const x402Config = buildX402Config(env);
  return new HTTPFacilitatorClient({
    url: x402Config.facilitator?.url ?? 'https://x402.org/facilitator',
    createAuthHeaders: x402Config.facilitator?.createAuthHeaders,
  });
}

/**
 * Creates the x402 payment middleware for Hono using @x402/hono.
 * Each call returns an independent middleware instance (own lazy cache).
 */
export function createX402PaymentMiddleware(options: { facilitatorClient?: unknown } = {}) {
  let cachedMiddleware: ReturnType<typeof paymentMiddleware> | null = null;

  return async (c: { env: Env; json: (body: unknown, status: number) => Response }, next: () => Promise<void>) => {
    if (!cachedMiddleware) {
      const env = c.env;

      const facilitatorClient = resolveFacilitatorClient(env, options);

      const recipient = env.X402_RECIPIENT as `0x${string}`;
      if (!recipient) {
        return c.json({ error: 'Payment configuration error' }, 500);
      }

      const resourceServer = new x402ResourceServer(facilitatorClient)
        .register(BASE_NETWORK, new ExactEvmScheme());

      cachedMiddleware = paymentMiddleware(buildRoutesConfig(recipient), resourceServer);
    }

    try {
      return await cachedMiddleware(c, next);
    } catch (err) {
      // Secondary safety net; src/index.ts is the primary guard (402 only without payment headers).
      console.error('[x402] Middleware error → returning 402:', err);
      return c.json({ error: 'Payment required' }, 402);
    }
  };
}
