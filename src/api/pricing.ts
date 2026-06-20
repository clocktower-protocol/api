/**
 * x402 / MCP pricing (USD, USDC on Base).
 *
 * Keep in sync with clocktower-agent/src/smoke-pricing.ts.
 *
 * Static entries in API_PRICES are defaults for manifests and simple tools.
 * Dynamic helpers scale cost-heavy endpoints (history pagination, discovery enrichment).
 */

export const PRICING_BATCH_SIZE = 50;
export const PRICING_PER_BATCH_USD = 0.01;
export const PRICING_MAX_HISTORY_RECORDS = 200;

export const SEARCH_BASE_USD = 0.05;
export const SEARCH_PER_RESULT_USD = 0.01;
export const SEARCH_INCLUDE_DETAILS_SURCHARGE_USD = 0.01;
export const SEARCH_MAX_FIRST = 50;

export const API_PRICES = {
	// Read endpoints
	protocolState: 0.01,
	getSubscription: 0.01,
	getAccountSubscriptions: 0.01,
	getAccount: 0.03,
	getSubscribers: 0.01,
	getApprovedToken: 0.01,
	getSubscriptionsDue: 0.02,
	feeBalance: 0.01,
	catalog: 0.01,
	subscriptionDetails: 0.02,
	/** Base only — use calculateSearchSubscriptionsPrice() for MCP billing */
	searchSubscriptions: SEARCH_BASE_USD,

	// History & profile (bases — use calculate* helpers for MCP billing)
	subscriptionHistory: 0.03,
	accountActivity: 0.04,
	subscriptionDetailsHistory: 0.02,
	providerProfile: 0.02,

	// Write endpoints
	checkSubscribeReadiness: 0.01,
	prepareCreateSubscription: 0.02,
	prepareSubscribe: 0.02,
	prepareCancelSubscription: 0.02,
	prepareUnsubscribe: 0.02,
	prepareUnsubscribeByProvider: 0.02,
	prepareEditDetails: 0.02,
	checkRemitReadiness: 0.02,
	prepareRemit: 0.03,
	getTransactionStatus: 0.01,
} as const;

export type ApiEndpoint = keyof typeof API_PRICES;

export const WRITE_READINESS_PRICE = API_PRICES.checkSubscribeReadiness;
export const WRITE_PREPARE_PRICE = API_PRICES.prepareSubscribe;
export const REMIT_READINESS_PRICE = API_PRICES.checkRemitReadiness;
export const REMIT_PREPARE_PRICE = API_PRICES.prepareRemit;

export function roundUsd(amount: number): number {
	return Math.round(amount * 100) / 100;
}

export function calculateBatchPrice(
	recordCount: number,
	basePrice: number,
	options: {
		batchSize?: number;
		perBatch?: number;
		maxRecords?: number;
	} = {},
): number {
	const batchSize = options.batchSize ?? PRICING_BATCH_SIZE;
	const perBatch = options.perBatch ?? PRICING_PER_BATCH_USD;
	const maxRecords = options.maxRecords ?? PRICING_MAX_HISTORY_RECORDS;
	const count = Math.min(Math.max(1, Math.floor(recordCount) || 1), maxRecords);

	if (count <= batchSize) {
		return roundUsd(basePrice);
	}

	const extraBatches = Math.ceil((count - batchSize) / batchSize);
	return roundUsd(basePrice + extraBatches * perBatch);
}

/** @deprecated Use calculateSubscriptionHistoryPrice */
export function calculateSuggestedHistoryPrice(recordCount: number): number {
	return calculateSubscriptionHistoryPrice(recordCount);
}

export function calculateSubscriptionHistoryPrice(
	recordCount: number = PRICING_MAX_HISTORY_RECORDS,
): number {
	return calculateBatchPrice(recordCount, API_PRICES.subscriptionHistory);
}

export function calculateAccountActivityPrice(
	recordCount: number = PRICING_MAX_HISTORY_RECORDS,
): number {
	return calculateBatchPrice(recordCount, API_PRICES.accountActivity);
}

export function calculateSubscriptionDetailsHistoryPrice(
	recordCount: number = PRICING_MAX_HISTORY_RECORDS,
): number {
	return calculateBatchPrice(recordCount, API_PRICES.subscriptionDetailsHistory);
}

export function calculateSearchSubscriptionsPrice(
	options: { first?: number; includeDetails?: boolean } = {},
): number {
	const first = Math.min(
		Math.max(1, Math.floor(options.first ?? 20)),
		SEARCH_MAX_FIRST,
	);
	let price = SEARCH_BASE_USD + first * SEARCH_PER_RESULT_USD;
	if (options.includeDetails) {
		price += SEARCH_INCLUDE_DETAILS_SURCHARGE_USD;
	}
	return roundUsd(price);
}

export function getStandardPreparePrice(readinessOnly?: boolean): number {
	return readinessOnly ? WRITE_READINESS_PRICE : WRITE_PREPARE_PRICE;
}

export function getRemitPreparePrice(readinessOnly?: boolean): number {
	return readinessOnly ? REMIT_READINESS_PRICE : REMIT_PREPARE_PRICE;
}