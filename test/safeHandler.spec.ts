import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';
import {
	BaseError,
	ContractFunctionRevertedError,
	HttpRequestError,
} from 'viem';
import { attachRequestId } from '../src/tx/prepare-response.js';
import { safeHandler } from '../src/tools/safeHandler.js';

const SAMPLE_ABI = [
	{
		name: 'idSubMap',
		type: 'function',
		inputs: [{ name: 'id', type: 'bytes32' }],
		outputs: [{ name: 'id', type: 'bytes32' }],
		stateMutability: 'view',
	},
] as const;

type ErrorPayload = {
	error: string;
	code: 'INVALID_INPUT' | 'CONTRACT_REVERT' | 'PREPARE_FAILURE' | 'RPC_FAILURE';
	requestId?: string;
	reason?: string;
	issues?: Array<{ path: string; message: string }>;
};

function parseResult(result: Awaited<ReturnType<typeof safeHandler>>): ErrorPayload {
	expect(result.isError).toBe(true);
	expect(result.content).toHaveLength(1);
	const first = result.content[0];
	expect(first.type).toBe('text');
	return JSON.parse(first.text) as ErrorPayload;
}

describe('safeHandler', () => {
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		errorSpy.mockRestore();
	});

	it('returns the handler result unchanged on success', async () => {
		const success = { content: [{ type: 'text' as const, text: '{"ok":true}' }] };
		const result = await safeHandler('any', async () => success);
		expect(result).toBe(success);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('does NOT leak Alchemy URLs/API keys when viem throws an HttpRequestError', async () => {
		const apiKey = 'super-secret-alchemy-key-12345';
		const rpcUrl = `https://base-mainnet.g.alchemy.com/v2/${apiKey}`;

		const result = await safeHandler('get_protocol_state', async () => {
			throw new HttpRequestError({
				body: { jsonrpc: '2.0', method: 'eth_call' },
				details: 'connection refused',
				headers: new Headers(),
				status: 502,
				url: rpcUrl,
			});
		});

		const text = result.content[0].text;
		expect(text).not.toContain(apiKey);
		expect(text).not.toContain('alchemy.com');
		expect(text).not.toContain('eth_call');

		const payload = parseResult(result);
		expect(payload.code).toBe('RPC_FAILURE');
		expect(payload.error).toBe('Upstream error');
		expect(typeof payload.requestId).toBe('string');
		expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);

		expect(errorSpy).toHaveBeenCalledTimes(1);
		const [message, context] = errorSpy.mock.calls[0] as [string, { requestId: string; error: unknown }];
		expect(message).toContain('get_protocol_state');
		expect(context.requestId).toBe(payload.requestId);
	});

	it('passes through Zod validation errors with safe field paths and messages', async () => {
		const schema = z.object({
			from: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
			amount: z.number().int().positive(),
		});

		const result = await safeHandler('prepare_subscribe', async () => {
			schema.parse({ from: 'not-an-address', amount: -1 });
			throw new Error('unreachable');
		});

		const payload = parseResult(result);
		expect(payload.code).toBe('INVALID_INPUT');
		expect(payload.error).toBe('Validation failed');
		expect(payload.issues).toBeDefined();
		expect(payload.issues!.some((issue) => issue.path === 'from')).toBe(true);
		expect(payload.issues!.some((issue) => issue.path === 'amount')).toBe(true);
		expect(payload.issues!.some((issue) => issue.message === 'Invalid Ethereum address')).toBe(
			true,
		);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('re-thrown ZodError still classifies as INVALID_INPUT', async () => {
		const result = await safeHandler('any', async () => {
			throw new ZodError([
				{
					code: 'custom',
					path: ['nested', 'field'],
					message: 'Custom rule failed',
				},
			]);
		});

		const payload = parseResult(result);
		expect(payload.code).toBe('INVALID_INPUT');
		expect(payload.issues).toEqual([
			{ path: 'nested.field', message: 'Custom rule failed' },
		]);
	});

	it('passes through the revert reason from a ContractFunctionRevertedError', async () => {
		const reverted = new ContractFunctionRevertedError({
			abi: SAMPLE_ABI,
			functionName: 'idSubMap',
			message: 'execution reverted: Subscription not found',
		});
		(reverted as { reason?: string }).reason = 'Subscription not found';

		const result = await safeHandler('get_subscription', async () => {
			throw reverted;
		});

		const payload = parseResult(result);
		expect(payload.code).toBe('CONTRACT_REVERT');
		expect(payload.reason).toBe('Subscription not found');
		expect(payload.error).toBe('Contract reverted');
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('finds a ContractFunctionRevertedError nested inside a BaseError cause chain', async () => {
		const reverted = new ContractFunctionRevertedError({
			abi: SAMPLE_ABI,
			functionName: 'idSubMap',
			message: 'execution reverted: Only the subscription provider can edit',
		});
		(reverted as { reason?: string }).reason = 'Only the subscription provider can edit';

		const wrapped = new BaseError('Simulation failed', {
			cause: reverted,
		});

		const result = await safeHandler('prepare_edit_details', async () => {
			throw wrapped;
		});

		const payload = parseResult(result);
		expect(payload.code).toBe('CONTRACT_REVERT');
		expect(payload.reason).toBe('Only the subscription provider can edit');
	});

	it('falls back to RPC_FAILURE when a revert has no reason field', async () => {
		const reverted = new ContractFunctionRevertedError({
			abi: SAMPLE_ABI,
			functionName: 'idSubMap',
			message: 'execution reverted',
		});
		// viem's constructor may derive `reason` from the message — for this
		// fallback-path test we explicitly clear it to assert what happens
		// when there is genuinely nothing safe to surface.
		(reverted as { reason?: string }).reason = undefined;

		const result = await safeHandler('any', async () => {
			throw reverted;
		});

		const payload = parseResult(result);
		expect(payload.code).toBe('RPC_FAILURE');
		expect(payload.reason).toBeUndefined();
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});

	it('always returns isError:true so the x402 SDK skips settlement', async () => {
		const cases: Array<() => unknown> = [
			() => {
				throw new Error('plain JS error');
			},
			() => {
				throw new ZodError([
					{ code: 'custom', path: ['x'], message: 'bad' },
				]);
			},
			() => {
				const r = new ContractFunctionRevertedError({
					abi: SAMPLE_ABI,
					functionName: 'idSubMap',
					message: 'execution reverted: Boom',
				});
				(r as { reason?: string }).reason = 'Boom';
				throw r;
			},
		];

		for (const throwFn of cases) {
			const result = await safeHandler('any', async () => {
				throwFn();
				throw new Error('unreachable');
			});
			expect(result.isError).toBe(true);
		}
	});

	it('surfaces prepare-layer failures with the attached requestId', async () => {
		const result = await safeHandler('prepare_subscribe', async () => {
			throw attachRequestId(new Error('Simulation failed: execution reverted'), 'abc-request-id');
		});

		const payload = parseResult(result);
		expect(payload.code).toBe('PREPARE_FAILURE');
		expect(payload.error).toContain('Simulation failed');
		expect(payload.requestId).toBe('abc-request-id');
	});

	it('redacts Alchemy URL/key from PREPARE_FAILURE messages (L7 complete)', async () => {
		const apiKey = 'super-secret-alchemy-key-12345';
		const rpcUrl = `https://base-mainnet.g.alchemy.com/v2/${apiKey}`;
		const result = await safeHandler('prepare_subscribe', async () => {
			throw attachRequestId(
				new Error(`Simulation failed: HTTP request failed.\nURL: ${rpcUrl}`),
				'prep-request-id',
			);
		});

		const text = result.content[0].text;
		expect(text).not.toContain(apiKey);
		expect(text).not.toContain('alchemy.com');

		const payload = parseResult(result);
		expect(payload.code).toBe('PREPARE_FAILURE');
		expect(payload.error).toBe('Prepare failed');
		expect(payload.requestId).toBe('prep-request-id');
	});

	it('wraps history tools (get_provider_profile example) without leaking internals', async () => {
		// History tools use the same safeHandler path as all other MCP tools
		const result = await safeHandler('get_provider_profile', async () => {
			// Simulate an internal error (e.g. bad env)
			throw new Error('GRAPH_API_KEY=sk_live_abc123');
		});

		expect(result.isError).toBe(true);
		const text = result.content[0].text;
		expect(text).not.toContain('sk_live');
		expect(text).toContain('Upstream error'); // or similar safe message
	});
});
