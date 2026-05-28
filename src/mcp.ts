import { McpAgent } from 'agents/mcp';

/**
 * Ultra-minimal McpAgent class.
 *
 * All logic (server creation, x402 wrapping, tool registration) lives in
 * mcp-setup.ts and is loaded via dynamic import inside init().
 *
 * This pattern is the most reliable way to avoid "Class is not a constructor"
 * errors with McpAgent + Wrangler when you have complex tool/x402 code.
 */
export class ClocktowerMCP extends McpAgent<Env> {
  async init() {
    const { initializeClocktowerMCP } = await import('./clocktower-mcp.js');
    await initializeClocktowerMCP(this);
  }
}
