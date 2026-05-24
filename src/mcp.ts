import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { withX402, type X402Config } from 'agents/x402';
import { registerFreeTools, registerPaidTools } from './tools/read.js';

function buildX402Config(env: Env): X402Config {
	return {
		network: env.X402_NETWORK as X402Config['network'],
		recipient: env.X402_RECIPIENT as `0x${string}`,
		facilitator: { url: env.X402_FACILITATOR_URL },
	};
}

export class ClocktowerMCP extends McpAgent<Env> {
	server = withX402(new McpServer({ name: 'clocktower-mcp', version: '1.0.0' }), {
		network: 'eip155:84532',
		recipient: '0x0000000000000000000000000000000000000001',
		facilitator: { url: 'https://x402.org/facilitator' },
	});

	async init() {
		this.server = withX402(
			new McpServer({ name: 'clocktower-mcp', version: '1.0.0' }),
			buildX402Config(this.env),
		);

		registerFreeTools(this.server, this.env);
		registerPaidTools(this.server, this.env);
	}
}
