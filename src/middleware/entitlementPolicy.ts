import { createClocktowerClient } from '../client.js';
import { resolveChain } from '../chain.js';
import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import {
	extractSubscriptionId,
	findEntitlementRoute,
	isConfiguredEntitlementSubscriptionId,
} from '../config/entitlementBuilder.js';
import { parseAccountSubscriptionRecord, parseSubscriptionRecord } from '../validation.js';
import type { SessionRecord } from '../auth/session.js';

async function isSubscribedToContent(
	env: Env,
	address: `0x${string}`,
	subscriptionId: string,
): Promise<boolean> {
	const chain = resolveChain(env);
	const client = createClocktowerClient(chain);
	const raw = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'getAccountSubscriptions',
		args: [true, address],
	});
	const target = subscriptionId.toLowerCase();
	return (raw as unknown[]).some((entry) => {
		const parsed = parseAccountSubscriptionRecord(entry);
		return parsed.subscription.id.toLowerCase() === target;
	});
}

async function isProviderOfContent(
	env: Env,
	address: `0x${string}`,
	subscriptionId: string,
): Promise<boolean> {
	const chain = resolveChain(env);
	const client = createClocktowerClient(chain);
	const raw = await client.readContract({
		address: chain.contractAddress,
		abi: CLOCKTOWER_READ_ABI,
		functionName: 'idSubMap',
		args: [subscriptionId as `0x${string}`],
	});
	const sub = parseSubscriptionRecord(raw);
	return sub.provider.toLowerCase() === address.toLowerCase();
}

function isEntitlementSubId(env: Env, subscriptionId: string): boolean {
	return isConfiguredEntitlementSubscriptionId(env, subscriptionId);
}

async function evaluateContentAccess(
	env: Env,
	session: SessionRecord,
	subscriptionId: string,
	requireSubscription: boolean,
): Promise<boolean> {
	if (isEntitlementSubId(env, subscriptionId)) {
		return false;
	}

	const [subscribed, provider] = await Promise.all([
		isSubscribedToContent(env, session.address, subscriptionId),
		isProviderOfContent(env, session.address, subscriptionId),
	]);

	if (requireSubscription) {
		return subscribed;
	}
	return subscribed || provider;
}

async function bodyFromAddressMatchesSession(
	request: Request,
	session: SessionRecord,
): Promise<boolean> {
	if (request.method !== 'POST') {
		return true;
	}
	try {
		const clone = request.clone();
		const body = (await clone.json()) as { from?: string };
		if (!body.from) {
			return false;
		}
		return body.from.toLowerCase() === session.address.toLowerCase();
	} catch {
		return false;
	}
}

export async function enforceBuilderPolicy(
	request: Request,
	env: Env,
	session: SessionRecord,
): Promise<Response | null> {
	const url = new URL(request.url);
	const route = findEntitlementRoute(request.method, url.pathname);

	if (!route) {
		return Response.json(
			{ error: 'Endpoint not in Builder entitlement scope', code: 'FORBIDDEN' },
			{ status: 403, headers: { 'X-Clocktower-Lane': 'builder' } },
		);
	}

	switch (route.rule.kind) {
		case 'always':
			return null;
		case 'denied':
			return Response.json(
				{ error: 'Endpoint not included in Builder entitlement scope', code: 'FORBIDDEN' },
				{ status: 403, headers: { 'X-Clocktower-Lane': 'builder' } },
			);
		case 'me_only': {
			const path = url.pathname.split('?')[0];
			if (!path.includes('/me')) {
				return Response.json(
					{ error: 'Builder sessions must use :me routes for own-account reads', code: 'FORBIDDEN' },
					{ status: 403, headers: { 'X-Clocktower-Lane': 'builder' } },
				);
			}
			return null;
		}
		case 'content_read': {
			const id = extractSubscriptionId(url.pathname);
			if (!id || id === 'due') {
				return Response.json(
					{ error: 'Invalid subscription id', code: 'VALIDATION_ERROR' },
					{ status: 400 },
				);
			}
			const allowed = await evaluateContentAccess(env, session, id, false);
			if (!allowed) {
				return Response.json(
					{ error: 'Not subscribed to or provider of this content subscription', code: 'FORBIDDEN' },
					{ status: 403, headers: { 'X-Clocktower-Lane': 'builder' } },
				);
			}
			return null;
		}
		case 'content_history': {
			const id = extractSubscriptionId(url.pathname);
			if (!id || id === 'due') {
				return Response.json(
					{ error: 'Invalid subscription id', code: 'VALIDATION_ERROR' },
					{ status: 400 },
				);
			}
			const allowed = await evaluateContentAccess(env, session, id, true);
			if (!allowed) {
				return Response.json(
					{ error: 'Must be subscribed to this content subscription', code: 'FORBIDDEN' },
					{ status: 403, headers: { 'X-Clocktower-Lane': 'builder' } },
				);
			}
			return null;
		}
		case 'subscriber_write': {
			const matches = await bodyFromAddressMatchesSession(request, session);
			if (!matches) {
				return Response.json(
					{ error: 'Write body from must match session wallet', code: 'FORBIDDEN' },
					{ status: 403, headers: { 'X-Clocktower-Lane': 'builder' } },
				);
			}
			return null;
		}
		default:
			return null;
	}
}

/** Rewrite :me paths to the session wallet address for downstream handlers. */
export function rewriteMePath(pathname: string, session: SessionRecord): string {
	return pathname
		.replace('/accounts/me/', `/accounts/${session.address}/`)
		.replace('/accounts/me', `/accounts/${session.address}`);
}