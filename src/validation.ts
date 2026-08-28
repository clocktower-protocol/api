import { z } from 'zod';
import { assertDefaultRestChainId } from './chain.js';
import { isMcpX402Enabled } from './config/mcpX402.js';

export const MAX_REQUEST_BYTES = 1024 * 1024;
export const MAX_JSON_DEPTH = 10;
export const MAX_DAY_NUMBER = 47482; // 2100-01-01 UTC

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const BYTES32_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const HTTPS_URL_PATTERN = /^https:\/\/.+/;

const MCP_METHODS = new Set(['GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD']);

export function normalizeHex(value: string): string {
	return value.toLowerCase();
}

export function isAddress(value: string): boolean {
	return ADDRESS_PATTERN.test(value);
}

export function isBytes32(value: string): boolean {
	return BYTES32_PATTERN.test(value);
}

export const addressSchema = z
	.string()
	.regex(ADDRESS_PATTERN, 'Invalid Ethereum address')
	.transform((value) => normalizeHex(value) as `0x${string}`);

export const bytes32Schema = z
	.string()
	.regex(BYTES32_PATTERN, 'Invalid bytes32 hex string')
	.transform((value) => normalizeHex(value) as `0x${string}`);

export const dayNumberSchema = z
	.number()
	.int()
	.nonnegative()
	.max(MAX_DAY_NUMBER)
	.optional()
	.describe('Day number since Unix epoch; defaults to today');

export const frequencySchema = z
	.number()
	.int()
	.min(0)
	.max(3)
	.optional()
	.describe('0=weekly, 1=monthly, 2=quarterly, 3=yearly; omit to query all frequencies');

export const bySubscriberSchema = z.coerce
	.boolean()
	.describe('true = subscriptions the account is subscribed to; false = subscriptions created by the account');

export function validateJsonDepth(value: unknown, maxDepth = MAX_JSON_DEPTH, depth = 0): boolean {
	if (depth > maxDepth) {
		return false;
	}

	if (typeof value === 'object' && value !== null) {
		for (const key of Object.keys(value)) {
			if (!validateJsonDepth((value as Record<string, unknown>)[key], maxDepth, depth + 1)) {
				return false;
			}
		}
	}

	return true;
}

/**
 * Streams the body of `request.clone()` chunk-by-chunk and aborts the moment
 * cumulative bytes exceed `maxBytes`. The original `request.body` stream is
 * never read here, so downstream consumers (e.g. `ClocktowerMCP.serve`) can
 * still read the body normally.
 *
 * Without this, M6's chunked-encoding DoS vector applies: a client that omits
 * `content-length` and streams a body larger than MAX_REQUEST_BYTES would have
 * the entire body buffered into memory by `request.clone().text()` before the
 * post-hoc size check fires.
 */
async function readClonedBodyWithCap(
	request: Request,
	maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
	const reader = request.clone().body?.getReader();
	if (!reader) {
		return { ok: true, text: '' };
	}

	const decoder = new TextDecoder('utf-8');
	let total = 0;
	let text = '';
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				return { ok: false };
			}
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
		return { ok: true, text };
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// ignore: lock is already released after cancel/done
		}
	}
}

async function validateJsonPostBody(request: Request): Promise<Response | null> {
	const contentType = request.headers.get('content-type');
	if (!contentType?.includes('application/json')) {
		return Response.json({ error: 'Content-Type must be application/json' }, { status: 415 });
	}

	// Fast-path: reject obviously oversized bodies before reading anything.
	const contentLength = request.headers.get('content-length');
	if (contentLength) {
		const size = Number.parseInt(contentLength, 10);
		if (!Number.isFinite(size) || size > MAX_REQUEST_BYTES) {
			return Response.json(
				{ error: `Request too large. Maximum size: ${MAX_REQUEST_BYTES / (1024 * 1024)}MB` },
				{ status: 413 },
			);
		}
	}

	// Streaming size check on a clone, so the original body is left intact
	// for downstream consumers. Aborts as soon as the cap is exceeded
	// — required for chunked / missing-content-length requests (M6).
	const bodyResult = await readClonedBodyWithCap(request, MAX_REQUEST_BYTES);
	if (!bodyResult.ok) {
		return Response.json(
			{ error: `Request too large. Maximum size: ${MAX_REQUEST_BYTES / (1024 * 1024)}MB` },
			{ status: 413 },
		);
	}
	const bodyText = bodyResult.text;
	if (bodyText.length === 0) {
		return null;
	}

	let body: unknown;
	try {
		body = JSON.parse(bodyText);
	} catch {
		return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
	}

	if (typeof body !== 'object' || body === null) {
		return Response.json({ error: 'Request body must be a JSON object' }, { status: 400 });
	}

	if (!validateJsonDepth(body)) {
		return Response.json(
			{ error: `Request body too deeply nested (max ${MAX_JSON_DEPTH} levels)` },
			{ status: 400 },
		);
	}

	return null;
}

/** Size/depth guard for REST `/api` POST bodies (same limits as MCP). */
export async function validateApiPostRequest(request: Request): Promise<Response | null> {
	if (request.method !== 'POST') {
		return null;
	}

	return validateJsonPostBody(request);
}

export async function validateMcpRequest(request: Request): Promise<Response | null> {
	if (!MCP_METHODS.has(request.method)) {
		return Response.json({ error: 'Method not allowed' }, { status: 405 });
	}

	if (request.method === 'OPTIONS' || request.method === 'GET' || request.method === 'HEAD') {
		return null;
	}

	if (request.method === 'POST') {
		return validateJsonPostBody(request);
	}

	return null;
}

function assertRequiredString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Missing or invalid env var: ${name}`);
	}

	return value;
}

function assertHttpsUrl(value: unknown, name: string): string {
	const url = assertRequiredString(value, name);
	if (!HTTPS_URL_PATTERN.test(url)) {
		throw new Error(`Env var ${name} must be an HTTPS URL`);
	}

	return url;
}

// ALCHEMY_URL is concatenated with ALCHEMY_API_KEY in `resolveChain`. A missing
// trailing slash silently produces a malformed RPC URL like
// `https://base-mainnet.g.alchemy.com/v2KEY`. Fail fast at startup instead.
function assertHttpsUrlWithTrailingSlash(value: unknown, name: string): string {
	const url = assertHttpsUrl(value, name);
	if (!url.endsWith('/')) {
		throw new Error(`Env var ${name} must end with a trailing '/'`);
	}

	return url;
}

function assertAddress(value: unknown, name: string): `0x${string}` {
	const address = assertRequiredString(value, name);
	if (!isAddress(address)) {
		throw new Error(`Env var ${name} must be a valid Ethereum address`);
	}

	return normalizeHex(address) as `0x${string}`;
}

export function validateEnv(env: Env): void {
	assertRequiredString(env.ALCHEMY_API_KEY, 'ALCHEMY_API_KEY');
	assertHttpsUrlWithTrailingSlash(env.ALCHEMY_URL, 'ALCHEMY_URL');
	assertAddress(env.CLOCKTOWER_ADDRESS, 'CLOCKTOWER_ADDRESS');
	if (isMcpX402Enabled(env)) {
		assertRequiredString(env.CDP_API_KEY_ID, 'CDP_API_KEY_ID');
		assertRequiredString(env.CDP_API_KEY_SECRET, 'CDP_API_KEY_SECRET');
		assertAddress(env.X402_RECIPIENT, 'X402_RECIPIENT');
	}
	// Fail fast: invalid REST default must not wait until the first omitted-chainId request.
	assertDefaultRestChainId(env);
}

/**
 * Optional validator for The Graph subgraph configuration used by history endpoints.
 * GRAPH_* vars are not required for core API/MCP operation.
 * If any GRAPH var is present it must be a valid https URL (with trailing slash for base URLs).
 * Call this from history query paths only when a history feature is actually invoked.
 */
export function validateGraphConfig(env: Env): void {
	const base = env.GRAPH_BASE_URL;
	const baseSepolia = env.GRAPH_BASE_SEPOLIA_URL;
	const key = env.GRAPH_API_KEY;

	if (base) {
		assertHttpsUrlWithTrailingSlash(base, 'GRAPH_BASE_URL');
	}
	if (baseSepolia) {
		assertHttpsUrlWithTrailingSlash(baseSepolia, 'GRAPH_BASE_SEPOLIA_URL');
	}
	if (key && typeof key !== 'string') {
		throw new Error('GRAPH_API_KEY must be a string when provided');
	}
}

function assertBytes32(value: unknown, field: string): `0x${string}` {
	if (typeof value !== 'string' || !isBytes32(value)) {
		throw new Error(`Invalid ${field}: expected bytes32 hex string`);
	}

	return normalizeHex(value) as `0x${string}`;
}

function assertBigint(value: unknown, field: string): bigint {
	if (typeof value !== 'bigint') {
		throw new Error(`Invalid ${field}: expected bigint`);
	}

	return value;
}

function assertBoolean(value: unknown, field: string): boolean {
	if (typeof value !== 'boolean') {
		throw new Error(`Invalid ${field}: expected boolean`);
	}

	return value;
}

function assertUint16(value: unknown, field: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
		throw new Error(`Invalid ${field}: expected uint16`);
	}

	return parsed;
}

function assertFrequency(value: unknown, field: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
		throw new Error(`Invalid ${field}: expected frequency 0-3`);
	}

	return parsed;
}

function assertStatus(value: unknown, field: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2) {
		throw new Error(`Invalid ${field}: expected status 0-2`);
	}

	return parsed;
}

function assertTokenDecimals(value: unknown, field: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
		throw new Error(`Invalid ${field}: expected uint8 decimals`);
	}

	return parsed;
}

export type SubscriptionRecord = {
	id: `0x${string}`;
	amount: bigint;
	provider: `0x${string}`;
	token: `0x${string}`;
	cancelled: boolean;
	frequency: number;
	dueDay: number;
};

export type AccountSubscriptionRecord = {
	subscription: SubscriptionRecord;
	status: number;
	totalSubscribers: bigint;
};

export type ApprovedTokenRecord = {
	tokenAddress: `0x${string}`;
	decimals: number;
	paused: boolean;
	minimum: bigint;
};

export type SubscriberRecord = {
	subscriber: `0x${string}`;
	feeBalance: bigint;
};

export function parseSubscriptionRecord(raw: unknown): SubscriptionRecord {
	const record = Array.isArray(raw)
		? {
				id: raw[0],
				amount: raw[1],
				provider: raw[2],
				token: raw[3],
				cancelled: raw[4],
				frequency: raw[5],
				dueDay: raw[6],
			}
		: raw;

	if (typeof record !== 'object' || record === null) {
		throw new Error('Invalid subscription record');
	}

	const entry = record as Record<string, unknown>;

	return {
		id: assertBytes32(entry.id, 'subscription.id'),
		amount: assertBigint(entry.amount, 'subscription.amount'),
		provider: assertAddress(entry.provider, 'subscription.provider'),
		token: assertAddress(entry.token, 'subscription.token'),
		cancelled: assertBoolean(entry.cancelled, 'subscription.cancelled'),
		frequency: assertFrequency(entry.frequency, 'subscription.frequency'),
		dueDay: assertUint16(entry.dueDay, 'subscription.dueDay'),
	};
}

export function parseAccountSubscriptionRecord(raw: unknown): AccountSubscriptionRecord {
	const record = Array.isArray(raw)
		? {
				subscription: raw[0],
				status: raw[1],
				totalSubscribers: raw[2],
			}
		: raw;

	if (typeof record !== 'object' || record === null) {
		throw new Error('Invalid account subscription record');
	}

	const entry = record as Record<string, unknown>;

	return {
		subscription: parseSubscriptionRecord(entry.subscription),
		status: assertStatus(entry.status, 'subscription.status'),
		totalSubscribers: assertBigint(entry.totalSubscribers, 'subscription.totalSubscribers'),
	};
}

export function parseApprovedTokenRecord(raw: unknown): ApprovedTokenRecord {
	const record = Array.isArray(raw)
		? {
				tokenAddress: raw[0],
				decimals: raw[1],
				paused: raw[2],
				minimum: raw[3],
			}
		: raw;

	if (typeof record !== 'object' || record === null) {
		throw new Error('Invalid approved token record');
	}

	const entry = record as Record<string, unknown>;

	return {
		tokenAddress: assertAddress(entry.tokenAddress, 'approvedToken.tokenAddress'),
		decimals: assertTokenDecimals(entry.decimals, 'approvedToken.decimals'),
		paused: assertBoolean(entry.paused, 'approvedToken.paused'),
		minimum: assertBigint(entry.minimum, 'approvedToken.minimum'),
	};
}

export function parseSubscriberRecord(raw: unknown): SubscriberRecord {
	const record = Array.isArray(raw) ? { subscriber: raw[0], feeBalance: raw[1] } : raw;

	if (typeof record !== 'object' || record === null) {
		throw new Error('Invalid subscriber record');
	}

	const entry = record as Record<string, unknown>;

	return {
		subscriber: assertAddress(entry.subscriber, 'subscriber.subscriber'),
		feeBalance: assertBigint(entry.feeBalance, 'subscriber.feeBalance'),
	};
}
