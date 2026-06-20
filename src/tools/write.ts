/**
 * Write tools: prepare unsigned Clocktower transactions (x402).
 * Signing and broadcasting happen in the client wallet. EIP-5792 batch descriptors are
 * returned when multiple steps are needed (e.g. approve + subscribe). Gas is always paid
 * by the user.
 */
import { z } from 'zod';
import {
	checkSubscribeReadiness,
	checkRemitReadiness,
	prepareCancelSubscription,
	prepareCreateSubscription,
	prepareEditDetails,
	prepareRemit,
	prepareSubscribe,
	prepareUnsubscribe,
	prepareUnsubscribeByProvider,
} from '../tx/prepare.js';
import { getTransactionStatus } from '../tx/status.js';
import {
	API_PRICES,
	getRemitPreparePrice,
	getStandardPreparePrice,
} from '../api/pricing.js';
import {
	createSubscriptionInputSchema,
	editDetailsInputSchema,
	readinessOnlySchema,
	simulateFromAddressSchema,
	remitInputSchema,
	subscribeInputSchema,
	subscriptionActionInputSchema,
	toWriteDetails,
	toWriteSubscription,
	unsubscribeByProviderInputSchema,
} from '../validation-write.js';
import { addressSchema, bytes32Schema } from '../validation.js';
import { textResult } from '../utils.js';
import { registerDynamicPaidTool } from '../mcp/paidToolDynamic.js';
import { safeHandler } from './safeHandler.js';
import type { PaidToolHandler, X402McpServer } from './types.js';
import { normalizeSubscriptionAmount } from '../tx/amount.js';

const writeAnnotations = { readOnlyHint: false };
const destructiveAnnotations = { readOnlyHint: false, destructiveHint: true };

function preparePrice(args: Record<string, unknown>): number {
	return getStandardPreparePrice(args.readinessOnly as boolean | undefined);
}

function registerPrepareTool(
	server: X402McpServer,
	env: Env,
	name: string,
	description: string,
	paramsSchema: Record<string, z.ZodTypeAny>,
	annotations: Record<string, unknown>,
	handler: PaidToolHandler,
	priceFn: (args: Record<string, unknown>) => number = preparePrice,
): void {
	registerDynamicPaidTool(server, env, name, description, priceFn, paramsSchema, annotations, handler);
}

export function registerWriteTools(server: X402McpServer, env: Env) {
	server.paidTool(
		'check_subscribe_readiness',
		'Check allowance, balance, and protocol rules before subscribing on Base mainnet',
		API_PRICES.checkSubscribeReadiness,
		{
			from: addressSchema,
			subscription: subscribeInputSchema.shape.subscription,
		},
		{ readOnlyHint: true },
		async ({ from, subscription }) =>
			safeHandler('check_subscribe_readiness', async () => {
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
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_create_subscription',
		'Prepare unsigned createSubscription transaction on Base mainnet',
		{
			from: addressSchema,
			amount: z.string().describe('Human amount in the token\'s native decimals (e.g. "100.5" for USDC)'),
			token: addressSchema,
			details: createSubscriptionInputSchema.shape.details,
			frequency: z.number().int().min(0).max(3),
			dueDay: z.number().int(),
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
		},
		writeAnnotations,
		async (args) =>
			safeHandler('prepare_create_subscription', async () => {
				const parsed = createSubscriptionInputSchema.parse(args);

				const normalized = await normalizeSubscriptionAmount(env, {
					amount: parsed.amount,
					token: parsed.token,
				});

				return textResult(
					await prepareCreateSubscription(
						env,
						parsed.from,
						normalized.amount,
						parsed.token,
						toWriteDetails(parsed.details),
						parsed.frequency,
						parsed.dueDay,
						{
							readinessOnly: parsed.readinessOnly,
							simulateFromAddress: parsed.simulateFromAddress,
						},
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_subscribe',
		'Prepare unsigned subscribe transaction(s) including ERC20 approve when needed on Base mainnet',
		{
			from: addressSchema,
			subscription: subscribeInputSchema.shape.subscription,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
		},
		writeAnnotations,
		async (args) =>
			safeHandler('prepare_subscribe', async () => {
				const parsed = subscribeInputSchema.parse(args);

				const normalizedSubscription = await normalizeSubscriptionAmount(env, parsed.subscription);

				return textResult(
					await prepareSubscribe(
						env,
						parsed.from,
						toWriteSubscription(normalizedSubscription),
						{
							readinessOnly: parsed.readinessOnly,
							simulateFromAddress: parsed.simulateFromAddress,
						},
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_cancel_subscription',
		'Prepare unsigned cancelSubscription for the provider on Base mainnet',
		{
			from: addressSchema,
			subscription: subscriptionActionInputSchema.shape.subscription,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
		},
		destructiveAnnotations,
		async (args) =>
			safeHandler('prepare_cancel_subscription', async () => {
				const parsed = subscriptionActionInputSchema.parse(args);
				const normalizedSubscription = await normalizeSubscriptionAmount(env, parsed.subscription);

				return textResult(
					await prepareCancelSubscription(
						env,
						parsed.from,
						toWriteSubscription(normalizedSubscription),
						{
							readinessOnly: parsed.readinessOnly,
							simulateFromAddress: parsed.simulateFromAddress,
						},
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_unsubscribe',
		'Prepare unsigned unsubscribe transaction for a subscriber on Base mainnet',
		{
			from: addressSchema,
			subscription: subscriptionActionInputSchema.shape.subscription,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
		},
		destructiveAnnotations,
		async (args) =>
			safeHandler('prepare_unsubscribe', async () => {
				const parsed = subscriptionActionInputSchema.parse(args);
				const normalizedSubscription = await normalizeSubscriptionAmount(env, parsed.subscription);

				return textResult(
					await prepareUnsubscribe(
						env,
						parsed.from,
						toWriteSubscription(normalizedSubscription),
						{
							readinessOnly: parsed.readinessOnly,
							simulateFromAddress: parsed.simulateFromAddress,
						},
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_unsubscribe_by_provider',
		'Prepare unsigned unsubscribeByProvider transaction on Base mainnet',
		{
			from: addressSchema,
			subscription: unsubscribeByProviderInputSchema.shape.subscription,
			subscriber: addressSchema,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
		},
		destructiveAnnotations,
		async (args) =>
			safeHandler('prepare_unsubscribe_by_provider', async () => {
				const parsed = unsubscribeByProviderInputSchema.parse(args);
				const normalizedSubscription = await normalizeSubscriptionAmount(env, parsed.subscription);

				return textResult(
					await prepareUnsubscribeByProvider(
						env,
						parsed.from,
						toWriteSubscription(normalizedSubscription),
						parsed.subscriber,
						{
							readinessOnly: parsed.readinessOnly,
							simulateFromAddress: parsed.simulateFromAddress,
						},
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_edit_details',
		'Prepare unsigned editDetails transaction on Base mainnet',
		{
			from: addressSchema,
			id: bytes32Schema,
			details: editDetailsInputSchema.shape.details,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
		},
		writeAnnotations,
		async (args) =>
			safeHandler('prepare_edit_details', async () => {
				const parsed = editDetailsInputSchema.parse(args);
				return textResult(
					await prepareEditDetails(
						env,
						parsed.from,
						parsed.id,
						toWriteDetails(parsed.details),
						{
							readinessOnly: parsed.readinessOnly,
							simulateFromAddress: parsed.simulateFromAddress,
						},
					),
				);
			}),
	);

	server.paidTool(
		'check_remit_readiness',
		'Check whether remit() is callable on Base mainnet (nextUncheckedDay, due subscription scan, pagination hints)',
		API_PRICES.checkRemitReadiness,
		{
			from: addressSchema,
		},
		{ readOnlyHint: true },
		async ({ from }) =>
			safeHandler('check_remit_readiness', async () => {
				const parsed = remitInputSchema.parse({ from });
				return textResult(await checkRemitReadiness(env, parsed.from));
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_remit',
		'Prepare unsigned remit() transaction on Base mainnet (permissionless; earns caller fees in subscription tokens)',
		{
			from: addressSchema,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
		},
		destructiveAnnotations,
		async (args) =>
			safeHandler('prepare_remit', async () => {
				const parsed = remitInputSchema.parse(args);
				return textResult(
					await prepareRemit(env, parsed.from, {
						readinessOnly: parsed.readinessOnly,
						simulateFromAddress: parsed.simulateFromAddress,
					}),
				);
			}),
		(args) => getRemitPreparePrice(args.readinessOnly as boolean | undefined),
	);

	server.paidTool(
		'get_transaction_status',
		'Get confirmation status for a transaction hash on Base mainnet',
		API_PRICES.getTransactionStatus,
		{
			txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
		},
		{ readOnlyHint: true },
		async ({ txHash }) =>
			safeHandler('get_transaction_status', async () =>
				textResult(await getTransactionStatus(env, txHash as `0x${string}`)),
			),
	);
}