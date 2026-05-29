import { paymentMiddleware, x402ResourceServer } from '@x402/hono';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';

import { buildX402Config } from '../x402.js';
import { API_PRICES } from './pricing.js';

/**
 * Official x402 integration for Hono using @x402/hono.
 *
 * This replaces the previous custom low-level withX402Payment implementation.
 * It provides much better compatibility with official clients (@x402/fetch, etc.)
 * and follows the recommended patterns from the x402 Foundation.
 */

type Env = any;

/**
 * Creates the x402 payment middleware for Hono using the official library.
 *
 * Usage in app.ts:
 *   const x402Mw = createX402PaymentMiddleware(options);
 *   app.use(x402Mw);
 *
 * Then register your routes normally (no more per-route wrapping needed).
 */
export function createX402PaymentMiddleware(options: { facilitatorClient?: any } = {}) {
  return async (c: any, next: any) => {
    const env: Env = c.env;

    const config = buildX402Config(env);
    const facilitatorClient = options.facilitatorClient ?? new HTTPFacilitatorClient({
      url: config.facilitator?.url ?? 'https://x402.org/facilitator',
      createAuthHeaders: config.facilitator?.createAuthHeaders,
    });

    const recipient = env.X402_RECIPIENT as `0x${string}`;
    if (!recipient) {
      return c.json({ error: 'Payment configuration error' }, 500);
    }

    const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

    // Build the routes config from our centralized pricing.
    // This is the key to keeping pricing in one place.
    const routesConfig: Record<string, any> = {
      // Read endpoints
      'GET /api/protocol/state': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.protocolState}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get Clocktower protocol state',
        mimeType: 'application/json',
      },
      'GET /api/subscriptions/due': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.getSubscriptionsDue}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get subscriptions due',
        mimeType: 'application/json',
      },
      'GET /api/subscriptions/:id': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.getSubscription}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get subscription by ID',
        mimeType: 'application/json',
      },
      'GET /api/subscriptions/:id/subscribers': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.getSubscribers}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get subscribers for subscription',
        mimeType: 'application/json',
      },
      'GET /api/accounts/:address/subscriptions': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.getAccountSubscriptions}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get subscriptions for account',
        mimeType: 'application/json',
      },
      'GET /api/accounts/:address': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.getAccountSubscriptions}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get full account overview',
        mimeType: 'application/json',
      },
      'GET /api/approved-tokens': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.getApprovedToken}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'List approved tokens',
        mimeType: 'application/json',
      },
      'GET /api/approved-tokens/:token': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.getApprovedToken}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get approved token config',
        mimeType: 'application/json',
      },
      'GET /api/subscriptions/:id/fee-balance': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.getApprovedToken}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get fee balance',
        mimeType: 'application/json',
      },

      // History endpoints
      'GET /api/subscriptions/:id/history': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.subscriptionHistory}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get subscription history',
        mimeType: 'application/json',
      },
      'GET /api/accounts/:address/activity': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.accountActivity}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get combined account activity history',
        mimeType: 'application/json',
      },
      'GET /api/providers/:address': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.providerProfile}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get provider profile',
        mimeType: 'application/json',
      },
      'GET /api/subscriptions/:id/details-history': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.subscriptionDetailsHistory}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get subscription details history',
        mimeType: 'application/json',
      },

      // Write endpoints
      'POST /api/check_subscribe_readiness': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.checkSubscribeReadiness}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Check subscribe readiness',
        mimeType: 'application/json',
      },
      'POST /api/prepare/create_subscription': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.prepareCreateSubscription}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Prepare create subscription',
        mimeType: 'application/json',
      },
      'POST /api/prepare/subscribe': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.prepareSubscribe}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Prepare subscribe',
        mimeType: 'application/json',
      },
      'POST /api/prepare/cancel_subscription': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.prepareCancelSubscription}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Prepare cancel subscription',
        mimeType: 'application/json',
      },
      'POST /api/prepare/unsubscribe': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.prepareUnsubscribe}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Prepare unsubscribe',
        mimeType: 'application/json',
      },
      'POST /api/prepare/unsubscribe_by_provider': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.prepareUnsubscribeByProvider}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Prepare unsubscribe by provider',
        mimeType: 'application/json',
      },
      'POST /api/prepare/edit_details': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.prepareEditDetails}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Prepare edit details',
        mimeType: 'application/json',
      },
      'POST /api/submit_signed_transactions': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.submitSignedTransactions}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Submit signed transactions',
        mimeType: 'application/json',
      },
      'POST /api/transactions/status': {
        accepts: [{ scheme: 'exact', price: `$${API_PRICES.getTransactionStatus}`, network: 'eip155:8453', payTo: recipient, asset: USDC_ADDRESS }],
        description: 'Get transaction status',
        mimeType: 'application/json',
      },
    };

    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register('eip155:8453', new ExactEvmScheme());

    // Use the official middleware
    const mw = paymentMiddleware(routesConfig, resourceServer);
    return mw(c, next);
  };
}

/**
 * @deprecated
 * Legacy function kept only for gradual migration.
 * New code should use `createX402PaymentMiddleware` above + the official @x402/hono middleware.
 */
export const withX402Payment = (...args: any[]) => {
  throw new Error(
    'withX402Payment is deprecated. Migrate to createX402PaymentMiddleware (see src/api/x402.ts) and apply it once via app.use().'
  );
};
