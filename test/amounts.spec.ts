import { describe, expect, it } from 'vitest';
import { convertProtocolAmountToTokenNative, formatProtocolStoredAmount } from '../src/utils.js';

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
