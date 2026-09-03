import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STATUS_TYPES } from '../src/utils.js';

vi.mock('../src/client.js', () => ({
	createClocktowerClient: vi.fn(),
}));

import { createClocktowerClient } from '../src/client.js';
import { enforceBuilderPolicy } from '../src/middleware/entitlementPolicy.js';
import type { SessionRecord } from '../src/auth/session.js';

const SUB_ID = `0x${'ab'.repeat(32)}` as const;
const ADDRESS = '0x0000000000000000000000000000000000000001' as const;
const OTHER = '0x0000000000000000000000000000000000000002' as const;
const TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

const env = {
	ALCHEMY_API_KEY: 'test-alchemy-key',
	ALCHEMY_URL: 'https://base-mainnet.g.alchemy.com/v2/',
	CLOCKTOWER_ADDRESS: '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
	BUILDER_SUB_IDS: `0x${'cd'.repeat(32)}`,
} as Env;

const session: SessionRecord = {
	address: ADDRESS,
	createdAt: 1,
	expiresAt: Date.now() + 60_000,
	lastEntitlementCheck: 1,
};

function accountEntry(status: number, id: `0x${string}` = SUB_ID) {
	return {
		subscription: {
			id,
			amount: 1n,
			provider: OTHER,
			token: TOKEN,
			cancelled: status !== STATUS_TYPES.ACTIVE,
			frequency: 1,
			dueDay: 1,
		},
		status,
		totalSubscribers: 1n,
	};
}

function subRecord(provider: `0x${string}`) {
	return {
		id: SUB_ID,
		amount: 1n,
		provider,
		token: TOKEN,
		cancelled: false,
		frequency: 1,
		dueDay: 1,
	};
}

function mockClient(accountRows: unknown[], provider: `0x${string}` = OTHER) {
	vi.mocked(createClocktowerClient).mockReturnValue({
		readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
			if (functionName === 'getAccountSubscriptions') {
				return accountRows;
			}
			if (functionName === 'idSubMap') {
				return subRecord(provider);
			}
			throw new Error(functionName);
		}),
	} as never);
}

describe('enforceBuilderPolicy content access', () => {
	beforeEach(() => {
		vi.mocked(createClocktowerClient).mockReset();
	});

	it('allows content_read for an ACTIVE subscriber', async () => {
		mockClient([accountEntry(STATUS_TYPES.ACTIVE)]);
		const req = new Request(`http://example.com/api/subscriptions/${SUB_ID}`);
		const blocked = await enforceBuilderPolicy(req, env, session);
		expect(blocked).toBeNull();
	});

	it('denies content_read when the matching subscription is not ACTIVE', async () => {
		mockClient([accountEntry(STATUS_TYPES.CANCELLED)]);
		const req = new Request(`http://example.com/api/subscriptions/${SUB_ID}`);
		const blocked = await enforceBuilderPolicy(req, env, session);
		expect(blocked?.status).toBe(403);
		const body = (await blocked!.json()) as { code?: string };
		expect(body.code).toBe('FORBIDDEN');
	});

	it('still allows content_read for the provider when not an active subscriber', async () => {
		mockClient([accountEntry(STATUS_TYPES.UNSUBSCRIBED)], ADDRESS);
		const req = new Request(`http://example.com/api/subscriptions/${SUB_ID}`);
		const blocked = await enforceBuilderPolicy(req, env, session);
		expect(blocked).toBeNull();
	});

	it('denies content_history unless the wallet is an ACTIVE subscriber', async () => {
		mockClient([accountEntry(STATUS_TYPES.CANCELLED)], ADDRESS);
		const req = new Request(`http://example.com/api/subscriptions/${SUB_ID}/history`);
		const blocked = await enforceBuilderPolicy(req, env, session);
		expect(blocked?.status).toBe(403);
	});
});
