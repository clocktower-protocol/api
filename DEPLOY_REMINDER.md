# Deploy Reminder — Clocktower API (tiered access)

Ops checklist for deploying [clocktower-protocol/api](https://github.com/clocktower-protocol/api).

**Last updated:** June 2026

**Status:** Pre-release — no public production API yet. Use this checklist before go-live.

**Worker name:** `clocktower-mcp` (in `wrangler.jsonc`; separate from the repo name).

---

## 1. Cloudflare KV namespaces

Create production namespaces and replace placeholder IDs in `wrangler.jsonc`:

```bash
wrangler kv namespace create SESSIONS_KV
wrangler kv namespace create RPC_CACHE_KV
```

Update `wrangler.jsonc` → `kv_namespaces` bindings with real IDs for both prod and (if separate) preview.

| Binding | Purpose |
|---------|---------|
| `SESSIONS_KV` | Builder SIWE session tokens + auth nonces |
| `RPC_CACHE_KV` | Optional RPC read cache (protocol state, approved tokens) |

---

## 2. Worker secrets (`wrangler secret put`)

Required:

| Secret | Notes |
|--------|-------|
| `ALCHEMY_API_KEY` | Base mainnet RPC |
| `CDP_API_KEY_ID` | x402 facilitator (MCP only) |
| `CDP_API_KEY_SECRET` | x402 facilitator (MCP only) |
| `X402_RECIPIENT` | USDC payment recipient for `/mcp` |
| `GRAPH_BASE_URL` | The Graph subgraph (history/discovery) |
| `GRAPH_API_KEY` | Subgraph auth bearer token |

Optional:

| Secret | Notes |
|--------|-------|
| `GRAPH_BASE_SEPOLIA_URL` | Only if testing Sepolia subgraph |

Never commit secrets. Mirror locally in `.dev.vars` (gitignored); see `.dev.vars.example`.

---

## 3. Worker vars (`wrangler.jsonc` vars or dashboard)

Review / set after deploy:

| Var | Default | Action |
|-----|---------|--------|
| `API_ENABLED` | `"true"` | Keep `true` for launch. Set `false` to disable REST `/api/*` without redeploying (MCP stays up; `GET /api/status` remains available) |
| `BUILDER_SUB_ID` | `""` (disabled) | Set to on-chain Builder entitlement subscription ID once published |
| `CLOCKTOWER_ADDRESS` | in wrangler.jsonc | Confirm matches production contract |
| `API_REQUIRE_BASIC_AUTH` | `"false"` | Leave `false` in prod; optional `true` for local dev only |
| `FREE_RATE_LIMIT_RPM` | `20` | Free tier global cap |
| `FREE_EXPENSIVE_RATE_LIMIT_RPM` | unset (code default) | Subgraph-heavy / discovery routes |
| `FREE_SUBGRAPH_DAILY_LIMIT` | unset (code default) | Per-IP subgraph daily cap (free) |
| `FREE_WRITE_RATE_LIMIT_RPM` | unset (code default) | Prepare/write bucket (free) |
| `BUILDER_RATE_LIMIT_RPM` | `120` | Builder tier global cap |
| `BUILDER_SUBGRAPH_DAILY_LIMIT` | unset (code default) | Per-address subgraph cap (builder) |
| `BUILDER_WRITE_RATE_LIMIT_RPM` | unset (code default) | Prepare/write bucket (builder) |
| `MCP_RATE_LIMIT_RPM` | `300` | MCP IP cap |
| `MCP_WRITE_RATE_LIMIT_RPM` | `60` | MCP prepare cap per address |
| `API_CORS_ALLOWED_ORIGINS` | unset | Comma-separated SPA origins when browser clients go live |

**Builder auth is off until `BUILDER_SUB_ID` is a valid `0x` + 64 hex chars.**

**SIWE domain:** `src/api/auth.ts` hardcodes `SIWE_DOMAIN = 'clocktower.workers.dev'`. Update before launch if using a custom hostname.

**Bundle size:** `minify` is `false` in `wrangler.jsonc` today — consider `true` for production (observability is already enabled).

---

## 4. On-chain (Base mainnet)

Before enabling Builder lane:

1. Clocktower LLC creates the **Builder entitlement** content subscription on-chain
2. Copy `subscriptionId` → set `BUILDER_SUB_ID` in Worker config
3. Document public subscribe URL for builders

---

## 5. Cloudflare dashboard (zone / account)

Configure **before** announcing the public REST API:

### DDoS / WAF (zone)

- [ ] HTTP DDoS managed ruleset — enabled (default)
- [ ] **Rate Limiting rule:** block or challenge `>500 requests / 5 minutes` per IP to `*/api*` and `*/mcp`
- [ ] **WAF custom rule:** block requests with empty `User-Agent` on `/api` and `/mcp`
- [ ] **WAF custom rule:** managed challenge on `/api/auth/*` when `>30 requests / minute` per IP
- [ ] **Bot Fight Mode** — consider enabling on the workers.dev custom domain or routed zone

### Workers & observability

- [ ] `npm test && wrangler deploy` from `master` (or your release branch)
- [ ] Confirm `API_ENABLED=true` in dashboard / `wrangler.jsonc`
- [ ] Workers Analytics / Logpush — watch 429 rate by lane (`X-Clocktower-Lane` header)
- [ ] Alert on spike in 429 or subgraph daily cap exhaustion

### Custom domain (if applicable)

- [ ] Route `your-domain.com/*` → Worker
- [ ] SSL/TLS full (strict)
- [ ] Apply WAF/rate rules to custom hostname, not only `*.workers.dev`
- [ ] Update `SIWE_DOMAIN` in `src/api/auth.ts` to match the public hostname

---

## 6. Post-deploy smoke tests

```bash
WORKER=https://<your-worker>.workers.dev

# Worker root
curl -s "$WORKER/" | jq '{ status, apiEnabled, mcp, rest }'

# Free tier — no auth
curl -s "$WORKER/api/catalog" | jq '{ apiEnabled, builderAuthEnabled, access: .access.rest }'
curl -s "$WORKER/api/protocol/state"

# Health (always available, even when API disabled)
curl -s "$WORKER/api/status" | jq '{ status, apiEnabled, service }'

# Builder auth disabled → 503 AUTH_DISABLED
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$WORKER/api/auth/challenge" \
  -H "Content-Type: application/json" \
  -d '{"address":"0x0000000000000000000000000000000000000001"}'

# MCP still requires x402 (not blocked by API_ENABLED)
curl -s -o /dev/null -w "%{http_code}\n" "$WORKER/mcp"
```

**Kill switch test** (optional, after verifying prod is up):

```bash
# Set API_ENABLED=false in dashboard, then:
curl -s -o /dev/null -w "%{http_code}\n" "$WORKER/api/protocol/state"   # expect 503
curl -s "$WORKER/api/status" | jq '{ status, apiEnabled }'             # expect disabled
curl -s -o /dev/null -w "%{http_code}\n" "$WORKER/mcp"                  # MCP unaffected
# Set API_ENABLED=true when done
```

After `BUILDER_SUB_ID` is set:

1. `POST /api/auth/challenge` → 200 + message
2. Sign + `POST /api/auth/verify` → 200 + `cts_…` token
3. `GET /api/accounts/me` with `Authorization: Bearer <token>` → 200

---

## 7. CORS (browser SPAs)

Builder subscription does **not** enable CORS. Manually add each origin:

```
API_CORS_ALLOWED_ORIGINS=https://app.example.com,http://localhost:5173
```

Redeploy or update var in dashboard after each new frontend origin.

---

## 8. Access model reminder

| Lane | Surface | Auth |
|------|---------|------|
| Free | REST `/api/*` | None (rate-limited) |
| Builder | REST `/api/*` | SIWE session (`Authorization: Bearer cts_…`) |
| Agent | MCP `/mcp` | x402 (USDC on Base) |

REST `/api` does **not** require x402. **MCP `/mcp` unchanged** — still x402.

---

## Quick deploy command

```bash
npm test && wrangler deploy
```

Ensure `.dev.vars` locally mirrors secrets for `wrangler dev` (never commit `.dev.vars`).