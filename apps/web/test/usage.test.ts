import { describe, expect, it } from 'vitest';
import { fetchUsage, METRICS } from '../worker/usage.ts';

/** A pretend Cloudflare analytics API that answers each dataset from `data`, or fails for `broken` ones. */
function fakeCloudflare(data: Record<string, unknown>, broken: string[] = []) {
  const asked: { query: string; variables: Record<string, string>; auth: string | null }[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, string> };
    asked.push({ ...body, auth: new Headers(init.headers).get('authorization') });
    const dataset = Object.keys(data).concat(broken).find((name) => body.query.includes(`${name}(`));
    if (!dataset || broken.includes(dataset)) return Response.json({ data: null, errors: [{ message: `unknown field ${dataset}` }] });
    return Response.json({ data: { viewer: { accounts: [{ [dataset]: data[dataset] }] } }, errors: null });
  }) as typeof fetch;
  return { fetchFn, asked };
}

describe('Usage page numbers', () => {
  it('adds up today’s usage from Cloudflare and converts awake time to GB-seconds', async () => {
    const { fetchFn, asked } = fakeCloudflare({
      workersInvocationsAdaptive: [{ sum: { requests: 1200 } }, { sum: { requests: 34 } }],
      durableObjectsInvocationsAdaptiveGroups: [{ sum: { requests: 5000 } }],
      // 2 hours awake, in microseconds, at 128 MB = 900 GB-seconds.
      durableObjectsPeriodicGroups: [{ sum: { activeTime: 7_200_000_000 } }],
      d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 40_000, rowsWritten: 900 } }],
      d1StorageAdaptiveGroups: [{ max: { databaseSizeBytes: 98_304 } }],
      durableObjectsStorageGroups: [{ max: { storedBytes: 1_000_000 } }, { max: { storedBytes: 3_000_000 } }],
    });
    const items = await fetchUsage('acct', 'token', new Date('2026-10-29T15:00:00Z'), fetchFn);
    const used = Object.fromEntries(items.map((i) => [i.key, i.used]));
    expect(used).toEqual({ website: 1234, roomRequests: 5000, roomTime: 900, rowsRead: 40_000, rowsWritten: 900, databaseSize: 98_304, roomStorage: 3_000_000 });
    expect(asked[0].variables).toEqual({ account: 'acct', date: '2026-10-29' });
    expect(asked[0].auth).toBe('Bearer token');
    expect(items).toHaveLength(METRICS.length);
  });

  it('shows the rest when Cloudflare can’t report one number', async () => {
    const { fetchFn } = fakeCloudflare({ workersInvocationsAdaptive: [{ sum: { requests: 10 } }] }, ['durableObjectsPeriodicGroups']);
    const items = await fetchUsage('acct', 'token', new Date(), fetchFn);
    expect(items.find((i) => i.key === 'website')?.used).toBe(10);
    expect(items.find((i) => i.key === 'roomTime')).toMatchObject({ used: null, error: 'unknown field durableObjectsPeriodicGroups' });
  });
});
