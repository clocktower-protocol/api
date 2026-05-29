/**
 * In-memory x402 facilitator for Vitest / worker pool tests.
 *
 * Activated when env.X402_USE_MOCK_FACILITATOR === 'true' (see vitest.config.mts).
 * Avoids real CDP JWT auth and network calls to the facilitator during tests.
 */

/** Shape matches @x402/core supportedResponseSchema (see HTTPFacilitatorClient.getSupported). */
const MOCK_SUPPORTED_KINDS = {
	kinds: [
		{
			x402Version: 2,
			scheme: 'exact',
			network: 'eip155:8453',
		},
	],
	extensions: [] as string[],
	signers: {} as Record<string, string[]>,
};

export function createMockFacilitatorClient() {
	return {
		getSupported: async () => MOCK_SUPPORTED_KINDS,
		verifyPayment: async () => ({ isValid: true }),
		settlePayment: async () => ({ success: true, transaction: '0xmock' }),
		createAuthHeaders: async () => ({}),
	};
}
