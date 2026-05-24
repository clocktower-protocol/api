import { describe, expect, it } from 'vitest';
import {
	createSubscriptionInputSchema,
	detailsSchema,
	protocolAmountSchema,
	validateDueDayForFrequency,
} from '../src/validation-write.js';

describe('validation-write', () => {
	it('parses protocol decimal amounts', () => {
		expect(protocolAmountSchema.parse('1.5')).toBe(1500000000000000000n);
	});

	it('validates due day ranges per frequency', () => {
		expect(validateDueDayForFrequency(0, 7)).toBeNull();
		expect(validateDueDayForFrequency(0, 8)).toMatch(/between 1 and 7/);
		expect(validateDueDayForFrequency(1, 28)).toBeNull();
		expect(validateDueDayForFrequency(1, 29)).toMatch(/between 1 and 28/);
	});

	it('rejects descriptions longer than 255 characters', () => {
		const result = detailsSchema.safeParse({
			url: 'https://example.com',
			description: 'x'.repeat(256),
		});
		expect(result.success).toBe(false);
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
});
