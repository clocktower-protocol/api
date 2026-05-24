import type { WriteDetails, WriteSubscription } from '../abi/clocktower-write.js';
import { BASE_CHAIN_ID, resolveChain } from '../chain.js';
import { createClocktowerClient } from '../client.js';
import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import { parseApprovedTokenRecord } from '../validation.js';
import {
	encodeApprove,
	encodeCancelSubscription,
	encodeCreateSubscription,
	encodeEditDetails,
	encodeSubscribe,
	encodeUnsubscribe,
	encodeUnsubscribeByProvider,
} from './encode.js';
import { storePrepareIntent } from './intent.js';
import { checkSubscribeReadiness, INFINITE_APPROVAL } from './preflight.js';
import { simulateUnsignedTransactions } from './simulate.js';
import type { PrepareResult, UnsignedTransaction } from './types.js';

function toChainIdHex(chainId: number): `0x${string}` {
	return `0x${chainId.toString(16)}` as `0x${string}`;
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
	preflight?: Record<string, unknown>,
): Promise<PrepareResult> {
	const chain = resolveChain(env);
	const client = createClocktowerClient(chain);
	const intent = await storePrepareIntent(env, from, unsigned);
	const simulation = await simulateUnsignedTransactions(client, unsigned);

	const signingMode = unsigned.length > 1 ? 'eip5792' : 'raw';

	return {
		prepareId: intent.prepareId,
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
		preflight,
	};
}

export async function prepareCreateSubscription(
	env: Env,
	from: `0x${string}`,
	amount: bigint,
	token: `0x${string}`,
	details: WriteDetails,
	frequency: number,
	dueDay: number,
): Promise<PrepareResult> {
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

	const warnings: string[] = [];
	if (approvedToken.paused) {
		warnings.push('Token is paused on protocol');
	}
	if (amount < approvedToken.minimum) {
		throw new Error(
			`Amount below token minimum (${approvedToken.minimum.toString()} protocol units)`,
		);
	}

	const data = encodeCreateSubscription(amount, token, details, frequency, dueDay);
	const unsigned = [buildUnsigned(from, chain.contractAddress, data)];

	return buildPrepareResult(env, from, unsigned, {
		token,
		frequency,
		dueDay,
		warnings,
	});
}

export async function prepareSubscribe(
	env: Env,
	from: `0x${string}`,
	subscription: WriteSubscription,
): Promise<PrepareResult> {
	const chain = resolveChain(env);
	const readiness = await checkSubscribeReadiness(env, chain, from, subscription);

	if (readiness.errors.length > 0) {
		throw new Error(readiness.errors.join('; '));
	}

	const sub = readiness.subscription ?? subscription;
	const unsigned: UnsignedTransaction[] = [];

	if (readiness.needsApproval) {
		unsigned.push(
			buildUnsigned(
				from,
				sub.token,
				encodeApprove(chain.contractAddress, INFINITE_APPROVAL),
			),
		);
	}

	unsigned.push(
		buildUnsigned(from, chain.contractAddress, encodeSubscribe(sub)),
	);

	return buildPrepareResult(env, from, unsigned, {
		needsApproval: readiness.needsApproval,
		warnings: readiness.warnings,
	});
}

export { checkSubscribeReadiness };

export async function prepareCancelSubscription(
	env: Env,
	from: `0x${string}`,
	subscription: WriteSubscription,
): Promise<PrepareResult> {
	const chain = resolveChain(env);
	if (subscription.provider.toLowerCase() !== from.toLowerCase()) {
		throw new Error('Only the subscription provider can cancel');
	}

	const data = encodeCancelSubscription(subscription);
	const unsigned = [buildUnsigned(from, chain.contractAddress, data)];
	return buildPrepareResult(env, from, unsigned);
}

export async function prepareUnsubscribe(
	env: Env,
	from: `0x${string}`,
	subscription: WriteSubscription,
): Promise<PrepareResult> {
	const chain = resolveChain(env);
	const data = encodeUnsubscribe(subscription);
	const unsigned = [buildUnsigned(from, chain.contractAddress, data)];
	return buildPrepareResult(env, from, unsigned, {
		note: 'Caller must be an active subscriber',
	});
}

export async function prepareUnsubscribeByProvider(
	env: Env,
	from: `0x${string}`,
	subscription: WriteSubscription,
	subscriber: `0x${string}`,
): Promise<PrepareResult> {
	const chain = resolveChain(env);
	if (subscription.provider.toLowerCase() !== from.toLowerCase()) {
		throw new Error('Only the subscription provider can unsubscribe a subscriber');
	}

	const data = encodeUnsubscribeByProvider(subscription, subscriber);
	const unsigned = [buildUnsigned(from, chain.contractAddress, data)];
	return buildPrepareResult(env, from, unsigned, { subscriber });
}

export async function prepareEditDetails(
	env: Env,
	from: `0x${string}`,
	id: `0x${string}`,
	details: WriteDetails,
): Promise<PrepareResult> {
	const chain = resolveChain(env);
	const data = encodeEditDetails(details, id);
	const unsigned = [buildUnsigned(from, chain.contractAddress, data)];
	return buildPrepareResult(env, from, unsigned, {
		note: 'Caller must be the subscription provider (createdSubs)',
	});
}
