/**
 * Write tools: prepare unsigned Clocktower transactions (x402).
 * Signing and broadcasting happen in the client wallet. EIP-5792 batch descriptors are
 * returned when multiple steps are needed (e.g. approve + subscribe). Gas is always paid
 * by the user.
 */
import { z } from 'zod';
import type { AccessLane } from '../config/rateLimits.js';
import {
	checkSubscribeReadiness,
	checkRemitReadiness,
	prepareCancelSubscription,
	prepareCancelSubscriptionById,
	prepareCreateSubscription,
	prepareEditDetails,
	prepareRemit,
	prepareSubscribe,
	prepareSubscribeById,
	loadWriteSubscriptionById,
	prepareUnsubscribe,
	prepareUnsubscribeById,
	prepareUnsubscribeByProvider,
	prepareUnsubscribeByProviderById,
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
	subscribeByIdInputSchema,
	subscriptionActionInputSchema,
	subscriptionActionByIdInputSchema,
	toWriteDetails,
	toWriteSubscription,
	unsubscribeByProviderInputSchema,
	unsubscribeByProviderByIdInputSchema,
} from '../validation-write.js';
import { addressSchema, bytes32Schema } from '../validation.js';
import { textResult } from '../utils.js';
import { registerDynamicPaidTool } from '../mcp/paidToolDynamic.js';
import { safeHandler } from './safeHandler.js';
import type { PaidToolHandler, X402McpServer } from './types.js';
import { normalizeSubscriptionAmount } from '../tx/amount.js';

const writeAnnotations = { readOnlyHint: false };
const destructiveAnnotations = { readOnlyHint: false, destructiveHint: true };

/** Explicit MCP lane for write RPM (no isolate-global request lane). */
const MCP_PREPARE_LANE = { lane: 'mcp' as AccessLane };

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
				const normalized = await normalizeSubscriptionAmount(env, subscription);
				const sub = toWriteSubscription(normalized);
				const result = await checkSubscribeReadiness(
					env,
					resolveChain(env),
					from as `0x${string}`,
					sub,
				);
				return textResult(result);
			}),
	);

	server.paidTool(
		'check_subscribe_readiness_by_id',
		'Check subscribe readiness using only a subscription id (loads amount/token from chain on Base mainnet)',
		API_PRICES.checkSubscribeReadiness,
		{
			from: addressSchema,
			id: bytes32Schema.describe('Subscription id; amount and token are loaded from chain'),
		},
		{ readOnlyHint: true },
		async ({ from, id }) =>
			safeHandler('check_subscribe_readiness_by_id', async () => {
				const { resolveChain } = await import('../chain.js');
				const sub = await loadWriteSubscriptionById(env, id as `0x${string}`);
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
							...MCP_PREPARE_LANE,
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
		'Prepare unsigned subscribe transaction(s) including ERC20 approve when needed on Base mainnet. Approves the subscription amount by default; set infiniteApproval for max allowance.',
		{
			from: addressSchema,
			subscription: subscribeInputSchema.shape.subscription,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			infiniteApproval: subscribeInputSchema.shape.infiniteApproval,
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
							...MCP_PREPARE_LANE,
							readinessOnly: parsed.readinessOnly,
							simulateFromAddress: parsed.simulateFromAddress,
							infiniteApproval: parsed.infiniteApproval,
						},
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_subscribe_by_id',
		'Prepare unsigned subscribe by subscription id only (loads amount/token from chain). Approves the subscription amount by default; set infiniteApproval for max allowance.',
		{
			from: addressSchema,
			id: bytes32Schema.describe('Subscription id; amount and token are loaded from chain'),
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			infiniteApproval: subscribeByIdInputSchema.shape.infiniteApproval,
		},
		writeAnnotations,
		async (args) =>
			safeHandler('prepare_subscribe_by_id', async () => {
				const parsed = subscribeByIdInputSchema.parse(args);

				return textResult(
					await prepareSubscribeById(
						env,
						parsed.from,
						parsed.id,
						{
							...MCP_PREPARE_LANE,
							readinessOnly: parsed.readinessOnly,
							simulateFromAddress: parsed.simulateFromAddress,
							infiniteApproval: parsed.infiniteApproval,
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
							...MCP_PREPARE_LANE,
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
		'prepare_cancel_subscription_by_id',
		'Prepare unsigned cancelSubscription using only subscription id (preferred)',
		{
			from: addressSchema,
			id: bytes32Schema.describe('Subscription id; remaining fields loaded from chain'),
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
		},
		destructiveAnnotations,
		async (args) =>
			safeHandler('prepare_cancel_subscription_by_id', async () => {
				const parsed = subscriptionActionByIdInputSchema.parse(args);
				return textResult(
					await prepareCancelSubscriptionById(
						env,
						parsed.from,
						parsed.id,
						{
							...MCP_PREPARE_LANE,
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
							...MCP_PREPARE_LANE,
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
		'prepare_unsubscribe_by_id',
		'Prepare unsigned unsubscribe using only subscription id (preferred)',
		{
			from: addressSchema,
			id: bytes32Schema.describe('Subscription id; remaining fields loaded from chain'),
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
		},
		destructiveAnnotations,
		async (args) =>
			safeHandler('prepare_unsubscribe_by_id', async () => {
				const parsed = subscriptionActionByIdInputSchema.parse(args);
				return textResult(
					await prepareUnsubscribeById(
						env,
						parsed.from,
						parsed.id,
						{
							...MCP_PREPARE_LANE,
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
							...MCP_PREPARE_LANE,
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
		'prepare_unsubscribe_by_provider_by_id',
		'Prepare unsigned unsubscribeByProvider using only subscription id + subscriber (preferred)',
		{
			from: addressSchema,
			id: bytes32Schema.describe('Subscription id; remaining fields loaded from chain'),
			subscriber: addressSchema,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
		},
		destructiveAnnotations,
		async (args) =>
			safeHandler('prepare_unsubscribe_by_provider_by_id', async () => {
				const parsed = unsubscribeByProviderByIdInputSchema.parse(args);
				return textResult(
					await prepareUnsubscribeByProviderById(
						env,
						parsed.from,
						parsed.id,
						parsed.subscriber,
						{
							...MCP_PREPARE_LANE,
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
							...MCP_PREPARE_LANE,
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
						...MCP_PREPARE_LANE,
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