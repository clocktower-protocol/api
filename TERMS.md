# Clocktower API Terms of Use

**Last updated:** August 25, 2026

These Terms of Use ("Terms") govern access to the hosted Clocktower API and MCP
services operated by **Clocktower LLC** ("Clocktower", "we", "us"). They apply to
use of:

- `https://api.clocktower.finance` — REST API
- `https://mcp.clocktower.finance` — Model Context Protocol (MCP) server

By calling these endpoints, you agree to these Terms. If you do not agree, do not
use the hosted services.

A public copy of these Terms is also published at
[clocktower.finance/terms](https://clocktower.finance/terms).

---

## 1. Relationship to the open-source repository

The source code for this implementation is published in the
[clocktower-protocol/api](https://github.com/clocktower-protocol/api) repository
under the [MIT License](LICENSE) for transparency and auditability.

These Terms apply **only** to Clocktower's **hosted** API and MCP services. They
do not restrict your rights under the MIT License to use, modify, or self-host
the software independently. Self-hosted deployments are not supported or
endorsed by Clocktower.

The **official** hosted API is the service above. Documentation may reference
legacy `*.workers.dev` paths for local development and staging; those are not
the production product unless we explicitly say otherwise.

---

## 2. The service

Clocktower provides read access to **Clocktower Protocol** data and prepare-only
write helpers (unsigned calldata) for protocol operations.

- **REST** defaults to **Base** (chain ID 8453). Protocol routes may accept
  optional `?chainId=` (decimal or CAIP-2) for REST-enabled chains listed in
  `GET /catalog`. Omitted `chainId` uses the server default (currently 8453).
- **MCP**, **x402** payments, **SIWE**, and **Builder entitlement** (when that
  lane is enabled) stay on Base regardless of REST `chainId`.
- The server **does not** custody user keys, relay signed transactions, or
  broadcast transactions on your behalf. You sign and submit from your own
  wallet.
- Subscription `amount` values on API inputs are **human token-unit strings**
  (for example `"10"` or `"100.5"`), not protocol wei.
- Live routes, chain registry, and rate limits are in `GET /catalog` (on the
  API host: `/catalog`; on `*.workers.dev`: `/api/catalog`). Catalog values
  control what is actually enabled.

We may add, change, or remove endpoints, chains, limits, or features at any
time.

---

## 3. Access tiers and authentication

Successful REST responses include an `X-Clocktower-Lane` header (`free`,
`developer`, or `builder` when that lane is enabled).

### Free REST tier

- No account or API key required.
- Limits are per **IP** (request rate, expensive-route rate, subgraph daily,
  prepare/readiness RPM and daily, and a daily request total).
- Search and similar discovery calls are capped (including `first` and
  `includeDetails`).
- Cross-account reads and prepare endpoints are allowed within those limits.
- On-chain authorization still applies to any transaction you sign and
  broadcast.

### Developer REST tier (API keys)

- Authenticate with `Authorization: Bearer ctk_…`.
- Keys are **free**. They raise **read** limits (per **key id**, not IP).
  Prepare/readiness stays intentionally tight because full prepare runs
  on-chain simulation and gas estimation on shared RPC.
- Keys are issued via Clocktower's developer portal or an admin mint path.
  The plaintext token is shown **once** at creation. Clocktower stores a
  **SHA-256 hash** of the key, not the plaintext.
- Invalid, unknown, or revoked keys return **401**. They do **not** fall back
  to the free tier.
- Do not share, sell, or transfer keys. Do not embed long-lived `ctk_…` keys
  in public client-side applications.
- Developer API keys **do not** authenticate MCP. Sending a `ctk_…` key to
  the MCP host does not waive x402 payment.

### Builder REST tier (optional; may be off)

- Builder is an optional higher REST lane. It is **disabled** unless
  Clocktower configures on-chain entitlement subscription ID(s). Check
  `builderAuthEnabled` on `GET /catalog`.
- When enabled, access requires an **ACTIVE** entitlement subscription on
  **Base** and a valid SIWE session (`Authorization: Bearer cts_…`).
  Entitlement is always evaluated on Base, even if the REST call uses another
  `chainId`.
- Access is wallet-scoped (including `:me` routes where offered). Sessions
  expire and may be revoked if entitlement lapses.
- Do not share, sell, or transfer session tokens.

### MCP (agents)

- Requires **x402** payment per tool invocation in USDC on Base, as configured
  by the server (see the MCP tool catalog / pricing).
- Subject to MCP-specific rate limits.
- Your MCP client must support the x402 payment flow on Base.
- API keys and SIWE sessions are **not** MCP credentials.

You must not circumvent tier restrictions (rate limits, entitlement checks, or
payment requirements).

---

## 4. Acceptable use

You agree **not** to:

- Abuse rate limits, scrape at scale, or use the API in a way that degrades the
  service for others
- Bypass authentication, geo-restrictions, or payment requirements
- Probe or attack the service (DDoS, credential stuffing, injection attempts,
  etc.)
- Mine or farm prepare/readiness as a substitute for your own RPC
- Misrepresent affiliation with Clocktower
- Use the API for unlawful activity or to violate third-party rights
- Resell or repackage the hosted API as a competing commercial service without
  our written permission

We may throttle, challenge, suspend, or block access (by IP, address, API key,
session, or other signal) at our discretion.

For production write volume, use your own RPC (and, when available, the
Clocktower SDK) rather than exhausting hosted prepare quotas.

---

## 5. Prepare endpoints and on-chain actions

Write endpoints and MCP write tools return **unsigned transactions** and/or
readiness information. You are solely responsible for reviewing, signing, and
broadcasting transactions from your wallet. Clocktower does not custody keys,
broadcast on your behalf, or guarantee that a prepare response will succeed
on-chain.

Simulation, gas estimates, and subgraph data are **advisory**. Chain state,
mempool conditions, and RPC latency can change before broadcast.

When you already have a subscription id, prefer the `*_by_id` prepare and
readiness paths. Amount, token, and provider are loaded from chain.

---

## 6. Data accuracy and third-party services

The API reads on-chain data via RPC providers (for example Alchemy) and, for
some routes, The Graph subgraphs. We strive for accuracy but do not warrant
that responses are complete, current, or error-free. Subgraph rows may lag or
disagree with chain state.

Do not rely on the API as the sole source of truth for financial or legal
decisions. Verify critical values on-chain.

---

## 7. Fees and payments

- **REST (free and developer):** No x402 payment. Access is rate-limited.
  Developer keys are issued without a Clocktower usage fee.
- **MCP:** x402 charges apply as listed by the server. Payments are processed
  via the x402 facilitator; Clocktower receives USDC at its configured
  recipient address.
- **Builder entitlement (when enabled):** On-chain subscription fees to
  Clocktower LLC are separate from API usage and are governed by the
  Clocktower Protocol smart contracts.
- **Gas:** You pay network gas for any transaction you broadcast.

Fees are non-refundable except where required by law.

---

## 8. Availability and changes

The service is provided on a **best-effort** basis. We do not guarantee uptime,
latency, or continued availability of any endpoint. We may:

- Enable maintenance mode (`API_ENABLED=false` or equivalent) for REST without
  taking MCP down
- Change rate limits, pricing, or tier rules
- Modify or discontinue endpoints or chains

Material changes to these Terms will be reflected in this file and at
[clocktower.finance/terms](https://clocktower.finance/terms) with an updated
"Last updated" date. Continued use after changes constitutes acceptance.

---

## 9. Geographic restrictions

Access may be restricted in certain jurisdictions (including where required by
law or policy). The service may block requests identified as originating from
restricted regions (including New York State, USA, as implemented in the
Worker).

---

## 10. Privacy

We process request metadata to operate, rate-limit, and secure the service,
including:

- IP address and Cloudflare edge geo signals
- Wallet addresses and other identifiers you send in requests
- Route, method, status, and access lane
- Developer **key id** (not the full `ctk_…` secret)
- Rate-limit identity and aggregate usage metrics (including Analytics Engine)

We do not log or store the plaintext API key after issuance. Keep tokens
confidential. Do not send secrets in API bodies.

We do not publish a separate privacy policy in this repository; contact us for
privacy questions.

---

## 11. Disclaimers

THE HOSTED API AND MCP SERVICES ARE PROVIDED **"AS IS"** AND **"AS AVAILABLE"**
WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

CLOCKTOWER DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR
ERROR-FREE, OR THAT ON-CHAIN OR SUBGRAPH DATA IS ACCURATE.

---

## 12. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, CLOCKTOWER LLC AND ITS AFFILIATES,
OFFICERS, AND CONTRIBUTORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR
GOODWILL, ARISING FROM YOUR USE OF THE HOSTED SERVICES.

OUR TOTAL LIABILITY FOR ANY CLAIM ARISING FROM THESE TERMS OR THE SERVICE IS
LIMITED TO THE GREATER OF (A) USD $100 OR (B) THE AMOUNT YOU PAID TO CLOCKTOWER
FOR MCP x402 USAGE IN THE TWELVE (12) MONTHS BEFORE THE CLAIM.

Some jurisdictions do not allow certain limitations; in those cases, our
liability is limited to the fullest extent permitted by law.

---

## 13. Indemnity

You agree to indemnify and hold harmless Clocktower from claims, damages, and
expenses (including reasonable legal fees) arising from your use of the hosted
services, your on-chain transactions, or your violation of these Terms.

---

## 14. Termination

We may suspend or terminate your access at any time, with or without notice, for
violation of these Terms or for operational or legal reasons. Provisions that by
their nature should survive (disclaimers, liability limits, indemnity) survive
termination.

---

## 15. Governing law

These Terms are governed by the laws of the jurisdiction in which Clocktower LLC
is organized, without regard to conflict-of-law principles, except where
mandatory consumer or data-protection rules in your country of residence apply
and cannot be waived by contract.

---

## 16. Contact

Questions about these Terms or the hosted API:

- Terms (docs): [clocktower.finance/terms](https://clocktower.finance/terms)
- Website: [clocktower.finance](https://clocktower.finance)
- Repository issues: [github.com/clocktower-protocol/api/issues](https://github.com/clocktower-protocol/api/issues)
