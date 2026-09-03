import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withX402 } from 'agents/x402';
import { isMcpX402Enabled } from './config/mcpX402.js';
import { asUnpaidX402Server } from './mcp/unpaidAdapter.js';
import { registerPaidTools } from './tools/read.js';
import { registerWriteTools } from './tools/write.js';
import { validateEnv } from './validation.js';
import { buildX402Config } from './x402.js';
import type { McpAgent } from 'agents/mcp';

/**
 * Clocktower MCP Implementation
 *
 * This file contains the actual McpServer setup, optional x402 payment wrapping,
 * and tool registration for the Clocktower MCP server.
 *
 * It is loaded dynamically from src/mcp.ts to avoid heavy top-level imports
 * in the McpAgent class file, which was causing "Class is not a constructor"
 * errors with Wrangler's Durable Object registration.
 */
export async function initializeClocktowerMCP(agent: McpAgent<Env>) {
  try {
    validateEnv(agent.env);
  } catch (err) {
    console.error('MCP env validation failed', err);
    throw new Error('Service configuration error');
  }

  const inner = new McpServer({ name: 'clocktower-mcp', version: '1.1.0' });
  const server = isMcpX402Enabled(agent.env)
    ? withX402(inner, buildX402Config(agent.env))
    : asUnpaidX402Server(inner);

  // Assign the (optionally x402-wrapped) server back onto the agent instance
  // (the registration functions expect the x402-augmented paidTool surface)
  (agent as any).server = server;

  // Register all tools (paid + write)
  // These imports are intentionally here (inside the dynamic load)
  // so they don't interfere with DO class registration.
  registerPaidTools(server, agent.env);
  registerWriteTools(server, agent.env);
}
