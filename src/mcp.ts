import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { withX402 } from 'agents/x402';
import { registerPaidTools } from './tools/read.js';
import { registerWriteTools } from './tools/write.js';
import type { X402McpServer } from './tools/types.js';
import { validateEnv } from './validation.js';
import { buildX402Config } from './x402.js';

// `server` is intentionally not initialized at the class-field level. The
// McpAgent base class awaits `init()` before reading `this.server`
// (see `onStart` in agents/dist/mcp/index.js), so leaving it unset until
// `init()` populates it avoids the prior failure mode where a placeholder
// recipient (`0x…0001`) would be wired into x402 if a request raced init.
export class ClocktowerMCP extends McpAgent<Env> {
	server!: X402McpServer;

	async init() {
		validateEnv(this.env);

		this.server = withX402(
			new McpServer({ name: 'clocktower-mcp', version: '1.1.0' }),
			buildX402Config(this.env),
		) as X402McpServer;

		registerPaidTools(this.server, this.env);
		registerWriteTools(this.server, this.env);
	}
}
