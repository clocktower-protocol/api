import { resolveChain } from '../chain.js';
import { createClocktowerClient } from '../client.js';
import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import { parseApprovedTokenRecord } from '../validation.js';
import { parseUnits } from 'viem';
import { convertTokenNativeToProtocolAmount } from '../utils.js';

type Env = any;

/**
 * If a subscription object has a human-readable amount string (e.g. "100.5"),
 * this converts it to the correct internal protocol units (always 18 decimals)
 * using the token's actual decimals from the protocol.
 *
 * If `amount` is already a bigint, it is returned unchanged.
 */
export async function normalizeSubscriptionAmount(env: Env, subscription: any) {
  if (typeof subscription.amount === 'string') {
    const chain = resolveChain(env);
    const client = createClocktowerClient(chain);

    const approvedToken = parseApprovedTokenRecord(
      await client.readContract({
        address: chain.contractAddress,
        abi: CLOCKTOWER_READ_ABI,
        functionName: 'approvedERC20',
        args: [subscription.token],
      }),
    );

    const nativeAmount = parseUnits(subscription.amount, approvedToken.decimals);
    const protocolAmount = convertTokenNativeToProtocolAmount(nativeAmount, approvedToken.decimals);

    return {
      ...subscription,
      amount: protocolAmount,
    };
  }

  return subscription;
}
