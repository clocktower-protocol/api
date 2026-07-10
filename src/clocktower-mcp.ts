import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withX402 } from 'agents/x402';
import { registerPaidTools } from './tools/read.js';
import { registerWriteTools } from './tools/write.js';
import { validateEnv } from './validation.js';
import { buildX402Config } from './x402.js';
import type { McpAgent } from 'agents/mcp';

/**
 * Clocktower MCP Implementation
 *
 * This file contains the actual McpServer setup, x402 payment wrapping,
 * and tool registration for the Clocktower MCP server.
 *
 * It is loaded dynamically from src/mcp.ts to avoid heavy top-level imports
 * in the McpAgent class file, which was causing "Class is not a constructor"
 * errors with Wrangler's Durable Object registration.
 */
export async function initializeClocktowerMCP(agent: McpAgent<Env>) {
  validateEnv(agent.env);

  // Prepare tools pass `lane: 'mcp'` explicitly (see tools/write.ts); no isolate-global lane.

  // Wrap the plain McpServer with x402 micropayment support
  const wrappedServer = withX402(
    new McpServer({ name: 'clocktower-mcp', version: '1.1.0' }),
    buildX402Config(agent.env),
  );

  // Assign the wrapped server back onto the agent instance
  // (the registration functions expect the x402-augmented server)
  (agent as any).server = wrappedServer;

  // Register all tools (paid + write)
  // These imports are intentionally here (inside the dynamic load)
  // so they don't interfere with DO class registration.
  registerPaidTools(wrappedServer, agent.env);
  registerWriteTools(wrappedServer, agent.env);
}
