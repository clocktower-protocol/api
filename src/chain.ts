import type { Chain } from 'viem';
import { base } from 'viem/chains';

/** Base mainnet (CAIP-2: eip155:8453). MCP default, x402 payments, SIWE, and Builder. */
export const BASE_CHAIN_ID = 8453 as const;

export type BaseChainId = typeof BASE_CHAIN_ID;

export const BASE_CAIP2 = 'eip155:8453' as const;

/** Static registry row. RPC, contract, and subgraph URLs are hydrated from env. */
export type ChainSpec = {
	chainId: number;
	caip2: string;
	name: string;
	viemChain: Chain;
	restEnabled: boolean;
	mcpEnabled: boolean;
};

export interface ChainConfig extends ChainSpec {
	rpcUrl: string;
	contractAddress: `0x${string}`;
	subgraphUrl?: string;
}

export class UnsupportedChainError extends Error {
	readonly code = 'UNSUPPORTED_CHAIN' as const;

	constructor(message: string) {
		super(message);
		this.name = 'UnsupportedChainError';
	}
}

const BASE_SPEC: ChainSpec = {
	chainId: BASE_CHAIN_ID,
	caip2: BASE_CAIP2,
	name: 'base',
	viemChain: base,
	restEnabled: true,
	mcpEnabled: true,
};

const CHAIN_REGISTRY: Map<number, ChainSpec> = new Map([[BASE_CHAIN_ID, BASE_SPEC]]);

const CAIP2_PATTERN = /^eip155:(\d+)$/i;
const DECIMAL_CHAIN_ID_PATTERN = /^\d+$/;

export function listChainSpecs(): ChainSpec[] {
	return [...CHAIN_REGISTRY.values()];
}

export function getChainSpec(chainId: number): ChainSpec | undefined {
	return CHAIN_REGISTRY.get(chainId);
}

/**
 * Parse a REST `chainId` query value. Accepts a decimal id (`8453`) or CAIP-2
 * (`eip155:8453`). Throws a generic Error on empty/invalid format.
 */
export function parseChainIdParam(raw: string): number {
	const value = raw.trim();
	if (!value) {
		throw new Error(
			'chainId must be a non-empty decimal or CAIP-2 string (e.g. 8453 or eip155:8453)',
		);
	}

	const caip = value.match(CAIP2_PATTERN);
	const digits = caip?.[1] ?? (DECIMAL_CHAIN_ID_PATTERN.test(value) ? value : undefined);
	if (!digits) {
		throw new Error('chainId must be a decimal chain id or CAIP-2 eip155:<id>');
	}

	const chainId = Number.parseInt(digits, 10);
	if (!Number.isSafeInteger(chainId) || chainId <= 0) {
		throw new Error('chainId must be a positive integer');
	}
	return chainId;
}

export type ChainIdInput = string | number | null | undefined;

function parseChainIdInput(raw: string | number): number {
	return parseChainIdParam(typeof raw === 'number' ? String(raw) : raw);
}

/**
 * REST default when the client omits `chainId`. Unset/empty → Base.
 * Does not apply to MCP protocol tools, x402, SIWE, or Builder entitlement.
 */
export function getDefaultRestChainId(env: Env): number {
	const raw = env.DEFAULT_REST_CHAIN_ID?.trim();
	if (!raw) {
		return BASE_CHAIN_ID;
	}
	return parseChainIdParam(raw);
}

export function assertDefaultRestChainId(env: Env): number {
	let chainId: number;
	try {
		chainId = getDefaultRestChainId(env);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`Env var DEFAULT_REST_CHAIN_ID is invalid: ${detail}`);
	}

	const spec = getChainSpec(chainId);
	if (!spec?.restEnabled) {
		throw new Error(
			`Env var DEFAULT_REST_CHAIN_ID must be a REST-enabled registered chain (got ${chainId})`,
		);
	}
	return chainId;
}

function hydrateChain(env: Env, spec: ChainSpec): ChainConfig {
	if (spec.chainId === BASE_CHAIN_ID) {
		return {
			...spec,
			rpcUrl: `${env.ALCHEMY_URL}${env.ALCHEMY_API_KEY}`,
			contractAddress: env.CLOCKTOWER_ADDRESS as `0x${string}`,
			subgraphUrl: env.GRAPH_BASE_URL,
		};
	}

	throw new UnsupportedChainError(`Chain ${spec.chainId} is not configured`);
}

export function getSubgraphUrl(env: Env, chainId: number): string | undefined {
	if (chainId === BASE_CHAIN_ID) {
		return env.GRAPH_BASE_URL;
	}
	return undefined;
}

/** Base mainnet only. Used by SIWE and Builder entitlement. Ignores DEFAULT_REST_CHAIN_ID. */
export function resolveChain(env: Env): ChainConfig {
	return hydrateChain(env, BASE_SPEC);
}

function resolveRegisteredChain(
	env: Env,
	chainId: number,
	surface: 'rest' | 'mcp',
): ChainConfig {
	const spec = getChainSpec(chainId);
	if (!spec) {
		throw new UnsupportedChainError(`Unsupported chainId ${chainId}`);
	}
	if (surface === 'rest' && !spec.restEnabled) {
		throw new UnsupportedChainError(`Chain ${chainId} is not enabled for REST`);
	}
	if (surface === 'mcp' && !spec.mcpEnabled) {
		throw new UnsupportedChainError(`Chain ${chainId} is not enabled for MCP`);
	}
	return hydrateChain(env, spec);
}

/**
 * REST protocol chain. Omitted/empty `raw` uses DEFAULT_REST_CHAIN_ID (Base if unset).
 * Rejects unknown and REST-disabled chains.
 */
export function resolveRestChain(env: Env, raw?: string | null): ChainConfig {
	const chainId =
		raw == null || raw.trim() === '' ? getDefaultRestChainId(env) : parseChainIdParam(raw);
	return resolveRegisteredChain(env, chainId, 'rest');
}

/**
 * MCP protocol chain. Omitted/empty `raw` uses Base (8453), not DEFAULT_REST_CHAIN_ID.
 * Accepts decimal, CAIP-2, or JSON number. Rejects unknown and MCP-disabled chains.
 */
export function resolveMcpChain(env: Env, raw?: ChainIdInput): ChainConfig {
	if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
		return resolveRegisteredChain(env, BASE_CHAIN_ID, 'mcp');
	}
	return resolveRegisteredChain(env, parseChainIdInput(raw), 'mcp');
}

export function listChainCatalog(env: Env): Array<{
	chainId: number;
	caip2: string;
	name: string;
	rest: boolean;
	mcp: boolean;
	default: boolean;
}> {
	const defaultId = getDefaultRestChainId(env);
	return listChainSpecs().map((spec) => ({
		chainId: spec.chainId,
		caip2: spec.caip2,
		name: spec.name,
		rest: spec.restEnabled,
		mcp: spec.mcpEnabled,
		default: spec.chainId === defaultId,
	}));
}

/** MCP `list_chains` catalog. `default` is always Base, not DEFAULT_REST_CHAIN_ID. */
export function listMcpChainCatalog(): Array<{
	chainId: number;
	caip2: string;
	name: string;
	rest: boolean;
	mcp: boolean;
	default: boolean;
}> {
	return listChainSpecs().map((spec) => ({
		chainId: spec.chainId,
		caip2: spec.caip2,
		name: spec.name,
		rest: spec.restEnabled,
		mcp: spec.mcpEnabled,
		default: spec.chainId === BASE_CHAIN_ID,
	}));
}
