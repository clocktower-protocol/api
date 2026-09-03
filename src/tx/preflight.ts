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
import { INFINITE_APPROVAL, ZERO_ADDRESS, ZERO_SUBSCRIPTION_ID } from './constants.js';
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
		// Do not surface viem/RPC messages (may embed Alchemy URL + API key).
		console.error('[checkSubscribeReadiness] idSubMap failed', error);
		return emptySubscribeReadiness(warnings, ['Failed to load subscription from chain']);
	}

	if (
		onChainSubscription.id === ZERO_SUBSCRIPTION_ID ||
		onChainSubscription.provider === ZERO_ADDRESS
	) {
		return emptySubscribeReadiness(warnings, ['Subscription not found on chain']);
	}

	// ERC20 allowance/balance are read from the on-chain token, never a caller-supplied address.
	const tokenAddress = onChainSubscription.token;
	if (tokenAddress === ZERO_ADDRESS) {
		return emptySubscribeReadiness(warnings, ['Subscription token is required']);
	}

	if (
		subscription.token !== ZERO_ADDRESS &&
		onChainSubscription.token.toLowerCase() !== subscription.token.toLowerCase()
	) {
		return emptySubscribeReadiness(warnings, ['Subscription token does not match on-chain token']);
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

	// Compare ERC-20 allowance to the token-native subscription amount (SDK-style).
	// Do not use a fixed global threshold — that is not denominated in token units.
	const needsApproval = allowance < requiredAmount;
	if (needsApproval) {
		warnings.push('ERC20 approve required before subscribe');
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
