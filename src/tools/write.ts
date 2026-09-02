/**
 * Write tools: prepare unsigned Clocktower transactions.
 * When MCP_X402_ENABLED is true, tools are x402-priced. Signing and broadcasting
 * happen in the client wallet. EIP-5792 batch descriptors are
 * returned when multiple steps are needed (e.g. approve + subscribe). Gas is always paid
 * by the user.
 */
import { z } from 'zod';
import type { AccessLane } from '../config/rateLimits.js';
import { isMcpX402Enabled, parseMcpAccessLane } from '../config/mcpX402.js';
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
import { mcpChain, mcpChainIdSchema } from './mcpChain.js';
import { safeHandler } from './safeHandler.js';
import type { PaidToolHandler, X402McpServer } from './types.js';
import { normalizeSubscriptionAmount } from '../tx/amount.js';
import type { PrepareOptions } from '../tx/prepare.js';
import type { ChainConfig } from '../chain.js';

const writeAnnotations = { readOnlyHint: false };
const destructiveAnnotations = { readOnlyHint: false, destructiveHint: true };

function mcpWriteLane(env: Env, extra?: unknown): AccessLane {
	if (isMcpX402Enabled(env)) {
		return 'mcp';
	}
	return parseMcpAccessLane(extra);
}

function mcpToolChain(env: Env, args: Record<string, unknown>): ChainConfig {
	return mcpChain(env, args.chainId as string | number | undefined);
}

function mcpPrepareOptions(
	env: Env,
	extra: unknown,
	args: Record<string, unknown>,
	parsed: {
		readinessOnly?: boolean;
		simulateFromAddress?: `0x${string}`;
		infiniteApproval?: boolean;
	},
): PrepareOptions {
	return {
		lane: mcpWriteLane(env, extra),
		readinessOnly: parsed.readinessOnly,
		simulateFromAddress: parsed.simulateFromAddress,
		infiniteApproval: parsed.infiniteApproval,
		chain: mcpToolChain(env, args),
	};
}

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
		'Check allowance, balance, and protocol rules before subscribing. Optional chainId, default Base (8453)',
		API_PRICES.checkSubscribeReadiness,
		{
			from: addressSchema,
			subscription: subscribeInputSchema.shape.subscription,
			chainId: mcpChainIdSchema,
		},
		{ readOnlyHint: true },
		async (args) =>
			safeHandler('check_subscribe_readiness', async () => {
				const chain = mcpToolChain(env, args);
				const normalized = await normalizeSubscriptionAmount(env, args.subscription, chain);
				const sub = toWriteSubscription(normalized);
				const result = await checkSubscribeReadiness(
					env,
					chain,
					args.from as `0x${string}`,
					sub,
				);
				return textResult(result);
			}),
	);

	server.paidTool(
		'check_subscribe_readiness_by_id',
		'Check subscribe readiness using only a subscription id (loads amount/token from chain). Optional chainId, default Base (8453)',
		API_PRICES.checkSubscribeReadiness,
		{
			from: addressSchema,
			id: bytes32Schema.describe('Subscription id; amount and token are loaded from chain'),
			chainId: mcpChainIdSchema,
		},
		{ readOnlyHint: true },
		async (args) =>
			safeHandler('check_subscribe_readiness_by_id', async () => {
				const chain = mcpToolChain(env, args);
				const sub = await loadWriteSubscriptionById(env, args.id as `0x${string}`, chain);
				const result = await checkSubscribeReadiness(
					env,
					chain,
					args.from as `0x${string}`,
					sub,
				);
				return textResult(result);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_create_subscription',
		'Prepare unsigned createSubscription transaction. Optional chainId, default Base (8453)',
		{
			from: addressSchema,
			amount: z.string().describe('Human amount in the token\'s native decimals (e.g. "100.5" for USDC)'),
			token: addressSchema,
			details: createSubscriptionInputSchema.shape.details,
			frequency: z.number().int().min(0).max(3),
			dueDay: z.number().int(),
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			chainId: mcpChainIdSchema,
		},
		writeAnnotations,
		async (args, extra) =>
			safeHandler('prepare_create_subscription', async () => {
				const parsed = createSubscriptionInputSchema.parse(args);
				const chain = mcpToolChain(env, args);

				const normalized = await normalizeSubscriptionAmount(
					env,
					{
						amount: parsed.amount,
						token: parsed.token,
					},
					chain,
				);

				return textResult(
					await prepareCreateSubscription(
						env,
						parsed.from,
						normalized.amount,
						parsed.token,
						toWriteDetails(parsed.details),
						parsed.frequency,
						parsed.dueDay,
						mcpPrepareOptions(env, extra, args, parsed),
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_subscribe',
		'Prepare unsigned subscribe transaction(s) including ERC20 approve when needed. Optional chainId, default Base (8453). Approves the subscription amount by default; set infiniteApproval for max allowance.',
		{
			from: addressSchema,
			subscription: subscribeInputSchema.shape.subscription,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			infiniteApproval: subscribeInputSchema.shape.infiniteApproval,
			chainId: mcpChainIdSchema,
		},
		writeAnnotations,
		async (args, extra) =>
			safeHandler('prepare_subscribe', async () => {
				const parsed = subscribeInputSchema.parse(args);
				const chain = mcpToolChain(env, args);

				const normalizedSubscription = await normalizeSubscriptionAmount(
					env,
					parsed.subscription,
					chain,
				);

				return textResult(
					await prepareSubscribe(
						env,
						parsed.from,
						toWriteSubscription(normalizedSubscription),
						mcpPrepareOptions(env, extra, args, parsed),
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_subscribe_by_id',
		'Prepare unsigned subscribe by subscription id only (loads amount/token from chain). Optional chainId, default Base (8453). Approves the subscription amount by default; set infiniteApproval for max allowance.',
		{
			from: addressSchema,
			id: bytes32Schema.describe('Subscription id; amount and token are loaded from chain'),
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			infiniteApproval: subscribeByIdInputSchema.shape.infiniteApproval,
			chainId: mcpChainIdSchema,
		},
		writeAnnotations,
		async (args, extra) =>
			safeHandler('prepare_subscribe_by_id', async () => {
				const parsed = subscribeByIdInputSchema.parse(args);

				return textResult(
					await prepareSubscribeById(
						env,
						parsed.from,
						parsed.id,
						mcpPrepareOptions(env, extra, args, parsed),
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_cancel_subscription',
		'Prepare unsigned cancelSubscription for the provider. Optional chainId, default Base (8453)',
		{
			from: addressSchema,
			subscription: subscriptionActionInputSchema.shape.subscription,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			chainId: mcpChainIdSchema,
		},
		destructiveAnnotations,
		async (args, extra) =>
			safeHandler('prepare_cancel_subscription', async () => {
				const parsed = subscriptionActionInputSchema.parse(args);
				const chain = mcpToolChain(env, args);
				const normalizedSubscription = await normalizeSubscriptionAmount(
					env,
					parsed.subscription,
					chain,
				);

				return textResult(
					await prepareCancelSubscription(
						env,
						parsed.from,
						toWriteSubscription(normalizedSubscription),
						mcpPrepareOptions(env, extra, args, parsed),
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_cancel_subscription_by_id',
		'Prepare unsigned cancelSubscription using only subscription id (preferred). Optional chainId, default Base (8453)',
		{
			from: addressSchema,
			id: bytes32Schema.describe('Subscription id; remaining fields loaded from chain'),
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			chainId: mcpChainIdSchema,
		},
		destructiveAnnotations,
		async (args, extra) =>
			safeHandler('prepare_cancel_subscription_by_id', async () => {
				const parsed = subscriptionActionByIdInputSchema.parse(args);
				return textResult(
					await prepareCancelSubscriptionById(
						env,
						parsed.from,
						parsed.id,
						mcpPrepareOptions(env, extra, args, parsed),
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_unsubscribe',
		'Prepare unsigned unsubscribe transaction for a subscriber. Optional chainId, default Base (8453)',
		{
			from: addressSchema,
			subscription: subscriptionActionInputSchema.shape.subscription,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			chainId: mcpChainIdSchema,
		},
		destructiveAnnotations,
		async (args, extra) =>
			safeHandler('prepare_unsubscribe', async () => {
				const parsed = subscriptionActionInputSchema.parse(args);
				const chain = mcpToolChain(env, args);
				const normalizedSubscription = await normalizeSubscriptionAmount(
					env,
					parsed.subscription,
					chain,
				);

				return textResult(
					await prepareUnsubscribe(
						env,
						parsed.from,
						toWriteSubscription(normalizedSubscription),
						mcpPrepareOptions(env, extra, args, parsed),
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_unsubscribe_by_id',
		'Prepare unsigned unsubscribe using only subscription id (preferred). Optional chainId, default Base (8453)',
		{
			from: addressSchema,
			id: bytes32Schema.describe('Subscription id; remaining fields loaded from chain'),
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			chainId: mcpChainIdSchema,
		},
		destructiveAnnotations,
		async (args, extra) =>
			safeHandler('prepare_unsubscribe_by_id', async () => {
				const parsed = subscriptionActionByIdInputSchema.parse(args);
				return textResult(
					await prepareUnsubscribeById(
						env,
						parsed.from,
						parsed.id,
						mcpPrepareOptions(env, extra, args, parsed),
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_unsubscribe_by_provider',
		'Prepare unsigned unsubscribeByProvider transaction. Optional chainId, default Base (8453)',
		{
			from: addressSchema,
			subscription: unsubscribeByProviderInputSchema.shape.subscription,
			subscriber: addressSchema,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			chainId: mcpChainIdSchema,
		},
		destructiveAnnotations,
		async (args, extra) =>
			safeHandler('prepare_unsubscribe_by_provider', async () => {
				const parsed = unsubscribeByProviderInputSchema.parse(args);
				const chain = mcpToolChain(env, args);
				const normalizedSubscription = await normalizeSubscriptionAmount(
					env,
					parsed.subscription,
					chain,
				);

				return textResult(
					await prepareUnsubscribeByProvider(
						env,
						parsed.from,
						toWriteSubscription(normalizedSubscription),
						parsed.subscriber,
						mcpPrepareOptions(env, extra, args, parsed),
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_unsubscribe_by_provider_by_id',
		'Prepare unsigned unsubscribeByProvider using only subscription id + subscriber (preferred). Optional chainId, default Base (8453)',
		{
			from: addressSchema,
			id: bytes32Schema.describe('Subscription id; remaining fields loaded from chain'),
			subscriber: addressSchema,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			chainId: mcpChainIdSchema,
		},
		destructiveAnnotations,
		async (args, extra) =>
			safeHandler('prepare_unsubscribe_by_provider_by_id', async () => {
				const parsed = unsubscribeByProviderByIdInputSchema.parse(args);
				return textResult(
					await prepareUnsubscribeByProviderById(
						env,
						parsed.from,
						parsed.id,
						parsed.subscriber,
						mcpPrepareOptions(env, extra, args, parsed),
					),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_edit_details',
		'Prepare unsigned editDetails transaction. Optional chainId, default Base (8453)',
		{
			from: addressSchema,
			id: bytes32Schema,
			details: editDetailsInputSchema.shape.details,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			chainId: mcpChainIdSchema,
		},
		writeAnnotations,
		async (args, extra) =>
			safeHandler('prepare_edit_details', async () => {
				const parsed = editDetailsInputSchema.parse(args);
				return textResult(
					await prepareEditDetails(
						env,
						parsed.from,
						parsed.id,
						toWriteDetails(parsed.details),
						mcpPrepareOptions(env, extra, args, parsed),
					),
				);
			}),
	);

	server.paidTool(
		'check_remit_readiness',
		'Check whether remit() is callable (nextUncheckedDay, due subscription scan, pagination hints). Optional chainId, default Base (8453)',
		API_PRICES.checkRemitReadiness,
		{
			from: addressSchema,
			chainId: mcpChainIdSchema,
		},
		{ readOnlyHint: true },
		async (args) =>
			safeHandler('check_remit_readiness', async () => {
				const parsed = remitInputSchema.parse({ from: args.from });
				return textResult(
					await checkRemitReadiness(env, parsed.from, mcpToolChain(env, args)),
				);
			}),
	);

	registerPrepareTool(
		server,
		env,
		'prepare_remit',
		'Prepare unsigned remit() transaction (permissionless; earns caller fees in subscription tokens). Optional chainId, default Base (8453)',
		{
			from: addressSchema,
			readinessOnly: readinessOnlySchema,
			simulateFromAddress: simulateFromAddressSchema,
			chainId: mcpChainIdSchema,
		},
		destructiveAnnotations,
		async (args, extra) =>
			safeHandler('prepare_remit', async () => {
				const parsed = remitInputSchema.parse(args);
				return textResult(
					await prepareRemit(env, parsed.from, mcpPrepareOptions(env, extra, args, parsed)),
				);
			}),
		(args) => getRemitPreparePrice(args.readinessOnly as boolean | undefined),
	);

	server.paidTool(
		'get_transaction_status',
		'Get confirmation status for a transaction hash. Optional chainId, default Base (8453)',
		API_PRICES.getTransactionStatus,
		{
			txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
			chainId: mcpChainIdSchema,
		},
		{ readOnlyHint: true },
		async (args) =>
			safeHandler('get_transaction_status', async () =>
				textResult(
					await getTransactionStatus(
						env,
						args.txHash as `0x${string}`,
						mcpToolChain(env, args),
					),
				),
			),
	);
}