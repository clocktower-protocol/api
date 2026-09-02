/**
 * Sanitizing wrapper for paid-tool handlers (L7).
 *
 * Goals:
 *
 * 1. Never leak upstream provider details (Alchemy URLs/keys, raw revert
 *    bytes, hex traces) to MCP clients. viem's default `toString()` on an
 *    `HttpRequestError` embeds the full RPC URL — which on Cloudflare
 *    includes `ALCHEMY_API_KEY` after `resolveChain` concatenates it.
 *
 * 2. Preserve the M1 invariant — when a handler fails, x402 settlement must
 *    NOT run, so the caller is not charged. The `agents/x402` SDK detects
 *    `result.isError === true` and sets `failed = true`, skipping settle.
 *    Every error path here therefore returns `isError: true` (rather than
 *    re-throwing) so x402 sees a structured failure result.
 *
 * 3. Pass through safe, actionable errors:
 *
 *    - `ZodError` — the user gave us bad input. The messages are static
 *      strings from our own schemas (e.g. "Invalid Ethereum address") and
 *      echo back only the field path, which the caller already knows.
 *      Surfacing these helps the caller fix their request.
 *
 *    - `ContractFunctionRevertedError` (anywhere in viem's cause chain) —
 *      the `reason` is the on-chain revert string from a public contract.
 *      Not sensitive; useful for the caller.
 *
 *    - Everything else collapses to a generic `RPC_FAILURE` payload with a
 *      `requestId` so the original error can still be correlated in
 *      observability logs.
 */

import { BaseError, ContractFunctionRevertedError } from 'viem';
import { ZodError } from 'zod';
import { UnsupportedChainError } from '../chain.js';
import { clientSafeMessage } from '../sanitizeUpstream.js';
import { getRequestId } from '../tx/prepare-response.js';
import { serializeJson } from '../utils.js';

export type SafeToolResult = {
	content: Array<{ type: 'text'; text: string }>;
	isError?: boolean;
};

type ErrorPayload = {
	error: string;
	code: 'INVALID_INPUT' | 'CONTRACT_REVERT' | 'PREPARE_FAILURE' | 'RPC_FAILURE';
	requestId?: string;
	reason?: string;
	issues?: Array<{ path: string; message: string }>;
};

function asResult(payload: ErrorPayload): SafeToolResult {
	return {
		isError: true,
		content: [{ type: 'text' as const, text: serializeJson(payload) }],
	};
}

function findContractRevert(err: unknown): ContractFunctionRevertedError | null {
	if (err instanceof ContractFunctionRevertedError) {
		return err;
	}
	if (err instanceof BaseError) {
		const match = err.walk((c) => c instanceof ContractFunctionRevertedError);
		if (match instanceof ContractFunctionRevertedError) {
			return match;
		}
	}
	return null;
}

export async function safeHandler<T extends SafeToolResult>(
	name: string,
	fn: () => Promise<T>,
): Promise<T | SafeToolResult> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof ZodError) {
			return asResult({
				error: 'Validation failed',
				code: 'INVALID_INPUT',
				issues: err.issues.map((issue) => ({
					path: issue.path.map(String).join('.') || '(root)',
					message: issue.message,
				})),
			});
		}

		if (
			err instanceof UnsupportedChainError ||
			(err instanceof Error && err.message.includes('chainId must'))
		) {
			return asResult({
				error: err.message,
				code: 'INVALID_INPUT',
			});
		}

		const revert = findContractRevert(err);
		if (revert && typeof revert.reason === 'string' && revert.reason.length > 0) {
			const requestId = getRequestId(err);
			return asResult({
				error: 'Contract reverted',
				code: 'CONTRACT_REVERT',
				reason: revert.reason,
				...(requestId ? { requestId } : {}),
			});
		}

		const attachedRequestId = getRequestId(err);
		if (attachedRequestId && err instanceof Error) {
			// Prepare attaches requestId before rethrowing. Messages may still embed
			// viem transport URLs (Alchemy key) from simulation failures — never
			// surface those verbatim (L7 completion).
			console.error(`[safeHandler] ${name} failed`, { requestId: attachedRequestId, error: err });
			return asResult({
				error: clientSafeMessage(err.message, 'Prepare failed'),
				code: 'PREPARE_FAILURE',
				requestId: attachedRequestId,
			});
		}

		const requestId = crypto.randomUUID();
		// Original error is intentionally only logged, not surfaced, because
		// viem `toString()` includes Alchemy URLs (with the API key) and
		// other infra details. The requestId is the bridge between caller
		// reports and Cloudflare observability logs.
		console.error(`[safeHandler] ${name} failed`, { requestId, error: err });

		return asResult({
			error: 'Upstream error',
			code: 'RPC_FAILURE',
			requestId,
		});
	}
}
