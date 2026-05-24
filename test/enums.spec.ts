import { describe, expect, it } from 'vitest';
import {
	FREQUENCY_TYPES,
	getFrequencyLabel,
	getStatusLabel,
	getSubscriptEventLabel,
	STATUS_TYPES,
	SUBSCRIPT_EVENT_TYPES,
} from '../src/utils.js';

describe('enum labels', () => {
	it('maps frequency values to contract enum names', () => {
		expect(getFrequencyLabel(FREQUENCY_TYPES.WEEKLY)).toBe('WEEKLY');
		expect(getFrequencyLabel(FREQUENCY_TYPES.MONTHLY)).toBe('MONTHLY');
		expect(getFrequencyLabel(FREQUENCY_TYPES.QUARTERLY)).toBe('QUARTERLY');
		expect(getFrequencyLabel(FREQUENCY_TYPES.YEARLY)).toBe('YEARLY');
		expect(getFrequencyLabel(99)).toBe('UNKNOWN');
	});

	it('maps status values to contract enum names', () => {
		expect(getStatusLabel(STATUS_TYPES.ACTIVE)).toBe('ACTIVE');
		expect(getStatusLabel(STATUS_TYPES.CANCELLED)).toBe('CANCELLED');
		expect(getStatusLabel(STATUS_TYPES.UNSUBSCRIBED)).toBe('UNSUBSCRIBED');
		expect(getStatusLabel(99)).toBe('UNKNOWN');
	});

	it('maps subscript event values to contract enum names', () => {
		expect(getSubscriptEventLabel(SUBSCRIPT_EVENT_TYPES.CREATE)).toBe('CREATE');
		expect(getSubscriptEventLabel(SUBSCRIPT_EVENT_TYPES.SUBREFUND)).toBe('SUBREFUND');
		expect(getSubscriptEventLabel(99)).toBe('UNKNOWN');
	});
});
