import { buildSiweMessage, verifySiweSignature } from '../auth/siwe.js';
import {
	consumeNonce,
	createSession,
	generateNonce,
	storeNonce,
	verifyEntitlementForAddress,
} from '../auth/session.js';
import { isEntitlementAuthEnabled } from '../config/entitlementBuilder.js';
import { getSiweDomain } from '../config/hostnames.js';
import { jsonResponse } from './responses.js';

const SIWE_CHAIN_ID = 8453;

function authDisabledResponse(): Response {
	return jsonResponse(
		{ error: 'Builder entitlement auth is not configured', code: 'AUTH_DISABLED' },
		503,
	);
}

export async function handleAuthChallenge(request: Request, env: Env): Promise<Response> {
	if (!isEntitlementAuthEnabled(env)) {
		return authDisabledResponse();
	}

	const body = (await request.json().catch(() => ({}))) as { address?: string };
	const address = body.address?.trim();
	if (!address?.match(/^0x[a-fA-F0-9]{40}$/)) {
		return jsonResponse({ error: 'Valid address is required', code: 'VALIDATION_ERROR' }, 400);
	}

	const nonce = generateNonce();
	await storeNonce(env, nonce);

	const issuedAt = new Date().toISOString();
	const siweDomain = getSiweDomain(env);
	const message = buildSiweMessage({
		domain: siweDomain,
		address: address as `0x${string}`,
		uri: new URL(request.url).origin,
		chainId: SIWE_CHAIN_ID,
		nonce,
		issuedAt,
	});

	return jsonResponse({ nonce, message, issuedAt, chainId: SIWE_CHAIN_ID });
}

export async function handleAuthVerify(request: Request, env: Env): Promise<Response> {
	if (!isEntitlementAuthEnabled(env)) {
		return authDisabledResponse();
	}

	const body = (await request.json().catch(() => null)) as {
		message?: string;
		signature?: string;
	} | null;

	if (!body?.message || !body.signature?.startsWith('0x')) {
		return jsonResponse(
			{ error: 'message and signature are required', code: 'VALIDATION_ERROR' },
			400,
		);
	}

	const parsed = body.message;
	const nonceMatch = parsed.match(/Nonce: (.+)/);
	const nonce = nonceMatch?.[1]?.trim();
	if (!nonce) {
		return jsonResponse({ error: 'Invalid SIWE message', code: 'VALIDATION_ERROR' }, 400);
	}

	const nonceValid = await consumeNonce(env, nonce);
	if (!nonceValid) {
		return jsonResponse({ error: 'Invalid or expired nonce', code: 'AUTH_FAILED' }, 401);
	}

	const siweDomain = getSiweDomain(env);
	const address = await verifySiweSignature(body.message, body.signature as `0x${string}`, {
		domain: siweDomain,
		chainId: SIWE_CHAIN_ID,
		nonce,
	});

	if (!address) {
		return jsonResponse({ error: 'Invalid signature', code: 'AUTH_FAILED' }, 401);
	}

	const entitled = await verifyEntitlementForAddress(env, address);
	if (!entitled) {
		return jsonResponse(
			{
				error: 'Wallet is not an active subscriber to the Builder entitlement subscription',
				code: 'ENTITLEMENT_REQUIRED',
			},
			403,
		);
	}

	const session = await createSession(env, address);
	return jsonResponse({
		token: session.token,
		expiresAt: session.expiresAt,
		address,
		lane: 'builder',
	});
}