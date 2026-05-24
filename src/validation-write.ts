import { parseUnits } from 'viem';
import { z } from 'zod';
import type { WriteDetails, WriteSubscription } from './abi/clocktower-write.js';
import { DUEDAY_RANGES } from './tx/constants.js';
import { PROTOCOL_DECIMALS } from './utils.js';
import { addressSchema, bytes32Schema } from './validation.js';

const URL_PATTERN =
	/((([A-Za-z]{3,9}:(?:\/\/)?)(?:[\-;:&=\+\$,\w]+@)?[A-Za-z0-9.\-]+|(?:www\.|[\-;:&=\+\$,\w]+@)[A-Za-z0-9.\-]+)((?:\/[\+~%\/.\w\-_]*)?\??(?:[\-\+=&;%@\.\w_]*)#?(?:[\.\!\/\\\w]*))?)/;

const bigintStringSchema = z
	.union([z.string(), z.number(), z.bigint()])
	.transform((value, ctx) => {
		try {
			return BigInt(value);
		} catch {
			ctx.addIssue({ code: 'custom', message: 'Invalid bigint value' });
			return z.NEVER;
		}
	});

export const fromAddressSchema = addressSchema.describe('Address that will sign and send the transaction(s)');

export const detailsSchema = z.object({
	url: z
		.string()
		.max(2048)
		.refine((value) => value === '' || URL_PATTERN.test(value), 'Invalid URL'),
	description: z.string().max(255),
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

export const protocolAmountSchema = z
	.string()
	.regex(/^\d+(\.\d+)?$/, 'Amount must be a decimal string')
	.transform((value) => parseUnits(value, PROTOCOL_DECIMALS));

export const subscriptionInputSchema = z.object({
	id: bytes32Schema,
	amount: bigintStringSchema,
	provider: addressSchema,
	token: addressSchema,
	cancelled: z.boolean(),
	frequency: z.number().int().min(0).max(3),
	dueDay: dueDaySchema,
});

export function toWriteSubscription(input: z.infer<typeof subscriptionInputSchema>): WriteSubscription {
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

export const createSubscriptionInputSchema = z
	.object({
		from: fromAddressSchema,
		amount: protocolAmountSchema,
		token: addressSchema,
		details: detailsSchema,
		frequency: z.number().int().min(0).max(3),
		dueDay: dueDaySchema,
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
});

export const subscriptionActionInputSchema = z.object({
	from: fromAddressSchema,
	subscription: subscriptionInputSchema,
});

export const unsubscribeByProviderInputSchema = z.object({
	from: fromAddressSchema,
	subscription: subscriptionInputSchema,
	subscriber: addressSchema,
});

export const editDetailsInputSchema = z.object({
	from: fromAddressSchema,
	id: bytes32Schema,
	details: detailsSchema,
});

export function toWriteDetails(input: z.infer<typeof detailsSchema>): WriteDetails {
	return {
		url: input.url,
		description: input.description,
	};
}
