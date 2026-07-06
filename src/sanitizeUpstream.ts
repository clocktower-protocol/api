/**
 * Redact upstream provider details (RPC URLs, API keys, bearer tokens) from
 * client-facing REST error messages. MCP paid tools use safeHandler for the
 * same purpose; REST write handlers share this helper.
 */

const HTTPS_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9\-_.]+/gi;
const LONG_SECRET_PATTERN = /[A-Za-z0-9]{32,}/g;

export function redactSensitiveErrorText(raw: string): string {
	let text = raw.replace(BEARER_TOKEN_PATTERN, 'Bearer [redacted]');
	text = text.replace(HTTPS_URL_PATTERN, '[redacted-url]');
	text = text.replace(LONG_SECRET_PATTERN, '[redacted]');
	if (text.length > 300) {
		return `${text.slice(0, 300)}…`;
	}
	return text;
}

/** True when the message is safe to return verbatim to API clients. */
export function isSafeClientErrorMessage(message: string): boolean {
	if (/https?:\/\/[^\s"'<>]+/i.test(message)) {
		return false;
	}
	if (/Bearer\s+[A-Za-z0-9\-_.]+/i.test(message)) {
		return false;
	}
	if (/[A-Za-z0-9]{32,}/.test(message)) {
		return false;
	}
	return message.length <= 300;
}

export function clientSafeMessage(message: string, fallback: string): string {
	return isSafeClientErrorMessage(message) ? message : fallback;
}