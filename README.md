# Clocktower API

**Repository:** [github.com/clocktower-protocol/api](https://github.com/clocktower-protocol/api)

> **Status:** Pre-release. There is no public production API yet. The documentation below describes the intended interface; endpoints, limits, and auth flows may change before launch.

Clocktower API is a Cloudflare Workers-based server that provides access to the Clocktower Protocol (a subscription management system) through a REST API and the Model Context Protocol (MCP). The Worker name is `clocktower-api` (see `wrangler.jsonc`). REST can select a protocol chain; MCP is Base-only because of x402.

Access uses **REST** lanes (free IP, developer API key) and **MCP** (x402 for agents — not API keys).

**Jump to:** [MCP Server](#mcp-server) · [REST API](#rest-api)

## Production hosts

One Cloudflare Worker serves both surfaces on dedicated subdomains:

| Host | Surface | Example |
|------|---------|---------|
| `https://api.clocktower.finance` | REST API | `GET /catalog`, `GET /protocol/state` |
| `https://mcp.clocktower.finance` | MCP (x402) | `GET /` or `GET /mcp` |

On the API host, paths **omit** the `/api` prefix (e.g. `GET /catalog` instead of `GET /api/catalog`). Legacy `*.workers.dev` URLs keep the `/api` and `/mcp` path prefixes for local dev and staging.

## Overview

- **Protocol**: Clocktower on Base mainnet today (`eip155:8453`). REST accepts optional `?chainId=` (decimal or CAIP-2); omitted uses `DEFAULT_REST_CHAIN_ID` (default 8453). MCP and x402 stay on Base.
- **Hosting**: Cloudflare Workers + Durable Objects
- **Interfaces**:
  - MCP Server at `mcp.clocktower.finance` (for AI agents — x402 USDC micropayments)
  - REST API at `api.clocktower.finance` (free IP limits, free developer API keys)

## Access tiers

| Lane | Surface | Auth | Default limits (approx.) |
|------|---------|------|---------------------------|
| **Free** | REST | None (IP) | 20 rpm; expensive 3 rpm; subgraph 100/day; **prepare 2/min · 20/day**; **500 req/day**; search `first` ≤ 10; no `includeDetails` |
| **Developer** | REST | API key `Authorization: Bearer ctk_…` | 80 rpm; expensive 40; subgraph 3k/day; **prepare 5/min · 100/day**; **5k req/day**; search `first` ≤ 25; `includeDetails` allowed |
| **Agent** | MCP | x402 (USDC on Base) | 300 rpm; write 60/min — **not API keys** |

- **Free**: Highly metered try-without-signup path. Exploration and light reads.
- **Developer**: Free API keys for integrators — **higher read limits**. Keys are **hashed at rest**; plaintext shown **once** on create. Mint/list/revoke is **admin/portal-only** (`DEVELOPER_KEYS_ADMIN_SECRET`) via `POST/GET/DELETE /developer/keys` (GET without `subjectId` lists all keys; GET `/:id` returns one).
- **Prepare / readiness** (free + developer): intentionally tight. Full prepare runs on-chain **simulation + gas estimate** (Alchemy cost) even though the server never relays the tx. For **production write volume**, use the **SDK with your own RPC**. Free/developer keys are not a free dry-run farm.
- **MCP**: Unchanged x402 micropayments. Do not send `ctk_` keys to MCP for auth.

**Abuse / DoS controls (REST):** request body size + JSON depth caps; per-lane Durable Object rate limits (global / expensive / write RPM / **write daily** / subgraph daily / **daily total**); secondary **IP ceiling**; **auth-fail RPM** on invalid `ctk_` keys (401, not free fallback); max keys per subject; admin create rate limits.

**Observability:** structured `api_access` JSON logs (keyId/lane/route/status — never full API keys) for Workers Logs and Logpush; **Analytics Engine** dataset `api_analytics` for SQL monitoring; hourly cron can alert via `ALERT_WEBHOOK_URL` when `CF_ACCOUNT_ID` + `CF_API_TOKEN` are set. Configure Logpush → R2 with a 90-day lifecycle for retention.

See `GET /api/catalog` (or `/catalog` on the api host) for the machine-readable tier manifest.

---

## MCP Server

The MCP server exposes tools that AI agents can call to interact with the Clocktower protocol.

### Connection

Connect using any MCP-compatible client:

```
https://mcp.clocktower.finance/
```

Staging / local dev (path-based):

```
https://your-worker.your-subdomain.workers.dev/mcp
```

### Tools

Tools are organized into two categories:

**MCP x402 pricing** (USD, USDC on Base). REST `/api` is free (rate-limited). Canonical values live in `src/api/pricing.ts`.

| Tool | MCP price |
|------|-----------|
| `get_protocol_state`, `get_subscription`, `get_account_subscriptions`, `get_subscribers`, `get_approved_token`, `list_approved_tokens`, `get_fee_balance` | $0.01 |
| `get_subscriptions_due` | $0.02 |
| **`get_account`** (enriched; fee balance per subscribed sub) | **$0.03** |
| `get_subscription_details`, `get_provider_profile` | $0.02 |
| `get_subscription_history` | **$0.03** + **$0.01 per 50 rows** (`first`, max 200 → $0.06) |
| `get_subscription_details_history` | **$0.02** + **$0.01 per 50 rows** (max → $0.05) |
| `get_account_activity` | **$0.04** + **$0.01 per 50 rows** (max → $0.07; two subgraph queries) |
| `search_subscriptions` | **$0.05** + **$0.01 × `first`** (max 50) + **$0.01** if `includeDetails` |
| `check_subscribe_readiness`, `get_transaction_status` | $0.01 |
| `check_remit_readiness` | $0.02 |
| `prepare_*` full (simulation + gas) | $0.02 |
| `prepare_*` with `readinessOnly: true` | $0.01 (remit: $0.02) |
| `prepare_remit` full | $0.03 |

**Read Tools**
- `get_protocol_state` — View current fee configuration
- `get_subscription` — Fetch a single subscription by ID
- `get_account_subscriptions` — List subscriptions for an account (as provider or subscriber)
- `get_account` — Full enriched account view with two arrays: `subscribedTo` (subscriptions you pay into, including your fee balances) and `created` (subscriptions you created as provider)
- `get_fee_balance` — Get your current fee balance on a specific subscription
- `get_subscribers` — List subscribers and fee balances for a subscription
- `get_approved_token` — Check configuration for an approved ERC-20 token (on-chain)
- `list_approved_tokens` — List approved ERC-20 tokens with on-chain `minimum` and `paused` per token
- `get_subscriptions_due` — Query subscriptions due on a given day/frequency (single-day probe; uses the same Multicall3 scan helper as remit readiness)

**Discovery Tools** (subgraph + on-chain enrichment):
- `search_subscriptions` — Browse/discover subscriptions. Filters: `provider`, `token`, `frequency`, `cancelled`, `includeDetails`, `first`, `skip`
- `get_subscription_details` — Current url/description for a subscription

**History & Profile Tools** (subgraph-backed via The Graph):
- `get_subscription_history` — Activity history (SubLog events) for one subscription. Supports `first`/`skip` pagination. Returns properly normalized amounts (`amount`, `amountRaw`, `tokenDecimals`), `eventName`, `formattedTimestamp`, and `formattedAmount`.
- `get_account_activity` — Merged activity across all subscriptions an account participates in (as subscriber or provider/creator). Returns breakdown stats + `hasMore`. Gracefully returns partial results if one side of the query fails.
- `get_provider_profile` — Latest provider profile (from ProvDetailsLog) with a convenience `latestProfile` object and `updatedAt` timestamp.
- `get_subscription_details_history` — History of URL/description changes (DetailsLog) for a subscription.

All history results are server-side limited (max 200 records, recommended ~100 per call) and include `hasMore` for pagination. Amounts are normalized to the token’s native decimals (consistent with the rest of the API). Subgraph failures return structured responses with an `error` field instead of failing hard.

**Write Tools**
- `check_subscribe_readiness` — Validate allowance, balance, and protocol rules before subscribing
- `prepare_create_subscription` — Prepare unsigned `createSubscription`
- `prepare_subscribe` — Prepare unsigned `subscribe` (includes ERC-20 `approve` when needed). Approve defaults to the token-native subscription amount; pass `infiniteApproval: true` for max allowance. `subscription.amount` must be a human-readable token string (e.g. `"10"`), not protocol wei.
- `prepare_subscribe_by_id` / `POST /api/prepare/subscribe_by_id` — **Preferred.** Same as prepare subscribe, but only `from` + `id` are required; amount, token, and provider are loaded from chain.
- `check_subscribe_readiness_by_id` / `POST /api/check_subscribe_readiness_by_id` — Readiness check with only `from` + `id`.
- `prepare_cancel_subscription_by_id` / `POST /api/prepare/cancel_subscription_by_id` — **Preferred.** Cancel with only `from` + `id`.
- `prepare_unsubscribe_by_id` / `POST /api/prepare/unsubscribe_by_id` — **Preferred.** Unsubscribe with only `from` + `id`.
- `prepare_unsubscribe_by_provider_by_id` / `POST /api/prepare/unsubscribe_by_provider_by_id` — **Preferred.** Provider remove with `from` + `id` + `subscriber`.
- `prepare_cancel_subscription` — Prepare provider cancel
- `prepare_unsubscribe` — Prepare subscriber unsubscribe
- `prepare_unsubscribe_by_provider` — Prepare provider-initiated unsubscribe
- `prepare_edit_details` — Prepare provider metadata edit
- `check_remit_readiness` — Multi-day scan of due subscriptions before calling `remit()`
- `prepare_remit` — Prepare permissionless `remit()` (earns caller fees in subscription ERC-20 tokens)
- `get_transaction_status` — Poll confirmation status for a transaction hash after client-side broadcast

**Write workflow:** prepare (or readiness check) → sign in wallet → broadcast from wallet → optionally poll `get_transaction_status`. The server returns unsigned calldata and never relays signed transactions. Each full prepare runs on-chain simulation and gas estimation on the selected REST chain (default Base, chainId 8453). MCP prepare still simulates on Base before x402 payment settles; failed simulation or validation throws so you are not charged.

**Remit flow:** `check_remit_readiness` → `prepare_remit` → sign → broadcast from wallet → repeat until readiness reports caught up. One `remit()` clears at most `maxRemits` subscriber payments per transaction. When the backlog needs multiple broadcasts, `preflight.expectedTransactions`, `gasSummary.backlogMultiplier`, and `warnings` describe the total gas budget. Remit can be gas-heavy on large backlogs — the caller pays gas (unlike the operator cron bot). Use `get_subscriptions_due` for a lightweight single-day read; use `check_remit_readiness` before preparing a remit tx.

#### Prepare response format

Full prepare responses (default) include:

| Field | Description |
|-------|-------------|
| `requestId` | Correlation UUID for support and logs. Not stored server-side and not required for follow-up calls. |
| `instructions` | Ordered steps for signing and broadcasting from the wallet. |
| `warnings` | Non-fatal hints (e.g. remit may need multiple transactions). |
| `unsignedTransactions` | Calldata for the wallet to sign (`to`, `data`, `value`, `chainId`, `from`). |
| `signingMode` | `raw` for a single tx, or `eip5792` when multiple steps are needed (e.g. approve + subscribe). |
| `eip5792` | Batch descriptor when `signingMode` is `eip5792`. |
| `simulation` | On-chain simulation results (must succeed before payment settles). |
| `gasEstimates` | Per-transaction gas budget on the selected chain: `gasLimit`, EIP-1559 fees, `estimatedCostWei` / `estimatedCostEth`, and `source` (`simulated` or `heuristic` fallback). |
| `gasSummary` | Aggregated totals across `gasEstimates`. For remit backlogs, includes `backlogMultiplier`, `totalBacklogEstimatedCostWei`, and `totalBacklogEstimatedCostEth` when multiple broadcasts are expected. |
| `preflight` | Operation-specific context (allowance, remit queue size, etc.). |

Optional request fields on any `prepare_*` call (REST body or MCP tool argument):

- **`readinessOnly: true`** — run preflight/readiness checks only; no unsigned transactions, simulation, or gas estimates. Response uses `readinessOnly: true` with `ready`, `errors`, `warnings`, `details`, and `instructions`. On MCP, billed at the readiness tier ($0.01; remit readiness path $0.02) instead of full prepare.
- **`simulateFromAddress`** — optional `0x` address passed to `eth_estimateGas` when the signing wallet differs from the account that will broadcast (defaults to `from`).

Gas estimates are advisory: fees can change between prepare and broadcast. Estimation verifies the RPC reports the selected chain (REST `?chainId=` or `DEFAULT_REST_CHAIN_ID`; MCP always Base 8453). Per-transaction limits come from `eth_estimateGas` when possible; otherwise a conservative heuristic is used and a warning is added (`source: "heuristic"`).

Example excerpt from a full prepare response:

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "chainId": 8453,
  "signingMode": "raw",
  "gasEstimates": [
    {
      "chainId": 8453,
      "gasLimit": "150000",
      "maxFeePerGas": "3000000",
      "maxPriorityFeePerGas": "1000000",
      "estimatedCostWei": "450000000000000",
      "estimatedCostEth": "0.00045",
      "source": "simulated"
    }
  ],
  "gasSummary": {
    "chainId": 8453,
    "totalGasLimit": "150000",
    "totalEstimatedCostWei": "450000000000000",
    "totalEstimatedCostEth": "0.00045",
    "transactionCount": 1
  },
  "warnings": [],
  "instructions": ["Sign unsignedTransactions[0] with the from wallet.", "..."]
}
```

For remit backlogs, `gasSummary` may also include `backlogMultiplier`, `totalBacklogEstimatedCostWei`, and `totalBacklogEstimatedCostEth`.

Include `requestId` when reporting prepare issues. Write errors from the prepare layer may also return `requestId` for log correlation.

### Payments (MCP)

All MCP tools are paid using the x402 protocol. Your MCP client must support sending USDC payments on Base when calling tools.

---

## REST API

The REST API provides the same capabilities as the MCP tools over standard HTTP. **No x402 payment is required** — access is controlled by free rate limits and optional developer API keys.

**Base URL**: `https://api.clocktower.finance` (paths omit `/api`; e.g. `GET /catalog`).

Staging / local dev: `https://your-worker.workers.dev/api/...`

**Chain selection:** protocol reads, prepares, history, discovery, approved tokens, and transaction status accept optional `?chainId=8453` or `?chainId=eip155:8453`. Omitted `chainId` uses `DEFAULT_REST_CHAIN_ID` (default 8453). Unknown or unsupported values return 400. Developer keys, health, and catalog are not chain-scoped (catalog still lists available chains). MCP does not take `chainId`.

### Authentication

| Method | When |
|--------|------|
| None | Free tier — call any allowed endpoint directly |
| `Authorization: Bearer ctk_…` | Developer tier — free API key |
| x402 | **Not used on REST** (MCP only) |

Optional HTTP Basic Auth on `/api` is controlled by `API_REQUIRE_BASIC_AUTH` (default **`false`**).

### Endpoints

#### Read Endpoints (GET)

Paths below use the production API host form (no `/api` prefix). On `*.workers.dev`, prefix each path with `/api`.

| Endpoint | Description |
|----------|-------------|
| `GET /catalog` | Machine-readable route catalog and tier limits |
| `GET /protocol/state` | Current protocol fee configuration |
| `GET /subscriptions/due` | Subscriptions due on a given day/frequency (single-day; same scan helper as remit) |
| `GET /subscriptions` | Search/discover subscriptions (see Discovery below) |
| `GET /subscriptions/:id` | Single subscription by ID |
| `GET /subscriptions/:id/subscribers` | Subscribers for a subscription |
| `GET /subscriptions/:id/fee-balance?address=0x…` | Fee balance for a subscriber on a subscription |
| `GET /accounts/:address/subscriptions` | Subscriptions for an account (rich) |
| `GET /accounts/:address` | Full enriched account overview. Returns `subscribedTo` (what you pay into) and `created` (what you created as provider) |
| `GET /approved-tokens` | List of approved tokens (includes on-chain `minimum` and `paused`) |
| `GET /approved-tokens/:token` | Approved token configuration |

#### Discovery Endpoints (GET, subgraph + on-chain — expensive bucket)

| Endpoint | Description |
|----------|-------------|
| `GET /subscriptions` | Search active subscriptions. Query params: `provider`, `token`, `frequency`, `cancelled` (default `false`), `includeDetails`, `first`, `skip`. **Free:** `first` max 10, no `includeDetails`. **Developer:** `first` max 25, `includeDetails` allowed. |
| `GET /subscriptions/:id/details` | Current url/description (latest DetailsLog) |

#### History & Profile Endpoints (GET, subgraph-backed)
These query The Graph for rich event history. Priced higher to cover external query costs. All support optional `?first=N&skip=M` pagination.

Returned SubLog events include:
- `eventName` (human readable)
- Normalized amount fields (`amount`, `amountRaw`, `tokenDecimals`)
- `formattedTimestamp` and `formattedAmount`

| Endpoint | Description |
|----------|-------------|
| `GET /subscriptions/:id/history` | Activity history for a subscription (formatted SubLog events) |
| `GET /accounts/:address/activity` | Combined activity for an account (subscriber + provider views) with breakdown |
| `GET /providers/:address` | Latest provider profile (ProvDetailsLog) |
| `GET /subscriptions/:id/details-history` | URL/description change history for a subscription (DetailsLog) |

Subgraph errors return a graceful response containing an `error` field rather than failing the entire request.

**Design Notes**
- **Cost Model**: History endpoints hit the **expensive rate bucket** and subgraph daily cap because they perform external The Graph queries + data transfer.
- **No Raw GraphQL Proxy**: We intentionally did **not** expose a low-level `/graph` passthrough proxy. All access goes through high-level, shaped, paid endpoints with formatting, limits, and normalization. This matches the original design goal of consistency and cost control.

**Security Notes (History Endpoints)**
- All subgraph errors are sanitized. No `GRAPH_API_KEY` or sensitive material is ever returned to clients.
- Cloudflare Cache API stores only response data (never Authorization headers).
- Raw internal 18-decimal protocol amounts are not exposed to users (only normalized values in the token's native decimals).
- Subgraph failures result in graceful responses with an `error` field rather than hard failures.

#### Write Endpoints (POST)

All `prepare_*` endpoints accept optional `readinessOnly: true` and `simulateFromAddress` in the JSON body (see Prepare response format above).

| Endpoint | Free tier | Description |
|----------|-----------|-------------|
| `POST /check_subscribe_readiness` | Allowed | Validate whether an account can subscribe |
| `POST /prepare/create_subscription` | Free: 2/min · 20/day; Developer: 5/min · 100/day | Prepare a new subscription |
| `POST /prepare/subscribe` | (same write bucket) | Prepare subscribing to an existing subscription |
| `POST /prepare/cancel_subscription` | (same write bucket) | Prepare cancelling a subscription (provider must match `from`) |
| `POST /prepare/unsubscribe` | (same write bucket) | Prepare unsubscribing from a subscription |
| `POST /prepare/unsubscribe_by_provider` | (same write bucket) | Provider-initiated unsubscribe |
| `POST /prepare/edit_details` | (same write bucket) | Provider metadata edit |
| `POST /check_remit_readiness` | Allowed | Check whether `remit()` is callable |
| `POST /prepare/remit` | 2/min/IP | Prepare permissionless `remit()` transaction |
| `POST /transactions/status` | Allowed | Check status of a broadcast transaction |

Full prepare responses include simulation, `gasEstimates`, and `gasSummary` (see Prepare response format in the MCP section above).

### Error Format

All errors return a consistent JSON shape:

```json
{
  "error": "Human readable message",
  "code": "VALIDATION_ERROR" | "NOT_FOUND" | "UPSTREAM_ERROR" | "RATE_LIMITED" | "API_DISABLED",
  "requestId": "optional-uuid-for-prepare-failures"
}
```

Validation errors on write endpoints may also include an `issues` array with field-level details. MCP prepare failures may return `code: "PREPARE_FAILURE"` with a `requestId` when the error originated in the prepare layer.

### Status Endpoints

- `GET https://api.clocktower.finance/` — API discovery JSON
- `GET /status` — Lightweight health/status check (free). Still available when `API_ENABLED=false`; returns `status: "disabled"` and `apiEnabled: false`
- `GET https://example.workers.dev/` — Legacy combined worker discovery (staging)

### Browser CORS (optional)

By default, browser cross-origin requests to `/api` are **not** allowed (no CORS headers). To enable a browser SPA on another origin, set:

```
API_CORS_ALLOWED_ORIGINS=https://app.example.com,http://localhost:5173
```

CORS is **not** authentication and is **not** granted by an API key. Ops must whitelist origins in `API_CORS_ALLOWED_ORIGINS`.

---

## Source and hosting

This repository is open source ([MIT License](LICENSE)) for audit and transparency. The hosted API at `api.clocktower.finance` and MCP at `mcp.clocktower.finance` are operated by Clocktower and governed by [Terms of Use](TERMS.md) ([clocktower.finance/terms](https://clocktower.finance/terms)). Operational deployment is maintained by the Clocktower team.

---

## Security & Rate Limiting

- **REST kill switch** — set `API_ENABLED=false` to block `/api/*` without redeploying (MCP unaffected)
- **Tier-aware rate limits** — separate buckets for free, developer, and MCP lanes
- **Expensive route bucket** — subgraph-heavy endpoints (history, discovery, cross-account reads)
- **Subgraph daily caps** — per-IP (free) or per-key (developer)
- Per-address write rate limiting on prepare (keyed on `from`, lane-specific)
- Geo-blocking support
- MCP: write simulation before x402 settlement; payments only settle on success
- **Caching**: subgraph responses (45s TTL), public GET edge cache on free-tier protocol state

### Cloudflare edge protections (configure in dashboard)

| Rule | Suggested config |
|------|------------------|
| Rate Limiting | Block `>500 req / 5 min` per IP on `/api*` and `/mcp` |
| WAF | Block empty `User-Agent` |
| DDoS | Keep HTTP DDoS managed ruleset enabled (default) |
| Bot Fight Mode | Enable on zone to reduce scripted free-tier abuse |

For security-related notes, see `SECURITY_FOLLOWUPS.md`.

---

## License and terms

| Document | Applies to |
|----------|------------|
| [MIT License](LICENSE) | Source code in this repository (audit, fork, self-host permitted under MIT) |
| [Terms of Use](TERMS.md) | Hosted REST API (`api.clocktower.finance`) and MCP (`mcp.clocktower.finance`); public copy at [clocktower.finance/terms](https://clocktower.finance/terms) |

The **official** production API is operated by **Clocktower LLC**. This public
repo is the reference implementation. Use of the hosted endpoints is subject to
[TERMS.md](TERMS.md) (also [clocktower.finance/terms](https://clocktower.finance/terms)); self-hosted deployments are not supported or endorsed.