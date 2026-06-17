import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, toFunctionSelector } from 'viem';
import {
	encodeCreateSubscription,
	encodeRemit,
	encodeSubscribe,
	getFunctionSelector,
} from '../src/tx/encode.js';
import * as gas from '../src/tx/gas.js';
import {
	prepareCancelSubscription,
	prepareCreateSubscription,
	prepareEditDetails,
	prepareRemit,
	prepareUnsubscribe,
} from '../src/tx/prepare.js';
import { checkRemitReadiness } from '../src/tx/remit-preflight.js';
import * as remitScan from '../src/tx/remit-scan.js';
import * as utils from '../src/utils.js';
import { clearActiveLane, setActiveLane } from '../src/requestLane.js';
import { createGasAwareFetch } from './rpc-mocks.js';
const testEnv = {
	...env,
	ALCHEMY_API_KEY: 'test-alchemy-key',
	ALCHEMY_URL: 'https://base-mainnet.g.alchemy.com/v2/',
	CLOCKTOWER_ADDRESS: '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
	MCP_WRITE_RATE_LIMIT_RPM: '1000',
} as Env;

beforeEach(() => setActiveLane('mcp'));
afterEach(() => clearActiveLane());

function encodeUint(value: bigint | number): string {
	return `0x${BigInt(value).toString(16).padStart(64, '0')}`;
}

function encodeBool(value: boolean): string {
	return value ? '0x0000000000000000000000000000000000000000000000000000000000000001' : encodeUint(0);
}

describe('tx encode', () => {
	it('encodeCreateSubscription produces known selector', () => {
		const data = encodeCreateSubscription(
			10n ** 18n,
			'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			{ url: 'https://example.com', description: 'desc' },
			1,
			15,
		);
		expect(getFunctionSelector(data)).toBe(
			toFunctionSelector(
				'createSubscription(uint256,address,(string,string),uint8,uint16)',
			),
		);
	});

	it('encodeSubscribe selector is stable', () => {
		const data = encodeSubscribe({
			id: `0x${'11'.repeat(32)}`,
			amount: 1n,
			provider: '0x0000000000000000000000000000000000000002',
			token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			cancelled: false,
			frequency: 1,
			dueDay: 1,
		});
		expect(getFunctionSelector(data)).toBe(
			toFunctionSelector(
				'subscribe((bytes32,uint256,address,address,bool,uint8,uint16))',
			),
		);
	});
});

describe('prepareCreateSubscription', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = createGasAwareFetch([
			// approvedERC20: token, decimals, paused, minimum
			`0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913${encodeUint(6).slice(2)}${encodeBool(false).slice(2)}${encodeUint(0).slice(2)}`,
			// eth_call simulation
			'0x',
		]);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('returns unsigned transactions and EIP-5792 descriptor', async () => {
		const from = '0x0000000000000000000000000000000000000001';
		const result = await prepareCreateSubscription(
			testEnv,
			from,
			10n ** 18n,
			'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			{ url: 'https://example.com', description: 'test' },
			1,
			15,
		);

		expect(result.requestId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		expect(result.instructions.length).toBeGreaterThan(0);
		expect(result.unsignedTransactions).toHaveLength(1);
		expect(result.eip5792.calls).toHaveLength(1);
		expect(result.signingMode).toBe('raw');
		expect(result.simulation.every((s) => s.success)).toBe(true);
		expect(result.gasEstimates).toHaveLength(1);
		expect(result.gasEstimates[0]?.chainId).toBe(8453);
		expect(result.gasEstimates[0]?.source).toBe('simulated');
	});

	it('passes simulateFromAddress through to gas estimation', async () => {
		const from = '0x0000000000000000000000000000000000000001';
		const simulateFrom = '0x00000000000000000000000000000000000000aa';
		const estimateSpy = vi.spyOn(gas, 'estimateGasForTransactions');

		await prepareCreateSubscription(
			testEnv,
			from,
			10n ** 18n,
			'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			{ url: 'https://example.com', description: 'test' },
			1,
			15,
			{ simulateFromAddress: simulateFrom },
		);

		expect(estimateSpy).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(Array),
			expect.objectContaining({ simulateFromAddress: simulateFrom }),
		);
		estimateSpy.mockRestore();
	});

	it('enforces per-address write rate limit on prepare', async () => {
		setActiveLane('free');
		const from = '0x00000000000000000000000000000000000000aa';
		const limitedEnv = {
			...testEnv,
			FREE_WRITE_RATE_LIMIT_RPM: '1',
		} as Env;

		const args = [
			limitedEnv,
			from,
			10n ** 18n,
			'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			{ url: 'https://example.com', description: 'test' },
			1,
			15,
		] as const;

		await prepareCreateSubscription(...args);
		await expect(prepareCreateSubscription(...args)).rejects.toThrow(/Write rate limit exceeded/);
		setActiveLane('mcp');
	});

	// M1 — these failure modes must throw rather than return successfully.
	// agents/x402 (verify-only-settle) skips settlement when the handler throws,
	// so throws cost the caller nothing; silent-success paths charge them
	// even though the prepare cannot succeed.
	it('throws when token is paused on protocol', async () => {
		// Override the success-path mock with a paused-token approvedERC20 response.
		globalThis.fetch = vi.fn(async () => {
			const result = `0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913${encodeUint(6).slice(2)}${encodeBool(true).slice(2)}${encodeUint(0).slice(2)}`;
			return Response.json({ jsonrpc: '2.0', id: 1, result });
		}) as typeof fetch;

		await expect(
			prepareCreateSubscription(
				testEnv,
				'0x0000000000000000000000000000000000000001',
				10n ** 18n,
				'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
				{ url: 'https://example.com', description: 'test' },
				1,
				15,
			),
		).rejects.toThrow(/paused/);
	});

	it('throws when on-chain simulation reverts', async () => {
		globalThis.fetch = createGasAwareFetch([
			`0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913${encodeUint(6).slice(2)}${encodeBool(false).slice(2)}${encodeUint(0).slice(2)}`,
			Response.json({
				jsonrpc: '2.0',
				id: 1,
				error: { code: 3, message: 'execution reverted: SubAlreadyExists' },
			}),
		]);

		await expect(
			prepareCreateSubscription(
				testEnv,
				'0x0000000000000000000000000000000000000001',
				10n ** 18n,
				'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
				{ url: 'https://example.com', description: 'test' },
				1,
				15,
			),
		).rejects.toThrow(/Simulation failed/);
	});
});

/**
 * H5 — non-create prepare paths must canonicalize the subscription tuple from
 * on-chain rather than trusting the user-supplied fields. These tests mock
 * idSubMap to return a provider DIFFERENT from `from`, and assert the local
 * authorization check rejects even though the input tuple lies about provider.
 */
describe('prepare* canonicalization (H5)', () => {
	const originalFetch = globalThis.fetch;

	function encodeAddressPadded(addr: string): string {
		return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
	}

	function mockIdSubMap(provider: string, opts: { cancelled?: boolean } = {}) {
		// idSubMap returns: (bytes32 id, uint256 amount, address provider,
		//                   address token, bool cancelled, uint256 frequency, uint16 dueDay)
		const id = '1'.repeat(64);
		const amount = encodeUint(10n ** 18n).slice(2);
		const providerHex = encodeAddressPadded(provider);
		const tokenHex = encodeAddressPadded('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
		const cancelled = encodeBool(opts.cancelled ?? false).slice(2);
		const frequency = encodeUint(1).slice(2);
		const dueDay = encodeUint(15).slice(2);
		return `0x${id}${amount}${providerHex}${tokenHex}${cancelled}${frequency}${dueDay}`;
	}

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('prepareCancelSubscription rejects when on-chain provider != caller', async () => {
		const onChainProvider = '0x000000000000000000000000000000000000abcd';
		globalThis.fetch = vi.fn(async () =>
			Response.json({ jsonrpc: '2.0', id: 1, result: mockIdSubMap(onChainProvider) }),
		) as typeof fetch;

		await expect(
			prepareCancelSubscription(
				testEnv,
				'0x0000000000000000000000000000000000000001',
				{
					id: `0x${'11'.repeat(32)}`,
					amount: 1n,
					// User LIES about provider, claiming to be them.
					provider: '0x0000000000000000000000000000000000000001',
					token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
					cancelled: false,
					frequency: 1,
					dueDay: 15,
				},
			),
		).rejects.toThrow(/Only the subscription provider can cancel/);
	});

	it('prepareCancelSubscription rejects when on-chain id is unknown (zero)', async () => {
		// idSubMap returns all-zero struct for unknown ids.
		const zeroes = '0'.repeat(64);
		globalThis.fetch = vi.fn(async () =>
			Response.json({
				jsonrpc: '2.0',
				id: 1,
				result: `0x${zeroes}${zeroes}${zeroes}${zeroes}${zeroes}${zeroes}${zeroes}`,
			}),
		) as typeof fetch;

		await expect(
			prepareCancelSubscription(
				testEnv,
				'0x0000000000000000000000000000000000000001',
				{
					id: `0x${'22'.repeat(32)}`,
					amount: 1n,
					provider: '0x0000000000000000000000000000000000000001',
					token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
					cancelled: false,
					frequency: 1,
					dueDay: 15,
				},
			),
		).rejects.toThrow(/Subscription not found/);
	});

	it('prepareEditDetails rejects when on-chain provider != caller', async () => {
		const onChainProvider = '0x000000000000000000000000000000000000beef';
		globalThis.fetch = vi.fn(async () =>
			Response.json({ jsonrpc: '2.0', id: 1, result: mockIdSubMap(onChainProvider) }),
		) as typeof fetch;

		await expect(
			prepareEditDetails(
				testEnv,
				'0x0000000000000000000000000000000000000001',
				`0x${'11'.repeat(32)}`,
				{ url: 'https://example.com', description: 'updated' },
			),
		).rejects.toThrow(/Only the subscription provider can edit/);
	});
});

/**
 * L13 — `prepareUnsubscribe` must verify the caller is actually subscribed
 * before encoding. The contract reverts cleanly otherwise, so this saves the
 * user gas; combined with M1's verify-only-settle, throwing here also avoids
 * charging x402 for a doomed prepare.
 */
describe('prepareUnsubscribe is-subscriber preflight (L13)', () => {
	const originalFetch = globalThis.fetch;

	const ID = `0x${'11'.repeat(32)}` as `0x${string}`;
	const PROVIDER = '0x00000000000000000000000000000000000000aa' as `0x${string}`;
	const TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`;
	const FROM = '0x0000000000000000000000000000000000000001' as `0x${string}`;

	function encodeAddressPadded(addr: string): string {
		return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
	}

	function mockIdSubMapResult(): string {
		const id = ID.slice(2);
		const amount = encodeUint(10n ** 18n).slice(2);
		const providerHex = encodeAddressPadded(PROVIDER);
		const tokenHex = encodeAddressPadded(TOKEN);
		const cancelled = encodeBool(false).slice(2);
		const frequency = encodeUint(1).slice(2);
		const dueDay = encodeUint(15).slice(2);
		return `0x${id}${amount}${providerHex}${tokenHex}${cancelled}${frequency}${dueDay}`;
	}

	const accountSubscriptionsAbi = [
		{
			type: 'tuple[]',
			components: [
				{
					type: 'tuple',
					name: 'subscription',
					components: [
						{ name: 'id', type: 'bytes32' },
						{ name: 'amount', type: 'uint256' },
						{ name: 'provider', type: 'address' },
						{ name: 'token', type: 'address' },
						{ name: 'cancelled', type: 'bool' },
						{ name: 'frequency', type: 'uint256' },
						{ name: 'dueDay', type: 'uint16' },
					],
				},
				{ name: 'status', type: 'uint8' },
				{ name: 'totalSubscribers', type: 'uint256' },
			],
		},
	] as const;

	function mockGetAccountSubscriptionsResult(ids: `0x${string}`[]): `0x${string}` {
		return encodeAbiParameters(accountSubscriptionsAbi, [
			ids.map((id) => ({
				subscription: {
					id,
					amount: 1n,
					provider: PROVIDER,
					token: TOKEN,
					cancelled: false,
					frequency: 1n,
					dueDay: 15,
				},
				status: 1,
				totalSubscribers: 1n,
			})),
		]);
	}

	function makeSequencedFetch(results: string[]) {
		let i = 0;
		return vi.fn(async () => {
			const result = results[i] ?? results[results.length - 1];
			i += 1;
			return Response.json({ jsonrpc: '2.0', id: 1, result });
		}) as typeof fetch;
	}

	const subscriptionInput = {
		id: ID,
		amount: 1n,
		provider: PROVIDER,
		token: TOKEN,
		cancelled: false,
		frequency: 1,
		dueDay: 15,
	};

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('throws when getAccountSubscriptions returns an empty list', async () => {
		globalThis.fetch = makeSequencedFetch([
			mockIdSubMapResult(),
			mockGetAccountSubscriptionsResult([]),
		]);

		await expect(prepareUnsubscribe(testEnv, FROM, subscriptionInput)).rejects.toThrow(
			/not currently subscribed/,
		);
	});

	it('throws when getAccountSubscriptions does not include the canonical id', async () => {
		const otherId = `0x${'22'.repeat(32)}` as `0x${string}`;
		globalThis.fetch = makeSequencedFetch([
			mockIdSubMapResult(),
			mockGetAccountSubscriptionsResult([otherId]),
		]);

		await expect(prepareUnsubscribe(testEnv, FROM, subscriptionInput)).rejects.toThrow(
			/not currently subscribed/,
		);
	});

	it('returns a prepare result when caller is subscribed (case-insensitive id match)', async () => {
		// Mixed-case id from the contract; the helper must compare lowercased.
		const mixedCaseId = `0x${'11'.repeat(32)}`.toUpperCase().replace('0X', '0x') as `0x${string}`;
		globalThis.fetch = createGasAwareFetch([
			mockIdSubMapResult(),
			mockGetAccountSubscriptionsResult([mixedCaseId]),
			'0x',
		]);

		const result = await prepareUnsubscribe(testEnv, FROM, subscriptionInput);
		expect(result.unsignedTransactions).toHaveLength(1);
		expect(result.preflight).toMatchObject({ id: ID });
	});
});

describe('remit prepare + readiness', () => {
	const originalFetch = globalThis.fetch;
	const FROM = '0x0000000000000000000000000000000000000001' as `0x${string}`;

	function encodeUint(value: bigint | number): string {
		return `0x${BigInt(value).toString(16).padStart(64, '0')}`;
	}

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('encodeRemit selector is stable', () => {
		const data = encodeRemit();
		expect(getFunctionSelector(data)).toBe(toFunctionSelector('remit()'));
	});

	it('checkRemitReadiness rejects when current day is before nextUncheckedDay', async () => {
		vi.spyOn(utils, 'getCurrentDay').mockReturnValue(1000);
		globalThis.fetch = vi.fn(async () =>
			Response.json({
				jsonrpc: '2.0',
				id: 1,
				result: encodeUint(1001),
			}),
		) as typeof fetch;

		const result = await checkRemitReadiness(testEnv, FROM);
		expect(result.ready).toBe(false);
		expect(result.errors[0]).toMatch(/before next unchecked day/);
	});

	it('checkRemitReadiness rejects when scan finds no due subscriptions', async () => {
		vi.spyOn(utils, 'getCurrentDay').mockReturnValue(1000);
		vi.spyOn(remitScan, 'scanDueSubscriptionIds').mockResolvedValue(0);

		let callCount = 0;
		globalThis.fetch = vi.fn(async () => {
			callCount += 1;
			return Response.json({
				jsonrpc: '2.0',
				id: 1,
				result: callCount === 1 ? encodeUint(999) : encodeUint(10),
			});
		}) as typeof fetch;

		const result = await checkRemitReadiness(testEnv, FROM);
		expect(result.ready).toBe(false);
		expect(result.errors[0]).toMatch(/No due subscriptions/);
	});

	it('checkRemitReadiness reports pagination when queue exceeds maxRemits', async () => {
		vi.spyOn(utils, 'getCurrentDay').mockReturnValue(1000);
		vi.spyOn(remitScan, 'scanDueSubscriptionIds').mockResolvedValue(25);

		let callCount = 0;
		globalThis.fetch = vi.fn(async () => {
			callCount += 1;
			return Response.json({
				jsonrpc: '2.0',
				id: 1,
				result: callCount === 1 ? encodeUint(999) : encodeUint(10),
			});
		}) as typeof fetch;

		const result = await checkRemitReadiness(testEnv, FROM);
		expect(result.ready).toBe(true);
		expect(result.expectedTransactions).toBe(3);
		expect(result.warnings.some((w) => w.includes('3 separate remit transactions'))).toBe(true);
	});

	it('prepareRemit throws when readiness fails', async () => {
		vi.spyOn(utils, 'getCurrentDay').mockReturnValue(1000);
		globalThis.fetch = vi.fn(async () =>
			Response.json({
				jsonrpc: '2.0',
				id: 1,
				result: encodeUint(1001),
			}),
		) as typeof fetch;

		await expect(prepareRemit(testEnv, FROM)).rejects.toThrow(/before next unchecked day/);
	});

	it('prepareRemit with readinessOnly skips unsigned transactions', async () => {
		vi.spyOn(remitScan, 'scanDueSubscriptionIds').mockResolvedValue(2);
		vi.spyOn(utils, 'getCurrentDay').mockReturnValue(1000);

		let callCount = 0;
		globalThis.fetch = vi.fn(async () => {
			callCount += 1;
			return Response.json({
				jsonrpc: '2.0',
				id: 1,
				result: callCount === 1 ? encodeUint(999) : encodeUint(10),
			});
		}) as typeof fetch;

		const result = await prepareRemit(testEnv, FROM, { readinessOnly: true });
		expect(result.readinessOnly).toBe(true);
		expect(result.requestId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		expect(result.ready).toBe(true);
		expect(result.instructions.length).toBeGreaterThan(0);
		expect('unsignedTransactions' in result).toBe(false);
	});

	it('prepareRemit includes gasSummary and backlog warning for multi-tx queues', async () => {
		vi.spyOn(remitScan, 'scanDueSubscriptionIds').mockResolvedValue(25);
		vi.spyOn(utils, 'getCurrentDay').mockReturnValue(1000);

		globalThis.fetch = createGasAwareFetch([encodeUint(999), encodeUint(10), '0x']);

		const result = await prepareRemit(testEnv, FROM);
		expect(result.gasSummary?.backlogMultiplier).toBe(3);
		expect(result.gasSummary?.transactionCount).toBe(1);
		expect(result.warnings.some((w) => w.includes('3 broadcasts'))).toBe(true);
	});

	it('prepareRemit succeeds when readiness passes and simulation succeeds', async () => {
		vi.spyOn(remitScan, 'scanDueSubscriptionIds').mockResolvedValue(2);
		vi.spyOn(utils, 'getCurrentDay').mockReturnValue(1000);

		globalThis.fetch = createGasAwareFetch([
			encodeUint(999),
			encodeUint(10),
			'0x',
		]);

		const result = await prepareRemit(testEnv, FROM);
		expect(result.requestId).toBeDefined();
		expect(result.instructions.length).toBeGreaterThan(0);
		expect(result.unsignedTransactions).toHaveLength(1);
		expect(result.preflight).toMatchObject({
			totalSubscriptions: 2,
			maxRemits: 10,
			expectedTransactions: 1,
		});
	});
});
