// The admin's Usage page: today's Cloudflare usage against the free plan's limits, so the TD can see
// long before a limit is near. Daily limits reset at 00:00 UTC (7 pm Central in summer, 6 pm in winter).
import { useLoad } from '../lib/api.ts';
import { timeAgo } from '../lib/format.ts';

interface UsageItem {
  key: string;
  label: string;
  help: string;
  used: number | null;
  limit: number;
  unit: 'count' | 'bytes' | 'gb-seconds';
  daily: boolean;
  error?: string;
}

type UsageData = { configured: false } | { configured: true; items: UsageItem[]; checkedAt: number };

function formatAmount(value: number, unit: UsageItem['unit']): string {
  if (unit === 'bytes') {
    const units = ['bytes', 'KB', 'MB', 'GB'];
    let v = value;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  }
  const rounded = unit === 'gb-seconds' ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded.toLocaleString()}${unit === 'gb-seconds' ? ' GB-s' : ''}`;
}

export function UsagePage() {
  const { data, error, reload } = useLoad<UsageData>('/admin/usage');

  return (
    <div className="page">
      <h1>Usage</h1>
      <p className="muted">
        Today’s use of Cloudflare’s free plan. Daily limits reset at 00:00 UTC: 7 pm Central in summer, 6 pm in winter. If one runs out, that
        part of the website stops until the reset, but the TriCaster and Pause keep working.
      </p>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Asking Cloudflare…</p>}
      {data && !data.configured && (
        <p className="notice">
          The Usage page isn’t set up yet. It needs a read-only Cloudflare API token: see “Set up the Usage page” in docs/PHASE-2.md.
        </p>
      )}
      {data?.configured && (
        <>
          <table className="simple usage">
            <thead>
              <tr>
                <th>What</th>
                <th>Used</th>
                <th>Free limit</th>
                <th aria-label="How much of the limit is used" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const share = item.used === null ? null : item.used / item.limit;
                const level = share === null ? '' : share >= 0.8 ? 'high' : share >= 0.5 ? 'medium' : 'low';
                return (
                  <tr key={item.key}>
                    <td>
                      <strong>{item.label}</strong>
                      <div className="muted small">{item.help}</div>
                    </td>
                    <td>{item.used === null ? <span className="muted" title={item.error}>Not available</span> : formatAmount(item.used, item.unit)}</td>
                    <td>
                      {formatAmount(item.limit, item.unit)}
                      <span className="muted small">{item.daily ? ' a day' : ' in total'}</span>
                    </td>
                    <td className="usage-bar-cell">
                      {share !== null && (
                        <div className={`usage-bar ${level}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label={`${item.label}: ${Math.round(share * 100)}% of the free limit`}>
                          <span style={{ width: `${Math.min(100, Math.max(share * 100, share > 0 ? 1 : 0))}%` }} />
                        </div>
                      )}
                      {share !== null && <span className="small">{share < 0.01 && share > 0 ? 'under 1%' : `${Math.round(share * 100)}%`}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">
            Checked {timeAgo(data.checkedAt)}. Cloudflare’s numbers can lag a few minutes. <button onClick={reload}>Refresh</button>
          </p>
        </>
      )}
    </div>
  );
}
