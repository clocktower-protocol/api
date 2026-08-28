import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isMcpX402Enabled, parseMcpAccessLane } from '../src/config/mcpX402.js';
import { asUnpaidX402Server } from '../src/mcp/unpaidAdapter.js';

describe('isMcpX402Enabled', () => {
	it('is true only when the env value is the string true', () => {
		expect(isMcpX402Enabled({ MCP_X402_ENABLED: 'true' } as Env)).toBe(true);
		expect(isMcpX402Enabled({ MCP_X402_ENABLED: 'false' } as Env)).toBe(false);
		expect(isMcpX402Enabled({ MCP_X402_ENABLED: 'TRUE' } as Env)).toBe(false);
		expect(isMcpX402Enabled({} as Env)).toBe(false);
	});
});

describe('parseMcpAccessLane', () => {
	it('defaults to free', () => {
		expect(parseMcpAccessLane(undefined)).toBe('free');
		expect(parseMcpAccessLane({})).toBe('free');
	});

	it('reads X-Clocktower-Lane from requestInfo headers', () => {
		expect(
			parseMcpAccessLane({
				requestInfo: { headers: { 'X-Clocktower-Lane': 'developer' } },
			}),
		).toBe('developer');
		expect(
			parseMcpAccessLane({
				requestInfo: { headers: { 'x-clocktower-lane': 'developer' } },
			}),
		).toBe('developer');
		expect(
			parseMcpAccessLane({
				requestInfo: { headers: { 'X-Clocktower-Lane': 'mcp' } },
			}),
		).toBe('free');
	});
});

describe('asUnpaidX402Server', () => {
	it('exposes paidTool that registers a normal tool', () => {
		const inner = new McpServer({ name: 'test', version: '1.0.0' });
		const server = asUnpaidX402Server(inner);
		expect(typeof server.paidTool).toBe('function');
		server.paidTool(
			'echo_unpaid',
			'echo',
			0.01,
			{},
			{},
			async () => ({ content: [{ type: 'text', text: 'ok' }] }),
		);
	});
});
