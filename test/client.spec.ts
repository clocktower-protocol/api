import { describe, expect, it } from 'vitest';
import { RPC_TIMEOUT_MS } from '../src/client.js';

describe('rpc client', () => {
	it('uses a 30 second upstream timeout', () => {
		expect(RPC_TIMEOUT_MS).toBe(30_000);
	});
});
