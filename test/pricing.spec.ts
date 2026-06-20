import { describe, expect, it } from 'vitest';
import {
	API_PRICES,
	calculateAccountActivityPrice,
	calculateSearchSubscriptionsPrice,
	calculateSubscriptionDetailsHistoryPrice,
	calculateSubscriptionHistoryPrice,
	getRemitPreparePrice,
	getStandardPreparePrice,
} from '../src/api/pricing.js';

describe('api pricing helpers', () => {
	it('scales subscription history by batch', () => {
		expect(calculateSubscriptionHistoryPrice(10)).toBe(0.03);
		expect(calculateSubscriptionHistoryPrice(50)).toBe(0.03);
		expect(calculateSubscriptionHistoryPrice(51)).toBe(0.04);
		expect(calculateSubscriptionHistoryPrice(200)).toBe(0.06);
	});

	it('scales account activity with higher base', () => {
		expect(calculateAccountActivityPrice(10)).toBe(0.04);
		expect(calculateAccountActivityPrice(200)).toBe(0.07);
	});

	it('scales details history from lower base', () => {
		expect(calculateSubscriptionDetailsHistoryPrice(10)).toBe(0.02);
		expect(calculateSubscriptionDetailsHistoryPrice(200)).toBe(0.05);
	});

	it('scales search by first and includeDetails', () => {
		expect(calculateSearchSubscriptionsPrice({ first: 10 })).toBe(0.15);
		expect(calculateSearchSubscriptionsPrice({ first: 20 })).toBe(0.25);
		expect(calculateSearchSubscriptionsPrice({ first: 10, includeDetails: true })).toBe(0.16);
	});

	it('charges readiness-only prepares at readiness price', () => {
		expect(getStandardPreparePrice(true)).toBe(API_PRICES.checkSubscribeReadiness);
		expect(getStandardPreparePrice(false)).toBe(API_PRICES.prepareSubscribe);
	});

	it('charges remit prepare higher than standard prepare', () => {
		expect(getRemitPreparePrice(true)).toBe(0.02);
		expect(getRemitPreparePrice(false)).toBe(0.03);
	});
});