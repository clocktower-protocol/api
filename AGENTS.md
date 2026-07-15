# AGENTS.md — clocktower-api

Cloudflare Worker that exposes the Clocktower protocol on Base via **REST** (`api.clocktower.finance`) and **MCP** (`mcp.clocktower.finance`). Worker name in Wrangler is `clocktower-mcp`. Pre-release: no public production API yet.

Full product docs: `README.md`. Deploy ops: `DEPLOY_REMINDER.md`.

## Hard rules

- **Subscription `amount` on API inputs is a human token-unit string** (e.g. `"10"` or `"100.5"`), never protocol wei and never token-native raw integers.
- **Protocol accounting is always 18 decimals.** Conversion path: human → token-native (`parseUnits` + approved token decimals) → protocol units. See `src/tx/amount.ts` and helpers in `src/utils.ts`.
- **Prefer `*_by_id` write paths** when the caller already has a subscription id: `prepare_subscribe_by_id`, `check_subscribe_readiness_by_id`, `prepare_cancel_subscription_by_id`, `prepare_unsubscribe_by_id`, `prepare_unsubscribe_by_provider_by_id` (and matching REST routes under `/api/prepare/*` and readiness). Keep object-based prepares for create and for callers that already hold a full subscription object.
- **Prepare returns unsigned calldata only.** The server never holds user keys, never relays signed txs, and never broadcasts for the user. Workflow: prepare/readiness → wallet signs → client broadcasts → optional `get_transaction_status`.
- **Three access lanes are distinct:** free REST (IP rate limits), Builder REST (SIWE session + on-chain entitlement), MCP (x402 USDC). Do not apply MCP pricing to REST or free-tier limits to Builder without an explicit product change.
- **ERC-20 approve on subscribe defaults to amount-scoped** (token-native subscription amount). Use `infiniteApproval: true` only when the client opts into max allowance.
- **Secrets stay out of git.** Use `wrangler secret` / gitignored `.dev.vars`. Never commit API keys, Graph keys, or session material.
- **Do not force-push or rewrite shared history** unless the user explicitly asks.

## Repo map

| Path | Role |
|------|------|
| `src/index.ts` | Worker entry |
| `src/api/` | Hono REST (read, write, auth, catalog, pricing, x402) |
| `src/tools/`, `src/mcp*.ts`, `src/clocktower-mcp.ts` | MCP tools and agent wiring |
| `src/tx/` | Amounts, prepare, preflight, encode, gas, remit, status |
| `src/validation.ts`, `src/validation-write.ts` | Request validation |
| `src/config/` | Hostnames, rate limits, approved tokens, entitlement |
| `src/middleware/` | Access lane, free tier, entitlement policy |
| `src/auth/` | SIWE + session |
| `src/abi/` | Contract ABIs |
| `test/` | Vitest (Workers pool) |
| `wrangler.jsonc` | Worker name, Durable Objects, KV, vars |

## Commands

```bash
npm test              # vitest run
npm run test:watch    # vitest watch
npm run dev           # wrangler dev
npm run types         # regenerate env.d.ts
npm run deploy        # wrangler deploy — ask before production
```

When changing amounts, prepare, validation, or write tools, run at least:

```bash
npm test -- test/amounts.spec.ts test/validation-write.spec.ts test/prepare.spec.ts test/preflight.spec.ts
```

Prefer full `npm test` before finishing a multi-file write-path change.

## Amounts and write flows

- **Create / object subscribe:** client sends human `subscription.amount` → `normalizeSubscriptionAmount` → protocol units for encoding.
- **By-id subscribe/cancel/unsubscribe:** load on-chain subscription via id; do not require the client to resubmit amount/token/provider when chain is source of truth.
- **Responses:** keep amount fields consistent with existing API conventions (human vs raw where already documented in README). Do not introduce a second dual-amount input shape on create (human-only is intentional).
- **Remit:** `check_remit_readiness` → `prepare_remit` → client broadcasts; one `remit()` clears at most `maxRemits` per tx; surface backlog warnings when multiple txs are needed.
- **Simulation:** full prepare runs on-chain simulation + gas estimation; failed validation/simulation must fail before x402 settlement charges the agent.

## Access lanes (summary)

| Lane | Surface | Auth | Limits live in |
|------|---------|------|----------------|
| Free | REST | None | `config/rateLimits`, free-tier middleware |
| Builder | REST | `Authorization: Bearer cts_…` (SIWE) | Entitlement sub IDs (`BUILDER_SUB_IDS` / `BUILDER_SUB_ID`) |
| Agent | MCP | x402 | `src/api/pricing.ts` + MCP rate limits |

Machine-readable tier manifest: `GET /catalog` (or `/api/catalog` on workers.dev). Details and pricing tables: `README.md` — do not duplicate full tables here.

## Change playbooks

**New prepare / write operation**

1. Schemas in `validation-write.ts`
2. Prepare/preflight/encode in `src/tx/`
3. REST handler in `src/api/write.ts`
4. MCP tool in `src/tools/write.ts` (+ registration)
5. Tests in `test/` (validation, prepare, and/or write integration)
6. Prefer a `*_by_id` variant when the op only needs `from` + id (and subscriber when required)

**Amount or decimal behavior**

1. `src/tx/amount.ts` and conversion helpers in `src/utils.ts`
2. Validation messages stay explicit about human-readable strings
3. Run amount + validation-write + prepare tests
4. Align docs in README if the public contract changes; coordinate with `clocktower-sdk` only when asked

**Rate limits / tiers**

- `src/config/rateLimits.ts`, `src/middleware/*`, related tests (`*rateLimit*`, `free-tier*`)

**MCP pricing**

- `src/api/pricing.ts` + tests; update README if public prices change

**Auth / SIWE**

- `src/auth/`, `src/api/auth.ts`, session KV; respect `SIWE_DOMAIN` / hostname config

## Ask before

- Production `wrangler deploy` or changing live secrets/vars
- Changing `CLOCKTOWER_ADDRESS`, chain IDs, or hostname routing defaults
- Widening CORS, disabling CSRF/geo blocks, or weakening rate limits
- Force-push / history rewrite
- Publishing or claiming a public production API
- Auto-merging Dependabot **production major** upgrades

## Dependabot / dependency PRs

When reviewing or landing Dependabot (or similar) dependency PRs in this repo:

### Prefer merge when

- Change is **patch or minor**, CI/`npm test` is green (or run it locally if CI is missing).
- **DevDependencies only** (e.g. `vitest`, `typescript`, `@cloudflare/workers-types`) and tests pass.
- PR is a **grouped** routine bump with no lockfile surprises beyond the intended packages.

### Always review carefully (do not rubber-stamp)

- **Majors** of: `viem`, `hono`, `@x402/*`, `@coinbase/x402`, `@modelcontextprotocol/sdk`, `agents`, `zod`, `wrangler`, `@cloudflare/*`.
- Anything that touches **payments, HTTP edge, RPC, or signing** (`viem`, x402 stack, `hono`, MCP SDK).
- PRs that only/transitively bump packages pinned in **`package.json` `overrides`** (`esbuild`, `undici`, `ws`) — confirm overrides still make sense after the bump.
- Security advisories: read the advisory; prefer upgrading the **direct** dependency when possible.

### Do not

- Auto-merge production majors without a human (or explicit user) go-ahead.
- Hand-edit `package-lock.json` around Dependabot unless resolving a merge conflict; prefer Dependabot’s lockfile or `npm install` after a deliberate `package.json` change.
- Broaden dependency ranges casually (`*` / overly loose ranges) to “make Dependabot happy.”
- Commit or paste secrets while “fixing” a bump.

### Suggested checks before merge

1. `npm test`
2. If `viem` / prepare/encode paths may be affected: sanity-check prepare or amount-related tests (`test/prepare*.spec.ts`, `test/amounts.spec.ts`, `test/validation-write.spec.ts`).
3. If x402 / MCP middleware changed: run x402-related specs (`test/api-x402*.spec.ts`, `test/x402-sdk-invariant.spec.ts`) when present.
4. Skim changelog/release notes for breaking API changes on majors.

### Scope

This is **review policy for agents and humans**, not GitHub enforcement. Actual Dependabot schedule/grouping lives in `.github/dependabot.yml` if/when added.

## Related repos

| Repo | Relationship |
|------|----------------|
| `clocktower-sdk` | Client/SDK mirrors amount rules and by-id helpers |
| `clocktower-contract` | On-chain source of truth |
| `clocktower-agent` | Smoke tests prefer `*_by_id` MCP tools |
| `clocktower-docs` | Public documentation site |

Work in this repo for API/MCP surface changes unless the user asks to update a sibling.

## Maintenance

When you change a hard rule (amounts, preferred by-id APIs, access model, write safety), update this file in the same commit. Prefer links to `README.md` and `DEPLOY_REMINDER.md` over copying long tables that will rot.
