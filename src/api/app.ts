import { Hono } from 'hono';
import { Errors, jsonResponse } from './responses.js';
import {
  handleGetProtocolState,
  handleGetSubscription,
  handleGetAccountSubscriptions,
  handleGetSubscribers,
  handleGetApprovedToken,
  handleGetSubscriptionsDue,
} from './read.js';
import { withX402Payment } from './x402.js';
import { API_PRICES } from './pricing.js';

// Write handlers (will be expanded)
import * as writeHandlers from './write.js';

/**
 * Clocktower REST API — Current Status
 *
 * This module defines the REST API surface mounted under `/api`.
 *
 * === Authentication Model (Transition in Progress) ===
 * Goal: Move toward Design B where x402 becomes the primary (and eventually the only) auth/payment layer.
 *
 * Current state:
 *   - x402 micropayments are the **primary and non-bypassable** authorization mechanism on all routes.
 *   - Basic Auth is still applied by default (controlled by `API_REQUIRE_BASIC_AUTH`).
 *     - Default (`true` or unset) → Basic Auth is required for /api routes.
 *     - `false` → Basic Auth is optional for /api (x402 remains mandatory).
 *   - IP rate limiting still applies.
 *
 * This design allows us to keep Basic Auth on for development/testing while gradually shifting
 * trust and enforcement to x402.
 *
 * === Current Endpoints ===
 * Read endpoints (all protected with x402):
 *   - GET /api/protocol/state
 *   - GET /api/subscriptions/due
 *   - GET /api/subscriptions/:id
 *   - GET /api/subscriptions/:id/subscribers
 *   - GET /api/accounts/:address/subscriptions
 *   - GET /api/tokens/:token
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
 * - x402 is the intended long-term primary auth layer for the REST API.
 * - Basic Auth is currently enabled by default as a temporary measure during the transition.
 *   It can be disabled for /api routes via `API_REQUIRE_BASIC_AUTH=false`.
 * - Write endpoints are implemented but may still receive further validation and response polish.
 *
 * See also:
 *   - src/api/x402.ts      → Core x402 payment wrapper (`withX402Payment`)
 *   - src/api/pricing.ts   → Pricing configuration for reads and writes
 *   - src/api/responses.ts → Consistent success/error response helpers
 *   - src/index.ts         → Top-level routing and auth layering
 */

export const api = new Hono<{ Bindings: Env }>();

// Health / info for the API surface
api.get('/', (c) => {
  const requireBasic = c.env.API_REQUIRE_BASIC_AUTH !== 'false';
  return jsonResponse({
    status: 'ok',
    message: 'Clocktower REST API',
    version: 'x402-primary',
    auth: {
      x402: 'required (primary & non-bypassable)',
      basicAuth: requireBasic ? 'required (default)' : 'optional',
    },
    note: 'x402 is the intended primary layer. Basic Auth is currently kept on by default for safety.',
  });
});

// === Read Endpoints (all protected with x402) ===

api.get('/api/protocol/state', withX402Payment(
  API_PRICES.protocolState,
  'Get Clocktower protocol state',
  async (c) => {
    return await handleGetProtocolState(c.env);
  }
));

api.get('/api/subscriptions/due', withX402Payment(
  API_PRICES.getSubscriptionsDue,
  'Get subscriptions due on a given day',
  async (c) => {
    const dayNumber = c.req.query('dayNumber');
    const frequency = c.req.query('frequency');
    return await handleGetSubscriptionsDue(c.env, dayNumber ?? null, frequency ?? null);
  }
));

api.get('/api/subscriptions/:id', withX402Payment(
  API_PRICES.getSubscription,
  'Get a single subscription by ID',
  async (c) => {
    const id = c.req.param('id');
    return await handleGetSubscription(c.env, id);
  }
));

api.get('/api/subscriptions/:id/subscribers', withX402Payment(
  API_PRICES.getSubscribers,
  'Get subscribers for a subscription',
  async (c) => {
    const id = c.req.param('id');
    return await handleGetSubscribers(c.env, id);
  }
));

api.get('/api/accounts/:address/subscriptions', withX402Payment(
  API_PRICES.getAccountSubscriptions,
  'Get subscriptions for an account',
  async (c) => {
    const address = c.req.param('address');
    const bySubscriber = c.req.query('bySubscriber');
    return await handleGetAccountSubscriptions(c.env, address, bySubscriber ?? null);
  }
));

api.get('/api/tokens/:token', withX402Payment(
  API_PRICES.getApprovedToken,
  'Get approved token configuration',
  async (c) => {
    const token = c.req.param('token');
    return await handleGetApprovedToken(c.env, token);
  }
));

// Catch-all for unknown routes under /api
api.all('*', (c) => {
  return Errors.notFound('Not Found');
});

// Lightweight status endpoint for the API surface
api.get('/api/status', (c) => {
  return jsonResponse({
    status: 'ok',
    service: 'clocktower-rest-api',
    x402: 'enabled',
  });
});

// === Write Endpoints (POST) ===
// All write endpoints will be wrapped with x402 at higher prices.
// They will delegate to src/tx/prepare.ts and src/tx/submit.ts.

// Write routes - all protected by x402
api.post('/api/check_subscribe_readiness', withX402Payment(
  API_PRICES.checkSubscribeReadiness,
  'Check subscribe readiness',
  async (c) => writeHandlers.handleCheckSubscribeReadiness(c)
));

api.post('/api/prepare/create_subscription', withX402Payment(
  API_PRICES.prepareCreateSubscription,
  'Prepare create subscription',
  async (c) => writeHandlers.handlePrepareCreateSubscription(c)
));

api.post('/api/prepare/subscribe', withX402Payment(
  API_PRICES.prepareSubscribe,
  'Prepare subscribe transaction(s)',
  async (c) => writeHandlers.handlePrepareSubscribe(c)
));

api.post('/api/prepare/cancel_subscription', withX402Payment(
  API_PRICES.prepareCancelSubscription,
  'Prepare cancel subscription',
  async (c) => writeHandlers.handlePrepareCancelSubscription(c)
));

api.post('/api/prepare/unsubscribe', withX402Payment(
  API_PRICES.prepareUnsubscribe,
  'Prepare unsubscribe',
  async (c) => writeHandlers.handlePrepareUnsubscribe(c)
));

api.post('/api/prepare/unsubscribe_by_provider', withX402Payment(
  API_PRICES.prepareUnsubscribeByProvider,
  'Prepare unsubscribe by provider',
  async (c) => writeHandlers.handlePrepareUnsubscribeByProvider(c)
));

api.post('/api/prepare/edit_details', withX402Payment(
  API_PRICES.prepareEditDetails,
  'Prepare edit details',
  async (c) => writeHandlers.handlePrepareEditDetails(c)
));

api.post('/api/submit_signed_transactions', withX402Payment(
  API_PRICES.submitSignedTransactions,
  'Submit signed transactions',
  async (c) => writeHandlers.handleSubmitSignedTransactions(c)
));

api.post('/api/transactions/status', withX402Payment(
  API_PRICES.getTransactionStatus,
  'Get transaction status',
  async (c) => writeHandlers.handleGetTransactionStatus(c)
));
