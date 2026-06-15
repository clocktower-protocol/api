import { jsonResponse } from './responses.js';
import { API_PRICES } from './pricing.js';
import { API_ROUTE_MANIFEST } from './x402.js';

export function handleGetCatalog() {
	return jsonResponse({
		version: '1',
		chainId: 8453,
		auth: {
			x402: 'required on all /api routes',
			paymentAsset: 'USDC on Base (eip155:8453)',
		},
		routes: API_ROUTE_MANIFEST.map(({ method, path, priceKey, description }) => ({
			method,
			path,
			priceUsd: API_PRICES[priceKey],
			description,
		})),
	});
}