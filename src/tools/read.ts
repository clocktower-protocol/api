import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import { resolveChain } from '../chain.js';
import { createClocktowerClient } from '../client.js';
import {
	dayNumberToDayjs,
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

function formatSubscription(subscription: SubscriptionRecord) {
	const frequency = Number(subscription.frequency);
	return {
		...subscription,
		frequency,
		frequencyLabel: getFrequencyLabel(frequency),
	};
}

function formatAccountSubscription(entry: AccountSubscriptionRecord) {
	const status = Number(entry.status);
	return {
		...entry,
		subscription: formatSubscription(entry.subscription),
		status,
		statusLabel: getStatusLabel(status),
	};
}

export const chainIdSchema = z.union([z.literal(8453), z.literal(84532)]);
export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

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

	return {
		chainId,
		subscription: formatSubscription(normalizeSubscriptionRecord(subscription)),
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

	return {
		chainId,
		bySubscriber,
		account,
		subscriptions: (subscriptions as unknown[]).map((entry) =>
			formatAccountSubscription(normalizeAccountSubscription(entry)),
		),
	};
}

export async function getSubscribers(env: Env, chainId: number, id: `0x${string}`) {
	const { chain, client } = getContractContext(env, chainId);

	const subscribers = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'getSubscribersById',
		args: [id],
	});

	return { chainId, id, subscribers };
}

export async function getApprovedToken(env: Env, chainId: number, token: `0x${string}`) {
	const { chain, client } = getContractContext(env, chainId);

	const approvedToken = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'approvedERC20',
		args: [token],
	});

	return { chainId, token, approvedToken };
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

export function registerFreeTools(server: McpServer, env: Env) {
	server.registerTool(
		'get_protocol_state',
		{
			description: 'Read Clocktower protocol configuration and remit state for a chain',
			inputSchema: {
				chainId: chainIdSchema.describe('8453 for Base mainnet, 84532 for Base Sepolia'),
			},
		},
		async ({ chainId }) => textResult(await getProtocolState(env, chainId)),
	);

	server.registerTool(
		'get_subscription',
		{
			description: 'Read a subscription by id from ClockTowerSubscribe',
			inputSchema: {
				chainId: chainIdSchema,
				id: bytes32Schema.describe('Subscription id (bytes32 hex)'),
			},
		},
		async ({ chainId, id }) => textResult(await getSubscription(env, chainId, id as `0x${string}`)),
	);

	server.registerTool(
		'get_account_subscriptions',
		{
			description: 'List subscriptions for an account as provider or subscriber',
			inputSchema: {
				chainId: chainIdSchema,
				bySubscriber: z
					.boolean()
					.describe('true = subscriptions the account is subscribed to; false = subscriptions created by the account'),
				account: addressSchema,
			},
		},
		async ({ chainId, bySubscriber, account }) =>
			textResult(await getAccountSubscriptions(env, chainId, bySubscriber, account as `0x${string}`)),
	);

	server.registerTool(
		'get_subscribers',
		{
			description: 'List subscribers and fee balances for a subscription id',
			inputSchema: {
				chainId: chainIdSchema,
				id: bytes32Schema,
			},
		},
		async ({ chainId, id }) => textResult(await getSubscribers(env, chainId, id as `0x${string}`)),
	);

	server.registerTool(
		'get_approved_token',
		{
			description: 'Read approved ERC20 token configuration from the Clocktower contract',
			inputSchema: {
				chainId: chainIdSchema,
				token: addressSchema,
			},
		},
		async ({ chainId, token }) => textResult(await getApprovedToken(env, chainId, token as `0x${string}`)),
	);
}

export function registerPaidTools(server: X402McpServer, env: Env) {
	server.paidTool(
		'get_subscriptions_due',
		'Find subscription ids due on a given day by frequency (mirrors caller remit scanning)',
		0.01,
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
