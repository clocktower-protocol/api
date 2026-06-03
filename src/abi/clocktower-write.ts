const SUBSCRIPTION_COMPONENTS = [
	{ name: 'id', type: 'bytes32' },
	{ name: 'amount', type: 'uint256' },
	{ name: 'provider', type: 'address' },
	{ name: 'token', type: 'address' },
	{ name: 'cancelled', type: 'bool' },
	{ name: 'frequency', type: 'uint8' },
	{ name: 'dueDay', type: 'uint16' },
] as const;

const DETAILS_COMPONENTS = [
	{ name: 'url', type: 'string' },
	{ name: 'description', type: 'string' },
] as const;

export const CLOCKTOWER_WRITE_ABI = [
	{
		name: 'createSubscription',
		type: 'function',
		inputs: [
			{ name: 'amount', type: 'uint256' },
			{ name: 'token', type: 'address' },
			{
				name: 'details',
				type: 'tuple',
				components: [...DETAILS_COMPONENTS],
			},
			{ name: 'frequency', type: 'uint8' },
			{ name: 'dueDay', type: 'uint16' },
		],
		outputs: [],
		stateMutability: 'nonpayable',
	},
	{
		name: 'subscribe',
		type: 'function',
		inputs: [
			{
				name: '_subscription',
				type: 'tuple',
				components: [...SUBSCRIPTION_COMPONENTS],
			},
		],
		outputs: [],
		stateMutability: 'nonpayable',
	},
	{
		name: 'cancelSubscription',
		type: 'function',
		inputs: [
			{
				name: '_subscription',
				type: 'tuple',
				components: [...SUBSCRIPTION_COMPONENTS],
			},
		],
		outputs: [],
		stateMutability: 'nonpayable',
	},
	{
		name: 'unsubscribe',
		type: 'function',
		inputs: [
			{
				name: '_subscription',
				type: 'tuple',
				components: [...SUBSCRIPTION_COMPONENTS],
			},
		],
		outputs: [],
		stateMutability: 'nonpayable',
	},
	{
		name: 'unsubscribeByProvider',
		type: 'function',
		inputs: [
			{
				name: '_subscription',
				type: 'tuple',
				components: [...SUBSCRIPTION_COMPONENTS],
			},
			{ name: 'subscriber', type: 'address' },
		],
		outputs: [],
		stateMutability: 'nonpayable',
	},
	{
		name: 'editDetails',
		type: 'function',
		inputs: [
			{
				name: 'details',
				type: 'tuple',
				components: [...DETAILS_COMPONENTS],
			},
			{ name: 'id', type: 'bytes32' },
		],
		outputs: [],
		stateMutability: 'nonpayable',
	},
	{
		name: 'remit',
		type: 'function',
		inputs: [],
		outputs: [],
		stateMutability: 'nonpayable',
	},
] as const;

export type WriteSubscription = {
	id: `0x${string}`;
	amount: bigint;
	provider: `0x${string}`;
	token: `0x${string}`;
	cancelled: boolean;
	frequency: number;
	dueDay: number;
};

export type WriteDetails = {
	url: string;
	description: string;
};
