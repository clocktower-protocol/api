import { ClocktowerMCP } from './mcp.js';
import { enforceRateLimit } from './rateLimit.js';
import { validateMcpRequest } from './validation.js';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/mcp') {
			const invalidRequest = await validateMcpRequest(request);
			if (invalidRequest) {
				return invalidRequest;
			}

			const rateLimited = await enforceRateLimit(request, env);
			if (rateLimited) {
				return rateLimited;
			}

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
