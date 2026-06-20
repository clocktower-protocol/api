import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateSuggestedHistoryPrice,
  formatSubLogEvent,
  getSubscriptionHistory,
  getProviderProfile,
  getAccountActivity,
  getSubscriptionDetails,
  getSubscriptionDetailsHistory,
  searchSubscriptionCreates,
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

    // New normalized amount fields (consistent with other read endpoints)
    expect(formatted.amount).toBe('1');           // 1e18 protocol / 1e12 = 1e6 units for 6-dec USDC
    expect(formatted.amountRaw).toBe('1000000');
    expect(formatted.tokenDecimals).toBe(6);

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
      if (q.includes('SearchSubscriptionCreates')) {
        return Response.json({
          data: {
            subLogs: [
              { ...sampleSubLog, subScriptEvent: '0' },
              { ...sampleSubLog, subScriptEvent: '0', internal_id: sampleSubLog.internal_id },
            ],
          },
        });
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

    // Amount normalization is applied (protocol 18-dec → USDC 6-dec)
    expect(res.events[0].amount).toBe('1');
    expect(res.events[0].tokenDecimals).toBe(6);

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

  it('getSubscriptionDetails returns latest url and description only', async () => {
    const res = await getSubscriptionDetails(baseEnv, sampleSubLog.internal_id as `0x${string}`);
    expect(res.details?.url).toBe('https://example.com/feed');
    expect(res.details?.description).toBe('Monthly newsletter');
    expect(res.details?.updatedAt).toMatch(/^\d{2}\/\d{2}\/\d{4}/);
  });

  it('searchSubscriptionCreates deduplicates Create events by internal_id', async () => {
    const res = await searchSubscriptionCreates(baseEnv, 8453, { first: 10 });
    expect(res.events.length).toBe(1);
    expect(res.events[0].internal_id).toBe(sampleSubLog.internal_id);
    expect(res.events[0].formattedTimestamp).toBeDefined();
  });

  it('searchSubscriptionCreates sends subScriptEvent as Int in GraphQL variables', async () => {
    await searchSubscriptionCreates(baseEnv, 8453, { first: 10 });

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(call[1]?.body as string);
    expect(body.variables.where.subScriptEvent).toBe(0);
    expect(typeof body.variables.where.subScriptEvent).toBe('number');
  });

  it('history functions return sanitized error object (graceful degradation) when GRAPH_BASE_URL missing', async () => {
    const badEnv = { ...baseEnv, GRAPH_BASE_URL: undefined } as Env;
    const res = await getSubscriptionHistory(badEnv, sampleSubLog.internal_id as `0x${string}`);

    expect(res.events).toEqual([]);
    expect(res.error).toMatch(/Subgraph URL not configured/);
    expect(res.error).toMatch(/GRAPH_BASE_URL/);
  });

  // === Phase 5 expanded tests ===

  it('respects server-side max limit (first > 200 is capped)', async () => {
    const res = await getSubscriptionHistory(baseEnv, sampleSubLog.internal_id as `0x${string}`, 8453, { first: 500 });
    // The implementation should have capped first at 200 before calling the subgraph
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining('"first":200'),
      })
    );
  });

  it('supports skip parameter for pagination', async () => {
    await getSubscriptionHistory(baseEnv, sampleSubLog.internal_id as `0x${string}`, 8453, { first: 5, skip: 10 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining('"skip":10'),
      })
    );
  });

  it('returns hasMore=true when subgraph returns exactly the requested number of records', async () => {
    // Override fetch for this test to return exactly 5 records when first=5
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      const fiveRecords = Array(5).fill(sampleSubLog);
      return Response.json({ data: { subLogs: fiveRecords } });
    }) as any;

    const res = await getSubscriptionHistory(baseEnv, sampleSubLog.internal_id as `0x${string}`, 8453, { first: 5 });

    expect(res.hasMore).toBe(true);
    expect(res.count).toBe(5);

    globalThis.fetch = origFetch;
  });

  it('uses cache on repeated identical calls (cache hit skips fetch)', async () => {
    // First call - should miss cache and call fetch
    await getSubscriptionHistory(baseEnv, sampleSubLog.internal_id as `0x${string}`);

    const firstCallCount = (globalThis.fetch as any).mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);
    expect(cachesMock.default.put).toHaveBeenCalled(); // should have written to cache

    // Simulate cache hit on second call
    const cachedResponse = new Response(JSON.stringify({ data: { subLogs: [sampleSubLog] } }));
    cachesMock.default.match.mockResolvedValueOnce(cachedResponse);

    await getSubscriptionHistory(baseEnv, sampleSubLog.internal_id as `0x${string}`);

    // Fetch should not have been called again
    expect((globalThis.fetch as any).mock.calls.length).toBe(firstCallCount);
  });

  it('falls back gracefully for non-approved tokens (uses 18 decimals)', async () => {
    const unknownTokenLog = { ...sampleSubLog, token: '0x000000000000000000000000000000000000dead' };

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return Response.json({ data: { subLogs: [unknownTokenLog] } });
    }) as any;

    const res = await getSubscriptionHistory(baseEnv, sampleSubLog.internal_id as `0x${string}`);

    // Should still return data without crashing, using 18 decimals as fallback
    expect(res.events[0].tokenDecimals).toBe(18);
    expect(res.events[0].tokenTicker).toBe('TOKEN'); // fallback ticker

    globalThis.fetch = origFetch;
  });
});
