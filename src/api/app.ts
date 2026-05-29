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
  handleGetSubscriptionHistory,
  handleGetAccountActivity,
  handleGetProviderProfile,
  handleGetSubscriptionDetailsHistory,
} from './read.js';
import { createX402PaymentMiddleware } from './x402.js';

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
 * - x402 is applied via the official @x402/hono middleware (see src/api/x402.ts).
 *
 * Related modules:
 *   - src/api/pricing.ts   → Centralized pricing for reads ($0.01) and writes ($0.02)
 *   - src/api/write.ts     → Write handler implementations
 *   - src/index.ts         → Top-level routing + security layers
 */

export function createApiApp(options: ApiAppOptions = {}) {
  const app = new Hono<{ Bindings: Env }>();

  // VERY EARLY DEBUG
  app.get('/api/early-debug', (c) => {
    return jsonResponse({ earlyDebug: true, timestamp: new Date().toISOString() });
  });

  // === Apply official x402 middleware (recommended approach) ===
  // This replaces the old per-route withPayment wrapping.
  const x402Middleware = createX402PaymentMiddleware(options);
  app.use('/api/*', x402Middleware);

  // Health / info for the API surface (not protected by x402)
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
      note: 'x402 is the primary and required layer on all /api routes (via @x402/hono).',
    });
  });

  // === Read Endpoints ===
  // Note: These are no longer individually wrapped. Protection comes from the middleware above.

  app.get('/api/protocol/state', async (c: any) => {
    return await handleGetProtocolState(c.env);
  });

  app.get('/api/subscriptions/due', async (c: any) => {
    const dayNumber = c.req.query('dayNumber');
    const frequency = c.req.query('frequency');
    return await handleGetSubscriptionsDue(c.env, dayNumber ?? null, frequency ?? null);
  });

  app.get('/api/subscriptions/:id', async (c: any) => {
    const id = c.req.param('id');
    return await handleGetSubscription(c.env, id);
  });

  app.get('/api/subscriptions/:id/subscribers', async (c: any) => {
    const id = c.req.param('id');
    return await handleGetSubscribers(c.env, id);
  });

  app.get('/api/accounts/:address/subscriptions', async (c: any) => {
    const address = c.req.param('address');
    const bySubscriber = c.req.query('bySubscriber');
    return await handleGetAccountSubscriptions(c.env, address, bySubscriber ?? null);
  });

  app.get('/api/approved-tokens/:token', async (c: any) => {
    const token = c.req.param('token');
    return await handleGetApprovedToken(c.env, token);
  });

  app.get('/api/approved-tokens', async () => handleListApprovedTokens());

  app.get('/api/subscriptions/:id/fee-balance', async (c: any) => {
    const id = c.req.param('id');
    const address = c.req.query('address');
    return await handleGetFeeBalance(c.env, id, address ?? '');
  });

  app.get('/api/accounts/:address', async (c: any) => {
    const address = c.req.param('address');
    return await handleGetAccount(c.env, address);
  });

  // Debug markers (useful during development)
  app.get('/api/debug-before-history', (c) => {
    return jsonResponse({ debug: 'before-history-routes', timestamp: new Date().toISOString() });
  });

  // History & Profile endpoints
  app.get('/api/subscriptions/:id/history', async (c: any) => {
    const id = c.req.param('id');
    return await handleGetSubscriptionHistory(c.env, id, c.req.query());
  });

  app.get('/api/accounts/:address/activity', async (c: any) => {
    const address = c.req.param('address');
    return await handleGetAccountActivity(c.env, address, c.req.query());
  });

  app.get('/api/providers/:address', async (c: any) => {
    const address = c.req.param('address');
    return await handleGetProviderProfile(c.env, address);
  });

  app.get('/api/subscriptions/:id/details-history', async (c: any) => {
    const id = c.req.param('id');
    return await handleGetSubscriptionDetailsHistory(c.env, id, c.req.query());
  });

  app.get('/api/debug-after-history', (c) => {
    return jsonResponse({ debug: 'after-history-routes', timestamp: new Date().toISOString() });
  });

  // Catch-all
  app.all('*', (c) => Errors.notFound('Not Found'));

  // Status (not under x402)
  app.get('/api/status', (c) => {
    return jsonResponse({
      status: 'ok',
      service: 'clocktower-rest-api',
      x402: 'required (primary) via @x402/hono',
      version: 'x402-official-middleware',
    });
  });

  app.get('/api/debug-version', (c) => {
    return jsonResponse({
      debug: true,
      timestamp: new Date().toISOString(),
      message: 'Migrated to official @x402/hono middleware',
    });
  });

  // === Write Endpoints ===
  app.post('/api/check_subscribe_readiness', async (c: any) => writeHandlers.handleCheckSubscribeReadiness(c));
  app.post('/api/prepare/create_subscription', async (c: any) => writeHandlers.handlePrepareCreateSubscription(c));
  app.post('/api/prepare/subscribe', async (c: any) => writeHandlers.handlePrepareSubscribe(c));
  app.post('/api/prepare/cancel_subscription', async (c: any) => writeHandlers.handlePrepareCancelSubscription(c));
  app.post('/api/prepare/unsubscribe', async (c: any) => writeHandlers.handlePrepareUnsubscribe(c));
  app.post('/api/prepare/unsubscribe_by_provider', async (c: any) => writeHandlers.handlePrepareUnsubscribeByProvider(c));
  app.post('/api/prepare/edit_details', async (c: any) => writeHandlers.handlePrepareEditDetails(c));
  app.post('/api/submit_signed_transactions', async (c: any) => writeHandlers.handleSubmitSignedTransactions(c));
  app.post('/api/transactions/status', async (c: any) => writeHandlers.handleGetTransactionStatus(c));

  return app;
}

// Default production instance (no injected facilitator)
export const api = createApiApp();