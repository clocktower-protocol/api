import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateSuggestedHistoryPrice,
  formatSubLogEvent,
  getSubscriptionHistory,
  getProviderProfile,
  getAccountActivity,
  getSubscriptionDetailsHistory,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
} from '../src/tools/history.js';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const baseEnv = {
  ALCHEMY_API_KEY: 'test',
  ALCHEMY_URL: 'https://test.alchemy/',
  CLOCKTOWER_ADDRESS: '0xFaF5fc2f77b21BC188f492b827D366B03a07c61f',
  CDP_API_KEY_ID: 't',
  CDP_API_KEY_SECRET: 't',
  X402_RECIPIENT: '0x0000000000000000000000000000000000000001',
  GRAPH_BASE_URL: 'https://api.thegraph.com/subgraphs/name/test/clocktower',
  GRAPH_API_KEY: 'test-graph-key',
} as Env;

const sampleSubLog = {
  internal_id: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  provider: '0x0000000000000000000000000000000000000001',
  subscriber: '0x0000000000000000000000000000000000000002',
  timestamp: '1710001234',
  amount: '1000000000000000000', // 1.0 in 18-dec
  token: USDC,
  subScriptEvent: '5',
  blockNumber: '123456',
  blockTimestamp: '1710001234',
  transactionHash: '0xabc123',
};

const sampleDetailsLog = {
  internal_id: sampleSubLog.internal_id,
  provider: sampleSubLog.provider,
  timestamp: '1710001234',
  url: 'https://example.com/feed',
  description: 'Monthly newsletter',
  blockNumber: '123456',
  blockTimestamp: '1710001234',
  transactionHash: '0xabc123',
};

const sampleProvDetails = {
  provider: sampleSubLog.provider,
  timestamp: '1710009999',
  description: 'Acme Corp',
  company: 'Acme',
  url: 'https://acme.example',
  domain: 'acme.example',
  email: 'billing@acme.example',
  misc: '',
};

describe('history helpers (pure)', () => {
  it('calculateSuggestedHistoryPrice returns tiered pricing', () => {
    expect(calculateSuggestedHistoryPrice(10)).toBe(0.03);
    expect(calculateSuggestedHistoryPrice(50)).toBe(0.03);
    expect(calculateSuggestedHistoryPrice(51)).toBe(0.04);
    expect(calculateSuggestedHistoryPrice(100)).toBe(0.04);
    expect(calculateSuggestedHistoryPrice(150)).toBe(0.05);
  });

  it('exports sane limit constants', () => {
    expect(HISTORY_DEFAULT_LIMIT).toBe(100);
    expect(HISTORY_MAX_LIMIT).toBe(200);
  });

  it('formatSubLogEvent produces frontend-style fields and applies view filtering', () => {
    const formatted = formatSubLogEvent(sampleSubLog as any, false);
    expect(formatted.eventName).toBe('SubPaid');
    expect(formatted.formattedAmount).toBe('1.00 USDC');
    expect(formatted.formattedTimestamp).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(formatted.tokenTicker).toBe('USDC');

    const asProvider = formatSubLogEvent(sampleSubLog as any, true);
    expect(asProvider.eventName).toBe('SubPaid (internal)');
  });
});

describe('history functions (mocked subgraph)', () => {
  const originalFetch = globalThis.fetch;
  let cachesMock: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    // Minimal Cloudflare Cache API mock (used by querySubgraph)
    cachesMock = {
      default: {
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      },
    };
    (globalThis as any).caches = cachesMock;

    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const q = body.query || '';

      if (q.includes('subLogs')) {
        return Response.json({ data: { subLogs: [sampleSubLog] } });
      }
      if (q.includes('provDetailsLogs')) {
        return Response.json({ data: { provDetailsLogs: [sampleProvDetails] } });
      }
      if (q.includes('detailsLogs')) {
        return Response.json({ data: { detailsLogs: [sampleDetailsLog] } });
      }
      return Response.json({ data: {} });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete (globalThis as any).caches;
  });

  it('getSubscriptionHistory calls subgraph, formats, and returns hasMore/count', async () => {
    const res = await getSubscriptionHistory(baseEnv, sampleSubLog.internal_id as `0x${string}`, 8453, { first: 10 });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(res.events.length).toBe(1);
    expect(res.events[0].eventName).toBe('SubPaid');
    expect(res.events[0].formattedAmount).toBe('1.00 USDC');
    expect(res.hasMore).toBe(false); // returned 1 < requested 10
    expect(res.count).toBe(1);
  });

  it('getProviderProfile returns latest + convenience latestProfile shape', async () => {
    const res = await getProviderProfile(baseEnv, sampleProvDetails.provider as `0x${string}`);

    expect(res.profile).toBeTruthy();
    expect(res.latestProfile?.company).toBe('Acme');
    expect(res.latestProfile?.updatedAt).toMatch(/^\d{2}\/\d{2}\/\d{4}/);
  });

  it('getAccountActivity merges subscriber + provider legs and dedupes', async () => {
    // Second call in same test run will still hit the same mock (returns subscriber-shaped)
    const res = await getAccountActivity(baseEnv, sampleSubLog.subscriber as `0x${string}`);

    expect(res.breakdown.asSubscriber).toBeGreaterThan(0);
    expect(res.events.length).toBeGreaterThan(0);
    expect(res.events[0].formattedTimestamp).toBeDefined();
  });

  it('getAccountActivity surfaces partial errors when one leg fails', async () => {
    // Force one query to fail by overriding fetch for this test only
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('network boom on subscriber');
      return Response.json({ data: { subLogs: [sampleSubLog] } });
    }) as any;

    const res = await getAccountActivity(baseEnv, sampleSubLog.provider as `0x${string}`);
    expect(res.partial).toBe(true);
    expect(res.queryErrors?.some((e: string) => e.includes('subscriber'))).toBe(true);

    globalThis.fetch = orig;
  });

  it('getSubscriptionDetailsHistory returns formatted DetailsLog entries', async () => {
    const res = await getSubscriptionDetailsHistory(baseEnv, sampleSubLog.internal_id as `0x${string}`);
    expect(res.events.length).toBe(1);
    expect(res.events[0].formattedTimestamp).toBeDefined();
    expect(res.events[0].description).toBe('Monthly newsletter');
  });

  it('history functions return sanitized error object (graceful degradation) when GRAPH_BASE_URL missing', async () => {
    const badEnv = { ...baseEnv, GRAPH_BASE_URL: undefined } as Env;
    const res = await getSubscriptionHistory(badEnv, sampleSubLog.internal_id as `0x${string}`);

    expect(res.events).toEqual([]);
    expect(res.error).toMatch(/Subgraph URL not configured/);
    expect(res.error).toMatch(/GRAPH_BASE_URL/);
  });
});
