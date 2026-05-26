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

export const api = new Hono<{ Bindings: Env }>();

// Health / info for the API surface (optional)
api.get('/', (c) => {
  return jsonResponse({
    status: 'ok',
    message: 'Clocktower REST API',
    version: 'stage-2',
  });
});

// Read endpoints (paths are relative to /api because we match on full pathname)
// All endpoints are now wrapped with x402 payment (early / non-live integration)

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
