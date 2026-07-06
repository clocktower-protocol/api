# Clocktower API Terms of Use

**Last updated:** July 2026

These Terms of Use ("Terms") govern access to the hosted Clocktower API and MCP
services operated by **Clocktower LLC** ("Clocktower", "we", "us"). They apply to
use of the production endpoints:

- `https://api.clocktower.finance` — REST API
- `https://mcp.clocktower.finance` — Model Context Protocol (MCP) server

By calling these endpoints, you agree to these Terms. If you do not agree, do not
use the hosted services.

---

## 1. Relationship to the open-source repository

The source code for this implementation is published in the
[clocktower-protocol/api](https://github.com/clocktower-protocol/api) repository
under the [MIT License](LICENSE) for transparency and auditability.

These Terms apply **only** to Clocktower's **hosted** API and MCP services. They
do not restrict your rights under the MIT License to use, modify, or self-host
the software independently. Self-hosted deployments are not supported or
endorsed by Clocktower.

The **official** production API is the hosted service above. Documentation may
reference legacy `*.workers.dev` paths for staging; those are not the production
product unless we explicitly say otherwise.

---

## 2. The service

Clocktower provides read and write access to **Clocktower Protocol** data and
operations on **Base mainnet** (chain ID 8453), including:

- A free, rate-limited REST API
- A Builder tier (higher limits, scoped access) via Sign-In With Ethereum (SIWE)
  and an on-chain entitlement subscription
- An MCP server for AI agents, gated by **x402** micropayments in USDC on Base

We may add, change, or remove endpoints, limits, or features at any time.

---

## 3. Access tiers and authentication

### Free REST tier

- No account required.
- Subject to rate limits (global, per-route, and subgraph daily caps).
- Cross-account reads and prepare endpoints are allowed within those limits.
- On-chain authorization still applies to any transactions you sign and broadcast.

### Builder REST tier

- Requires an active subscription to the Clocktower Builder entitlement
  subscription on-chain and a valid SIWE session (`Authorization: Bearer cts_…`).
- Access is scoped to your wallet and permitted routes (see API catalog).
- Sessions expire and may be revoked if entitlement lapses.

### MCP (agents)

- Requires x402 payment per tool invocation as configured by the server.
- Subject to MCP-specific rate limits.
- Your MCP client must support the x402 payment flow on Base.

You must not share, sell, or transfer session tokens or circumvent tier
restrictions (including rate limits, entitlement checks, or payment requirements).

---

## 4. Acceptable use

You agree **not** to:

- Abuse rate limits, scrape at scale, or use the API in a way that degrades the
  service for others
- Bypass authentication, geo-restrictions, or payment requirements
- Probe or attack the service (DDoS, credential stuffing, injection attempts, etc.)
- Misrepresent affiliation with Clocktower
- Use the API for unlawful activity or to violate third-party rights
- Resell or repackage the hosted API as a competing commercial service without
  our written permission

We may throttle, challenge, suspend, or block access (by IP, address, session,
or other signal) at our discretion.

---

## 5. Prepare endpoints and on-chain actions

Write endpoints return **unsigned transactions** or readiness information. You are
solely responsible for reviewing, signing, and broadcasting transactions from
your wallet. Clocktower does not custody keys, broadcast on your behalf, or
guarantee that a prepare response will succeed on-chain.

Simulation, gas estimates, and subgraph data are **advisory**. Chain state, mempool
conditions, and RPC latency can change before broadcast.

---

## 6. Data accuracy and third-party services

The API reads on-chain data via RPC providers (e.g. Alchemy) and, for some routes,
The Graph subgraphs. We strive for accuracy but do not warrant that responses are
complete, current, or error-free. Subgraph rows may lag or disagree with chain state.

Do not rely on the API as the sole source of truth for financial or legal decisions.
Verify critical values on-chain.

---

## 7. Fees and payments

- **REST API:** No x402 payment on the hosted REST surface (subject to tier rate limits).
- **MCP:** x402 charges apply as listed in the MCP tool catalog. Payments are
  processed via the x402 facilitator; Clocktower receives USDC per its configured
  recipient address.
- **Builder entitlement:** On-chain subscription fees to Clocktower LLC are separate
  from API usage and are governed by the Clocktower Protocol smart contracts.

Fees are non-refundable except where required by law.

---

## 8. Availability and changes

The service is provided on a **best-effort** basis. We do not guarantee uptime,
latency, or continued availability of any endpoint. We may:

- Enable maintenance mode (`API_ENABLED=false` or equivalent)
- Change rate limits, pricing, or tier rules
- Modify or discontinue endpoints

Material changes to these Terms will be reflected in this file with an updated
"Last updated" date. Continued use after changes constitutes acceptance.

---

## 9. Geographic restrictions

Access may be restricted in certain jurisdictions (including where required by
law or policy). The service may block requests identified as originating from
restricted regions (e.g. New York State, USA, as implemented in the Worker).

---

## 10. Privacy

We process request metadata (IP address, wallet addresses in requests, session
tokens, rate-limit keys) to operate and secure the service. We do not publish a
separate privacy policy in this repository; contact us for privacy questions.

Do not send secrets in API bodies. Session tokens and API keys (if offered in the
future) must be kept confidential.

---

## 11. Disclaimers

THE HOSTED API AND MCP SERVICES ARE PROVIDED **"AS IS"** AND **"AS AVAILABLE"**
WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

CLOCKTOWER DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR
ERROR-FREE, OR THAT ON-CHAIN OR SUBGRAPH DATA IS ACCURATE.

---

## 12. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, CLOCKTOWER LLC AND ITS AFFILIATES, OFFICERS,
AND CONTRIBUTORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR GOODWILL,
ARISING FROM YOUR USE OF THE HOSTED SERVICES.

OUR TOTAL LIABILITY FOR ANY CLAIM ARISING FROM THESE TERMS OR THE SERVICE IS LIMITED
TO THE GREATER OF (A) USD $100 OR (B) THE AMOUNT YOU PAID TO CLOCKTOWER FOR MCP
x402 USAGE IN THE TWELVE (12) MONTHS BEFORE THE CLAIM.

Some jurisdictions do not allow certain limitations; in those cases, our liability
is limited to the fullest extent permitted by law.

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

These Terms are governed by the laws of the State of Delaware, USA, without regard
to conflict-of-law principles, except where mandatory consumer protections in your
jurisdiction apply.

---

## 16. Contact

Questions about these Terms or the hosted API:

- Repository issues: [github.com/clocktower-protocol/api/issues](https://github.com/clocktower-protocol/api/issues)
- Website: [clocktower.finance](https://clocktower.finance)

---

*This document is a template for the pre-release hosted service. Clocktower may
publish authoritative Terms on clocktower.finance before or at public launch.*