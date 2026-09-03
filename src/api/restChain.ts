import type { Context, Next } from 'hono';
import {
	parseChainIdParam,
	resolveRestChain,
	UnsupportedChainError,
	type ChainConfig,
} from '../chain.js';
import { Errors } from './responses.js';

export type ApiBindings = {
	Bindings: Env;
	Variables: { chain: ChainConfig };
};

export function restChainErrorResponse(err: unknown, rawChainId?: string): Response {
	if (err instanceof UnsupportedChainError) {
		const raw = rawChainId?.trim();
		if (raw) {
			try {
				return Errors.validation(`Unsupported chainId ${parseChainIdParam(raw)}`);
			} catch {
				return Errors.validation('Unsupported or disabled chainId');
			}
		}
		return Errors.validation('Unsupported or disabled chainId');
	}
	return Errors.validation('chainId must be a decimal chain id or CAIP-2 eip155:<id>');
}

/** Resolve `?chainId=` (or DEFAULT_REST_CHAIN_ID) onto the Hono context. */
export async function restChainMiddleware(c: Context<ApiBindings>, next: Next) {
	const raw = c.req.query('chainId');
	try {
		c.set('chain', resolveRestChain(c.env, raw));
	} catch (err) {
		return restChainErrorResponse(err, raw);
	}
	await next();
}

export function requestChain(c: Context): ChainConfig {
	return c.get('chain') as ChainConfig;
}
