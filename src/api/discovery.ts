import { z } from 'zod';
import { Errors, jsonResponse } from './responses.js';
import { addressSchema } from './read.js';
import { searchSubscriptions } from '../tools/discovery.js';

const frequencySchema = z.coerce.number().int().min(0).max(3).optional();

const booleanQuerySchema = z
	.union([z.literal('true'), z.literal('false')])
	.transform((val) => val === 'true')
	.optional();

export async function handleSearchSubscriptions(env: Env, query: Record<string, string | undefined>) {
	const providerParse = query.provider
		? addressSchema.safeParse(query.provider)
		: { success: true as const, data: undefined };
	if (!providerParse.success) {
		return Errors.validation('Invalid provider address');
	}

	const tokenParse = query.token
		? addressSchema.safeParse(query.token)
		: { success: true as const, data: undefined };
	if (!tokenParse.success) {
		return Errors.validation('Invalid token address');
	}

	const frequencyParse = query.frequency
		? frequencySchema.safeParse(query.frequency)
		: { success: true as const, data: undefined };
	if (!frequencyParse.success) {
		return Errors.validation('Invalid frequency (must be 0-3)');
	}

	const cancelledParse = query.cancelled
		? booleanQuerySchema.safeParse(query.cancelled)
		: { success: true as const, data: undefined };
	if (!cancelledParse.success) {
		return Errors.validation('Invalid cancelled parameter (must be true or false)');
	}

	const includeDetailsParse = query.includeDetails
		? booleanQuerySchema.safeParse(query.includeDetails)
		: { success: true as const, data: undefined };
	if (!includeDetailsParse.success) {
		return Errors.validation('Invalid includeDetails parameter (must be true or false)');
	}

	const first = query.first ? Number(query.first) : undefined;
	const skip = query.skip ? Number(query.skip) : undefined;

	if (first !== undefined && (!Number.isInteger(first) || first < 1 || first > 50)) {
		return Errors.validation('Invalid first parameter (must be 1-50)');
	}
	if (skip !== undefined && (!Number.isInteger(skip) || skip < 0)) {
		return Errors.validation('Invalid skip parameter (must be >= 0)');
	}

	try {
		const data = await searchSubscriptions(env, {
			provider: providerParse.data as `0x${string}` | undefined,
			token: tokenParse.data as `0x${string}` | undefined,
			frequency: frequencyParse.data,
			cancelled: cancelledParse.data ?? false,
			includeDetails: includeDetailsParse.data ?? false,
			first,
			skip,
		});
		return jsonResponse(data);
	} catch (err: unknown) {
		console.error('search_subscriptions failed', err);
		return Errors.upstream('Failed to search subscriptions');
	}
}