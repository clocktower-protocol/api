import { describe, expect, it } from 'vitest';
import {
	buildSiweMessage,
	isSiweIssuedAtFresh,
	parseSiweMessage,
	SIWE_ISSUED_AT_MAX_AGE_MS,
} from '../src/auth/siwe.js';

describe('SIWE issued-at freshness', () => {
	const now = Date.parse('2026-07-10T12:00:00.000Z');

	it('accepts a recent Issued At', () => {
		expect(isSiweIssuedAtFresh(new Date(now - 60_000).toISOString(), now)).toBe(true);
	});

	it('rejects missing or invalid Issued At', () => {
		expect(isSiweIssuedAtFresh(undefined, now)).toBe(false);
		expect(isSiweIssuedAtFresh('not-a-date', now)).toBe(false);
	});

	it('rejects Issued At older than max age', () => {
		const stale = new Date(now - SIWE_ISSUED_AT_MAX_AGE_MS - 1).toISOString();
		expect(isSiweIssuedAtFresh(stale, now)).toBe(false);
	});

	it('rejects Issued At too far in the future', () => {
		const future = new Date(now + 5 * 60_000).toISOString();
		expect(isSiweIssuedAtFresh(future, now)).toBe(false);
	});

	it('parse + build round-trip includes issuedAt for freshness checks', () => {
		const issuedAt = new Date(now).toISOString();
		const message = buildSiweMessage({
			domain: 'api.clocktower.finance',
			address: '0x0000000000000000000000000000000000000001',
			uri: 'https://api.clocktower.finance',
			chainId: 8453,
			nonce: 'abc123',
			issuedAt,
		});
		const parsed = parseSiweMessage(message);
		expect(parsed?.issuedAt).toBe(issuedAt);
		expect(isSiweIssuedAtFresh(parsed?.issuedAt, now)).toBe(true);
	});
});
