import { describe, expect, it } from 'vitest';
import {
	classifyRoute,
	DEFAULT_TIER_LIMITS,
	getTierLimits,
} from '../src/config/rateLimits.js';

describe('tier rate limits config', () => {
	it('classifies expensive subgraph routes', () => {
		expect(classifyRoute('GET', '/api/subscriptions')).toBe('expensive');
		expect(classifyRoute('GET', '/api/accounts/0xabc/activity')).toBe('expensive');
		expect(classifyRoute('GET', '/api/providers/0xabc')).toBe('expensive');
	});

	it('classifies cheap reads', () => {
		expect(classifyRoute('GET', '/api/protocol/state')).toBe('cheap');
		expect(classifyRoute('GET', '/api/subscriptions/0x' + 'a'.repeat(64))).toBe('cheap');
	});

	it('classifies all prepare endpoints as write', () => {
		expect(classifyRoute('POST', '/api/prepare/cancel_subscription')).toBe('write');
		expect(classifyRoute('POST', '/api/prepare/unsubscribe_by_provider')).toBe('write');
		expect(classifyRoute('POST', '/api/prepare/edit_details')).toBe('write');
		expect(classifyRoute('POST', '/api/prepare/subscribe')).toBe('write');
	});

	it('classifies readiness checks', () => {
		expect(classifyRoute('POST', '/api/check_subscribe_readiness')).toBe('readiness');
	});

	it('returns tier defaults and env overrides', () => {
		const env = { FREE_RATE_LIMIT_RPM: '15' } as Env;
		expect(getTierLimits(env, 'free').globalRpm).toBe(15);
		expect(getTierLimits({} as Env, 'mcp').globalRpm).toBe(DEFAULT_TIER_LIMITS.mcp.globalRpm);
	});
});