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
  handleGetSubscriptionDetails,
  handleGetSubscriptionDetailsHistory,
} from './read.js';
import { handleGetCatalog } from './catalog.js';
import { handleSearchSubscriptions } from './discovery.js';
import { createMockFacilitatorClient } from './mockFacilitator.js';
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
 * authorization + payment layer on every `/api/*` route (including `/api/status`).
 *
 * Basic Auth (`API_REQUIRE_BASIC_AUTH`) is an optional extra safety layer for local
 * manual testing only. Production default is `false` in wrangler.jsonc (x402-only).
 *
 * IP rate limiting still applies on top (see src/index.ts).
 *
 * === Current Endpoints (all x402-protected unless noted) ===
 * Read:
 *   - GET /api/catalog
 *   - GET /api/protocol/state
 *   - GET /api/subscriptions/due
 *   - GET /api/subscriptions
 *   - GET /api/subscriptions/:id/details
 *   - GET /api/subscriptions/:id
 *   - GET /api/subscriptions/:id/subscribers
 *   - GET /api/subscriptions/:id/fee-balance
 *   - GET /api/accounts/:address/subscriptions
 *   - GET /api/accounts/:address
 *   - GET /api/approved-tokens
 *   - GET /api/approved-tokens/:token
 *   - GET /api/subscriptions/:id/history
 *   - GET /api/accounts/:address/activity
 *   - GET /api/providers/:address
 *   - GET /api/subscriptions/:id/details-history
 *   - GET /api/status
 *
 * Write:
 *   - POST /api/check_subscribe_readiness
 *   - POST /api/prepare/create_subscription
 *   - POST /api/prepare/subscribe
 *   - POST /api/prepare/cancel_subscription
 *   - POST /api/prepare/unsubscribe
 *   - POST /api/prepare/unsubscribe_by_provider
 *   - POST /api/prepare/edit_details
 *   - POST /api/check_remit_readiness
 *   - POST /api/prepare/remit
 *   - POST /api/transactions/status
 *
 * Not x402-protected: GET / (API discovery only)
 *
 * Related modules:
 *   - src/api/pricing.ts   → Centralized pricing
 *   - src/api/x402.ts      → @x402/hono middleware + route prices
 *   - src/api/write.ts     → Write handler implementations
 *   - src/index.ts         → Top-level routing + security layers
 */

export function createApiAppForEnv(env: Env, options: ApiAppOptions = {}) {
  const facilitatorClient =
    options.facilitatorClient ??
    (env.X402_USE_MOCK_FACILITATOR === 'true' ? createMockFacilitatorClient() : undefined);
  return createApiApp({ ...options, facilitatorClient });
}

export function createApiApp(options: ApiAppOptions = {}) {
  const app = new Hono<{ Bindings: Env }>();

  const x402Middleware = createX402PaymentMiddleware(options);
  app.use('/api/*', x402Middleware);

  // API discovery (not under /api — no x402)
  app.get('/', (c) => {
    const requireBasic = c.env.API_REQUIRE_BASIC_AUTH !== 'false';
    return jsonResponse({
      status: 'ok',
      message: 'Clocktower REST API',
      version: 'x402-primary',
      auth: {
        x402: 'required on all /api routes (via @x402/hono)',
        basicAuth: requireBasic ? 'optional (enabled via flag)' : 'disabled',
      },
    });
  });

  // === Read endpoints ===

  app.get('/api/catalog', () => handleGetCatalog());

  app.get('/api/protocol/state', async (c: any) => {
    return await handleGetProtocolState(c.env);
  });

  app.get('/api/subscriptions/due', async (c: any) => {
    const dayNumber = c.req.query('dayNumber');
    const frequency = c.req.query('frequency');
    return await handleGetSubscriptionsDue(c.env, dayNumber ?? null, frequency ?? null);
  });

  app.get('/api/subscriptions', async (c: any) => {
    return await handleSearchSubscriptions(c.env, c.req.query());
  });

  app.get('/api/subscriptions/:id/details', async (c: any) => {
    const id = c.req.param('id');
    return await handleGetSubscriptionDetails(c.env, id);
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

  app.get('/api/approved-tokens', async (c: any) => handleListApprovedTokens(c.env));

  app.get('/api/subscriptions/:id/fee-balance', async (c: any) => {
    const id = c.req.param('id');
    const address = c.req.query('address');
    return await handleGetFeeBalance(c.env, id, address ?? '');
  });

  app.get('/api/accounts/:address', async (c: any) => {
    const address = c.req.param('address');
    return await handleGetAccount(c.env, address);
  });

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

  // === Write endpoints ===

  app.post('/api/check_subscribe_readiness', async (c: any) => writeHandlers.handleCheckSubscribeReadiness(c));
  app.post('/api/prepare/create_subscription', async (c: any) => writeHandlers.handlePrepareCreateSubscription(c));
  app.post('/api/prepare/subscribe', async (c: any) => writeHandlers.handlePrepareSubscribe(c));
  app.post('/api/prepare/cancel_subscription', async (c: any) => writeHandlers.handlePrepareCancelSubscription(c));
  app.post('/api/prepare/unsubscribe', async (c: any) => writeHandlers.handlePrepareUnsubscribe(c));
  app.post('/api/prepare/unsubscribe_by_provider', async (c: any) => writeHandlers.handlePrepareUnsubscribeByProvider(c));
  app.post('/api/prepare/edit_details', async (c: any) => writeHandlers.handlePrepareEditDetails(c));
  app.post('/api/check_remit_readiness', async (c: any) => writeHandlers.handleCheckRemitReadiness(c));
  app.post('/api/prepare/remit', async (c: any) => writeHandlers.handlePrepareRemit(c));
  app.post('/api/transactions/status', async (c: any) => writeHandlers.handleGetTransactionStatus(c));

  // x402-protected service status
  app.get('/api/status', (c) => {
    return jsonResponse({
      status: 'ok',
      service: 'clocktower-rest-api',
      x402: 'required via @x402/hono',
    });
  });

  // Catch-all must be registered last (Hono first-match wins)
  app.all('*', (c) => Errors.notFound('Not Found'));

  return app;
}

// Default production instance (no injected facilitator)
export const api = createApiApp();
