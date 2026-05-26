/**
 * Write Endpoints — Preparation / Scaffolding
 *
 * This file is intentionally mostly empty right now.
 * It exists as a place to organize future write-side logic
 * (prepare_* and submit_signed_transactions endpoints).
 *
 * When we implement writes, we will likely:
 *   - Define request schemas (using zod)
 *   - Create handler functions that call into src/tx/prepare.ts and src/tx/submit.ts
 *   - Wrap them with withX402Payment (using higher prices from API_PRICES or a separate write pricing object)
 *
 * Current known write tools from the MCP side (for reference):
 *   - check_subscribe_readiness
 *   - prepare_create_subscription
 *   - prepare_subscribe
 *   - prepare_cancel_subscription
 *   - prepare_unsubscribe
 *   - prepare_unsubscribe_by_provider
 *   - prepare_edit_details
 *   - submit_signed_transactions
 *   - get_transaction_status
 *
 * Pricing note (from earlier design):
 *   - Write prepare/submit operations were priced higher (~0.02) than reads.
 */

import { jsonResponse } from './responses.js';

// Placeholder — will be expanded when we start implementing write endpoints.
export const writePlaceholder = () => {
  return jsonResponse({
    status: 'not_implemented',
    message: 'Write endpoints have not been implemented yet.',
  }, 501);
};
