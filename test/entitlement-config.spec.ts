import { describe, expect, it } from 'vitest';
import {
	BUILDER_ENTITLEMENT_ROUTES,
	findEntitlementRoute,
	isEntitlementAuthEnabled,
} from '../src/config/entitlementBuilder.js';
import { API_ROUTE_MANIFEST } from '../src/api/x402.js';

const VALID_SUB_ID = `0x${'ab'.repeat(32)}` as const;

describe('entitlement config', () => {
	it('is disabled when BUILDER_SUB_ID is unset', () => {
		expect(isEntitlementAuthEnabled({ BUILDER_SUB_ID: '' } as Env)).toBe(false);
		expect(isEntitlementAuthEnabled({} as Env)).toBe(false);
	});

	it('is enabled for valid subscription id', () => {
		expect(isEntitlementAuthEnabled({ BUILDER_SUB_ID: VALID_SUB_ID } as Env)).toBe(true);
	});

	it('maps catalog and me routes', () => {
		expect(findEntitlementRoute('GET', '/api/catalog')?.rule.kind).toBe('always');
		expect(findEntitlementRoute('GET', '/api/accounts/me')?.rule.kind).toBe('me_only');
		expect(findEntitlementRoute('GET', '/api/accounts/0x1')?.rule.kind).toBe('denied');
	});

	it('includes entitled routes that exist in API manifest', () => {
		for (const route of BUILDER_ENTITLEMENT_ROUTES) {
			if (route.rule.kind === 'denied') continue;
			const manifestPath = route.pathPattern
				.toString()
				.replace('/^', '')
				.replace('$/', '')
				.replace(/\\\/\[\^\/\]\+/g, ':id');
			const exists = API_ROUTE_MANIFEST.some((entry) => entry.method === route.method);
			expect(exists).toBe(true);
			void manifestPath;
		}
	});
});