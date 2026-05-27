import { describe, expect, it } from 'vitest';
import {
	convertProtocolAmountToTokenNative,
	formatProtocolStoredAmount,
	convertTokenNativeToProtocolAmount,
} from '../src/utils.js';

describe('token amount conversion', () => {
	it('converts 18-decimal protocol amounts to 6-decimal token amounts', () => {
		const protocolAmount = 1_000_000_000_000_000_000n;

		expect(convertProtocolAmountToTokenNative(protocolAmount, 6)).toBe(1_000_000n);
		expect(formatProtocolStoredAmount(protocolAmount, 6)).toEqual({
			amount: '1',
			amountRaw: 1_000_000n,
			tokenDecimals: 6,
		});
	});

	it('converts fractional protocol amounts to token-native values', () => {
		const protocolAmount = 1_500_000_000_000_000_000n;

		expect(formatProtocolStoredAmount(protocolAmount, 6)).toEqual({
			amount: '1.5',
			amountRaw: 1_500_000n,
			tokenDecimals: 6,
		});
	});

	it('leaves amounts unchanged when token decimals match protocol decimals', () => {
		const protocolAmount = 2_000_000_000_000_000_000n;

		expect(formatProtocolStoredAmount(protocolAmount, 18)).toEqual({
			amount: '2',
			amountRaw: 2_000_000_000_000_000_000n,
			tokenDecimals: 18,
		});
	});

	it('scales up when token decimals exceed protocol decimals', () => {
		const protocolAmount = 1_000_000_000_000_000_000n;

		expect(formatProtocolStoredAmount(protocolAmount, 20)).toEqual({
			amount: '1',
			amountRaw: 100_000_000_000_000_000_000n,
			tokenDecimals: 20,
		});
	});
});

describe('normalizeSubscriptionAmount (write path)', () => {
	const mockEnv = {
		ALCHEMY_URL: 'https://test.com/',
		ALCHEMY_API_KEY: 'test',
		CLOCKTOWER_ADDRESS: '0x0000000000000000000000000000000000000001',
	};

	it('converts human amount for 6-decimal token (USDC) to protocol units', () => {
		// User inputs "100.5" meaning 100.5 USDC (6 decimals)
		// First parse the human string into token-native units
		const nativeAmount = 100500000n; // 100.5 * 10^6

		// Then convert to protocol internal units (18 decimals)
		const protocolAmount = convertTokenNativeToProtocolAmount(nativeAmount, 6);

		// 100.5 USDC (6 dec) → 100.5 * 10^(18-6) = 100.5 * 10^12
		expect(protocolAmount).toBe(100500000000000000000n);
	});

	it('leaves amounts unchanged when token has 18 decimals', async () => {
		const nativeAmount = 1000000000000000000n; // 1 with 18 decimals
		const protocolAmount = convertProtocolAmountToTokenNative(nativeAmount, 18);

		expect(protocolAmount).toBe(nativeAmount);
	});
});

describe('amount round-trip (write then read)', () => {
	it('round-trips correctly for 6-decimal token (USDC)', () => {
		const originalHumanAmount = '123.456789'; // 9 decimal places to test precision

		// Write path: Human string → token native units → protocol units (18 dec)
		const nativeAmount = 123456789n; // 123.456789 USDC (6 decimals)
		const protocolAmount = convertTokenNativeToProtocolAmount(nativeAmount, 6);

		// Read path: Protocol units → token native units
		const roundTrippedNative = convertProtocolAmountToTokenNative(protocolAmount, 6);

		expect(roundTrippedNative).toBe(nativeAmount);

		// Also verify formatting produces the expected human value
		const formatted = formatProtocolStoredAmount(protocolAmount, 6);
		expect(formatted.amount).toBe('123.456789');
	});

	it('round-trips correctly for 18-decimal token', () => {
		const nativeAmount = 987654321000000000000n; // 987.654321 with 18 decimals

		const protocolAmount = convertTokenNativeToProtocolAmount(nativeAmount, 18);
		const roundTrippedNative = convertProtocolAmountToTokenNative(protocolAmount, 18);

		expect(roundTrippedNative).toBe(nativeAmount);
	});

	it('round-trips fractional amounts for 6-decimal token', () => {
		const nativeAmount = 1000000n; // exactly 1.0 USDC

		const protocolAmount = convertTokenNativeToProtocolAmount(nativeAmount, 6);
		const roundTrippedNative = convertProtocolAmountToTokenNative(protocolAmount, 6);

		expect(roundTrippedNative).toBe(nativeAmount);
	});
});
