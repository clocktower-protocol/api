import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSubscribeReadiness } from '../src/tx/preflight.js';
import { resolveChain } from '../src/chain.js';
import { createGasAwareFetch } from './rpc-mocks.js';

const testEnv = {
	ALCHEMY_API_KEY: 'test-alchemy-key',
	ALCHEMY_URL: 'https://base-mainnet.g.alchemy.com/v2/',
	CLOCKTOWER_ADDRESS: '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
} as Env;

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const CLOCKTOWER = '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f' as const;
const FROM = '0x0000000000000000000000000000000000000001' as const;
const SUB_ID = `0x${'22'.repeat(32)}` as const;

function encodeAddressPadded(addr: string): string {
	return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function mockIdSubMapResult(provider: string, token: string): string {
	const id = '1'.repeat(64);
	const amount = BigInt(10n ** 18n).toString(16).padStart(64, '0');
	const providerHex = encodeAddressPadded(provider);
	const tokenHex = encodeAddressPadded(token);
	const cancelled = '0'.repeat(64);
	const frequency = '0'.repeat(63) + '1';
	const dueDay = BigInt(15).toString(16).padStart(64, '0');
	return `0x${id}${amount}${providerHex}${tokenHex}${cancelled}${frequency}${dueDay}`;
}

function parseEthCallTarget(init?: RequestInit): string | null {
	if (!init?.body || typeof init.body !== 'string') {
		return null;
	}
	const body = JSON.parse(init.body) as {
		method?: string;
		params?: Array<{ to?: string; data?: string }>;
	};
	if (body.method !== 'eth_call') {
		return null;
	}
	return body.params?.[0]?.to?.toLowerCase() ?? null;
}

describe('checkSubscribeReadiness', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('returns not-found without calling ERC20 allowance on zero address', async () => {
		const zeroes = '0'.repeat(64);
		const fetchMock = createGasAwareFetch([
			`0x${zeroes}${zeroes}${zeroes}${zeroes}${zeroes}${zeroes}${zeroes}`,
		]);
		globalThis.fetch = fetchMock;

		const result = await checkSubscribeReadiness(
			testEnv,
			resolveChain(testEnv),
			FROM,
			{
				id: SUB_ID,
				amount: 1n,
				provider: '0x000000000000000000000000000000000000abcd',
				token: USDC,
				cancelled: false,
				frequency: 1,
				dueDay: 15,
			},
		);

		expect(result.ready).toBe(false);
		expect(result.errors).toContain('Subscription not found on chain');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('reads allowance from the subscription token contract, not Clocktower', async () => {
		const onChainProvider = '0x000000000000000000000000000000000000abcd';
		const fetchMock = createGasAwareFetch([
			mockIdSubMapResult(onChainProvider, USDC),
			`0x${encodeAddressPadded(USDC)}${'0'.repeat(63)}6${'0'.repeat(64)}${BigInt(1).toString(16).padStart(64, '0')}`,
			`0x${'0'.repeat(64)}`,
			`0x${'0'.repeat(64)}`,
		]);
		globalThis.fetch = fetchMock;

		await checkSubscribeReadiness(
			testEnv,
			resolveChain(testEnv),
			FROM,
			{
				id: SUB_ID,
				amount: 1n,
				provider: onChainProvider,
				token: USDC,
				cancelled: false,
				frequency: 1,
				dueDay: 15,
			},
		);

		const ethCallTargets = fetchMock.mock.calls
			.map(([, init]) => parseEthCallTarget(init))
			.filter((target): target is string => target !== null);

		expect(ethCallTargets[0]).toBe(CLOCKTOWER.toLowerCase());
		expect(ethCallTargets[1]).toBe(CLOCKTOWER.toLowerCase());
		expect(ethCallTargets[2]).toBe(USDC.toLowerCase());
		expect(ethCallTargets[3]).toBe(USDC.toLowerCase());
	});

	it('sets needsApproval when allowance is below token-native required amount', async () => {
		const onChainProvider = '0x000000000000000000000000000000000000abcd';
		// On-chain amount = 1e18 protocol = 1 USDC (6 dec) => requiredAmount = 1_000_000
		const allowanceHex = BigInt(500_000).toString(16).padStart(64, '0'); // 0.5 USDC
		const balanceHex = BigInt(2_000_000).toString(16).padStart(64, '0'); // 2 USDC
		const fetchMock = createGasAwareFetch([
			mockIdSubMapResult(onChainProvider, USDC),
			// approvedERC20: token, decimals=6, paused=false, minimum
			`0x${encodeAddressPadded(USDC)}${'0'.repeat(63)}6${'0'.repeat(64)}${BigInt(1).toString(16).padStart(64, '0')}`,
			`0x${allowanceHex}`,
			`0x${balanceHex}`,
		]);
		globalThis.fetch = fetchMock;

		const result = await checkSubscribeReadiness(
			testEnv,
			resolveChain(testEnv),
			FROM,
			{
				id: SUB_ID,
				amount: 1n,
				provider: onChainProvider,
				token: USDC,
				cancelled: false,
				frequency: 1,
				dueDay: 15,
			},
		);

		expect(result.requiredAmount).toBe('1000000');
		expect(result.needsApproval).toBe(true);
		expect(result.ready).toBe(true);
		expect(result.warnings.some((w) => /approve/i.test(w))).toBe(true);
	});

	it('clears needsApproval when allowance meets token-native required amount', async () => {
		const onChainProvider = '0x000000000000000000000000000000000000abcd';
		const allowanceHex = BigInt(1_000_000).toString(16).padStart(64, '0');
		const balanceHex = BigInt(2_000_000).toString(16).padStart(64, '0');
		const fetchMock = createGasAwareFetch([
			mockIdSubMapResult(onChainProvider, USDC),
			`0x${encodeAddressPadded(USDC)}${'0'.repeat(63)}6${'0'.repeat(64)}${BigInt(1).toString(16).padStart(64, '0')}`,
			`0x${allowanceHex}`,
			`0x${balanceHex}`,
		]);
		globalThis.fetch = fetchMock;

		const result = await checkSubscribeReadiness(
			testEnv,
			resolveChain(testEnv),
			FROM,
			{
				id: SUB_ID,
				amount: 1n,
				provider: onChainProvider,
				token: USDC,
				cancelled: false,
				frequency: 1,
				dueDay: 15,
			},
		);

		expect(result.needsApproval).toBe(false);
		expect(result.ready).toBe(true);
	});

	it('does not eth_call a caller-supplied token that differs from chain', async () => {
		const onChainProvider = '0x000000000000000000000000000000000000abcd';
		const attackerToken = '0x000000000000000000000000000000000000beef' as const;
		const fetchMock = createGasAwareFetch([mockIdSubMapResult(onChainProvider, USDC)]);
		globalThis.fetch = fetchMock;

		const result = await checkSubscribeReadiness(
			testEnv,
			resolveChain(testEnv),
			FROM,
			{
				id: SUB_ID,
				amount: 1n,
				provider: onChainProvider,
				token: attackerToken,
				cancelled: false,
				frequency: 1,
				dueDay: 15,
			},
		);

		expect(result.ready).toBe(false);
		expect(result.errors).toContain('Subscription token does not match on-chain token');

		const ethCallTargets = fetchMock.mock.calls
			.map(([, init]) => parseEthCallTarget(init))
			.filter((target): target is string => target !== null);

		expect(ethCallTargets).toEqual([CLOCKTOWER.toLowerCase()]);
		expect(ethCallTargets).not.toContain(attackerToken.toLowerCase());
	});
});