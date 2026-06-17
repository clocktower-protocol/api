import { verifyMessage } from 'viem';

export type SiweFields = {
	domain: string;
	address: `0x${string}`;
	uri: string;
	chainId: number;
	nonce: string;
	issuedAt: string;
};

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

export async function verifySiweSignature(
	message: string,
	signature: `0x${string}`,
	expected: {
		domain: string;
		chainId: number;
		nonce: string;
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

	const valid = await verifyMessage({
		address: parsed.address,
		message,
		signature,
	});

	return valid ? parsed.address : null;
}