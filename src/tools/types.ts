import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodTypeAny } from 'zod';

export type PaidToolHandler = (
	args: Record<string, unknown>,
	extra?: unknown,
) => Promise<{
	content: Array<{ type: 'text'; text: string }>;
	isError?: boolean;
}>;

export type X402McpServer = McpServer & {
	paidTool: (
		name: string,
		description: string,
		price: number,
		inputSchema: Record<string, ZodTypeAny>,
		annotations: Record<string, unknown>,
		handler: PaidToolHandler,
	) => void;
};
