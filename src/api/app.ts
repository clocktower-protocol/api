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
api.get('/api/protocol/state', async (c) => {
  return await handleGetProtocolState(c.env);
});

api.get('/api/subscriptions/due', async (c) => {
  const dayNumber = c.req.query('dayNumber');
  const frequency = c.req.query('frequency');
  return await handleGetSubscriptionsDue(c.env, dayNumber ?? null, frequency ?? null);
});

api.get('/api/subscriptions/:id', async (c) => {
  const id = c.req.param('id');
  return await handleGetSubscription(c.env, id);
});

api.get('/api/subscriptions/:id/subscribers', async (c) => {
  const id = c.req.param('id');
  return await handleGetSubscribers(c.env, id);
});

api.get('/api/accounts/:address/subscriptions', async (c) => {
  const address = c.req.param('address');
  const bySubscriber = c.req.query('bySubscriber');
  return await handleGetAccountSubscriptions(c.env, address, bySubscriber ?? null);
});

api.get('/api/tokens/:token', async (c) => {
  const token = c.req.param('token');
  return await handleGetApprovedToken(c.env, token);
});

// Catch-all for unknown routes under /api
api.all('*', (c) => {
  return Errors.notFound('Not Found');
});
