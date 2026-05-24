import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import { resolveChain } from '../chain.js';
import { createClocktowerClient } from '../client.js';
import {
	dayNumberToDayjs,
	formatProtocolStoredAmount,
	FREQUENCY_TYPES,
	getCurrentDay,
	getDueDay,
	getFrequencyLabel,
	getStatusLabel,
	textResult,
} from '../utils.js';

type SubscriptionRecord = {
	id: `0x${string}`;
	amount: bigint;
	provider: `0x${string}`;
	token: `0x${string}`;
	cancelled: boolean;
	frequency: bigint | number;
	dueDay: number;
};

type AccountSubscriptionRecord = {
	subscription: SubscriptionRecord;
	status: number;
	totalSubscribers: bigint;
};

function normalizeSubscriptionRecord(raw: unknown): SubscriptionRecord {
	if (Array.isArray(raw)) {
		const [id, amount, provider, token, cancelled, frequency, dueDay] = raw;
		return { id, amount, provider, token, cancelled, frequency, dueDay };
	}

	return raw as SubscriptionRecord;
}

function normalizeAccountSubscription(raw: unknown): AccountSubscriptionRecord {
	if (Array.isArray(raw)) {
		const [subscription, status, totalSubscribers] = raw;
		return {
			subscription: normalizeSubscriptionRecord(subscription),
			status: Number(status),
			totalSubscribers,
		};
	}

	const entry = raw as AccountSubscriptionRecord;
	return {
		...entry,
		subscription: normalizeSubscriptionRecord(entry.subscription),
	};
}

type ApprovedTokenRecord = {
	tokenAddress: `0x${string}`;
	decimals: number;
	paused: boolean;
	minimum: bigint;
};

type SubscriberRecord = {
	subscriber: `0x${string}`;
	feeBalance: bigint;
};

function normalizeApprovedToken(raw: unknown): ApprovedTokenRecord {
	if (Array.isArray(raw)) {
		const [tokenAddress, decimals, paused, minimum] = raw;
		return { tokenAddress, decimals: Number(decimals), paused, minimum };
	}

	const entry = raw as ApprovedTokenRecord;
	return {
		...entry,
		decimals: Number(entry.decimals),
	};
}

function normalizeSubscriberRecord(raw: unknown): SubscriberRecord {
	if (Array.isArray(raw)) {
		const [subscriber, feeBalance] = raw;
		return { subscriber, feeBalance };
	}

	return raw as SubscriberRecord;
}

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

	const { decimals } = normalizeApprovedToken(approvedToken);
	cache.set(key, decimals);
	return decimals;
}

function formatSubscription(subscription: SubscriptionRecord, tokenDecimals: number) {
	const frequency = Number(subscription.frequency);
	const { amount, amountRaw } = formatProtocolStoredAmount(subscription.amount, tokenDecimals);

	return {
		id: subscription.id,
		provider: subscription.provider,
		token: subscription.token,
		cancelled: subscription.cancelled,
		dueDay: subscription.dueDay,
		frequency,
		frequencyLabel: getFrequencyLabel(frequency),
		amount,
		amountRaw,
		tokenDecimals,
	};
}

function formatAccountSubscription(entry: AccountSubscriptionRecord, tokenDecimals: number) {
	const status = Number(entry.status);
	return {
		subscription: formatSubscription(entry.subscription, tokenDecimals),
		status,
		statusLabel: getStatusLabel(status),
		totalSubscribers: entry.totalSubscribers,
	};
}

function formatApprovedToken(approvedToken: ApprovedTokenRecord) {
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

function formatSubscriber(subscriber: SubscriberRecord, tokenDecimals: number) {
	const { amount, amountRaw } = formatProtocolStoredAmount(subscriber.feeBalance, tokenDecimals);

	return {
		subscriber: subscriber.subscriber,
		feeBalance: amount,
		feeBalanceRaw: amountRaw,
		tokenDecimals,
	};
}

export const chainIdSchema = z.union([z.literal(8453), z.literal(84532)]);
export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

export const TOOL_PRICE = 0.01;

type X402McpServer = McpServer & {
	paidTool: (
		name: string,
		description: string,
		price: number,
		inputSchema: Record<string, z.ZodTypeAny>,
		annotations: Record<string, unknown>,
		handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
	) => void;
};

function getContractContext(env: Env, chainId: number) {
	const chain = resolveChain(env, chainId);
	const client = createClocktowerClient(chain);
	return { chain, client };
}

export async function getProtocolState(env: Env, chainId: number) {
	const { chain, client } = getContractContext(env, chainId);

	const [nextUncheckedDay, callerFee, systemFee, maxRemits, cancelLimit] = await Promise.all([
		client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'nextUncheckedDay',
		}),
		client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'callerFee',
		}),
		client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'systemFee',
		}),
		client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'maxRemits',
		}),
		client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'cancelLimit',
		}),
	]);

	return {
		chainId,
		contractAddress: chain.contractAddress,
		nextUncheckedDay,
		callerFee,
		systemFee,
		maxRemits,
		cancelLimit,
	};
}

export async function getSubscription(env: Env, chainId: number, id: `0x${string}`) {
	const { chain, client } = getContractContext(env, chainId);

	const subscription = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'idSubMap',
		args: [id],
	});

	const normalized = normalizeSubscriptionRecord(subscription);
	const tokenDecimals = await fetchTokenDecimals(client, chain.contractAddress, normalized.token, new Map());

	return {
		chainId,
		subscription: formatSubscription(normalized, tokenDecimals),
	};
}

export async function getAccountSubscriptions(
	env: Env,
	chainId: number,
	bySubscriber: boolean,
	account: `0x${string}`,
) {
	const { chain, client } = getContractContext(env, chainId);

	const subscriptions = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'getAccountSubscriptions',
		args: [bySubscriber, account],
	});

	const normalized = (subscriptions as unknown[]).map((entry) => normalizeAccountSubscription(entry));
	const decimalsCache = new Map<string, number>();
	const uniqueTokens = [...new Set(normalized.map((entry) => entry.subscription.token.toLowerCase()))];

	await Promise.all(
		uniqueTokens.map((token) =>
			fetchTokenDecimals(client, chain.contractAddress, token as `0x${string}`, decimalsCache),
		),
	);

	return {
		chainId,
		bySubscriber,
		account,
		subscriptions: normalized.map((entry) =>
			formatAccountSubscription(entry, decimalsCache.get(entry.subscription.token.toLowerCase()) ?? 18),
		),
	};
}

export async function getSubscribers(env: Env, chainId: number, id: `0x${string}`) {
	const { chain, client } = getContractContext(env, chainId);

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

	const { token } = normalizeSubscriptionRecord(subscription);
	const tokenDecimals = await fetchTokenDecimals(client, chain.contractAddress, token, new Map());

	return {
		chainId,
		id,
		subscribers: (subscribers as unknown[]).map((entry) =>
			formatSubscriber(normalizeSubscriberRecord(entry), tokenDecimals),
		),
	};
}

export async function getApprovedToken(env: Env, chainId: number, token: `0x${string}`) {
	const { chain, client } = getContractContext(env, chainId);

	const approvedToken = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'approvedERC20',
		args: [token],
	});

	return {
		chainId,
		token,
		approvedToken: formatApprovedToken(normalizeApprovedToken(approvedToken)),
	};
}

export async function getSubscriptionsDue(
	env: Env,
	chainId: number,
	options: { dayNumber?: number; frequency?: number } = {},
) {
	const { chain, client } = getContractContext(env, chainId);
	const dayNumber = options.dayNumber ?? getCurrentDay();
	const day = dayNumberToDayjs(dayNumber);

	const frequencies =
		options.frequency !== undefined
			? [options.frequency]
			: [
					FREQUENCY_TYPES.WEEKLY,
					FREQUENCY_TYPES.MONTHLY,
					FREQUENCY_TYPES.QUARTERLY,
					FREQUENCY_TYPES.YEARLY,
				];

	const results = [];

	for (const frequency of frequencies) {
		const dueDayInfo = getDueDay(frequency, day);
		if (dueDayInfo.shouldSkip || dueDayInfo.dueDay === undefined) {
			results.push({
				frequency,
				frequencyLabel: getFrequencyLabel(frequency),
				dayNumber,
				skipped: true,
				skipReason: dueDayInfo.skipReason,
				subscriptionIds: [],
			});
			continue;
		}

		const subscriptionIds = await client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'getIdByTime',
			args: [BigInt(frequency), dueDayInfo.dueDay],
		});

		results.push({
			frequency,
			frequencyLabel: getFrequencyLabel(frequency),
			dayNumber,
			dueDay: dueDayInfo.dueDay,
			skipped: false,
			subscriptionIds,
		});
	}

	return { chainId, dayNumber, results };
}

export function registerPaidTools(server: X402McpServer, env: Env) {
	server.paidTool(
		'get_protocol_state',
		'Read Clocktower protocol configuration and remit state for a chain',
		TOOL_PRICE,
		{
			chainId: chainIdSchema.describe('8453 for Base mainnet, 84532 for Base Sepolia'),
		},
		{},
		async ({ chainId }) => textResult(await getProtocolState(env, chainId as 8453 | 84532)),
	);

	server.paidTool(
		'get_subscription',
		'Read a subscription by id from ClockTowerSubscribe',
		TOOL_PRICE,
		{
			chainId: chainIdSchema,
			id: bytes32Schema.describe('Subscription id (bytes32 hex)'),
		},
		{},
		async ({ chainId, id }) => textResult(await getSubscription(env, chainId as 8453 | 84532, id as `0x${string}`)),
	);

	server.paidTool(
		'get_account_subscriptions',
		'List subscriptions for an account as provider or subscriber',
		TOOL_PRICE,
		{
			chainId: chainIdSchema,
			bySubscriber: z
				.boolean()
				.describe('true = subscriptions the account is subscribed to; false = subscriptions created by the account'),
			account: addressSchema,
		},
		{},
		async ({ chainId, bySubscriber, account }) =>
			textResult(
				await getAccountSubscriptions(
					env,
					chainId as 8453 | 84532,
					bySubscriber as boolean,
					account as `0x${string}`,
				),
			),
	);

	server.paidTool(
		'get_subscribers',
		'List subscribers and fee balances for a subscription id',
		TOOL_PRICE,
		{
			chainId: chainIdSchema,
			id: bytes32Schema,
		},
		{},
		async ({ chainId, id }) => textResult(await getSubscribers(env, chainId as 8453 | 84532, id as `0x${string}`)),
	);

	server.paidTool(
		'get_approved_token',
		'Read approved ERC20 token configuration from the Clocktower contract',
		TOOL_PRICE,
		{
			chainId: chainIdSchema,
			token: addressSchema,
		},
		{},
		async ({ chainId, token }) =>
			textResult(await getApprovedToken(env, chainId as 8453 | 84532, token as `0x${string}`)),
	);

	server.paidTool(
		'get_subscriptions_due',
		'Find subscription ids due on a given day by frequency (mirrors caller remit scanning)',
		TOOL_PRICE,
		{
			chainId: chainIdSchema,
			dayNumber: z.number().int().nonnegative().optional().describe('Day number since Unix epoch; defaults to today'),
			frequency: z
				.number()
				.int()
				.min(0)
				.max(3)
				.optional()
				.describe('0=weekly, 1=monthly, 2=quarterly, 3=yearly; omit to query all frequencies'),
		},
		{},
		async ({ chainId, dayNumber, frequency }) =>
			textResult(
				await getSubscriptionsDue(env, chainId as 8453 | 84532, {
					dayNumber: dayNumber as number | undefined,
					frequency: frequency as number | undefined,
				}),
			),
	);
}
