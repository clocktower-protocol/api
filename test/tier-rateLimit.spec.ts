import { describe, expect, it } from 'vitest';
import {
	classifyMcpJsonRpc,
	classifyRoute,
	DEFAULT_TIER_LIMITS,
	getTierLimits,
	usesWriteRateBucket,
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

	it('classifies MCP JSON-RPC tools/call names', () => {
		expect(classifyMcpJsonRpc({ method: 'initialize' })).toBe('cheap');
		expect(classifyMcpJsonRpc({ method: 'tools/list' })).toBe('cheap');
		expect(
			classifyMcpJsonRpc({ method: 'tools/call', params: { name: 'get_protocol_state' } }),
		).toBe('cheap');
		expect(
			classifyMcpJsonRpc({ method: 'tools/call', params: { name: 'get_transaction_status' } }),
		).toBe('cheap');
		expect(
			classifyMcpJsonRpc({ method: 'tools/call', params: { name: 'prepare_subscribe' } }),
		).toBe('write');
		expect(
			classifyMcpJsonRpc({ method: 'tools/call', params: { name: 'prepare_subscribe_by_id' } }),
		).toBe('write');
		expect(
			classifyMcpJsonRpc({
				method: 'tools/call',
				params: { name: 'check_subscribe_readiness' },
			}),
		).toBe('readiness');
		expect(
			classifyMcpJsonRpc({
				method: 'tools/call',
				params: { name: 'check_subscribe_readiness_by_id' },
			}),
		).toBe('readiness');
		expect(
			classifyMcpJsonRpc({ method: 'tools/call', params: { name: 'check_remit_readiness' } }),
		).toBe('readiness');
		expect(
			classifyMcpJsonRpc({ method: 'tools/call', params: { name: 'search_subscriptions' } }),
		).toBe('expensive');
		expect(
			classifyMcpJsonRpc({ method: 'tools/call', params: { name: 'get_account_activity' } }),
		).toBe('expensive');
		expect(
			classifyMcpJsonRpc({ method: 'tools/call', params: { name: 'get_subscription_details' } }),
		).toBe('expensive');
	});

	it('applies the write rate bucket to readiness routes', () => {
		expect(usesWriteRateBucket('readiness')).toBe(true);
		expect(usesWriteRateBucket('write')).toBe(true);
		expect(usesWriteRateBucket('cheap')).toBe(false);
		expect(usesWriteRateBucket('expensive')).toBe(false);
	});

	it('returns tier defaults and env overrides', () => {
		const env = { FREE_RATE_LIMIT_RPM: '15' } as Env;
		expect(getTierLimits(env, 'free').globalRpm).toBe(15);
		expect(getTierLimits({} as Env, 'mcp').globalRpm).toBe(DEFAULT_TIER_LIMITS.mcp.globalRpm);
	});

	it('includes developer lane between free and builder', () => {
		const dev = DEFAULT_TIER_LIMITS.developer;
		const free = DEFAULT_TIER_LIMITS.free;
		const builder = DEFAULT_TIER_LIMITS.builder;
		expect(dev.globalRpm).toBeGreaterThan(free.globalRpm);
		expect(dev.globalRpm).toBeLessThan(builder.globalRpm);
		expect(dev.expensiveRpm).toBeGreaterThan(free.expensiveRpm);
		expect(dev.writeRpm).toBeGreaterThan(free.writeRpm);
		expect(free.writeRpm).toBe(2);
		expect(dev.writeRpm).toBe(5);
		expect(free.writeDaily).toBe(20);
		expect(dev.writeDaily).toBe(100);
		expect(dev.dailyTotalRequests).toBe(5_000);
		expect(Number.isFinite(dev.dailyTotalRequests)).toBe(true);
	});

	it('applies developer env overrides including write daily', () => {
		const env = {
			DEVELOPER_RATE_LIMIT_RPM: '99',
			DEVELOPER_DAILY_REQUEST_LIMIT: '1234',
			DEVELOPER_EXPENSIVE_RATE_LIMIT_RPM: '11',
			DEVELOPER_WRITE_DAILY_LIMIT: '42',
			DEVELOPER_WRITE_RATE_LIMIT_RPM: '3',
		} as Env;
		const limits = getTierLimits(env, 'developer');
		expect(limits.globalRpm).toBe(99);
		expect(limits.dailyTotalRequests).toBe(1234);
		expect(limits.expensiveRpm).toBe(11);
		expect(limits.writeDaily).toBe(42);
		expect(limits.writeRpm).toBe(3);
	});
});