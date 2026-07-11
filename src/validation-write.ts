import { z } from 'zod';
import type { WriteDetails, WriteSubscription } from './abi/clocktower-write.js';
import { DUEDAY_RANGES } from './tx/constants.js';
import { addressSchema, bytes32Schema } from './validation.js';

/**
 * Anchored https-only URL validation. Subscription details.url is written
 * on-chain and likely rendered by downstream UIs; permissive schemes
 * (javascript:, data:, vbscript:, etc.) would enable stored XSS.
 *
 * Validation runs in two layers:
 *   1) anchored regex prefix check (cheap)
 *   2) WHATWG URL parser sanity check (catches malformed inputs)
 */
const HTTPS_URL_PREFIX = /^https:\/\/[^\s"'<>`]+$/;

function isSafeHttpsUrl(value: string): boolean {
	if (!HTTPS_URL_PREFIX.test(value)) {
		return false;
	}
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== 'https:') {
			return false;
		}
		if (!parsed.hostname) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

export const fromAddressSchema = addressSchema.describe('Address that will sign and send the transaction(s)');

export const readinessOnlySchema = z
	.boolean()
	.optional()
	.describe(
		'If true, run preflight/readiness only without building unsigned transactions or simulation.',
	);

export const simulateFromAddressSchema = addressSchema
	.optional()
	.describe(
		'Optional account passed to eth_estimateGas; defaults to from when omitted.',
	);

// Description is bounded by UTF-8 byte length, not JS char count, because the
// downstream contract storage charges for bytes. A 255-char string of 4-byte
// emoji would otherwise occupy ~1 KB on-chain (subscriber pays gas, but a
// malicious provider can still bloat the protocol's index pages).
const DESCRIPTION_MAX_BYTES = 255;
const descriptionEncoder = new TextEncoder();

export const detailsSchema = z.object({
	url: z
		.string()
		.max(2048)
		.refine(
			(value) => value === '' || isSafeHttpsUrl(value),
			'Invalid URL: must be empty or an absolute https:// URL',
		),
	description: z
		.string()
		.refine(
			(value) => descriptionEncoder.encode(value).length <= DESCRIPTION_MAX_BYTES,
			`description must be <= ${DESCRIPTION_MAX_BYTES} UTF-8 bytes`,
		),
});

export const dueDaySchema = z.number().int().nonnegative().max(65535);

export function validateDueDayForFrequency(frequency: number, dueDay: number): string | null {
	const range = DUEDAY_RANGES[frequency];
	if (!range) {
		return `Unknown frequency: ${frequency}`;
	}
	if (dueDay < range.start || dueDay > range.stop) {
		return `dueDay must be between ${range.start} and ${range.stop} for frequency ${frequency}`;
	}
	return null;
}

export const humanAmountSchema = z
	.string()
	.regex(/^\d+(\.\d+)?$/, 'Amount must be a decimal string')
	.describe(
		'Human-readable token amount (e.g. "10" or "100.5"), not protocol 18-dec wei and not amountRaw',
	);

/** Client-facing subscription object: amount is human token units only. */
export const subscriptionInputSchema = z.object({
	id: bytes32Schema,
	amount: humanAmountSchema,
	provider: addressSchema,
	token: addressSchema,
	cancelled: z.boolean(),
	frequency: z.number().int().min(0).max(3),
	dueDay: dueDaySchema,
});

/** After normalizeSubscriptionAmount: amount is protocol 18-dec bigint. */
export type NormalizedSubscriptionInput = Omit<
	z.infer<typeof subscriptionInputSchema>,
	'amount'
> & {
	amount: bigint;
};

export function toWriteSubscription(input: NormalizedSubscriptionInput): WriteSubscription {
	return {
		id: input.id,
		amount: input.amount,
		provider: input.provider,
		token: input.token,
		cancelled: input.cancelled,
		frequency: input.frequency,
		dueDay: input.dueDay,
	};
}

export const infiniteApprovalSchema = z
	.boolean()
	.optional()
	.describe(
		'If true, prepare_subscribe approves max allowance; default approves the subscription amount only',
	);

export const createSubscriptionInputSchema = z
	.object({
		from: fromAddressSchema,
		amount: humanAmountSchema,
		token: addressSchema,
		details: detailsSchema,
		frequency: z.number().int().min(0).max(3),
		dueDay: dueDaySchema,
		readinessOnly: readinessOnlySchema,
		simulateFromAddress: simulateFromAddressSchema,
	})
	.superRefine((value, ctx) => {
		const error = validateDueDayForFrequency(value.frequency, value.dueDay);
		if (error) {
			ctx.addIssue({ code: 'custom', message: error, path: ['dueDay'] });
		}
	});

export const subscribeInputSchema = z.object({
	from: fromAddressSchema,
	subscription: subscriptionInputSchema,
	readinessOnly: readinessOnlySchema,
	simulateFromAddress: simulateFromAddressSchema,
	infiniteApproval: infiniteApprovalSchema,
});

/** Subscribe using only on-chain id (server loads amount/token/provider). */
export const subscribeByIdInputSchema = z.object({
	from: fromAddressSchema,
	id: bytes32Schema.describe('Subscription id (bytes32); amount and token are loaded from chain'),
	readinessOnly: readinessOnlySchema,
	simulateFromAddress: simulateFromAddressSchema,
	infiniteApproval: infiniteApprovalSchema,
});

export const checkSubscribeReadinessByIdInputSchema = z.object({
	from: fromAddressSchema,
	id: bytes32Schema.describe('Subscription id (bytes32); amount and token are loaded from chain'),
});

export const subscriptionActionInputSchema = z.object({
	from: fromAddressSchema,
	subscription: subscriptionInputSchema,
	readinessOnly: readinessOnlySchema,
	simulateFromAddress: simulateFromAddressSchema,
});

/** Cancel / unsubscribe using only on-chain id (server loads the full struct). */
export const subscriptionActionByIdInputSchema = z.object({
	from: fromAddressSchema,
	id: bytes32Schema.describe('Subscription id (bytes32); remaining fields are loaded from chain'),
	readinessOnly: readinessOnlySchema,
	simulateFromAddress: simulateFromAddressSchema,
});

export const unsubscribeByProviderInputSchema = z.object({
	from: fromAddressSchema,
	subscription: subscriptionInputSchema,
	subscriber: addressSchema,
	readinessOnly: readinessOnlySchema,
	simulateFromAddress: simulateFromAddressSchema,
});

export const unsubscribeByProviderByIdInputSchema = z.object({
	from: fromAddressSchema,
	id: bytes32Schema.describe('Subscription id (bytes32); remaining fields are loaded from chain'),
	subscriber: addressSchema,
	readinessOnly: readinessOnlySchema,
	simulateFromAddress: simulateFromAddressSchema,
});

export const editDetailsInputSchema = z.object({
	from: fromAddressSchema,
	id: bytes32Schema,
	details: detailsSchema,
	readinessOnly: readinessOnlySchema,
	simulateFromAddress: simulateFromAddressSchema,
});

export const remitInputSchema = z.object({
	from: fromAddressSchema,
	readinessOnly: readinessOnlySchema,
	simulateFromAddress: simulateFromAddressSchema,
});

export function toWriteDetails(input: z.infer<typeof detailsSchema>): WriteDetails {
	return {
		url: input.url,
		description: input.description,
	};
}
