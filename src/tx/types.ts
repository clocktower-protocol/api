import type { WriteSubscription } from '../abi/clocktower-write.js';
import { BASE_CHAIN_ID } from '../chain.js';

export type UnsignedTransaction = {
	to: `0x${string}`;
	data: `0x${string}`;
	value: bigint;
	chainId: typeof BASE_CHAIN_ID;
	from: `0x${string}`;
};

export type IntentTransaction = {
	to: `0x${string}`;
	data: `0x${string}`;
	value: string;
	functionSelector: `0x${string}`;
};

export type PrepareIntent = {
	prepareId: string;
	from: `0x${string}`;
	chainId: typeof BASE_CHAIN_ID;
	transactions: IntentTransaction[];
	expiresAt: number;
};

export type Eip5792Call = {
	to: `0x${string}`;
	data: `0x${string}`;
	value?: `0x${string}`;
};

export type SimulationResult = {
	success: boolean;
	error?: string;
};

export type PrepareResult = {
	prepareId: string;
	chainId: typeof BASE_CHAIN_ID;
	signingMode: 'eip5792' | 'raw';
	eip5792: {
		version: '1.0';
		chainId: `0x${string}`;
		from: `0x${string}`;
		calls: Eip5792Call[];
	};
	unsignedTransactions: Array<{
		to: `0x${string}`;
		data: `0x${string}`;
		value: string;
		chainId: number;
		from: `0x${string}`;
	}>;
	simulation: SimulationResult[];
	preflight?: Record<string, unknown>;
};

export type SubscribeReadinessResult = {
	ready: boolean;
	needsApproval: boolean;
	allowance: string;
	balance: string;
	requiredAmount: string;
	warnings: string[];
	errors: string[];
	subscription?: WriteSubscription;
};

export type RemitReadinessResult = {
	ready: boolean;
	from: `0x${string}`;
	currentDay: number;
	nextUncheckedDay: number;
	totalSubscriptions: number;
	maxRemits: number;
	expectedTransactions: number;
	warnings: string[];
	errors: string[];
};
