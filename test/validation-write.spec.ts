import { describe, expect, it } from 'vitest';
import {
	createSubscriptionInputSchema,
	detailsSchema,
	humanAmountSchema,
	HUMAN_AMOUNT_MAX_CHARS,
	remitInputSchema,
	subscribeByIdInputSchema,
	subscriptionActionByIdInputSchema,
	subscriptionInputSchema,
	unsubscribeByProviderByIdInputSchema,
	validateDueDayForFrequency,
} from '../src/validation-write.js';

describe('validation-write', () => {
	it('accepts human-readable decimal amount strings', () => {
		expect(humanAmountSchema.parse('1.5')).toBe('1.5');
		expect(humanAmountSchema.parse('10')).toBe('10');
		expect(humanAmountSchema.parse('1'.repeat(HUMAN_AMOUNT_MAX_CHARS))).toBe(
			'1'.repeat(HUMAN_AMOUNT_MAX_CHARS),
		);
	});

	it('rejects amount strings longer than HUMAN_AMOUNT_MAX_CHARS', () => {
		expect(humanAmountSchema.safeParse('1'.repeat(HUMAN_AMOUNT_MAX_CHARS + 1)).success).toBe(
			false,
		);
	});

	it('subscription.amount accepts human strings only (not protocol bigint / numbers)', () => {
		const base = {
			id: `0x${'11'.repeat(32)}`,
			provider: '0x0000000000000000000000000000000000000001',
			token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			cancelled: false,
			frequency: 1,
			dueDay: 15,
		};

		expect(subscriptionInputSchema.safeParse({ ...base, amount: '10' }).success).toBe(true);
		expect(subscriptionInputSchema.safeParse({ ...base, amount: '100.5' }).success).toBe(true);
		// JSON numbers and bare protocol wei are no longer accepted on subscription.amount
		expect(subscriptionInputSchema.safeParse({ ...base, amount: 10 }).success).toBe(false);
		expect(subscriptionInputSchema.safeParse({ ...base, amount: 10n }).success).toBe(false);
	});

	it('validates due day ranges per frequency', () => {
		expect(validateDueDayForFrequency(0, 7)).toBeNull();
		expect(validateDueDayForFrequency(0, 8)).toMatch(/between 1 and 7/);
		expect(validateDueDayForFrequency(1, 28)).toBeNull();
		expect(validateDueDayForFrequency(1, 29)).toMatch(/between 1 and 28/);
	});

	it('accepts ASCII descriptions exactly at the 255-byte cap', () => {
		const result = detailsSchema.safeParse({
			url: 'https://example.com',
			description: 'x'.repeat(255),
		});
		expect(result.success).toBe(true);
	});

	it('rejects ASCII descriptions one byte over the 255-byte cap', () => {
		const result = detailsSchema.safeParse({
			url: 'https://example.com',
			description: 'x'.repeat(256),
		});
		expect(result.success).toBe(false);
	});

	it('rejects emoji descriptions whose UTF-8 byte length exceeds the cap', () => {
		// 64 × U+1F600 ("😀") = 64 × 4 bytes = 256 UTF-8 bytes, but only 64
		// JS chars-as-pairs (128 UTF-16 code units). Pre-fix this passed
		// `.max(255)` because it was JS char count, not byte count.
		const description = '\u{1F600}'.repeat(64);
		const result = detailsSchema.safeParse({
			url: 'https://example.com',
			description,
		});
		expect(result.success).toBe(false);
	});

	it('accepts emoji descriptions whose UTF-8 byte length is at the cap', () => {
		// 63 × 4 bytes = 252 bytes, under the cap.
		const description = '\u{1F600}'.repeat(63);
		const result = detailsSchema.safeParse({
			url: 'https://example.com',
			description,
		});
		expect(result.success).toBe(true);
	});

	it('accepts optional simulateFromAddress on prepare inputs', () => {
		const simulateFrom = '0x00000000000000000000000000000000000000aa';
		const result = remitInputSchema.safeParse({
			from: '0x0000000000000000000000000000000000000001',
			simulateFromAddress: simulateFrom,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.simulateFromAddress).toBe(simulateFrom);
		}
	});

	it('accepts empty url and valid create subscription input', () => {
		const result = createSubscriptionInputSchema.safeParse({
			from: '0x0000000000000000000000000000000000000001',
			amount: '10',
			token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			details: { url: 'https://example.com', description: 'test' },
			frequency: 1,
			dueDay: 15,
		});
		expect(result.success).toBe(true);
	});

	it('accepts subscribe-by-id with from + id only', () => {
		const result = subscribeByIdInputSchema.safeParse({
			from: '0x0000000000000000000000000000000000000001',
			id: `0x${'11'.repeat(32)}`,
		});
		expect(result.success).toBe(true);
	});

	it('rejects subscribe-by-id without id', () => {
		const result = subscribeByIdInputSchema.safeParse({
			from: '0x0000000000000000000000000000000000000001',
		});
		expect(result.success).toBe(false);
	});

	it('accepts cancel/unsubscribe-by-id with from + id only', () => {
		const result = subscriptionActionByIdInputSchema.safeParse({
			from: '0x0000000000000000000000000000000000000001',
			id: `0x${'11'.repeat(32)}`,
		});
		expect(result.success).toBe(true);
	});

	it('accepts unsubscribe-by-provider-by-id with from + id + subscriber', () => {
		const result = unsubscribeByProviderByIdInputSchema.safeParse({
			from: '0x0000000000000000000000000000000000000001',
			id: `0x${'11'.repeat(32)}`,
			subscriber: '0x0000000000000000000000000000000000000002',
		});
		expect(result.success).toBe(true);
	});
});

describe('detailsSchema url hardening', () => {
	const cases: { input: string; ok: boolean; reason: string }[] = [
		{ input: '', ok: true, reason: 'empty allowed' },
		{ input: 'https://example.com', ok: true, reason: 'plain https' },
		{ input: 'https://example.com/path?q=1#frag', ok: true, reason: 'with path/query/hash' },
		{ input: 'https://sub.example.co.uk/x', ok: true, reason: 'subdomain' },
		// XSS-relevant schemes that the old regex accepted:
		{ input: 'javascript:alert(1)', ok: false, reason: 'javascript:' },
		{ input: 'JAVASCRIPT:alert(1)', ok: false, reason: 'JAVASCRIPT: uppercase' },
		{ input: 'data:text/html,<script>alert(1)</script>', ok: false, reason: 'data:' },
		{ input: 'vbscript:msgbox(1)', ok: false, reason: 'vbscript:' },
		{ input: 'file:///etc/passwd', ok: false, reason: 'file:' },
		// non-https network schemes:
		{ input: 'http://example.com', ok: false, reason: 'plain http' },
		{ input: 'ftp://example.com', ok: false, reason: 'ftp' },
		// regex-bypass attempts:
		{ input: 'https://example.com" onerror=alert(1)', ok: false, reason: 'embedded quote' },
		{ input: 'https://example.com<script>', ok: false, reason: 'embedded angle bracket' },
		{ input: 'https://example.com\nhttps://evil.com', ok: false, reason: 'newline smuggling' },
		// previously-permissive forms:
		{ input: 'www.example.com', ok: false, reason: 'no scheme' },
		{ input: 'mailto:foo@example.com', ok: false, reason: 'mailto' },
	];

	for (const { input, ok, reason } of cases) {
		it(`${ok ? 'accepts' : 'rejects'} ${reason}: ${JSON.stringify(input)}`, () => {
			const result = detailsSchema.safeParse({ url: input, description: 'x' });
			expect(result.success).toBe(ok);
		});
	}
});
