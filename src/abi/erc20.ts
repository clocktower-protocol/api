export const ERC20_ABI = [
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
