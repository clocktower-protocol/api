import { createFacilitatorConfig } from '@coinbase/x402';
import type { X402Config } from 'agents/x402';

/** Base mainnet; normalized to `eip155:8453` by agents/x402. */
export const X402_NETWORK = 'base' as const;

export function buildX402Config(env: Env): X402Config {
	return {
		network: X402_NETWORK,
		recipient: env.X402_RECIPIENT as `0x${string}`,
		facilitator: createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET),
	};
}
