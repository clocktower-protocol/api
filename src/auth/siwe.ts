import { verifyMessage } from 'viem';

export type SiweFields = {
	domain: string;
	address: `0x${string}`;
	uri: string;
	chainId: number;
	nonce: string;
	issuedAt: string;
};

/** Max age of SIWE Issued At relative to verify time (and small clock-skew allowance). */
export const SIWE_ISSUED_AT_MAX_AGE_MS = 10 * 60 * 1000;
export const SIWE_ISSUED_AT_FUTURE_SKEW_MS = 2 * 60 * 1000;

export function buildSiweMessage(fields: SiweFields): string {
	return [
		`${fields.domain} wants you to sign in with your Ethereum account:`,
		fields.address,
		'',
		`URI: ${fields.uri}`,
		'Version: 1',
		`Chain ID: ${fields.chainId}`,
		`Nonce: ${fields.nonce}`,
		`Issued At: ${fields.issuedAt}`,
	].join('\n');
}

export function parseSiweMessage(message: string): Partial<SiweFields> | null {
	const lines = message.split('\n');
	const domainMatch = lines[0]?.match(/^(.+) wants you to sign in with your Ethereum account:$/);
	if (!domainMatch) {
		return null;
	}

	const address = lines[1]?.trim() as `0x${string}` | undefined;
	if (!address?.startsWith('0x')) {
		return null;
	}

	const fields: Partial<SiweFields> = { domain: domainMatch[1], address };

	for (const line of lines.slice(2)) {
		if (line.startsWith('URI: ')) fields.uri = line.slice(5);
		if (line.startsWith('Chain ID: ')) fields.chainId = Number.parseInt(line.slice(10), 10);
		if (line.startsWith('Nonce: ')) fields.nonce = line.slice(7);
		if (line.startsWith('Issued At: ')) fields.issuedAt = line.slice(11);
	}

	return fields;
}

/**
 * Returns true when Issued At is present and within the allowed window.
 * Rejects missing/invalid timestamps, messages too far in the past, or too far in the future.
 */
export function isSiweIssuedAtFresh(
	issuedAt: string | undefined,
	nowMs: number = Date.now(),
): boolean {
	if (!issuedAt) {
		return false;
	}
	const issuedMs = Date.parse(issuedAt);
	if (Number.isNaN(issuedMs)) {
		return false;
	}
	if (issuedMs > nowMs + SIWE_ISSUED_AT_FUTURE_SKEW_MS) {
		return false;
	}
	if (nowMs - issuedMs > SIWE_ISSUED_AT_MAX_AGE_MS) {
		return false;
	}
	return true;
}

export async function verifySiweSignature(
	message: string,
	signature: `0x${string}`,
	expected: {
		domain: string;
		chainId: number;
		nonce: string;
		/** When set, message URI must match exactly (scheme + host + port). */
		uri?: string;
	},
): Promise<`0x${string}` | null> {
	const parsed = parseSiweMessage(message);
	if (
		!parsed?.address ||
		!parsed.nonce ||
		parsed.nonce !== expected.nonce ||
		parsed.domain !== expected.domain ||
		parsed.chainId !== expected.chainId
	) {
		return null;
	}

	if (!isSiweIssuedAtFresh(parsed.issuedAt)) {
		return null;
	}

	if (expected.uri !== undefined && parsed.uri !== expected.uri) {
		return null;
	}

	const valid = await verifyMessage({
		address: parsed.address,
		message,
		signature,
	});

	return valid ? parsed.address : null;
}
