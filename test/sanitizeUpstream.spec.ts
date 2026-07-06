import { describe, expect, it } from 'vitest';
import {
	clientSafeMessage,
	isSafeClientErrorMessage,
	redactSensitiveErrorText,
} from '../src/sanitizeUpstream.js';

describe('sanitizeUpstream', () => {
	it('detects RPC URLs and long secrets as unsafe', () => {
		expect(
			isSafeClientErrorMessage(
				'HTTP request failed. URL: https://base-mainnet.g.alchemy.com/v2/SECRETKEY123',
			),
		).toBe(false);
		expect(isSafeClientErrorMessage('Bearer abcdefghijklmnopqrstuvwxyz123456')).toBe(false);
		expect(isSafeClientErrorMessage('Token is paused on protocol')).toBe(true);
	});

	it('redacts sensitive fragments', () => {
		const redacted = redactSensitiveErrorText(
			'failed https://base-mainnet.g.alchemy.com/v2/mysecretkey1234567890abcdef',
		);
		expect(redacted).not.toContain('mysecretkey');
		expect(redacted).toContain('[redacted');
	});

	it('falls back when message is unsafe', () => {
		expect(
			clientSafeMessage(
				'Simulation failed: https://base-mainnet.g.alchemy.com/v2/KEY',
				'Simulation failed',
			),
		).toBe('Simulation failed');
	});
});