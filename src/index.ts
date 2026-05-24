import { ClocktowerMCP } from './mcp.js';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/mcp') {
			return ClocktowerMCP.serve('/mcp', { binding: 'CLOCKTOWER_MCP' }).fetch(request, env, ctx);
		}

		return Response.json({
			status: 'ok',
			name: 'clocktower-mcp',
			mcp: '/mcp',
		});
	},
};

export { ClocktowerMCP };
