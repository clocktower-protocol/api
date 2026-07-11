import { Hono } from 'hono';
import { isApiEnabled } from '../config/apiAccess.js';
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
import { handleAuthChallenge, handleAuthVerify } from './auth.js';
import { withPublicCacheHeaders } from '../rpcCache.js';

// Write handlers
import * as writeHandlers from './write.js';

export type ApiAppOptions = Record<string, never>;

/**
 * Clocktower REST API
 *
 * This module defines the REST API surface mounted under `/api`.
 *
 * === Authentication Model ===
 * REST `/api/*` is free with tiered rate limits (see src/index.ts).
 * Builder subscribers authenticate via SIWE session (Bearer token).
 * MCP `/mcp` remains x402-gated for agents.
 *
 * === Current Endpoints ===
 * REST is free with tiered rate limits (or Builder SIWE session). MCP uses x402.
 *
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
 * Write (prepare-only; client wallet signs and broadcasts):
 *   - POST /api/check_subscribe_readiness
 *   - POST /api/check_subscribe_readiness_by_id
 *   - POST /api/prepare/create_subscription
 *   - POST /api/prepare/subscribe
 *   - POST /api/prepare/subscribe_by_id
 *   - POST /api/prepare/cancel_subscription
 *   - POST /api/prepare/cancel_subscription_by_id
 *   - POST /api/prepare/unsubscribe
 *   - POST /api/prepare/unsubscribe_by_id
 *   - POST /api/prepare/unsubscribe_by_provider
 *   - POST /api/prepare/unsubscribe_by_provider_by_id
 *   - POST /api/prepare/edit_details
 *   - POST /api/check_remit_readiness
 *   - POST /api/prepare/remit
 *   - POST /api/transactions/status
 *
 * Auth: POST /api/auth/challenge, POST /api/auth/verify
 *
 * Related modules:
 *   - src/api/pricing.ts   → Centralized pricing
 *   - src/api/x402.ts      → @x402/hono middleware + route prices
 *   - src/api/write.ts     → Write handler implementations
 *   - src/index.ts         → Top-level routing + security layers
 */

export function createApiAppForEnv(_env: Env, options: ApiAppOptions = {}) {
  return createApiApp(options);
}

export function createApiApp(_options: ApiAppOptions = {}) {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/', (c) => {
    const requireBasic = c.env.API_REQUIRE_BASIC_AUTH !== 'false';
    return jsonResponse({
      status: 'ok',
      message: 'Clocktower REST API',
      version: 'tiered-access',
      auth: {
        rest: 'free with rate limits, or Builder SIWE session',
        mcp: 'x402 required on /mcp',
        basicAuth: requireBasic ? 'optional (enabled via flag)' : 'disabled',
      },
    });
  });

  app.post('/api/auth/challenge', async (c: any) => handleAuthChallenge(c.req.raw, c.env));
  app.post('/api/auth/verify', async (c: any) => handleAuthVerify(c.req.raw, c.env));

  // === Read endpoints ===

  app.get('/api/catalog', (c: any) => handleGetCatalog(c.env));

  app.get('/api/protocol/state', async (c: any) => {
    const lane = c.req.header('X-Clocktower-Lane') ?? 'free';
    const response = await handleGetProtocolState(c.env);
    return lane === 'free' ? withPublicCacheHeaders(response) : response;
  });

  app.get('/api/subscriptions/due', async (c: any) => {
    const dayNumber = c.req.query('dayNumber');
    const frequency = c.req.query('frequency');
    return await handleGetSubscriptionsDue(c.env, dayNumber ?? null, frequency ?? null);
  });

  app.get('/api/subscriptions', async (c: any) => {
    return await handleSearchSubscriptions(
      c.env,
      c.req.query(),
      c.req.header('X-Clocktower-Lane'),
    );
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
  app.post('/api/check_subscribe_readiness_by_id', async (c: any) => writeHandlers.handleCheckSubscribeReadinessById(c));
  app.post('/api/prepare/create_subscription', async (c: any) => writeHandlers.handlePrepareCreateSubscription(c));
  app.post('/api/prepare/subscribe', async (c: any) => writeHandlers.handlePrepareSubscribe(c));
  app.post('/api/prepare/subscribe_by_id', async (c: any) => writeHandlers.handlePrepareSubscribeById(c));
  app.post('/api/prepare/cancel_subscription', async (c: any) => writeHandlers.handlePrepareCancelSubscription(c));
  app.post('/api/prepare/cancel_subscription_by_id', async (c: any) => writeHandlers.handlePrepareCancelSubscriptionById(c));
  app.post('/api/prepare/unsubscribe', async (c: any) => writeHandlers.handlePrepareUnsubscribe(c));
  app.post('/api/prepare/unsubscribe_by_id', async (c: any) => writeHandlers.handlePrepareUnsubscribeById(c));
  app.post('/api/prepare/unsubscribe_by_provider', async (c: any) => writeHandlers.handlePrepareUnsubscribeByProvider(c));
  app.post('/api/prepare/unsubscribe_by_provider_by_id', async (c: any) => writeHandlers.handlePrepareUnsubscribeByProviderById(c));
  app.post('/api/prepare/edit_details', async (c: any) => writeHandlers.handlePrepareEditDetails(c));
  app.post('/api/check_remit_readiness', async (c: any) => writeHandlers.handleCheckRemitReadiness(c));
  app.post('/api/prepare/remit', async (c: any) => writeHandlers.handlePrepareRemit(c));
  app.post('/api/transactions/status', async (c: any) => writeHandlers.handleGetTransactionStatus(c));

  app.get('/api/status', (c) => {
    const apiEnabled = isApiEnabled(c.env);
    return jsonResponse({
      status: apiEnabled ? 'ok' : 'disabled',
      service: 'clocktower-rest-api',
      apiEnabled,
      lane: c.req.header('X-Clocktower-Lane') ?? 'free',
    });
  });

  // Catch-all must be registered last (Hono first-match wins)
  app.all('*', (c) => Errors.notFound('Not Found'));

  return app;
}

// Default production instance (no injected facilitator)
export const api = createApiApp();
