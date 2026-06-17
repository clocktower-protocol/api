import type { AccessLane } from './config/rateLimits.js';

let activeLane: AccessLane = 'free';

export function setActiveLane(lane: AccessLane): void {
	activeLane = lane;
}

export function getActiveLane(): AccessLane {
	return activeLane;
}

export function clearActiveLane(): void {
	activeLane = 'free';
}