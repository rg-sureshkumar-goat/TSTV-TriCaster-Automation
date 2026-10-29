// Today's Cloudflare usage against the free plan's limits, for the admin's Usage page. It asks Cloudflare's
// analytics API, which needs a read-only API token the TD creates (see docs/PHASE-2.md). Each number is
// fetched on its own, so one that Cloudflare can't report doesn't hide the others.

export interface UsageItem {
  key: string;
  label: string;
  /** What it means in plain words. */
  help: string;
  used: number | null;
  limit: number;
  unit: 'count' | 'bytes' | 'gb-seconds';
  /** True for limits that reset every day at 00:00 UTC; false for totals, like storage. */
  daily: boolean;
  error?: string;
}

interface Metric {
  key: string;
  label: string;
  help: string;
  limit: number;
  unit: UsageItem['unit'];
  daily: boolean;
  /** The analytics query's body, inside viewer.accounts. */
  query: string;
  read: (account: Record<string, unknown>) => number;
}

type Groups = { sum?: Record<string, number>; max?: Record<string, number> }[];
const total = (groups: unknown, field: string, kind: 'sum' | 'max' = 'sum') =>
  ((groups as Groups | undefined) ?? []).reduce((acc, g) => (kind === 'sum' ? acc + (g.sum?.[field] ?? 0) : Math.max(acc, g.max?.[field] ?? 0)), 0);

const TODAY = 'filter: { date_geq: $date, date_leq: $date }';

/** The free plan's limits, checked Oct 28, 2026 (docs/ARCHITECTURE.md, section 10). */
export const METRICS: Metric[] = [
  {
    key: 'website',
    label: 'Website requests',
    help: 'Pages and sign-ins served by the website today. Loading the website’s files is free and not counted.',
    limit: 100_000,
    unit: 'count',
    daily: true,
    query: `workersInvocationsAdaptive(limit: 1000, ${TODAY}) { sum { requests } }`,
    read: (a) => total(a.workersInvocationsAdaptive, 'requests'),
  },
  {
    key: 'roomRequests',
    label: 'Episode room requests',
    help: 'Live editing traffic to episode rooms today. 20 live messages count as one request.',
    limit: 100_000,
    unit: 'count',
    daily: true,
    query: `durableObjectsInvocationsAdaptiveGroups(limit: 1000, ${TODAY}) { sum { requests } }`,
    read: (a) => total(a.durableObjectsInvocationsAdaptiveGroups, 'requests'),
  },
  {
    key: 'roomTime',
    label: 'Episode room awake time',
    help: 'How long episode rooms were awake today. 13,000 GB-seconds is about 29 room-hours.',
    limit: 13_000,
    unit: 'gb-seconds',
    daily: true,
    query: `durableObjectsPeriodicGroups(limit: 1000, ${TODAY}) { sum { activeTime } }`,
    // activeTime is in microseconds; each room is billed as 128 MB of memory.
    read: (a) => (total(a.durableObjectsPeriodicGroups, 'activeTime') / 1_000_000) * 0.125,
  },
  {
    key: 'rowsRead',
    label: 'Database rows read',
    help: 'Rows the database read today, for sign-ins, lists and search.',
    limit: 5_000_000,
    unit: 'count',
    daily: true,
    query: `d1AnalyticsAdaptiveGroups(limit: 1000, ${TODAY}) { sum { rowsRead } }`,
    read: (a) => total(a.d1AnalyticsAdaptiveGroups, 'rowsRead'),
  },
  {
    key: 'rowsWritten',
    label: 'Database rows written',
    help: 'Rows the database wrote today, like episode summaries and sign-ins.',
    limit: 100_000,
    unit: 'count',
    daily: true,
    query: `d1AnalyticsAdaptiveGroups(limit: 1000, ${TODAY}) { sum { rowsWritten } }`,
    read: (a) => total(a.d1AnalyticsAdaptiveGroups, 'rowsWritten'),
  },
  {
    key: 'databaseSize',
    label: 'Database size',
    help: 'Users, shows, the episode list and search text. Rundowns and scripts live in the episode rooms.',
    limit: 500 * 1024 * 1024,
    unit: 'bytes',
    daily: false,
    query: `d1StorageAdaptiveGroups(limit: 1000, ${TODAY}) { max { databaseSizeBytes } }`,
    read: (a) => total(a.d1StorageAdaptiveGroups, 'databaseSizeBytes', 'max'),
  },
  {
    key: 'roomStorage',
    label: 'Episode room storage',
    help: 'Every episode’s rundown and scripts, together.',
    limit: 5 * 1024 * 1024 * 1024,
    unit: 'bytes',
    daily: false,
    query: `durableObjectsStorageGroups(limit: 1000, ${TODAY}) { max { storedBytes } }`,
    read: (a) => total(a.durableObjectsStorageGroups, 'storedBytes', 'max'),
  },
];

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

/** Asks Cloudflare for today's usage (in UTC, when the free limits reset). */
export async function fetchUsage(accountId: string, token: string, now = new Date(), fetchFn: typeof fetch = fetch): Promise<UsageItem[]> {
  const date = now.toISOString().slice(0, 10);
  return Promise.all(
    METRICS.map(async (m): Promise<UsageItem> => {
      const base = { key: m.key, label: m.label, help: m.help, limit: m.limit, unit: m.unit, daily: m.daily };
      try {
        const response = await fetchFn(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({
            query: `query ($account: string!, $date: Date!) { viewer { accounts(filter: { accountTag: $account }) { ${m.query} } } }`,
            variables: { account: accountId, date },
          }),
        });
        const json = (await response.json()) as { data?: { viewer?: { accounts?: Record<string, unknown>[] } }; errors?: { message: string }[] | null };
        if (!response.ok || json.errors?.length) return { ...base, used: null, error: json.errors?.[0]?.message ?? `Cloudflare answered ${response.status}` };
        const account = json.data?.viewer?.accounts?.[0];
        if (!account) return { ...base, used: null, error: 'Cloudflare didn’t find the account. Check CF_ACCOUNT_ID.' };
        return { ...base, used: m.read(account) };
      } catch (e) {
        return { ...base, used: null, error: (e as Error).message };
      }
    }),
  );
}
