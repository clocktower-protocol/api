import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { registerExactEvmScheme } from '@x402/evm/exact/server';
import type { ZodTypeAny } from 'zod';
import { isMcpX402Enabled } from '../config/mcpX402.js';
import { clientSafeMessage } from '../sanitizeUpstream.js';
import { buildX402Config } from '../x402.js';

const LEGACY_NETWORK_MAP: Record<string, string> = {
	'base-sepolia': 'eip155:84532',
	base: 'eip155:8453',
	ethereum: 'eip155:1',
	sepolia: 'eip155:11155111',
};

function normalizeNetwork(network: string): string {
	return LEGACY_NETWORK_MAP[network] ?? network;
}

type ToolHandler = (
	args: Record<string, unknown>,
	extra?: unknown,
) => Promise<{
	content: Array<{ type: 'text'; text: string }>;
	isError?: boolean;
	_meta?: Record<string, unknown>;
}>;

/**
 * Registers an MCP tool whose x402 price is computed from call arguments
 * (e.g. history `first`, prepare `readinessOnly`).
 */
export function registerDynamicPaidTool(
	server: McpServer,
	env: Env,
	name: string,
	description: string,
	priceFn: (args: Record<string, unknown>) => number,
	paramsSchema: Record<string, ZodTypeAny>,
	annotations: Record<string, unknown>,
	handler: ToolHandler,
): void {
	if (!isMcpX402Enabled(env)) {
		server.registerTool(
			name,
			{
				description,
				inputSchema: paramsSchema,
				annotations,
			},
			(async (args, extra) => handler(args as Record<string, unknown>, extra)) as never,
		);
		return;
	}

	const cfg = buildX402Config(env);
	const network = normalizeNetwork(cfg.network);
	const resourceServer = new x402ResourceServer(
		new HTTPFacilitatorClient(
			cfg.facilitator ?? { url: 'https://x402.org/facilitator' },
		),
	);
	registerExactEvmScheme(resourceServer);

	let initPromise: Promise<void> | null = null;
	function ensureInitialized(): Promise<void> {
		if (!initPromise) {
			initPromise = resourceServer.initialize().catch((err) => {
				initPromise = null;
				throw err;
			});
		}
		return initPromise;
	}

	server.registerTool(
		name,
		{
			description,
			inputSchema: paramsSchema,
			annotations,
			_meta: {
				'agents-x402/paymentRequired': true,
				'agents-x402/priceUSD': 'dynamic',
			},
		},
		(async (args, extra) => {
			await ensureInitialized();
			const priceUSD = priceFn(args as Record<string, unknown>);

			const resourceConfig = {
				scheme: 'exact' as const,
				payTo: cfg.recipient,
				price: priceUSD,
				network,
				maxTimeoutSeconds: 300,
			};

			let requirements;
			try {
				requirements = await resourceServer.buildPaymentRequirements(resourceConfig);
			} catch {
				const payload = { x402Version: 2, error: 'PRICE_COMPUTE_FAILED' };
				return {
					isError: true,
					_meta: { 'x402/error': payload },
					content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
				};
			}

			const resourceInfo = {
				url: `x402://${name}`,
				description,
				mimeType: 'application/json',
			};

			const extraInfo = extra as
				| {
						requestInfo?: { headers?: Record<string, string> };
						_meta?: Record<string, unknown>;
				  }
				| undefined;
			const headers = extraInfo?.requestInfo?.headers ?? {};
			const token =
				extraInfo?._meta?.['x402/payment'] ??
				headers['PAYMENT-SIGNATURE'] ??
				headers['X-PAYMENT'];

			const paymentRequired = (reason = 'PAYMENT_REQUIRED', extraFields: Record<string, unknown> = {}) => {
				const payload = {
					x402Version: 2,
					error: reason,
					resource: resourceInfo,
					accepts: requirements,
					...extraFields,
				};
				return {
					isError: true,
					_meta: { 'x402/error': payload },
					content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
				};
			};

			if (!token || typeof token !== 'string') {
				return paymentRequired();
			}

			let paymentPayload: unknown;
			try {
				paymentPayload = JSON.parse(atob(token));
			} catch {
				return paymentRequired('INVALID_PAYMENT');
			}

			const matchingReq = resourceServer.findMatchingRequirements(
				requirements,
				paymentPayload as never,
			);
			if (!matchingReq) {
				return paymentRequired('INVALID_PAYMENT');
			}

			try {
				const vr = await resourceServer.verifyPayment(
					paymentPayload as never,
					matchingReq,
				);
				if (!vr.isValid) {
					return paymentRequired(vr.invalidReason ?? 'INVALID_PAYMENT', {
						payer: vr.payer,
					});
				}
			} catch {
				return paymentRequired('INVALID_PAYMENT');
			}

			let result: Awaited<ReturnType<ToolHandler>>;
			let failed = false;
			try {
				result = await handler(args as Record<string, unknown>, extra);
				if (result && typeof result === 'object' && 'isError' in result && result.isError) {
					failed = true;
				}
			} catch (e) {
				failed = true;
				const raw = e instanceof Error ? e.message : String(e);
				console.error(`[paidToolDynamic] ${name} threw`, e);
				result = {
					isError: true,
					content: [
						{
							type: 'text',
							text: clientSafeMessage(
								`Tool execution failed: ${raw}`,
								'Tool execution failed',
							),
						},
					],
				};
			}

			if (!failed) {
				try {
					const s = await resourceServer.settlePayment(
						paymentPayload as never,
						matchingReq,
					);
					if (s.success) {
						result._meta ??= {};
						result._meta['x402/payment-response'] = {
							success: true,
							transaction: s.transaction,
							network: s.network,
							payer: s.payer,
						};
					} else {
						return paymentRequired(s.errorReason ?? 'SETTLEMENT_FAILED');
					}
				} catch {
					return paymentRequired('SETTLEMENT_FAILED');
				}
			}

			return result;
		}) as never,
	);
}