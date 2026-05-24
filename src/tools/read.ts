import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodTypeAny } from 'zod';
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

function formatSubscription(subscription: SubscriptionRecord, tokenDecimals: number) {
	const { amount, amountRaw } = formatProtocolStoredAmount(subscription.amount, tokenDecimals);

	return {
		id: subscription.id,
		provider: subscription.provider,
		token: subscription.token,
		cancelled: subscription.cancelled,
		dueDay: subscription.dueDay,
		frequency: subscription.frequency,
		frequencyLabel: getFrequencyLabel(subscription.frequency),
		amount,
		amountRaw,
		tokenDecimals,
	};
}

function formatAccountSubscription(
	entry: ReturnType<typeof parseAccountSubscriptionRecord>,
	tokenDecimals: number,
) {
	return {
		subscription: formatSubscription(entry.subscription, tokenDecimals),
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

type X402McpServer = McpServer & {
	paidTool: (
		name: string,
		description: string,
		price: number,
		inputSchema: Record<string, ZodTypeAny>,
		annotations: Record<string, unknown>,
		handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
	) => void;
};

function getContractContext(env: Env) {
	const chain = resolveChain(env);
	const client = createClocktowerClient(chain);
	return { chain, client };
}

export async function getProtocolState(env: Env) {
	const { chain, client } = getContractContext(env);

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
		chainId: chain.chainId,
		contractAddress: chain.contractAddress,
		nextUncheckedDay,
		callerFee,
		systemFee,
		maxRemits,
		cancelLimit,
	};
}

export async function getSubscription(env: Env, id: `0x${string}`) {
	const { chain, client } = getContractContext(env);

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
		subscription: formatSubscription(normalized, tokenDecimals),
	};
}

export async function getAccountSubscriptions(
	env: Env,
	bySubscriber: boolean,
	account: `0x${string}`,
) {
	const { chain, client } = getContractContext(env);

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

	return {
		chainId: chain.chainId,
		bySubscriber,
		account,
		subscriptions: normalized.map((entry) =>
			formatAccountSubscription(entry, decimalsCache.get(entry.subscription.token.toLowerCase()) ?? 18),
		),
	};
}

export async function getSubscribers(env: Env, id: `0x${string}`) {
	const { chain, client } = getContractContext(env);

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

export async function getApprovedToken(env: Env, token: `0x${string}`) {
	const { chain, client } = getContractContext(env);

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

export async function getSubscriptionsDue(
	env: Env,
	options: { dayNumber?: number; frequency?: number } = {},
) {
	const { chain, client } = getContractContext(env);
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

	return { chainId: chain.chainId, dayNumber, results };
}

export function registerPaidTools(server: X402McpServer, env: Env) {
	server.paidTool(
		'get_protocol_state',
		'Read Clocktower protocol configuration and remit state on Base mainnet',
		TOOL_PRICE,
		{},
		{},
		async () => textResult(await getProtocolState(env)),
	);

	server.paidTool(
		'get_subscription',
		'Read a subscription by id from ClockTowerSubscribe on Base mainnet',
		TOOL_PRICE,
		{
			id: bytes32Schema.describe('Subscription id (bytes32 hex)'),
		},
		{},
		async ({ id }) => textResult(await getSubscription(env, id as `0x${string}`)),
	);

	server.paidTool(
		'get_account_subscriptions',
		'List subscriptions for an account as provider or subscriber on Base mainnet',
		TOOL_PRICE,
		{
			bySubscriber: bySubscriberSchema,
			account: addressSchema,
		},
		{},
		async ({ bySubscriber, account }) =>
			textResult(
				await getAccountSubscriptions(env, bySubscriber as boolean, account as `0x${string}`),
			),
	);

	server.paidTool(
		'get_subscribers',
		'List subscribers and fee balances for a subscription id on Base mainnet',
		TOOL_PRICE,
		{
			id: bytes32Schema,
		},
		{},
		async ({ id }) => textResult(await getSubscribers(env, id as `0x${string}`)),
	);

	server.paidTool(
		'get_approved_token',
		'Read approved ERC20 token configuration from the Clocktower contract on Base mainnet',
		TOOL_PRICE,
		{
			token: addressSchema,
		},
		{},
		async ({ token }) => textResult(await getApprovedToken(env, token as `0x${string}`)),
	);

	server.paidTool(
		'get_subscriptions_due',
		'Find subscription ids due on a given day by frequency on Base mainnet (mirrors caller remit scanning)',
		TOOL_PRICE,
		{
			dayNumber: dayNumberSchema,
			frequency: frequencySchema,
		},
		{},
		async ({ dayNumber, frequency }) =>
			textResult(
				await getSubscriptionsDue(env, {
					dayNumber: dayNumber as number | undefined,
					frequency: frequency as number | undefined,
				}),
			),
	);
}
