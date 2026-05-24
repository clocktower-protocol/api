export const CLOCKTOWER_READ_ABI = [
	{
		name: 'nextUncheckedDay',
		type: 'function',
		inputs: [],
		outputs: [{ type: 'uint40' }],
		stateMutability: 'view',
	},
	{
		name: 'callerFee',
		type: 'function',
		inputs: [],
		outputs: [{ type: 'uint256' }],
		stateMutability: 'view',
	},
	{
		name: 'systemFee',
		type: 'function',
		inputs: [],
		outputs: [{ type: 'uint256' }],
		stateMutability: 'view',
	},
	{
		name: 'maxRemits',
		type: 'function',
		inputs: [],
		outputs: [{ type: 'uint256' }],
		stateMutability: 'view',
	},
	{
		name: 'cancelLimit',
		type: 'function',
		inputs: [],
		outputs: [{ type: 'uint256' }],
		stateMutability: 'view',
	},
	{
		name: 'getIdByTime',
		type: 'function',
		inputs: [
			{ name: 'frequency', type: 'uint256' },
			{ name: 'dueDay', type: 'uint16' },
		],
		outputs: [{ type: 'bytes32[]' }],
		stateMutability: 'view',
	},
	{
		name: 'idSubMap',
		type: 'function',
		inputs: [{ name: 'id', type: 'bytes32' }],
		outputs: [
			{ name: 'id', type: 'bytes32' },
			{ name: 'amount', type: 'uint256' },
			{ name: 'provider', type: 'address' },
			{ name: 'token', type: 'address' },
			{ name: 'cancelled', type: 'bool' },
			{ name: 'frequency', type: 'uint256' },
			{ name: 'dueDay', type: 'uint16' },
		],
		stateMutability: 'view',
	},
	{
		name: 'getAccountSubscriptions',
		type: 'function',
		inputs: [
			{ name: 'bySubscriber', type: 'bool' },
			{ name: 'account', type: 'address' },
		],
		outputs: [
			{
				components: [
					{
						components: [
							{ name: 'id', type: 'bytes32' },
							{ name: 'amount', type: 'uint256' },
							{ name: 'provider', type: 'address' },
							{ name: 'token', type: 'address' },
							{ name: 'cancelled', type: 'bool' },
							{ name: 'frequency', type: 'uint256' },
							{ name: 'dueDay', type: 'uint16' },
						],
						name: 'subscription',
						type: 'tuple',
					},
					{ name: 'status', type: 'uint8' },
					{ name: 'totalSubscribers', type: 'uint256' },
				],
				type: 'tuple[]',
			},
		],
		stateMutability: 'view',
	},
	{
		name: 'getSubscribersById',
		type: 'function',
		inputs: [{ name: 'id', type: 'bytes32' }],
		outputs: [
			{
				components: [
					{ name: 'subscriber', type: 'address' },
					{ name: 'feeBalance', type: 'uint256' },
				],
				type: 'tuple[]',
			},
		],
		stateMutability: 'view',
	},
	{
		name: 'approvedERC20',
		type: 'function',
		inputs: [{ name: 'erc20Contract', type: 'address' }],
		outputs: [
			{ name: 'tokenAddress', type: 'address' },
			{ name: 'decimals', type: 'uint8' },
			{ name: 'paused', type: 'bool' },
			{ name: 'minimum', type: 'uint256' },
		],
		stateMutability: 'view',
	},
] as const;
