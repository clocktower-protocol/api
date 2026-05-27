import type { X402McpServer } from './types.js';
import { safeHandler } from './safeHandler.js';
import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import { ERC20_ABI } from '../abi/erc20.js';
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
import { APPROVED_TOKENS } from '../config/approvedTokens.js';

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

function getContractContext(env: Env) {
	const chain = resolveChain(env);
	const client = createClocktowerClient(chain);
	return { chain, client };
}

export async function getProtocolState(env: Env) {
	const { chain, client } = getContractContext(env);

	const [callerFee, systemFee] = await Promise.all([
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
		chainId: chain.chainId,
		contractAddress: chain.contractAddress,
		callerFeePercent: callerFeePercent,
		systemFeePercent: systemFeePercent,
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
		subscription: await formatSubscription(normalized, tokenDecimals, client),
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

export async function getFeeBalance(env: Env, subscriptionId: `0x${string}`, subscriber: `0x${string}`) {
	const { chain, client } = getContractContext(env);

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

export async function getAccount(env: Env, account: `0x${string}`) {
	const { chain, client } = getContractContext(env);

	const accountData = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'getAccount',
		args: [account],
	});

	// Add human-readable labels for frequency and status (matching MCP style)
	const formatSubIndex = (sub: any) => ({
		...sub,
		frequencyLabel: getFrequencyLabel(sub.frequency),
		statusLabel: getStatusLabel(sub.status),
	});

	return {
		chainId: chain.chainId,
		accountAddress: accountData.accountAddress,
		subscriptions: (accountData.subscriptions || []).map(formatSubIndex),
		provSubs: (accountData.provSubs || []).map(formatSubIndex),
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
			dueDay: dueDayInfo.dueDay,
			skipped: false,
			subscriptionIds,
		});
	}

	return { chainId: chain.chainId, results };
}

export function registerPaidTools(server: X402McpServer, env: Env) {
	server.paidTool(
		'get_protocol_state',
		'Read Clocktower protocol fee configuration on Base mainnet',
		TOOL_PRICE,
		{},
		{},
		async () =>
			safeHandler('get_protocol_state', async () => textResult(await getProtocolState(env))),
	);

	server.paidTool(
		'get_subscription',
		'Read a subscription by id from ClockTowerSubscribe on Base mainnet',
		TOOL_PRICE,
		{
			id: bytes32Schema.describe('Subscription id (bytes32 hex)'),
		},
		{},
		async ({ id }) =>
			safeHandler('get_subscription', async () =>
				textResult(await getSubscription(env, id as `0x${string}`)),
			),
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
			safeHandler('get_account_subscriptions', async () =>
				textResult(
					await getAccountSubscriptions(env, bySubscriber as boolean, account as `0x${string}`),
				),
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
		async ({ id }) =>
			safeHandler('get_subscribers', async () =>
				textResult(await getSubscribers(env, id as `0x${string}`)),
			),
	);

	server.paidTool(
		'get_approved_token',
		'Read approved ERC20 token configuration from the Clocktower contract on Base mainnet',
		TOOL_PRICE,
		{
			token: addressSchema,
		},
		{},
		async ({ token }) =>
			safeHandler('get_approved_token', async () =>
				textResult(await getApprovedToken(env, token as `0x${string}`)),
			),
	);

	// Lightly managed list of approved tokens (static config because the
	// on-chain approvedERC20 mapping is not enumerable).
	server.paidTool(
		'list_approved_tokens',
		'List ERC-20 tokens currently approved for use with Clocktower subscriptions',
		TOOL_PRICE,
		{},
		{},
		async () =>
			safeHandler('list_approved_tokens', async () =>
				textResult({
					chainId: 8453,
					tokens: APPROVED_TOKENS,
				}),
			),
	);

	server.paidTool(
		'get_fee_balance',
		'Get current fee balance for a subscriber on a specific subscription',
		TOOL_PRICE,
		{
			id: bytes32Schema,
			address: addressSchema,
		},
		{},
		async ({ id, address }) =>
			safeHandler('get_fee_balance', async () =>
				textResult(await getFeeBalance(env, id as `0x${string}`, address as `0x${string}`)),
			),
	);

	server.paidTool(
		'get_account',
		'Get full account overview including subscriptions and created subscriptions with status',
		TOOL_PRICE,
		{
			address: addressSchema,
		},
		{},
		async ({ address }) =>
			safeHandler('get_account', async () =>
				textResult(await getAccount(env, address as `0x${string}`)),
			),
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
			safeHandler('get_subscriptions_due', async () =>
				textResult(
					await getSubscriptionsDue(env, {
						dayNumber: dayNumber as number | undefined,
						frequency: frequency as number | undefined,
					}),
				),
			),
	);
}
