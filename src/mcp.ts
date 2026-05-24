import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { withX402 } from 'agents/x402';
import { createFacilitatorConfig } from '@coinbase/x402';
import { registerPaidTools } from './tools/read.js';
import { validateEnv } from './validation.js';
import { buildX402Config, X402_NETWORK } from './x402.js';

const PLACEHOLDER_RECIPIENT = '0x0000000000000000000000000000000000000001' as const;

export class ClocktowerMCP extends McpAgent<Env> {
	server = withX402(new McpServer({ name: 'clocktower-mcp', version: '1.0.0' }), {
		network: X402_NETWORK,
		recipient: PLACEHOLDER_RECIPIENT,
		facilitator: createFacilitatorConfig(),
	});

	async init() {
		validateEnv(this.env);

		this.server = withX402(
			new McpServer({ name: 'clocktower-mcp', version: '1.0.0' }),
			buildX402Config(this.env),
		);

		registerPaidTools(this.server, this.env);
	}
}
