import { describe, expect, it, vi } from 'vitest';
import {
	buildAccessEvent,
	recordAccess,
	recordAdminAudit,
} from '../src/observability/accessLog.js';

describe('access observability', () => {
	it('builds access events without secrets', () => {
		const req = new Request('http://example.com/api/catalog', {
			headers: { 'cf-ray': 'abc-123' },
		});
		const event = buildAccessEvent({
			request: req,
			pathname: '/api/catalog',
			lane: 'developer',
			identity: 'key:key_test',
			keyId: 'key_test',
			subjectId: 'dev_subj',
			status: 200,
			durationMs: 12,
		});
		expect(event.type).toBe('api_access');
		expect(event.route).toBe('/api/catalog');
		expect(event.routeClass).toBe('cheap');
		expect(event.keyId).toBe('key_test');
		expect(JSON.stringify(event)).not.toContain('ctk_');
	});

	it('classifies prepare routes as write', () => {
		const req = new Request('http://example.com/api/prepare/subscribe_by_id', {
			method: 'POST',
		});
		const event = buildAccessEvent({
			request: req,
			pathname: '/api/prepare/subscribe_by_id',
			lane: 'free',
			identity: 'ip:1.2.3.4',
			status: 200,
			durationMs: 5,
		});
		expect(event.routeClass).toBe('write');
	});

	it('writes Analytics Engine data points when bound', () => {
		const writeDataPoint = vi.fn();
		const env = {
			API_ANALYTICS: { writeDataPoint },
		} as unknown as Env;

		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		recordAccess(env, {
			type: 'api_access',
			ts: new Date().toISOString(),
			method: 'GET',
			route: '/api/catalog',
			routeClass: 'cheap',
			lane: 'developer',
			identity: 'key:key_1',
			keyId: 'key_1',
			status: 200,
			durationMs: 3,
		});
		expect(writeDataPoint).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalled();
		const line = String(log.mock.calls[0][0]);
		expect(line).toContain('"type":"api_access"');
		log.mockRestore();
	});

	it('records admin audit without token material', () => {
		const writeDataPoint = vi.fn();
		const env = {
			API_ANALYTICS: { writeDataPoint },
		} as unknown as Env;
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		recordAdminAudit(env, {
			action: 'create',
			status: 201,
			subjectId: 'dev_x',
			keyId: 'key_y',
			ip: '203.0.113.1',
		});
		const line = String(log.mock.calls[0][0]);
		expect(line).toContain('api_key_admin');
		expect(line).toContain('key_y');
		expect(line).not.toContain('ctk_');
		expect(writeDataPoint).toHaveBeenCalled();
		log.mockRestore();
	});

	it('skips when OBSERVABILITY_ENABLED=false', () => {
		const writeDataPoint = vi.fn();
		const env = {
			OBSERVABILITY_ENABLED: 'false',
			API_ANALYTICS: { writeDataPoint },
		} as unknown as Env;
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		recordAccess(env, {
			type: 'api_access',
			ts: new Date().toISOString(),
			method: 'GET',
			route: '/api/catalog',
			routeClass: 'cheap',
			lane: 'free',
			identity: 'ip:1.1.1.1',
			status: 200,
			durationMs: 1,
		});
		expect(writeDataPoint).not.toHaveBeenCalled();
		expect(log).not.toHaveBeenCalled();
		log.mockRestore();
	});
});
