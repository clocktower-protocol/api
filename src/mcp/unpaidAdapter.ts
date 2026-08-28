import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PaidToolHandler, X402McpServer } from '../tools/types.js';

/**
 * Makes a plain McpServer look like the x402-augmented server so existing
 * `paidTool(...)` registrations work without charging. Prices are ignored.
 */
export function asUnpaidX402Server(server: McpServer): X402McpServer {
	const wrapped = server as X402McpServer;
	wrapped.paidTool = (
		name,
		description,
		_price,
		inputSchema,
		annotations,
		handler: PaidToolHandler,
	) => {
		server.registerTool(
			name,
			{
				description,
				inputSchema,
				annotations,
			},
			(async (args: Record<string, unknown>, extra: unknown) => handler(args, extra)) as never,
		);
	};
	return wrapped;
}
