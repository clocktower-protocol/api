import { Hono } from 'hono';
import { Errors, jsonResponse } from './responses.js';
import {
  handleGetProtocolState,
  handleGetSubscription,
  handleGetAccountSubscriptions,
  handleGetSubscribers,
  handleGetApprovedToken,
  handleGetSubscriptionsDue,
  handleListApprovedTokens,
  handleGetFeeBalance,
  handleGetAccount,
} from './read.js';
import { withX402Payment } from './x402.js';
import { API_PRICES } from './pricing.js';

// Write handlers
import * as writeHandlers from './write.js';

export type ApiAppOptions = {
  /** For tests: inject a mock facilitator so we can test full x402 + real handler flows */
  facilitatorClient?: any;
};

/**
 * Clocktower REST API
 *
 * This module defines the REST API surface mounted under `/api`.
 *
 * === Authentication Model ===
 * x402 micropayments (USDC on Base) are the **primary and non-bypassable**
 * authorization + payment layer on every route.
 *
 * Basic Auth (`API_REQUIRE_BASIC_AUTH`) is an optional extra safety layer
 * intended only for the developer's manual testing while x402 is still
 * maturing. It is disabled by default in tests (`false`).
 *
 * IP rate limiting still applies on top.
 *
 * === Current Endpoints ===
 * Read endpoints (all protected with x402):
 *   - GET /api/protocol/state
 *   - GET /api/subscriptions/due
 *   - GET /api/subscriptions/:id
 *   - GET /api/subscriptions/:id/subscribers
 *   - GET /api/accounts/:address/subscriptions
 *   - GET /api/accounts/:address          (full enriched view: subscribedTo + created)
 *   - GET /api/approved-tokens
 *   - GET /api/approved-tokens/:token
 *
 * Write endpoints (all protected with x402):
 *   - POST /api/check_subscribe_readiness
 *   - POST /api/prepare/create_subscription
 *   - POST /api/prepare/subscribe
 *   - POST /api/prepare/cancel_subscription
 *   - POST /api/prepare/unsubscribe
 *   - POST /api/prepare/unsubscribe_by_provider
 *   - POST /api/prepare/edit_details
 *   - POST /api/submit_signed_transactions
 *   - POST /api/transactions/status
 *
 * === Notes ===
 * - All routes require a valid x402 payment.
 * - Basic Auth can be turned on for /api by setting API_REQUIRE_BASIC_AUTH=true
 *   (useful only for early developer testing).
 * - See src/api/x402.ts for the withX402Payment wrapper implementation.
 *
 * Related modules:
 *   - src/api/pricing.ts   → Centralized pricing for reads ($0.01) and writes ($0.02)
 *   - src/api/write.ts     → Write handler implementations
 *   - src/index.ts         → Top-level routing + security layers
 */

export function createApiApp(options: ApiAppOptions = {}) {
  const app = new Hono<{ Bindings: Env }>();
  const facilitatorClient = options.facilitatorClient;

  const withPayment = (price: number, description: string, handler: any) =>
    withX402Payment(price, description, handler, facilitatorClient ? { facilitatorClient } : undefined);

  // Health / info for the API surface
  app.get('/', (c) => {
    const requireBasic = c.env.API_REQUIRE_BASIC_AUTH !== 'false';
    return jsonResponse({
      status: 'ok',
      message: 'Clocktower REST API',
      version: 'x402-primary',
      auth: {
        x402: 'required (primary & non-bypassable)',
        basicAuth: requireBasic ? 'optional (enabled via flag)' : 'disabled',
      },
      note: 'x402 is the primary and required layer on all routes.',
    });
  });

  // === Read Endpoints (all protected with x402) ===

  app.get('/api/protocol/state', withPayment(
    API_PRICES.protocolState,
    'Get Clocktower protocol state',
    async (c: any) => {
      return await handleGetProtocolState(c.env);
    }
  ));

  app.get('/api/subscriptions/due', withPayment(
    API_PRICES.getSubscriptionsDue,
    'Get subscriptions due on a given day',
    async (c: any) => {
      const dayNumber = c.req.query('dayNumber');
      const frequency = c.req.query('frequency');
      return await handleGetSubscriptionsDue(c.env, dayNumber ?? null, frequency ?? null);
    }
  ));

  app.get('/api/subscriptions/:id', withPayment(
    API_PRICES.getSubscription,
    'Get a single subscription by ID',
    async (c: any) => {
      const id = c.req.param('id');
      return await handleGetSubscription(c.env, id);
    }
  ));

  app.get('/api/subscriptions/:id/subscribers', withPayment(
    API_PRICES.getSubscribers,
    'Get subscribers for a subscription',
    async (c: any) => {
      const id = c.req.param('id');
      return await handleGetSubscribers(c.env, id);
    }
  ));

  app.get('/api/accounts/:address/subscriptions', withPayment(
    API_PRICES.getAccountSubscriptions,
    'Get subscriptions for an account',
    async (c: any) => {
      const address = c.req.param('address');
      const bySubscriber = c.req.query('bySubscriber');
      return await handleGetAccountSubscriptions(c.env, address, bySubscriber ?? null);
    }
  ));

  app.get('/api/approved-tokens/:token', withPayment(
    API_PRICES.getApprovedToken,
    'Get approved token configuration',
    async (c: any) => {
      const token = c.req.param('token');
      return await handleGetApprovedToken(c.env, token);
    }
  ));

  // List of approved tokens (lightly managed static list)
  app.get('/api/approved-tokens', withPayment(
    API_PRICES.getApprovedToken, // reuse same pricing for now
    'List approved tokens',
    async () => handleListApprovedTokens()
  ));

  // Fee balance for a specific subscription + subscriber
  app.get('/api/subscriptions/:id/fee-balance', withPayment(
    API_PRICES.getApprovedToken,
    'Get fee balance for subscription',
    async (c: any) => {
      const id = c.req.param('id');
      const address = c.req.query('address');
      return await handleGetFeeBalance(c.env, id, address ?? '');
    }
  ));

  // Full account view — rich enriched data with subscribedTo + created arrays
  app.get('/api/accounts/:address', withPayment(
    API_PRICES.getAccountSubscriptions,
    'Get full enriched account overview (subscribedTo + created)',
    async (c: any) => {
      const address = c.req.param('address');
      return await handleGetAccount(c.env, address);
    }
  ));

  // Catch-all for unknown routes under /api
  app.all('*', (c) => {
    return Errors.notFound('Not Found');
  });

  // Lightweight status endpoint for the API surface
  app.get('/api/status', (c) => {
    return jsonResponse({
      status: 'ok',
      service: 'clocktower-rest-api',
      x402: 'required (primary)',
      version: 'x402-primary',
    });
  });

  // === Write Endpoints (POST) ===
  // All write endpoints are wrapped with x402.

  app.post('/api/check_subscribe_readiness', withPayment(
    API_PRICES.checkSubscribeReadiness,
    'Check subscribe readiness',
    async (c: any) => writeHandlers.handleCheckSubscribeReadiness(c)
  ));

  app.post('/api/prepare/create_subscription', withPayment(
    API_PRICES.prepareCreateSubscription,
    'Prepare create subscription',
    async (c: any) => writeHandlers.handlePrepareCreateSubscription(c)
  ));

  app.post('/api/prepare/subscribe', withPayment(
    API_PRICES.prepareSubscribe,
    'Prepare subscribe transaction(s)',
    async (c: any) => writeHandlers.handlePrepareSubscribe(c)
  ));

  app.post('/api/prepare/cancel_subscription', withPayment(
    API_PRICES.prepareCancelSubscription,
    'Prepare cancel subscription',
    async (c: any) => writeHandlers.handlePrepareCancelSubscription(c)
  ));

  app.post('/api/prepare/unsubscribe', withPayment(
    API_PRICES.prepareUnsubscribe,
    'Prepare unsubscribe',
    async (c: any) => writeHandlers.handlePrepareUnsubscribe(c)
  ));

  app.post('/api/prepare/unsubscribe_by_provider', withPayment(
    API_PRICES.prepareUnsubscribeByProvider,
    'Prepare unsubscribe by provider',
    async (c: any) => writeHandlers.handlePrepareUnsubscribeByProvider(c)
  ));

  app.post('/api/prepare/edit_details', withPayment(
    API_PRICES.prepareEditDetails,
    'Prepare edit details',
    async (c: any) => writeHandlers.handlePrepareEditDetails(c)
  ));

  app.post('/api/submit_signed_transactions', withPayment(
    API_PRICES.submitSignedTransactions,
    'Submit signed transactions',
    async (c: any) => writeHandlers.handleSubmitSignedTransactions(c)
  ));

  app.post('/api/transactions/status', withPayment(
    API_PRICES.getTransactionStatus,
    'Get transaction status',
    async (c: any) => writeHandlers.handleGetTransactionStatus(c)
  ));

  return app;
}

// Default production instance (no injected facilitator)
export const api = createApiApp();