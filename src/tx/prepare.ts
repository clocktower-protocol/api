import type { WriteDetails, WriteSubscription } from '../abi/clocktower-write.js';
import { BASE_CHAIN_ID, resolveChain, type ChainConfig } from '../chain.js';
import { createClocktowerClient } from '../client.js';
import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import {
	parseAccountSubscriptionRecord,
	parseApprovedTokenRecord,
	parseSubscriptionRecord,
} from '../validation.js';
import {
	encodeApprove,
	encodeCancelSubscription,
	encodeCreateSubscription,
	encodeEditDetails,
	encodeRemit,
	encodeSubscribe,
	encodeUnsubscribe,
	encodeUnsubscribeByProvider,
} from './encode.js';
import { checkSubscribeReadiness, INFINITE_APPROVAL } from './preflight.js';
import {
	buildReadinessOnlyResult,
	finalizePrepareResult,
	runPrepare,
	type PrepareOptions,
} from './prepare-response.js';
import {
	buildGasSummary,
	buildRemitBacklogGasWarning,
	estimateGasForTransactions,
} from './gas.js';
import { checkRemitReadiness } from './remit-preflight.js';
import { simulateUnsignedTransactions } from './simulate.js';
import type { PrepareResponse, PrepareResult, UnsignedTransaction } from './types.js';

export type { PrepareOptions };

function toChainIdHex(chainId: number): `0x${string}` {
	return `0x${chainId.toString(16)}` as `0x${string}`;
}

/**
 * Reads the authoritative subscription from chain for the given id.
 * All prepare* write paths build their calldata from this canonical tuple,
 * never from user-supplied fields, so callers cannot smuggle mismatched
 * (id, amount, provider, token, frequency, dueDay) values that would either
 * confuse downstream consumers or pass weak local authorization checks.
 */
/**
 * L13 preflight: returns true if `account` is currently subscribed to the
 * given canonical subscription id.
 *
 * The on-chain contract reverts cleanly on `unsubscribe` from a non-subscriber,
 * but the user pays gas for the failed call. Throwing here also lets
 * `agents/x402` (verify-only-settle, see `buildPrepareResult` comment) skip
 * settlement so the caller is not charged for a doomed prepare.
 *
 * Note on consistency: this read hits the same RPC the user will eventually
 * broadcast through, so a just-subscribed user hitting an archive node before
 * reorg-finality could see a stale negative. The thrown error message guides
 * the user to retry rather than treating the result as authoritative.
 */
async function isAccountSubscribedTo(
	client: ReturnType<typeof createClocktowerClient>,
	chain: ChainConfig,
	account: `0x${string}`,
	canonicalId: `0x${string}`,
): Promise<boolean> {
	const raw = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'getAccountSubscriptions',
		args: [true, account],
	});
	const target = canonicalId.toLowerCase();
	return (raw as unknown[]).some((entry) => {
		const parsed = parseAccountSubscriptionRecord(entry);
		return parsed.subscription.id.toLowerCase() === target;
	});
}

export async function fetchCanonicalSubscription(
	client: ReturnType<typeof createClocktowerClient>,
	chain: ChainConfig,
	id: `0x${string}`,
): Promise<WriteSubscription> {
	const raw = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'idSubMap',
		args: [id],
	});
	const parsed = parseSubscriptionRecord(raw);
	// The contract returns a zero id for unknown ids.
	if (parsed.id === `0x${'00'.repeat(32)}`) {
		throw new Error('Subscription not found on chain');
	}
	return {
		id: parsed.id,
		amount: parsed.amount,
		provider: parsed.provider,
		token: parsed.token,
		cancelled: parsed.cancelled,
		frequency: parsed.frequency,
		dueDay: parsed.dueDay,
	};
}

/** Load a write subscription struct by id (protocol amount from chain). */
export async function loadWriteSubscriptionById(
	env: Env,
	id: `0x${string}`,
): Promise<WriteSubscription> {
	const chain = resolveChain(env);
	const client = createClocktowerClient(chain);
	return fetchCanonicalSubscription(client, chain, id);
}

function buildUnsigned(
	from: `0x${string}`,
	to: `0x${string}`,
	data: `0x${string}`,
	value = 0n,
): UnsignedTransaction {
	return {
		to,
		data,
		value,
		chainId: BASE_CHAIN_ID,
		from,
	};
}

async function buildPrepareResult(
	env: Env,
	from: `0x${string}`,
	unsigned: UnsignedTransaction[],
	requestId: string,
	preflight?: Record<string, unknown>,
	options?: PrepareOptions,
): Promise<PrepareResult> {
	const chain = resolveChain(env);
	const client = createClocktowerClient(chain);

	// Simulate before returning. A failed simulation guarantees the eventual
	// on-chain broadcast will revert, so throwing here
	// lets `agents/x402` (verify-only-settle, see node_modules/agents/dist/mcp/x402.js
	// `if (!failed)` around line 124) skip settlement so the caller is not
	// charged for a doomed prepare. This is the M1 fix tracked in
	// SECURITY_FOLLOWUPS.md.
	const simulation = await simulateUnsignedTransactions(client, unsigned);
	const firstFailure = simulation.find((s) => !s.success);
	if (firstFailure) {
		throw new Error(`Simulation failed: ${firstFailure.error ?? 'unknown error'}`);
	}

	const { estimates: gasEstimates, warnings: gasWarnings } = await estimateGasForTransactions(
		client,
		unsigned,
		{ simulateFromAddress: options?.simulateFromAddress },
	);

	const expectedTransactions =
		typeof preflight?.expectedTransactions === 'number'
			? preflight.expectedTransactions
			: undefined;
	const gasSummary = buildGasSummary(gasEstimates, {
		expectedTransactions: expectedTransactions ?? 1,
	});
	const backlogWarning =
		expectedTransactions !== undefined
			? buildRemitBacklogGasWarning(expectedTransactions, gasSummary)
			: null;
	const allGasWarnings = [
		...gasWarnings,
		...(backlogWarning ? [backlogWarning] : []),
	];

	const signingMode = unsigned.length > 1 ? 'eip5792' : 'raw';

	return finalizePrepareResult(
		requestId,
		{
			chainId: BASE_CHAIN_ID,
			signingMode,
			eip5792: {
				version: '1.0',
				chainId: toChainIdHex(BASE_CHAIN_ID),
				from,
				calls: unsigned.map((tx) => ({
					to: tx.to,
					data: tx.data,
					value: `0x${tx.value.toString(16)}` as `0x${string}`,
				})),
			},
			unsignedTransactions: unsigned.map((tx) => ({
				to: tx.to,
				data: tx.data,
				value: tx.value.toString(),
				chainId: tx.chainId,
				from: tx.from,
			})),
			simulation,
			gasEstimates,
			gasSummary,
			preflight,
		},
		preflight,
		allGasWarnings,
	);
}

export async function prepareCreateSubscription(
	env: Env,
	from: `0x${string}`,
	amount: bigint,
	token: `0x${string}`,
	details: WriteDetails,
	frequency: number,
	dueDay: number,
	options?: PrepareOptions,
): Promise<PrepareResponse> {
	return runPrepare('prepare_create_subscription', env, from, async ({ requestId }) => {
		const chain = resolveChain(env);
		const client = createClocktowerClient(chain);

		const approvedToken = parseApprovedTokenRecord(
			await client.readContract({
				address: chain.contractAddress,
				abi: CLOCKTOWER_READ_ABI,
				functionName: 'approvedERC20',
				args: [token],
			}),
		);

		// Throw rather than warn: a paused token cannot host new subscriptions, so
		// any prepare against it is guaranteed to revert. Throwing lets x402 skip
		// settlement (see comment in buildPrepareResult and M1 in SECURITY_FOLLOWUPS.md).
		if (approvedToken.paused) {
			throw new Error('Token is paused on protocol');
		}
		if (amount < approvedToken.minimum) {
			throw new Error(
				`Amount below token minimum (${approvedToken.minimum.toString()} protocol units)`,
			);
		}

		if (options?.readinessOnly) {
			return buildReadinessOnlyResult(
				requestId,
				'prepare_create_subscription',
				true,
				[],
				[],
				{
					token,
					frequency,
					dueDay,
					minimum: approvedToken.minimum.toString(),
					decimals: approvedToken.decimals,
				},
			);
		}

		const data = encodeCreateSubscription(amount, token, details, frequency, dueDay);
		const unsigned = [buildUnsigned(from, chain.contractAddress, data)];

		return buildPrepareResult(
			env,
			from,
			unsigned,
			requestId,
			{
				token,
				frequency,
				dueDay,
			},
			options,
		);
	}, options?.lane);
}

/**
 * Prepare subscribe using only a subscription id. Loads the on-chain struct
 * (amount is protocol units from storage) then runs {@link prepareSubscribe}.
 */
export async function prepareSubscribeById(
	env: Env,
	from: `0x${string}`,
	id: `0x${string}`,
	options?: PrepareOptions,
): Promise<PrepareResponse> {
	const subscription = await loadWriteSubscriptionById(env, id);
	return prepareSubscribe(env, from, subscription, options);
}

export async function prepareSubscribe(
	env: Env,
	from: `0x${string}`,
	subscription: WriteSubscription,
	options?: PrepareOptions,
): Promise<PrepareResponse> {
	return runPrepare('prepare_subscribe', env, from, async ({ requestId }) => {
		const chain = resolveChain(env);
		const readiness = await checkSubscribeReadiness(env, chain, from, subscription);

		if (options?.readinessOnly) {
			return buildReadinessOnlyResult(
				requestId,
				'prepare_subscribe',
				readiness.ready,
				readiness.errors,
				readiness.warnings,
				{
					needsApproval: readiness.needsApproval,
					allowance: readiness.allowance,
					balance: readiness.balance,
					requiredAmount: readiness.requiredAmount,
				},
			);
		}

		if (readiness.errors.length > 0) {
			throw new Error(readiness.errors.join('; '));
		}

		const sub = readiness.subscription ?? subscription;
		const unsigned: UnsignedTransaction[] = [];

		if (readiness.needsApproval) {
			const requiredNative = BigInt(readiness.requiredAmount);
			const approveAmount = options?.infiniteApproval
				? INFINITE_APPROVAL
				: requiredNative;
			unsigned.push(
				buildUnsigned(
					from,
					sub.token,
					encodeApprove(chain.contractAddress, approveAmount),
				),
			);
		}

		unsigned.push(
			buildUnsigned(from, chain.contractAddress, encodeSubscribe(sub)),
		);

		return buildPrepareResult(
			env,
			from,
			unsigned,
			requestId,
			{
				needsApproval: readiness.needsApproval,
				requiredAmount: readiness.requiredAmount,
				infiniteApproval: Boolean(options?.infiniteApproval),
				warnings: readiness.warnings,
			},
			options,
		);
	}, options?.lane);
}

export { checkSubscribeReadiness, checkRemitReadiness };

export async function prepareCancelSubscription(
	env: Env,
	from: `0x${string}`,
	subscription: WriteSubscription,
	options?: PrepareOptions,
): Promise<PrepareResponse> {
	return runPrepare('prepare_cancel_subscription', env, from, async ({ requestId }) => {
		const chain = resolveChain(env);
		const client = createClocktowerClient(chain);

		const canonical = await fetchCanonicalSubscription(client, chain, subscription.id);
		const isProvider = canonical.provider.toLowerCase() === from.toLowerCase();

		if (options?.readinessOnly) {
			return buildReadinessOnlyResult(
				requestId,
				'prepare_cancel_subscription',
				isProvider,
				isProvider ? [] : ['Only the subscription provider can cancel'],
				[],
				{ id: canonical.id, provider: canonical.provider },
			);
		}

		if (!isProvider) {
			throw new Error('Only the subscription provider can cancel');
		}

		const data = encodeCancelSubscription(canonical);
		const unsigned = [buildUnsigned(from, chain.contractAddress, data)];
		return buildPrepareResult(env, from, unsigned, requestId, { id: canonical.id }, options);
	}, options?.lane);
}

export async function prepareUnsubscribe(
	env: Env,
	from: `0x${string}`,
	subscription: WriteSubscription,
	options?: PrepareOptions,
): Promise<PrepareResponse> {
	return runPrepare('prepare_unsubscribe', env, from, async ({ requestId }) => {
		const chain = resolveChain(env);
		const client = createClocktowerClient(chain);

		const canonical = await fetchCanonicalSubscription(client, chain, subscription.id);

		// L13: confirm the caller is actually subscribed before encoding. The
		// contract reverts cleanly otherwise; this check just spares the user
		// gas (and, per M1, ensures x402 doesn't charge for a doomed prepare).
		const isSubscriber = await isAccountSubscribedTo(client, chain, from, canonical.id);

		if (options?.readinessOnly) {
			return buildReadinessOnlyResult(
				requestId,
				'prepare_unsubscribe',
				isSubscriber,
				isSubscriber
					? []
					: [
							`Account ${from} is not currently subscribed to ${canonical.id}; if you just subscribed, retry in a few seconds.`,
						],
				[],
				{ id: canonical.id },
			);
		}

		if (!isSubscriber) {
			throw new Error(
				`Account ${from} is not currently subscribed to ${canonical.id}; ` +
					'if you just subscribed, retry in a few seconds.',
			);
		}

		const data = encodeUnsubscribe(canonical);
		const unsigned = [buildUnsigned(from, chain.contractAddress, data)];
		return buildPrepareResult(
			env,
			from,
			unsigned,
			requestId,
			{
				id: canonical.id,
				note: 'Caller must be an active subscriber',
			},
			options,
		);
	}, options?.lane);
}

export async function prepareUnsubscribeByProvider(
	env: Env,
	from: `0x${string}`,
	subscription: WriteSubscription,
	subscriber: `0x${string}`,
	options?: PrepareOptions,
): Promise<PrepareResponse> {
	return runPrepare('prepare_unsubscribe_by_provider', env, from, async ({ requestId }) => {
		const chain = resolveChain(env);
		const client = createClocktowerClient(chain);

		const canonical = await fetchCanonicalSubscription(client, chain, subscription.id);
		const isProvider = canonical.provider.toLowerCase() === from.toLowerCase();

		if (options?.readinessOnly) {
			return buildReadinessOnlyResult(
				requestId,
				'prepare_unsubscribe_by_provider',
				isProvider,
				isProvider ? [] : ['Only the subscription provider can unsubscribe a subscriber'],
				[],
				{ id: canonical.id, subscriber, provider: canonical.provider },
			);
		}

		if (!isProvider) {
			throw new Error('Only the subscription provider can unsubscribe a subscriber');
		}

		const data = encodeUnsubscribeByProvider(canonical, subscriber);
		const unsigned = [buildUnsigned(from, chain.contractAddress, data)];
		return buildPrepareResult(
			env,
			from,
			unsigned,
			requestId,
			{ id: canonical.id, subscriber },
			options,
		);
	}, options?.lane);
}

export async function prepareEditDetails(
	env: Env,
	from: `0x${string}`,
	id: `0x${string}`,
	details: WriteDetails,
	options?: PrepareOptions,
): Promise<PrepareResponse> {
	return runPrepare('prepare_edit_details', env, from, async ({ requestId }) => {
		const chain = resolveChain(env);
		const client = createClocktowerClient(chain);

		// Validate the subscription exists and the caller is the provider before
		// encoding calldata. The on-chain check is authoritative, but failing here
		// avoids burning the user's gas on a guaranteed revert.
		const canonical = await fetchCanonicalSubscription(client, chain, id);
		const isProvider = canonical.provider.toLowerCase() === from.toLowerCase();

		if (options?.readinessOnly) {
			return buildReadinessOnlyResult(
				requestId,
				'prepare_edit_details',
				isProvider,
				isProvider ? [] : ['Only the subscription provider can edit details'],
				[],
				{ id: canonical.id, provider: canonical.provider },
			);
		}

		if (!isProvider) {
			throw new Error('Only the subscription provider can edit details');
		}

		const data = encodeEditDetails(details, id);
		const unsigned = [buildUnsigned(from, chain.contractAddress, data)];
		return buildPrepareResult(
			env,
			from,
			unsigned,
			requestId,
			{
				id: canonical.id,
				note: 'Caller must be the subscription provider (createdSubs)',
			},
			options,
		);
	}, options?.lane);
}

export async function prepareRemit(
	env: Env,
	from: `0x${string}`,
	options?: PrepareOptions,
): Promise<PrepareResponse> {
	return runPrepare('prepare_remit', env, from, async ({ requestId }) => {
		const readiness = await checkRemitReadiness(env, from);

		if (options?.readinessOnly) {
			return buildReadinessOnlyResult(
				requestId,
				'prepare_remit',
				readiness.ready,
				readiness.errors,
				readiness.warnings,
				{
					currentDay: readiness.currentDay,
					nextUncheckedDay: readiness.nextUncheckedDay,
					totalSubscriptions: readiness.totalSubscriptions,
					maxRemits: readiness.maxRemits,
					expectedTransactions: readiness.expectedTransactions,
				},
			);
		}

		if (!readiness.ready) {
			throw new Error(readiness.errors[0] ?? 'Remit not ready');
		}

		const chain = resolveChain(env);
		const data = encodeRemit();
		const unsigned = [buildUnsigned(from, chain.contractAddress, data)];

		return buildPrepareResult(
			env,
			from,
			unsigned,
			requestId,
			{
				currentDay: readiness.currentDay,
				nextUncheckedDay: readiness.nextUncheckedDay,
				totalSubscriptions: readiness.totalSubscriptions,
				maxRemits: readiness.maxRemits,
				expectedTransactions: readiness.expectedTransactions,
				warnings: readiness.warnings,
			},
			options,
		);
	}, options?.lane);
}
