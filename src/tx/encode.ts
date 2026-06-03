import { encodeFunctionData } from 'viem';
import {
	CLOCKTOWER_WRITE_ABI,
	type WriteDetails,
	type WriteSubscription,
} from '../abi/clocktower-write.js';
import { ERC20_ABI } from '../abi/erc20.js';

export function subscriptionTuple(subscription: WriteSubscription) {
	return {
		id: subscription.id,
		amount: subscription.amount,
		provider: subscription.provider,
		token: subscription.token,
		cancelled: subscription.cancelled,
		frequency: subscription.frequency,
		dueDay: subscription.dueDay,
	} as const;
}

export function encodeApprove(spender: `0x${string}`, amount: bigint) {
	return encodeFunctionData({
		abi: ERC20_ABI,
		functionName: 'approve',
		args: [spender, amount],
	});
}

export function encodeCreateSubscription(
	amount: bigint,
	token: `0x${string}`,
	details: WriteDetails,
	frequency: number,
	dueDay: number,
) {
	return encodeFunctionData({
		abi: CLOCKTOWER_WRITE_ABI,
		functionName: 'createSubscription',
		args: [amount, token, details, frequency, dueDay],
	});
}

export function encodeSubscribe(subscription: WriteSubscription) {
	return encodeFunctionData({
		abi: CLOCKTOWER_WRITE_ABI,
		functionName: 'subscribe',
		args: [subscriptionTuple(subscription)],
	});
}

export function encodeCancelSubscription(subscription: WriteSubscription) {
	return encodeFunctionData({
		abi: CLOCKTOWER_WRITE_ABI,
		functionName: 'cancelSubscription',
		args: [subscriptionTuple(subscription)],
	});
}

export function encodeUnsubscribe(subscription: WriteSubscription) {
	return encodeFunctionData({
		abi: CLOCKTOWER_WRITE_ABI,
		functionName: 'unsubscribe',
		args: [subscriptionTuple(subscription)],
	});
}

export function encodeUnsubscribeByProvider(subscription: WriteSubscription, subscriber: `0x${string}`) {
	return encodeFunctionData({
		abi: CLOCKTOWER_WRITE_ABI,
		functionName: 'unsubscribeByProvider',
		args: [subscriptionTuple(subscription), subscriber],
	});
}

export function encodeEditDetails(details: WriteDetails, id: `0x${string}`) {
	return encodeFunctionData({
		abi: CLOCKTOWER_WRITE_ABI,
		functionName: 'editDetails',
		args: [details, id],
	});
}

export function encodeRemit() {
	return encodeFunctionData({
		abi: CLOCKTOWER_WRITE_ABI,
		functionName: 'remit',
		args: [],
	});
}

export function getFunctionSelector(data: `0x${string}`): `0x${string}` {
	if (data.length < 10) {
		throw new Error('Calldata too short for function selector');
	}
	return data.slice(0, 10) as `0x${string}`;
}
