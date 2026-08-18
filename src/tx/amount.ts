import { resolveChain, type ChainConfig } from '../chain.js';
import { createClocktowerClient } from '../client.js';
import { CLOCKTOWER_READ_ABI } from '../abi/clocktower.js';
import { parseApprovedTokenRecord } from '../validation.js';
import { parseUnits } from 'viem';
import { convertTokenNativeToProtocolAmount } from '../utils.js';

type Env = any;

/**
 * Converts a subscription object's human-readable `amount` string (e.g. "100.5")
 * into protocol internal units (always 18 decimals) using the token's decimals
 * from `approvedERC20`.
 *
 * `amount` must be a human token-unit string — not protocol wei and not
 * token-native raw integers. Mirrors the SDK create path (human → native → protocol).
 */
export async function normalizeSubscriptionAmount(
  env: Env,
  subscription: any,
  chain: ChainConfig = resolveChain(env),
) {
  if (typeof subscription.amount !== 'string') {
    throw new Error(
      'subscription.amount must be a human-readable decimal string (e.g. "10" or "100.5")',
    );
  }

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
  const protocolAmount = convertTokenNativeToProtocolAmount(
    nativeAmount,
    approvedToken.decimals,
  );

  return {
    ...subscription,
    amount: protocolAmount,
  };
}
