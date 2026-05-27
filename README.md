# Clocktower MCP

Clocktower MCP is a Cloudflare Workers-based server that provides access to the Clocktower Protocol (a subscription management system on Base) through both the Model Context Protocol (MCP) and a REST API.

All access is protected by x402 micropayments using USDC on Base.

## Overview

- **Protocol**: Clocktower on Base mainnet (eip155:8453)
- **Payments**: x402 (USDC micropayments)
- **Hosting**: Cloudflare Workers + Durable Objects
- **Interfaces**:
  - MCP Server (for AI agents and MCP clients)
  - REST API (for direct HTTP integration)

---

## MCP Server

The MCP server exposes tools that AI agents can call to interact with the Clocktower protocol.

### Connection

Connect using any MCP-compatible client by pointing it at the `/mcp` endpoint of your deployed worker:

```
https://your-worker.your-subdomain.workers.dev/mcp
```

### Tools

Tools are organized into two categories:

**Read Tools** (all priced at $0.01):
- `get_protocol_state` — View current fee configuration
- `get_subscription` — Fetch a single subscription by ID
- `get_account_subscriptions` — List subscriptions for an account (as provider or subscriber)
- `get_subscribers` — List subscribers and fee balances for a subscription
- `get_approved_token` — Check configuration for an approved ERC-20 token
- `get_subscriptions_due` — Query subscriptions due on a given day/frequency

**Write Tools** (priced at $0.01–$0.02):
- Prepare tools for creating, subscribing, editing, cancelling, and unsubscribing
- `submit_signed_transactions` — Submit previously prepared and signed transactions

All write operations follow a prepare → sign → submit flow and include on-chain simulation before any payment is settled.

### Payments (MCP)

All MCP tools are paid using the x402 protocol. Your MCP client must support sending USDC payments on Base when calling tools.

---

## REST API

The REST API provides the same capabilities as the MCP tools over standard HTTP, protected by x402.

**Base URL**: `https://your-worker.your-subdomain.workers.dev/api`

### Authentication

**x402 is the primary and required authentication method.** Every request to the REST API must include a valid x402 payment header (`X-Payment`) using USDC on Base.

### Endpoints

#### Read Endpoints (GET) — $0.01 each

| Endpoint | Description |
|----------|-------------|
| `GET /api/protocol/state` | Current protocol fee configuration |
| `GET /api/subscriptions/due` | Subscriptions due on a given day/frequency |
| `GET /api/subscriptions/:id` | Single subscription by ID |
| `GET /api/subscriptions/:id/subscribers` | Subscribers for a subscription |
| `GET /api/accounts/:address/subscriptions` | Subscriptions for an account |
| `GET /api/tokens/:token` | Approved token configuration |

#### Write Endpoints (POST)

| Endpoint | Price | Description |
|----------|-------|-------------|
| `POST /api/check_subscribe_readiness` | $0.01 | Validate whether an account can subscribe |
| `POST /api/prepare/create_subscription` | $0.02 | Prepare a new subscription |
| `POST /api/prepare/subscribe` | $0.02 | Prepare subscribing to an existing subscription |
| `POST /api/prepare/cancel_subscription` | $0.02 | Prepare cancelling a subscription |
| `POST /api/prepare/unsubscribe` | $0.02 | Prepare unsubscribing from a subscription |
| `POST /api/prepare/unsubscribe_by_provider` | $0.02 | Prepare provider-initiated unsubscribe |
| `POST /api/prepare/edit_details` | $0.02 | Prepare editing subscription details |
| `POST /api/submit_signed_transactions` | $0.02 | Submit previously prepared + signed transactions |
| `POST /api/transactions/status` | $0.01 | Check status of a submitted transaction |

### Pricing

- Read operations: **$0.01**
- Write preparation and submission operations: **$0.02**
- `check_subscribe_readiness` and transaction status: **$0.01**

All prices are paid in USDC on Base via x402.

### Error Format

All errors return a consistent JSON shape:

```json
{
  "error": "Human readable message",
  "code": "VALIDATION_ERROR" | "NOT_FOUND" | "UPSTREAM_ERROR" | "RATE_LIMITED"
}
```

Validation errors on write endpoints may also include an `issues` array with field-level details.

### Status Endpoints

- `GET /api/` — Basic information about the REST API surface
- `GET /api/status` — Lightweight health/status check

---

## Getting Started

### Environment Variables

Required for both MCP and REST:

| Variable | Description |
|----------|-------------|
| `ALCHEMY_API_KEY` | Alchemy API key for Base |
| `CLOCKTOWER_ADDRESS` | Deployed Clocktower contract address |
| `X402_RECIPIENT` | Address that receives x402 payments |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | Rate limiting configuration |

Optional:

- `API_REQUIRE_BASIC_AUTH` — Set to `true` to enable Basic Auth on the REST API (for development only)

### Deployment

This project is designed for Cloudflare Workers:

```bash
npm install
wrangler deploy
```

Configure secrets using `wrangler secret put`.

### Payments

Both the MCP server and REST API require valid x402 payments in USDC on Base for every operation. See the [x402 specification](https://github.com/coinbase/x402) for client implementation details.

---

## Development

The project includes a comprehensive test suite using Vitest + Cloudflare's test pool.

```bash
npm test
```

Tests default to x402-primary mode.

---

## Security & Rate Limiting

- IP-based rate limiting
- Geo-blocking support
- All write operations are simulated before payment settlement
- Payments are only settled on successful handler execution

For security-related notes, see `SECURITY_FOLLOWUPS.md`.

---

## License

Private project.