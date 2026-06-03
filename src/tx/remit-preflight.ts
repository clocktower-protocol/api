import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import { resolveChain } from '../chain.js';
import { createClocktowerClient } from '../client.js';
import { getCurrentDay } from '../utils.js';
import { scanDueSubscriptionIds } from './remit-scan.js';
import type { RemitReadinessResult } from './types.js';

const LARGE_QUEUE_THRESHOLD = 50;

export async function checkRemitReadiness(
	env: Env,
	from: `0x${string}`,
): Promise<RemitReadinessResult> {
	const chain = resolveChain(env);
	const client = createClocktowerClient(chain);
	const currentDay = getCurrentDay();

	const [nextUncheckedDayRaw, maxRemitsRaw] = await Promise.all([
		client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'nextUncheckedDay',
		}),
		client.readContract({
			address: chain.contractAddress,
			abi: CLOCKTOWER_READ_ABI,
			functionName: 'maxRemits',
		}),
	]);

	const nextUncheckedDay = Number(nextUncheckedDayRaw);
	const maxRemits = Number(maxRemitsRaw);
	const errors: string[] = [];
	const warnings: string[] = [];

	if (currentDay < nextUncheckedDay) {
		errors.push(
			`Remit not due: current day (${currentDay}) is before next unchecked day (${nextUncheckedDay})`,
		);
	}

	let totalSubscriptions = 0;
	if (errors.length === 0) {
		totalSubscriptions = await scanDueSubscriptionIds(
			client,
			chain.contractAddress,
			nextUncheckedDay,
			currentDay,
		);

		if (totalSubscriptions === 0) {
			errors.push(
				`No due subscriptions found between day ${nextUncheckedDay} and ${currentDay}`,
			);
		}
	}

	const expectedTransactions =
		totalSubscriptions > 0 && maxRemits > 0
			? Math.max(1, Math.ceil(totalSubscriptions / maxRemits))
			: 0;

	if (expectedTransactions > 1) {
		warnings.push(
			`Queue may require ${expectedTransactions} separate remit transactions; call prepare_remit again after each submit until caught up.`,
		);
	}

	if (totalSubscriptions > LARGE_QUEUE_THRESHOLD) {
		warnings.push(
			`Large remit queue (${totalSubscriptions} subscription slots); ensure sufficient gas limit.`,
		);
	}

	return {
		ready: errors.length === 0,
		from,
		currentDay,
		nextUncheckedDay,
		totalSubscriptions,
		maxRemits,
		expectedTransactions,
		warnings,
		errors,
	};
}
