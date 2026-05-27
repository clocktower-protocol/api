export const ERC20_ABI = [
	{
		name: 'name',
		type: 'function',
		inputs: [],
		outputs: [{ type: 'string' }],
		stateMutability: 'view',
	},
	{
		name: 'symbol',
		type: 'function',
		inputs: [],
		outputs: [{ type: 'string' }],
		stateMutability: 'view',
	},
	{
		name: 'decimals',
		type: 'function',
		inputs: [],
		outputs: [{ type: 'uint8' }],
		stateMutability: 'view',
	},
	{
		name: 'approve',
		type: 'function',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		outputs: [{ type: 'bool' }],
		stateMutability: 'nonpayable',
	},
	{
		name: 'allowance',
		type: 'function',
		inputs: [
			{ name: 'owner', type: 'address' },
			{ name: 'spender', type: 'address' },
		],
		outputs: [{ type: 'uint256' }],
		stateMutability: 'view',
	},
	{
		name: 'balanceOf',
		type: 'function',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ type: 'uint256' }],
		stateMutability: 'view',
	},
] as const;
