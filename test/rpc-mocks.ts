import { vi } from 'vitest';

/** Base mainnet chain id as returned by eth_chainId. */
export const BASE_CHAIN_ID_HEX = '0x2105';

const DEFAULT_GAS_LIMIT_HEX = '0x30d40'; // 200_000
const DEFAULT_BASE_FEE_HEX = '0xf4240'; // 1_000_000
const DEFAULT_PRIORITY_FEE_HEX = '0xf4240'; // 1_000_000

type RpcBody = {
	id?: number;
	method?: string;
};

function parseRpcBody(init?: RequestInit): RpcBody {
	if (!init?.body || typeof init.body !== 'string') {
		return {};
	}
	try {
		return JSON.parse(init.body) as RpcBody;
	} catch {
		return {};
	}
}

function gasRpcResponse(body: RpcBody, options?: { estimateGasFails?: boolean }): Response | null {
	const id = body.id ?? 1;

	switch (body.method) {
		case 'eth_chainId':
			return Response.json({ jsonrpc: '2.0', id, result: BASE_CHAIN_ID_HEX });
		case 'eth_getBlockByNumber':
			return Response.json({
				jsonrpc: '2.0',
				id,
				result: {
					number: '0x1',
					hash: `0x${'00'.repeat(32)}`,
					parentHash: `0x${'00'.repeat(32)}`,
					nonce: '0x0000000000000000',
					sha3Uncles: `0x${'00'.repeat(32)}`,
					logsBloom: `0x${'00'.repeat(256)}`,
					transactionsRoot: `0x${'00'.repeat(32)}`,
					stateRoot: `0x${'00'.repeat(32)}`,
					receiptsRoot: `0x${'00'.repeat(32)}`,
					miner: '0x0000000000000000000000000000000000000000',
					difficulty: '0x0',
					totalDifficulty: '0x0',
					extraData: '0x',
					size: '0x0',
					gasLimit: '0x1c9c380',
					gasUsed: '0x0',
					timestamp: '0x0',
					transactions: [],
					uncles: [],
					baseFeePerGas: DEFAULT_BASE_FEE_HEX,
				},
			});
		case 'eth_maxPriorityFeePerGas':
			return Response.json({ jsonrpc: '2.0', id, result: DEFAULT_PRIORITY_FEE_HEX });
		case 'eth_estimateGas':
			if (options?.estimateGasFails) {
				return Response.json({
					jsonrpc: '2.0',
					id,
					error: { code: 3, message: 'execution reverted' },
				});
			}
			return Response.json({ jsonrpc: '2.0', id, result: DEFAULT_GAS_LIMIT_HEX });
		default:
			return null;
	}
}

/**
 * Fetch mock that answers gas-related JSON-RPC methods and sequences contract
 * read / simulation eth_call results from `contractResults`.
 */
export function createGasAwareFetch(
	contractResults: (string | Response)[],
	options?: { estimateGasFails?: boolean },
): typeof fetch {
	let callIndex = 0;

	return vi.fn(async (_url: string, init?: RequestInit) => {
		const body = parseRpcBody(init);
		const gasResponse = gasRpcResponse(body, options);
		if (gasResponse) {
			return gasResponse;
		}

		const entry = contractResults[callIndex] ?? contractResults[contractResults.length - 1] ?? '0x';
		callIndex += 1;

		if (entry instanceof Response) {
			return entry;
		}

		return Response.json({ jsonrpc: '2.0', id: body.id ?? 1, result: entry });
	}) as typeof fetch;
}