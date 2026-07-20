import { z } from 'zod';
import { Errors, jsonResponse } from './responses.js';
import { addressSchema } from './read.js';
import { getSearchMaxFirst } from '../config/rateLimits.js';
import { parseAccessLane } from '../requestLane.js';
import { searchSubscriptions } from '../tools/discovery.js';

const frequencySchema = z.coerce.number().int().min(0).max(3).optional();

const booleanQuerySchema = z
	.union([z.literal('true'), z.literal('false')])
	.transform((val) => val === 'true')
	.optional();

export async function handleSearchSubscriptions(
	env: Env,
	query: Record<string, string | undefined>,
	laneHeader?: string | null,
) {
	const lane = parseAccessLane(laneHeader);

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

	let first = query.first ? Number(query.first) : undefined;
	const skip = query.skip ? Number(query.skip) : undefined;

	const maxFirst = getSearchMaxFirst(lane);
	if (first !== undefined && (!Number.isInteger(first) || first < 1 || first > maxFirst)) {
		return Errors.validation(
			`Invalid first parameter (${lane} tier: 1–${maxFirst})`,
		);
	}
	if (skip !== undefined && (!Number.isInteger(skip) || skip < 0)) {
		return Errors.validation('Invalid skip parameter (must be >= 0)');
	}

	let includeDetails = includeDetailsParse.data ?? false;
	if (lane === 'free' && includeDetails) {
		return Errors.validation(
			'Free tier does not support includeDetails=true; use a developer API key or Builder session',
		);
	}

	try {
		const data = await searchSubscriptions(env, {
			provider: providerParse.data as `0x${string}` | undefined,
			token: tokenParse.data as `0x${string}` | undefined,
			frequency: frequencyParse.data,
			cancelled: cancelledParse.data ?? false,
			includeDetails,
			first,
			skip,
		});
		return jsonResponse(data);
	} catch (err: unknown) {
		console.error('search_subscriptions failed', err);
		return Errors.upstream('Failed to search subscriptions');
	}
}