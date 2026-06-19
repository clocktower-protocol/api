import { ERC20_ABI } from '../abi/erc20.js';
import type { WriteSubscription } from '../abi/clocktower-write.js';
import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import type { ChainConfig } from '../chain.js';
import { createClocktowerClient } from '../client.js';
import {
	parseApprovedTokenRecord,
	parseSubscriptionRecord,
} from '../validation.js';
import { convertProtocolAmountToTokenNative } from '../utils.js';
import { ALLOWANCE_THRESHOLD, INFINITE_APPROVAL, ZERO_ADDRESS, ZERO_SUBSCRIPTION_ID } from './constants.js';
import type { SubscribeReadinessResult } from './types.js';

function emptySubscribeReadiness(
	warnings: string[],
	errors: string[],
): SubscribeReadinessResult {
	return {
		ready: false,
		needsApproval: false,
		allowance: '0',
		balance: '0',
		requiredAmount: '0',
		warnings,
		errors,
	};
}

export async function checkSubscribeReadiness(
	env: Env,
	chain: ChainConfig,
	from: `0x${string}`,
	subscription: WriteSubscription,
): Promise<SubscribeReadinessResult> {
	const client = createClocktowerClient(chain);
	const warnings: string[] = [];
	const errors: string[] = [];

	let onChainSubscription: WriteSubscription;
	try {
		const raw = await client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'idSubMap',
			args: [subscription.id],
		});
		onChainSubscription = parseSubscriptionRecord(raw);
	} catch (error) {
		return emptySubscribeReadiness(warnings, [
			error instanceof Error ? error.message : 'Subscription not found',
		]);
	}

	if (
		onChainSubscription.id === ZERO_SUBSCRIPTION_ID ||
		onChainSubscription.provider === ZERO_ADDRESS
	) {
		return emptySubscribeReadiness(warnings, ['Subscription not found on chain']);
	}

	// ERC20 allowance/balance are read from the subscription token contract, not Clocktower.
	const tokenAddress = subscription.token;
	if (tokenAddress === ZERO_ADDRESS) {
		return emptySubscribeReadiness(warnings, ['Subscription token is required']);
	}

	if (onChainSubscription.token !== ZERO_ADDRESS &&
		onChainSubscription.token.toLowerCase() !== tokenAddress.toLowerCase()) {
		errors.push('Subscription token does not match on-chain token');
	}

	if (onChainSubscription.cancelled) {
		errors.push('Subscription is cancelled');
	}
	if (onChainSubscription.provider.toLowerCase() === from.toLowerCase()) {
		errors.push('Provider cannot subscribe to their own subscription');
	}

	const approvedToken = parseApprovedTokenRecord(
		await client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'approvedERC20',
			args: [tokenAddress],
		}),
	);

	if (approvedToken.paused) {
		errors.push('Token is paused');
	}

	const requiredAmount = convertProtocolAmountToTokenNative(
		onChainSubscription.amount,
		approvedToken.decimals,
	);

	const [allowance, balance] = await Promise.all([
		client.readContract({
			address: tokenAddress,
			abi: ERC20_ABI,
			functionName: 'allowance',
			args: [from, chain.contractAddress],
		}),
		client.readContract({
			address: tokenAddress,
			abi: ERC20_ABI,
			functionName: 'balanceOf',
			args: [from],
		}),
	]);

	if (balance < requiredAmount) {
		errors.push('Insufficient token balance');
	}

	const needsApproval = allowance < ALLOWANCE_THRESHOLD;
	if (needsApproval) {
		warnings.push('ERC20 approve required before subscribe');
	} else if (allowance < requiredAmount) {
		errors.push('Insufficient allowance for subscription amount');
	}

	return {
		ready: errors.length === 0,
		needsApproval,
		allowance: allowance.toString(),
		balance: balance.toString(),
		requiredAmount: requiredAmount.toString(),
		warnings,
		errors,
		subscription: onChainSubscription,
	};
}

export { INFINITE_APPROVAL };
