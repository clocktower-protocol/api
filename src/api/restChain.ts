import type { Context, Next } from 'hono';
import {
	resolveRestChain,
	UnsupportedChainError,
	type ChainConfig,
} from '../chain.js';
import { Errors } from './responses.js';

export type ApiBindings = {
	Bindings: Env;
	Variables: { chain: ChainConfig };
};

export function restChainErrorResponse(err: unknown): Response {
	if (err instanceof UnsupportedChainError) {
		return Errors.validation(err.message);
	}
	if (err instanceof Error) {
		return Errors.validation(err.message);
	}
	return Errors.validation('Invalid chainId');
}

/** Resolve `?chainId=` (or DEFAULT_REST_CHAIN_ID) onto the Hono context. */
export async function restChainMiddleware(c: Context<ApiBindings>, next: Next) {
	try {
		c.set('chain', resolveRestChain(c.env, c.req.query('chainId')));
	} catch (err) {
		return restChainErrorResponse(err);
	}
	await next();
}

export function requestChain(c: Context): ChainConfig {
	return c.get('chain') as ChainConfig;
}
