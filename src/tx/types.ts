import type { WriteSubscription } from '../abi/clocktower-write.js';
import { BASE_CHAIN_ID } from '../chain.js';

export type UnsignedTransaction = {
	to: `0x${string}`;
	data: `0x${string}`;
	value: bigint;
	chainId: typeof BASE_CHAIN_ID;
	from: `0x${string}`;
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

export type ReadinessOnlyResult = {
	requestId: string;
	readinessOnly: true;
	chainId: typeof BASE_CHAIN_ID;
	operation: string;
	ready: boolean;
	errors: string[];
	warnings: string[];
	instructions: string[];
	details: Record<string, unknown>;
};

export type PrepareResult = {
	requestId: string;
	readinessOnly?: false;
	chainId: typeof BASE_CHAIN_ID;
	signingMode: 'eip5792' | 'raw';
	instructions: string[];
	warnings: string[];
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

export type PrepareResponse = PrepareResult | ReadinessOnlyResult;

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
