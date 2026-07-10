import { describe, expect, it } from 'vitest';
import { parseAccessLane } from '../src/requestLane.js';

describe('parseAccessLane', () => {
	it('accepts known lanes', () => {
		expect(parseAccessLane('free')).toBe('free');
		expect(parseAccessLane('builder')).toBe('builder');
		expect(parseAccessLane('mcp')).toBe('mcp');
	});

	it('defaults unknown or missing values to free', () => {
		expect(parseAccessLane(null)).toBe('free');
		expect(parseAccessLane(undefined)).toBe('free');
		expect(parseAccessLane('')).toBe('free');
		expect(parseAccessLane('admin')).toBe('free');
		expect(parseAccessLane('FREE')).toBe('free');
	});
});
