interface Env {
	CLOCKTOWER_MCP: DurableObjectNamespace;
	RATE_LIMIT: KVNamespace;
	ALCHEMY_API_KEY: string;
	ALCHEMY_URL: string;
	CLOCKTOWER_ADDRESS: string;
	CDP_API_KEY_ID: string;
	CDP_API_KEY_SECRET: string;
	X402_RECIPIENT: string;
	RATE_LIMIT_REQUESTS_PER_MINUTE?: string;
	ENABLE_AUTH?: string;
	CFP_USERNAME?: string;
	CFP_PASSWORD?: string;
}
