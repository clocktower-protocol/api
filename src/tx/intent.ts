import { BASE_CHAIN_ID } from '../chain.js';
import {
	DEFAULT_PREPARE_INTENT_TTL_SECONDS,
	PREPARE_KV_PREFIX,
} from './constants.js';
import { getFunctionSelector } from './encode.js';
import type { IntentTransaction, PrepareIntent, UnsignedTransaction } from './types.js';

export function getPrepareIntentTtlSeconds(env: Env): number {
	const configured = env.PREPARE_INTENT_TTL_SECONDS;
	if (configured === undefined) {
		return DEFAULT_PREPARE_INTENT_TTL_SECONDS;
	}
	const parsed = Number.parseInt(configured, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PREPARE_INTENT_TTL_SECONDS;
}

function intentTransactions(unsigned: UnsignedTransaction[]): IntentTransaction[] {
	return unsigned.map((tx) => ({
		to: tx.to,
		data: tx.data,
		value: tx.value.toString(),
		functionSelector: getFunctionSelector(tx.data),
	}));
}

export async function storePrepareIntent(
	env: Env,
	from: `0x${string}`,
	unsigned: UnsignedTransaction[],
): Promise<PrepareIntent> {
	const prepareId = crypto.randomUUID();
	const ttl = getPrepareIntentTtlSeconds(env);
	const expiresAt = Date.now() + ttl * 1000;

	const intent: PrepareIntent = {
		prepareId,
		from,
		chainId: BASE_CHAIN_ID,
		transactions: intentTransactions(unsigned),
		expiresAt,
	};

	await env.RATE_LIMIT.put(`${PREPARE_KV_PREFIX}${prepareId}`, JSON.stringify(intent), {
		expirationTtl: ttl + 60,
	});

	return intent;
}

export async function loadPrepareIntent(env: Env, prepareId: string): Promise<PrepareIntent | null> {
	const raw = await env.RATE_LIMIT.get(`${PREPARE_KV_PREFIX}${prepareId}`);
	if (!raw) {
		return null;
	}

	const intent = JSON.parse(raw) as PrepareIntent;
	if (Date.now() > intent.expiresAt) {
		await env.RATE_LIMIT.delete(`${PREPARE_KV_PREFIX}${prepareId}`);
		return null;
	}

	return intent;
}

export async function consumePrepareIntent(env: Env, prepareId: string): Promise<PrepareIntent | null> {
	const intent = await loadPrepareIntent(env, prepareId);
	if (!intent) {
		return null;
	}
	await env.RATE_LIMIT.delete(`${PREPARE_KV_PREFIX}${prepareId}`);
	return intent;
}
