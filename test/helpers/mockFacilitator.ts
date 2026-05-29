import { vi } from 'vitest';
import type { HTTPFacilitatorClient } from '@x402/core/server';
import { createMockFacilitatorClient } from '../../src/api/mockFacilitator.js';

export type MockFacilitator = Partial<HTTPFacilitatorClient>;

/** Vitest facilitator with spies; wraps the same stub used by the worker in mock mode. */
export function createMockFacilitator(overrides: { verify?: unknown; settle?: unknown } = {}): MockFacilitator {
	const base = createMockFacilitatorClient();
	return {
		getSupported: vi.fn(base.getSupported),
		verifyPayment: vi.fn().mockResolvedValue(overrides.verify ?? { isValid: true }),
		settlePayment: vi.fn().mockResolvedValue(overrides.settle ?? { success: true, transaction: '0xsettled' }),
		createAuthHeaders: vi.fn(base.createAuthHeaders),
	};
}
