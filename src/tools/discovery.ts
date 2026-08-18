/**
 * Subscription discovery — subgraph Create events + optional on-chain enrichment.
 */

import { getFrequencyLabel } from '../utils.js';
import { resolveChain, type ChainConfig } from '../chain.js';
import { getSubscription } from './read.js';
import {
	getSubscriptionDetails,
	searchSubscriptionCreates,
	type SearchCreatesOptions,
} from './history.js';

export type SearchSubscriptionsOptions = SearchCreatesOptions & {
	cancelled?: boolean;
	frequency?: number;
	includeDetails?: boolean;
};

const DISCOVERY_DEFAULT_LIMIT = 20;
const DISCOVERY_MAX_LIMIT = 50;

function normalizeDiscoveryOptions(options: SearchSubscriptionsOptions = {}) {
	const rawFirst = options.first ?? DISCOVERY_DEFAULT_LIMIT;
	const rawSkip = options.skip ?? 0;

	return {
		first: Math.max(1, Math.min(Math.floor(rawFirst), DISCOVERY_MAX_LIMIT)),
		skip: Math.max(0, Math.floor(rawSkip)),
		provider: options.provider,
		token: options.token,
		cancelled: options.cancelled ?? false,
		frequency: options.frequency,
		includeDetails: options.includeDetails ?? false,
	};
}

export async function searchSubscriptions(
	env: Env,
	options: SearchSubscriptionsOptions = {},
	chain: ChainConfig = resolveChain(env),
) {
	const normalized = normalizeDiscoveryOptions(options);
	const chainId = chain.chainId;

	const subgraphResult = await searchSubscriptionCreates(env, chainId, {
		provider: normalized.provider,
		token: normalized.token,
		first: Math.min(normalized.first + normalized.skip + 50, 200),
		skip: 0,
	});

	if (subgraphResult.error) {
		return {
			chainId,
			subscriptions: [],
			hasMore: false,
			count: 0,
			error: subgraphResult.error,
		};
	}

	const enriched: Array<Record<string, unknown>> = [];

	for (const createEvent of subgraphResult.events) {
		if (enriched.length >= normalized.first + normalized.skip + normalized.first) {
			break;
		}

		try {
			const onChain = await getSubscription(env, createEvent.internal_id as `0x${string}`, chain);
			const sub = onChain.subscription;

			if (sub.cancelled !== normalized.cancelled) {
				continue;
			}

			if (
				normalized.frequency !== undefined &&
				Number(sub.frequency) !== normalized.frequency
			) {
				continue;
			}

			const entry: Record<string, unknown> = {
				id: sub.id,
				provider: sub.provider,
				token: sub.token,
				amount: sub.amount,
				amountRaw: sub.amountRaw,
				tokenDecimals: sub.tokenDecimals,
				frequency: sub.frequency,
				frequencyLabel: sub.frequencyLabel ?? getFrequencyLabel(Number(sub.frequency)),
				dueDay: sub.dueDay,
				cancelled: sub.cancelled,
				createdAt: createEvent.formattedTimestamp,
			};

			if (normalized.includeDetails) {
				const detailsResult = await getSubscriptionDetails(
					env,
					createEvent.internal_id as `0x${string}`,
					chainId,
				);
				entry.details = detailsResult.details;
			}

			enriched.push(entry);
		} catch {
			// Skip ids that fail on-chain lookup (stale subgraph row, etc.)
		}
	}

	const page = enriched.slice(normalized.skip, normalized.skip + normalized.first);

	return {
		chainId,
		subscriptions: page,
		hasMore: enriched.length > normalized.skip + normalized.first,
		count: page.length,
		filters: {
			provider: normalized.provider ?? null,
			token: normalized.token ?? null,
			frequency: normalized.frequency ?? null,
			cancelled: normalized.cancelled,
			includeDetails: normalized.includeDetails,
		},
	};
}