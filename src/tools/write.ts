/**
 * Write tools: prepare unsigned Clocktower transactions (x402) and relay user-signed raw txs.
 * Signing happens on the client wallet. EIP-5792 batch descriptors are returned when multiple
 * steps are needed (e.g. approve + subscribe). Gas is always paid by the user.
 */
import { z } from 'zod';
import {
	checkSubscribeReadiness,
	prepareCancelSubscription,
	prepareCreateSubscription,
	prepareEditDetails,
	prepareSubscribe,
	prepareUnsubscribe,
	prepareUnsubscribeByProvider,
} from '../tx/prepare.js';
import { getTransactionStatus, submitSignedTransactions } from '../tx/submit.js';
import {
	WRITE_PREPARE_PRICE,
	WRITE_READINESS_PRICE,
	WRITE_SUBMIT_PRICE,
} from '../tx/constants.js';
import {
	createSubscriptionInputSchema,
	editDetailsInputSchema,
	subscribeInputSchema,
	subscriptionActionInputSchema,
	toWriteDetails,
	toWriteSubscription,
	unsubscribeByProviderInputSchema,
} from '../validation-write.js';
import { addressSchema, bytes32Schema } from '../validation.js';
import { textResult } from '../utils.js';
import type { X402McpServer } from './types.js';

const writeAnnotations = { readOnlyHint: false };
const destructiveAnnotations = { readOnlyHint: false, destructiveHint: true };

export function registerWriteTools(server: X402McpServer, env: Env) {
	server.paidTool(
		'check_subscribe_readiness',
		'Check allowance, balance, and protocol rules before subscribing on Base mainnet',
		WRITE_READINESS_PRICE,
		{
			from: addressSchema,
			subscription: subscribeInputSchema.shape.subscription,
		},
		{ readOnlyHint: true },
		async ({ from, subscription }) => {
			const { resolveChain } = await import('../chain.js');
			const sub = toWriteSubscription(
				subscription as Parameters<typeof toWriteSubscription>[0],
			);
			const result = await checkSubscribeReadiness(
				env,
				resolveChain(env),
				from as `0x${string}`,
				sub,
			);
			return textResult(result);
		},
	);

	server.paidTool(
		'prepare_create_subscription',
		'Prepare unsigned createSubscription transaction on Base mainnet',
		WRITE_PREPARE_PRICE,
		{
			from: addressSchema,
			amount: z.string().describe('Protocol amount as decimal string (18 decimals)'),
			token: addressSchema,
			details: createSubscriptionInputSchema.shape.details,
			frequency: z.number().int().min(0).max(3),
			dueDay: z.number().int(),
		},
		writeAnnotations,
		async (args) => {
			const parsed = createSubscriptionInputSchema.parse(args);
			return textResult(
				await prepareCreateSubscription(
					env,
					parsed.from,
					parsed.amount,
					parsed.token,
					toWriteDetails(parsed.details),
					parsed.frequency,
					parsed.dueDay,
				),
			);
		},
	);

	server.paidTool(
		'prepare_subscribe',
		'Prepare unsigned subscribe transaction(s) including ERC20 approve when needed on Base mainnet',
		WRITE_PREPARE_PRICE,
		{
			from: addressSchema,
			subscription: subscribeInputSchema.shape.subscription,
		},
		writeAnnotations,
		async ({ from, subscription }) => {
			const parsed = subscribeInputSchema.parse({ from, subscription });
			return textResult(
				await prepareSubscribe(env, parsed.from, toWriteSubscription(parsed.subscription)),
			);
		},
	);

	server.paidTool(
		'prepare_cancel_subscription',
		'Prepare unsigned cancelSubscription for the provider on Base mainnet',
		WRITE_PREPARE_PRICE,
		{
			from: addressSchema,
			subscription: subscriptionActionInputSchema.shape.subscription,
		},
		destructiveAnnotations,
		async ({ from, subscription }) => {
			const parsed = subscriptionActionInputSchema.parse({ from, subscription });
			return textResult(
				await prepareCancelSubscription(
					env,
					parsed.from,
					toWriteSubscription(parsed.subscription),
				),
			);
		},
	);

	server.paidTool(
		'prepare_unsubscribe',
		'Prepare unsigned unsubscribe transaction for a subscriber on Base mainnet',
		WRITE_PREPARE_PRICE,
		{
			from: addressSchema,
			subscription: subscriptionActionInputSchema.shape.subscription,
		},
		destructiveAnnotations,
		async ({ from, subscription }) => {
			const parsed = subscriptionActionInputSchema.parse({ from, subscription });
			return textResult(
				await prepareUnsubscribe(env, parsed.from, toWriteSubscription(parsed.subscription)),
			);
		},
	);

	server.paidTool(
		'prepare_unsubscribe_by_provider',
		'Prepare unsigned unsubscribeByProvider transaction on Base mainnet',
		WRITE_PREPARE_PRICE,
		{
			from: addressSchema,
			subscription: unsubscribeByProviderInputSchema.shape.subscription,
			subscriber: addressSchema,
		},
		destructiveAnnotations,
		async (args) => {
			const parsed = unsubscribeByProviderInputSchema.parse(args);
			return textResult(
				await prepareUnsubscribeByProvider(
					env,
					parsed.from,
					toWriteSubscription(parsed.subscription),
					parsed.subscriber,
				),
			);
		},
	);

	server.paidTool(
		'prepare_edit_details',
		'Prepare unsigned editDetails transaction on Base mainnet',
		WRITE_PREPARE_PRICE,
		{
			from: addressSchema,
			id: bytes32Schema,
			details: editDetailsInputSchema.shape.details,
		},
		writeAnnotations,
		async (args) => {
			const parsed = editDetailsInputSchema.parse(args);
			return textResult(
				await prepareEditDetails(
					env,
					parsed.from,
					parsed.id,
					toWriteDetails(parsed.details),
				),
			);
		},
	);

	server.paidTool(
		'submit_signed_transactions',
		'Broadcast user-signed raw transactions matching a prior prepare intent on Base mainnet',
		WRITE_SUBMIT_PRICE,
		{
			prepareId: z.string().uuid(),
			signedTransactions: z
				.array(z.string().regex(/^0x[a-fA-F0-9]+$/))
				.min(1)
				.max(5),
		},
		writeAnnotations,
		async (args) => {
			const { prepareId, signedTransactions } = args as {
				prepareId: string;
				signedTransactions: `0x${string}`[];
			};

			return textResult(
				await submitSignedTransactions(env, prepareId, signedTransactions),
			);
		},
	);

	server.paidTool(
		'get_transaction_status',
		'Get confirmation status for a transaction hash on Base mainnet',
		WRITE_READINESS_PRICE,
		{
			txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
		},
		{ readOnlyHint: true },
		async ({ txHash }) =>
			textResult(await getTransactionStatus(env, txHash as `0x${string}`)),
	);
}
