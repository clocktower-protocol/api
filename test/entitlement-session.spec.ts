import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STATUS_TYPES } from '../src/utils.js';

vi.mock('../src/tools/read.js', () => ({
	getAccountSubscriptions: vi.fn(),
}));

import { getAccountSubscriptions } from '../src/tools/read.js';
import { findActiveEntitlementSubscription } from '../src/auth/session.js';

const ID_A = `0x${'ab'.repeat(32)}` as const;
const ID_B = `0x${'cd'.repeat(32)}` as const;
const ADDRESS = '0x0000000000000000000000000000000000000001' as const;

const env = {
	BUILDER_SUB_IDS: `${ID_A},${ID_B}`,
} as Env;

describe('findActiveEntitlementSubscription', () => {
	beforeEach(() => {
		vi.mocked(getAccountSubscriptions).mockReset();
	});

	it('returns the first configured id with an ACTIVE subscription', async () => {
		vi.mocked(getAccountSubscriptions).mockResolvedValue({
			chainId: 8453,
			bySubscriber: true,
			account: ADDRESS,
			subscriptions: [
				{ subscription: { id: ID_B }, status: STATUS_TYPES.ACTIVE },
				{ subscription: { id: ID_A }, status: STATUS_TYPES.ACTIVE },
			],
		} as Awaited<ReturnType<typeof getAccountSubscriptions>>);

		const matched = await findActiveEntitlementSubscription(env, ADDRESS);
		expect(matched).toBe(ID_A);
	});

	it('returns null when wallet has no active entitlement match', async () => {
		vi.mocked(getAccountSubscriptions).mockResolvedValue({
			chainId: 8453,
			bySubscriber: true,
			account: ADDRESS,
			subscriptions: [
				{ subscription: { id: ID_A }, status: STATUS_TYPES.CANCELLED },
			],
		} as Awaited<ReturnType<typeof getAccountSubscriptions>>);

		const matched = await findActiveEntitlementSubscription(env, ADDRESS);
		expect(matched).toBeNull();
	});
});