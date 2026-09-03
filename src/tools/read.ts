import type { X402McpServer } from './types.js';
import { safeHandler } from './safeHandler.js';
import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import { ERC20_ABI } from '../abi/erc20.js';
import { BASE_CHAIN_ID, listMcpChainCatalog, resolveChain, type ChainConfig } from '../chain.js';
import { mcpChain, mcpChainIdSchema } from './mcpChain.js';
import { createClocktowerClient } from '../client.js';
import {
	buildDayFrequencyProbes,
	fetchGetIdByTimeForDay,
} from '../tx/remit-scan.js';
import {
	formatProtocolStoredAmount,
	FREQUENCY_TYPES,
	getCurrentDay,
	getFrequencyLabel,
	getStatusLabel,
	serializeJson,
	textResult,
} from '../utils.js';
import {
	addressSchema,
	bySubscriberSchema,
	bytes32Schema,
	dayNumberSchema,
	frequencySchema,
	parseAccountSubscriptionRecord,
	parseApprovedTokenRecord,
	parseSubscriberRecord,
	parseSubscriptionRecord,
	type SubscriptionRecord,
} from '../validation.js';
import { getApprovedTokens } from '../config/approvedTokens.js';
import {
  getSubscriptionHistory,
  getAccountActivity,
  getProviderProfile,
  getSubscriptionDetails,
  getSubscriptionDetailsHistory,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_SKIP,
} from './history.js';
import { searchSubscriptions } from './discovery.js';
import {
	API_PRICES,
	calculateAccountActivityPrice,
	calculateSearchSubscriptionsPrice,
	calculateSubscriptionDetailsHistoryPrice,
	calculateSubscriptionHistoryPrice,
} from '../api/pricing.js';
import { registerDynamicPaidTool } from '../mcp/paidToolDynamic.js';
import { isMcpX402Enabled, parseMcpAccessLane } from '../config/mcpX402.js';
import { getSearchArgsPolicyError } from '../middleware/freeTierPolicy.js';
import { z } from 'zod';

type ClocktowerClient = ReturnType<typeof createClocktowerClient>;

async function fetchTokenDecimals(
	client: ClocktowerClient,
	contractAddress: `0x${string}`,
	token: `0x${string}`,
	cache: Map<string, number>,
): Promise<number> {
	const key = token.toLowerCase();
	const cached = cache.get(key);
	if (cached !== undefined) {
		return cached;
	}

	const approvedToken = await client.readContract({
		address: contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'approvedERC20',
		args: [token],
	});

	const { decimals } = parseApprovedTokenRecord(approvedToken);
	cache.set(key, decimals);
	return decimals;
}

async function getTokenMetadata(client: any, tokenAddress: `0x${string}`) {
	try {
		const [name, symbol] = await Promise.all([
			client.readContract({
				address: tokenAddress,
				abi: ERC20_ABI,
				functionName: 'name',
			}),
			client.readContract({
				address: tokenAddress,
				abi: ERC20_ABI,
				functionName: 'symbol',
			}),
		]);
		return { name, symbol };
	} catch {
		return { name: null, symbol: null };
	}
}

async function formatSubscription(subscription: SubscriptionRecord, tokenDecimals: number, client: any) {
	const { amount, amountRaw } = formatProtocolStoredAmount(subscription.amount, tokenDecimals);
	const metadata = await getTokenMetadata(client, subscription.token);

	return {
		id: subscription.id,
		provider: subscription.provider,
		token: {
			address: subscription.token,
			symbol: metadata.symbol,
			name: metadata.name,
		},
		cancelled: subscription.cancelled,
		dueDay: subscription.dueDay,
		frequency: subscription.frequency,
		frequencyLabel: getFrequencyLabel(subscription.frequency),
		amount,
		amountRaw,
		tokenDecimals,
	};
}

async function formatAccountSubscription(
	entry: ReturnType<typeof parseAccountSubscriptionRecord>,
	tokenDecimals: number,
	client: any,
) {
	return {
		subscription: await formatSubscription(entry.subscription, tokenDecimals, client),
		status: entry.status,
		statusLabel: getStatusLabel(entry.status),
		totalSubscribers: entry.totalSubscribers,
	};
}

function formatApprovedToken(approvedToken: ReturnType<typeof parseApprovedTokenRecord>) {
	const { amount, amountRaw, tokenDecimals } = formatProtocolStoredAmount(
		approvedToken.minimum,
		approvedToken.decimals,
	);

	return {
		tokenAddress: approvedToken.tokenAddress,
		decimals: tokenDecimals,
		paused: approvedToken.paused,
		minimum: amount,
		minimumRaw: amountRaw,
	};
}

function formatSubscriber(subscriber: ReturnType<typeof parseSubscriberRecord>, tokenDecimals: number) {
	const { amount, amountRaw } = formatProtocolStoredAmount(subscriber.feeBalance, tokenDecimals);

	return {
		subscriber: subscriber.subscriber,
		feeBalance: amount,
		feeBalanceRaw: amountRaw,
		tokenDecimals,
	};
}

export { addressSchema, bytes32Schema } from '../validation.js';

export const TOOL_PRICE = 0.01;

function getContractContext(env: Env, chain: ChainConfig = resolveChain(env)) {
	const client = createClocktowerClient(chain);
	return { chain, client };
}

export async function getProtocolState(env: Env, protocolChain?: ChainConfig) {
	const { chain: resolved, client } = getContractContext(env, protocolChain);

	const [callerFee, systemFee] = await Promise.all([
		client.readContract({
			address: resolved.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'callerFee',
		}),
		client.readContract({
			address: resolved.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'systemFee',
		}),
	]);

	// Fees are stored in basis points where 10000 = 0%
	// Examples:
	//   callerFee = 10000 → 0%
	//   callerFee = 10100 → 1%
	//   callerFee = 10833 → 8.33%
	//
	// systemFee is the % of the caller fee that goes to the system.
	//   systemFee = 10000 → 0%
	//   systemFee = 10100 → 1% of caller fee

	const callerFeeBps = Number(callerFee);
	const systemFeeBps = Number(systemFee);

	const callerFeePercent = (callerFeeBps - 10000) / 100;
	const systemFeePercent = (systemFeeBps - 10000) / 100;

	return {
		chainId: resolved.chainId,
		contractAddress: resolved.contractAddress,
		callerFeePercent: callerFeePercent,
		systemFeePercent: systemFeePercent,
	};
}

export async function getSubscription(env: Env, id: `0x${string}`, protocolChain?: ChainConfig) {
	const { chain, client } = getContractContext(env, protocolChain);

	const subscription = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'idSubMap',
		args: [id],
	});

	const normalized = parseSubscriptionRecord(subscription);
	const tokenDecimals = await fetchTokenDecimals(client, chain.contractAddress, normalized.token, new Map());

	return {
		chainId: chain.chainId,
		subscription: await formatSubscription(normalized, tokenDecimals, client),
	};
}

export async function getAccountSubscriptions(
	env: Env,
	bySubscriber: boolean,
	account: `0x${string}`,
	protocolChain?: ChainConfig,
) {
	const { chain, client } = getContractContext(env, protocolChain);

	const subscriptions = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'getAccountSubscriptions',
		args: [bySubscriber, account],
	});

	const normalized = (subscriptions as unknown[]).map((entry) => parseAccountSubscriptionRecord(entry));
	const decimalsCache = new Map<string, number>();
	const uniqueTokens = [...new Set(normalized.map((entry) => entry.subscription.token.toLowerCase()))];

	await Promise.all(
		uniqueTokens.map((token) =>
			fetchTokenDecimals(client, chain.contractAddress, token as `0x${string}`, decimalsCache),
		),
	);

	const formattedSubscriptions = [];
	for (const entry of normalized) {
		const decimals = decimalsCache.get(entry.subscription.token.toLowerCase()) ?? 18;
		const formatted = await formatAccountSubscription(entry, decimals, client);
		formattedSubscriptions.push(formatted);
	}

	return {
		chainId: chain.chainId,
		bySubscriber,
		account,
		subscriptions: formattedSubscriptions,
	};
}

export async function getSubscribers(env: Env, id: `0x${string}`, protocolChain?: ChainConfig) {
	const { chain, client } = getContractContext(env, protocolChain);

	const [subscribers, subscription] = await Promise.all([
		client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'getSubscribersById',
			args: [id],
		}),
		client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'idSubMap',
			args: [id],
		}),
	]);

	const { token } = parseSubscriptionRecord(subscription);
	const tokenDecimals = await fetchTokenDecimals(client, chain.contractAddress, token, new Map());

	return {
		chainId: chain.chainId,
		id,
		subscribers: (subscribers as unknown[]).map((entry) =>
			formatSubscriber(parseSubscriberRecord(entry), tokenDecimals),
		),
	};
}

export async function getApprovedToken(env: Env, token: `0x${string}`, protocolChain?: ChainConfig) {
	const { chain, client } = getContractContext(env, protocolChain);

	const approvedToken = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'approvedERC20',
		args: [token],
	});

	return {
		chainId: chain.chainId,
		token,
		approvedToken: formatApprovedToken(parseApprovedTokenRecord(approvedToken)),
	};
}

export async function getFeeBalance(
	env: Env,
	subscriptionId: `0x${string}`,
	subscriber: `0x${string}`,
	protocolChain?: ChainConfig,
) {
	const { chain, client } = getContractContext(env, protocolChain);

	const [balance, subscription] = await Promise.all([
		client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'feeBalance',
			args: [subscriptionId, subscriber],
		}),
		client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'idSubMap',
			args: [subscriptionId],
		}),
	]);

	const token = subscription[3] as `0x${string}`; // token is 4th field in Subscription tuple

	const approvedToken = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'approvedERC20',
		args: [token],
	});

	const { decimals } = parseApprovedTokenRecord(approvedToken);

	const formatted = formatProtocolStoredAmount(balance, decimals);

	return {
		chainId: chain.chainId,
		subscriptionId,
		subscriber,
		feeBalance: formatted.amount,
		feeBalanceRaw: formatted.amountRaw.toString(),
		tokenDecimals: decimals,
	};
}

export async function getAccount(env: Env, account: `0x${string}`, protocolChain?: ChainConfig) {
	const { chain } = getContractContext(env, protocolChain);

	// Fetch both views using the already-rich formatting logic
	const [asSubscriberRaw, asProviderRaw] = await Promise.all([
		getAccountSubscriptions(env, true, account, chain),
		getAccountSubscriptions(env, false, account, chain),
	]);

	// For the subscriber view, enrich each entry with the caller's personal fee balance.
	// This is the main value-add of the combined "full account" view.
	const enrichedSubscribedTo = await Promise.all(
		asSubscriberRaw.subscriptions.map(async (entry: any) => {
			try {
				const fee = await getFeeBalance(env, entry.subscription.id, account, chain);
				return {
					...entry,
					feeBalance: fee.feeBalance,
					feeBalanceRaw: fee.feeBalanceRaw,
				};
			} catch {
				// If fee balance lookup fails (very rare), still return the subscription data
				return {
					...entry,
					feeBalance: '0',
					feeBalanceRaw: '0',
				};
			}
		})
	);

	return {
		chainId: chain.chainId,
		accountAddress: account,
		subscribedTo: enrichedSubscribedTo,
		created: asProviderRaw.subscriptions,
	};
}

export async function getSubscriptionsDue(
	env: Env,
	options: { dayNumber?: number; frequency?: number } = {},
	protocolChain?: ChainConfig,
) {
	const { chain, client } = getContractContext(env, protocolChain);
	const dayNumber = options.dayNumber ?? getCurrentDay();

	const frequencies =
		options.frequency !== undefined
			? [options.frequency]
			: [
					FREQUENCY_TYPES.WEEKLY,
					FREQUENCY_TYPES.MONTHLY,
					FREQUENCY_TYPES.QUARTERLY,
					FREQUENCY_TYPES.YEARLY,
				];

	const probes = buildDayFrequencyProbes(dayNumber, frequencies);
	const idsByFrequency = await fetchGetIdByTimeForDay(
		client,
		chain.contractAddress,
		dayNumber,
		frequencies,
	);

	const results = probes.map((probe) => {
		if (probe.skipped) {
			return {
				frequency: probe.frequency,
				frequencyLabel: getFrequencyLabel(probe.frequency),
				skipped: true,
				skipReason: probe.skipReason,
				subscriptionIds: [],
			};
		}

		return {
			frequency: probe.frequency,
			frequencyLabel: getFrequencyLabel(probe.frequency),
			dueDay: probe.dueDay,
			skipped: false,
			subscriptionIds: idsByFrequency.get(probe.frequency) ?? [],
		};
	});

	return { chainId: chain.chainId, dayNumber, results };
}

export async function listApprovedTokens(env: Env, protocolChain?: ChainConfig) {
	const { chain } = getContractContext(env, protocolChain);

	const tokens = await Promise.all(
		getApprovedTokens(chain.chainId).map(async (staticInfo) => {
			const onChain = await getApprovedToken(env, staticInfo.address, chain);
			return {
				address: staticInfo.address,
				symbol: staticInfo.symbol,
				name: staticInfo.name,
				decimals: staticInfo.decimals,
				paused: onChain.approvedToken.paused,
				minimum: onChain.approvedToken.minimum,
				minimumRaw: onChain.approvedToken.minimumRaw,
			};
		}),
	);

	return {
		chainId: chain.chainId,
		tokens,
	};
}

export function registerPaidTools(server: X402McpServer, env: Env) {
	server.paidTool(
		'list_chains',
		'List protocol chains available to MCP tools. default is Base (8453); optional chainId on other tools selects a row with mcp: true',
		API_PRICES.catalog,
		{},
		{ readOnlyHint: true },
		async () =>
			safeHandler('list_chains', async () =>
				textResult({
					chainId: BASE_CHAIN_ID,
					chains: listMcpChainCatalog(),
				}),
			),
	);

	server.paidTool(
		'get_protocol_state',
		'Read Clocktower protocol fee configuration. Optional chainId, default Base (8453)',
		TOOL_PRICE,
		{ chainId: mcpChainIdSchema },
		{},
		async ({ chainId }) =>
			safeHandler('get_protocol_state', async () =>
				textResult(await getProtocolState(env, mcpChain(env, chainId as string | number | undefined))),
			),
	);

	server.paidTool(
		'get_subscription',
		'Read a subscription by id. Optional chainId, default Base (8453)',
		TOOL_PRICE,
		{
			id: bytes32Schema.describe('Subscription id (bytes32 hex)'),
			chainId: mcpChainIdSchema,
		},
		{},
		async ({ id, chainId }) =>
			safeHandler('get_subscription', async () =>
				textResult(
					await getSubscription(
						env,
						id as `0x${string}`,
						mcpChain(env, chainId as string | number | undefined),
					),
				),
			),
	);

	server.paidTool(
		'get_account_subscriptions',
		'List subscriptions for an account as provider or subscriber. Optional chainId, default Base (8453)',
		TOOL_PRICE,
		{
			bySubscriber: bySubscriberSchema,
			account: addressSchema,
			chainId: mcpChainIdSchema,
		},
		{},
		async ({ bySubscriber, account, chainId }) =>
			safeHandler('get_account_subscriptions', async () =>
				textResult(
					await getAccountSubscriptions(
						env,
						bySubscriber as boolean,
						account as `0x${string}`,
						mcpChain(env, chainId as string | number | undefined),
					),
				),
			),
	);

	server.paidTool(
		'get_subscribers',
		'List subscribers and fee balances for a subscription id. Optional chainId, default Base (8453)',
		TOOL_PRICE,
		{
			id: bytes32Schema,
			chainId: mcpChainIdSchema,
		},
		{},
		async ({ id, chainId }) =>
			safeHandler('get_subscribers', async () =>
				textResult(
					await getSubscribers(
						env,
						id as `0x${string}`,
						mcpChain(env, chainId as string | number | undefined),
					),
				),
			),
	);

	server.paidTool(
		'get_approved_token',
		'Read approved ERC20 token configuration from the Clocktower contract. Optional chainId, default Base (8453)',
		TOOL_PRICE,
		{
			token: addressSchema,
			chainId: mcpChainIdSchema,
		},
		{},
		async ({ token, chainId }) =>
			safeHandler('get_approved_token', async () =>
				textResult(
					await getApprovedToken(
						env,
						token as `0x${string}`,
						mcpChain(env, chainId as string | number | undefined),
					),
				),
			),
	);

	// Lightly managed list of approved tokens (static config because the
	// on-chain approvedERC20 mapping is not enumerable).
	server.paidTool(
		'list_approved_tokens',
		'List ERC-20 tokens currently approved for Clocktower subscriptions. Optional chainId, default Base (8453)',
		TOOL_PRICE,
		{ chainId: mcpChainIdSchema },
		{},
		async ({ chainId }) =>
			safeHandler('list_approved_tokens', async () =>
				textResult(
					await listApprovedTokens(env, mcpChain(env, chainId as string | number | undefined)),
				),
			),
	);

	server.paidTool(
		'get_fee_balance',
		'Get current fee balance for a subscriber on a specific subscription. Optional chainId, default Base (8453)',
		TOOL_PRICE,
		{
			id: bytes32Schema,
			address: addressSchema,
			chainId: mcpChainIdSchema,
		},
		{},
		async ({ id, address, chainId }) =>
			safeHandler('get_fee_balance', async () =>
				textResult(
					await getFeeBalance(
						env,
						id as `0x${string}`,
						address as `0x${string}`,
						mcpChain(env, chainId as string | number | undefined),
					),
				),
			),
	);

	server.paidTool(
		'get_account',
		'Get a complete enriched view of an account: subscriptions the address pays into (as subscribedTo, with personal fee balances) and subscriptions it created as provider (as created). Includes full token metadata, human-readable amounts, labels, and subscriber counts. Optional chainId, default Base (8453)',
		API_PRICES.getAccount,
		{
			address: addressSchema,
			chainId: mcpChainIdSchema,
		},
		{},
		async ({ address, chainId }) =>
			safeHandler('get_account', async () =>
				textResult(
					await getAccount(
						env,
						address as `0x${string}`,
						mcpChain(env, chainId as string | number | undefined),
					),
				),
			),
	);

	server.paidTool(
		'get_subscriptions_due',
		'Find subscription ids due on a given day by frequency (mirrors caller remit scanning). Optional chainId, default Base (8453)',
		API_PRICES.getSubscriptionsDue,
		{
			dayNumber: dayNumberSchema,
			frequency: frequencySchema,
			chainId: mcpChainIdSchema,
		},
		{},
		async ({ dayNumber, frequency, chainId }) =>
			safeHandler('get_subscriptions_due', async () =>
				textResult(
					await getSubscriptionsDue(
						env,
						{
							dayNumber: dayNumber as number | undefined,
							frequency: frequency as number | undefined,
						},
						mcpChain(env, chainId as string | number | undefined),
					),
				),
			),
	);

	// === History & Profile tools (subgraph-backed) ===
	// These use x402 payments with higher pricing to cover subgraph costs.

	registerDynamicPaidTool(
		server,
		env,
		'get_subscription_history',
		'Get activity history (SubLog) for a specific subscription with formatting and pagination. Optional chainId, default Base (8453)',
		(args) =>
			calculateSubscriptionHistoryPrice(
				(args.first as number | undefined) ?? HISTORY_DEFAULT_LIMIT,
			),
		{
			id: bytes32Schema,
			first: z.coerce.number().int().min(1).max(200).optional(),
			skip: z.coerce.number().int().min(0).max(HISTORY_MAX_SKIP).optional(),
			chainId: mcpChainIdSchema,
		},
		{},
		async ({ id, first, skip, chainId }) =>
			safeHandler('get_subscription_history', async () => {
				const chain = mcpChain(env, chainId as string | number | undefined);
				return textResult(
					await getSubscriptionHistory(env, id as `0x${string}`, chain.chainId, {
						first: first as number | undefined,
						skip: skip as number | undefined,
					}),
				);
			}),
	);

	registerDynamicPaidTool(
		server,
		env,
		'get_account_activity',
		'Get combined activity history across all subscriptions an account participates in (as subscriber or provider). Optional chainId, default Base (8453)',
		(args) =>
			calculateAccountActivityPrice(
				(args.first as number | undefined) ?? HISTORY_DEFAULT_LIMIT,
			),
		{
			address: addressSchema,
			first: z.coerce.number().int().min(1).max(200).optional(),
			skip: z.coerce.number().int().min(0).max(HISTORY_MAX_SKIP).optional(),
			chainId: mcpChainIdSchema,
		},
		{},
		async ({ address, first, skip, chainId }) =>
			safeHandler('get_account_activity', async () => {
				const chain = mcpChain(env, chainId as string | number | undefined);
				return textResult(
					await getAccountActivity(env, address as `0x${string}`, chain.chainId, {
						first: first as number | undefined,
						skip: skip as number | undefined,
					}),
				);
			}),
	);

	server.paidTool(
		'get_provider_profile',
		'Get the latest provider profile details (ProvDetailsLog). Optional chainId, default Base (8453)',
		API_PRICES.providerProfile,
		{
			address: addressSchema,
			chainId: mcpChainIdSchema,
		},
		{},
		async ({ address, chainId }) =>
			safeHandler('get_provider_profile', async () => {
				const chain = mcpChain(env, chainId as string | number | undefined);
				return textResult(await getProviderProfile(env, address as `0x${string}`, chain.chainId));
			}),
	);

	server.paidTool(
		'get_subscription_details',
		'Get current subscription url and description (latest DetailsLog). Optional chainId, default Base (8453)',
		API_PRICES.subscriptionDetails,
		{
			id: bytes32Schema,
			chainId: mcpChainIdSchema,
		},
		{},
		async ({ id, chainId }) =>
			safeHandler('get_subscription_details', async () => {
				const chain = mcpChain(env, chainId as string | number | undefined);
				return textResult(await getSubscriptionDetails(env, id as `0x${string}`, chain.chainId));
			}),
	);

	registerDynamicPaidTool(
		server,
		env,
		'search_subscriptions',
		'Search and discover subscriptions (Create events + on-chain enrichment). Optional chainId, default Base (8453)',
		(args) =>
			calculateSearchSubscriptionsPrice({
				first: args.first as number | undefined,
				includeDetails: args.includeDetails as boolean | undefined,
			}),
		{
			provider: addressSchema.optional(),
			token: addressSchema.optional(),
			frequency: frequencySchema.optional(),
			cancelled: z.boolean().optional(),
			includeDetails: z.boolean().optional(),
			first: z.coerce.number().int().min(1).max(50).optional(),
			skip: z.coerce.number().int().min(0).optional(),
			chainId: mcpChainIdSchema,
		},
		{},
		async (args, extra) =>
			safeHandler('search_subscriptions', async () => {
				const lane = isMcpX402Enabled(env) ? 'mcp' : parseMcpAccessLane(extra);
				const policyError = getSearchArgsPolicyError(
					lane,
					args.first as number | undefined,
					args.includeDetails as boolean | undefined,
				);
				if (policyError) {
					return {
						isError: true,
						content: [
							{
								type: 'text' as const,
								text: serializeJson({ error: policyError, code: 'VALIDATION_ERROR' }),
							},
						],
					};
				}
				return textResult(
					await searchSubscriptions(
						env,
						{
							provider: args.provider as `0x${string}` | undefined,
							token: args.token as `0x${string}` | undefined,
							frequency: args.frequency as number | undefined,
							cancelled: args.cancelled as boolean | undefined,
							includeDetails: args.includeDetails as boolean | undefined,
							first: args.first as number | undefined,
							skip: args.skip as number | undefined,
						},
						mcpChain(env, args.chainId as string | number | undefined),
					),
				);
			}),
	);

	registerDynamicPaidTool(
		server,
		env,
		'get_subscription_details_history',
		'Get history of description/URL changes for a subscription (DetailsLog). Optional chainId, default Base (8453)',
		(args) =>
			calculateSubscriptionDetailsHistoryPrice(
				(args.first as number | undefined) ?? HISTORY_DEFAULT_LIMIT,
			),
		{
			id: bytes32Schema,
			first: z.coerce.number().int().min(1).max(200).optional(),
			skip: z.coerce.number().int().min(0).max(HISTORY_MAX_SKIP).optional(),
			chainId: mcpChainIdSchema,
		},
		{},
		async ({ id, first, skip, chainId }) =>
			safeHandler('get_subscription_details_history', async () => {
				const chain = mcpChain(env, chainId as string | number | undefined);
				return textResult(
					await getSubscriptionDetailsHistory(env, id as `0x${string}`, chain.chainId, {
						first: first as number | undefined,
						skip: skip as number | undefined,
					}),
				);
			}),
	);
}
