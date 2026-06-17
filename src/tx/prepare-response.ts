import { BASE_CHAIN_ID } from '../chain.js';
import type { AccessLane } from '../config/rateLimits.js';
import { getActiveLane } from '../requestLane.js';
import { enforceWriteRateLimitForAddress } from '../rateLimit.js';
import type { PrepareResult, ReadinessOnlyResult, PrepareResponse } from './types.js';

export type PrepareOptions = {
	readinessOnly?: boolean;
	/** Account passed to eth_estimateGas; defaults to `from`. */
	simulateFromAddress?: `0x${string}`;
	/** Rate-limit bucket lane (API builder/free or MCP). */
	lane?: AccessLane;
};

export function createRequestId(): string {
	return crypto.randomUUID();
}

export function attachRequestId(error: unknown, requestId: string): Error {
	if (error instanceof Error) {
		(error as Error & { requestId?: string }).requestId = requestId;
		return error;
	}
	const wrapped = new Error(String(error));
	(wrapped as Error & { requestId?: string }).requestId = requestId;
	return wrapped;
}

export function getRequestId(error: unknown): string | undefined {
	if (error instanceof Error && 'requestId' in error) {
		const id = (error as Error & { requestId?: string }).requestId;
		return typeof id === 'string' ? id : undefined;
	}
	return undefined;
}

function collectPreflightWarnings(preflight?: Record<string, unknown>): string[] {
	if (!preflight || !Array.isArray(preflight.warnings)) {
		return [];
	}
	return preflight.warnings.filter((w): w is string => typeof w === 'string');
}

export function buildPrepareInstructions(
	signingMode: 'eip5792' | 'raw',
	txCount: number,
): string[] {
	const steps: string[] = [];

	if (signingMode === 'eip5792') {
		steps.push(
			'Sign the transaction batch with your wallet using the eip5792 descriptor (EIP-5792 batch signing).',
		);
		steps.push('Broadcast the signed batch from the wallet.');
	} else if (txCount === 1) {
		steps.push('Sign unsignedTransactions[0] with the from wallet.');
		steps.push('Broadcast the signed transaction from the wallet.');
	} else {
		steps.push(
			`Sign all ${txCount} unsignedTransactions in order with the from wallet.`,
		);
		steps.push(
			'Broadcast each signed transaction sequentially; nonces must be contiguous from the pending nonce.',
		);
	}

	steps.push(
		'Ensure the wallet is connected to Base mainnet (chain ID 8453) before signing.',
	);
	steps.push(
		'Review gasEstimates and gasSummary; budgets are advisory and may change before broadcast.',
	);
	steps.push(
		'After broadcast, poll get_transaction_status (REST: POST /api/transactions/status) with the transaction hash.',
	);
	steps.push('Include requestId when reporting issues to support.');

	return steps;
}

export function buildReadinessInstructions(operation: string): string[] {
	return [
		`Readiness-only response for ${operation}; no unsigned transactions were built or simulated.`,
		'Call the same endpoint with readinessOnly omitted or false to prepare unsigned transactions.',
		'For lower cost, use check_subscribe_readiness or check_remit_readiness when only exploring state.',
	];
}

export function buildReadinessOnlyResult(
	requestId: string,
	operation: string,
	ready: boolean,
	errors: string[],
	warnings: string[],
	details: Record<string, unknown>,
): ReadinessOnlyResult {
	return {
		requestId,
		readinessOnly: true,
		chainId: BASE_CHAIN_ID,
		operation,
		ready,
		errors,
		warnings,
		instructions: buildReadinessInstructions(operation),
		details,
	};
}

function logPrepareSuccess(
	operation: string,
	from: `0x${string}`,
	requestId: string,
	result: PrepareResponse,
): void {
	if (result.readinessOnly) {
		console.info('[prepare]', {
			requestId,
			operation,
			from,
			readinessOnly: true,
			ready: result.ready,
		});
		return;
	}

	console.info('[prepare]', {
		requestId,
		operation,
		from,
		txCount: result.unsignedTransactions.length,
		signingMode: result.signingMode,
	});
}

function logPrepareFailure(
	operation: string,
	from: `0x${string}`,
	requestId: string,
	error: unknown,
): void {
	console.error('[prepare]', { requestId, operation, from, error });
}

export async function runPrepare<T extends PrepareResponse>(
	operation: string,
	env: Env,
	from: `0x${string}`,
	fn: (ctx: { requestId: string }) => Promise<T>,
	lane?: AccessLane,
): Promise<T> {
	await enforceWriteRateLimitForAddress(env, from, lane ?? getActiveLane());
	const requestId = createRequestId();

	try {
		const result = await fn({ requestId });
		logPrepareSuccess(operation, from, requestId, result);
		return result;
	} catch (error) {
		logPrepareFailure(operation, from, requestId, error);
		throw attachRequestId(error, requestId);
	}
}

export function finalizePrepareResult(
	requestId: string,
	result: Omit<PrepareResult, 'requestId' | 'instructions' | 'warnings'>,
	preflight?: Record<string, unknown>,
	extraWarnings: string[] = [],
): PrepareResult {
	const warnings = [...collectPreflightWarnings(preflight), ...extraWarnings];
	return {
		...result,
		requestId,
		warnings,
		instructions: buildPrepareInstructions(result.signingMode, result.unsignedTransactions.length),
	};
}