// The admin's Usage page: today's Cloudflare usage against the free plan's limits, so the TD can see
// long before a limit is near. Daily limits reset at 00:00 UTC (7 pm Central in summer, 6 pm in winter).
import { api, useLoad } from '../lib/api.ts';
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
      <DriveBox />
    </div>
  );
}

interface DriveStatus {
  connected: boolean;
  email: string | null;
  connectedAt: number | null;
  files: number;
  bytes: number;
  googleSetUp: boolean;
}

/** What came back from connecting the Drive (Google sends the admin back here). */
const DRIVE_RESULTS: Record<string, { text: string; ok?: boolean }> = {
  connected: { text: 'Google Drive connected. RiGster now keeps the shows’ profiles there.', ok: true },
  cancelled: { text: 'Connecting Google Drive was cancelled.' },
  expired: { text: 'That took too long. Click Connect Google Drive again.' },
  google: { text: 'Google didn’t finish connecting the Drive. Try again; if it keeps happening, check the Drive setup in docs/PHASE-6.md.' },
  'no-drive-permission': { text: 'Google’s page had the Drive permission unticked. Click Connect Google Drive again and leave it ticked.' },
  'admins-only': { text: 'Only an admin can connect the Drive.' },
  'not-set-up': { text: 'Google sign-in isn’t set up on the website yet.' },
};

/**
 * RiGster's show profiles (Nov 2, 2026): each show's permanent graphics, green screen and tease music
 * are kept in a Google Drive, which an admin connects here, so every laptop with RiGster has them.
 */
function DriveBox() {
  const { data, error, reload } = useLoad<DriveStatus>('/drive');
  const result = DRIVE_RESULTS[new URLSearchParams(window.location.search).get('drive') ?? ''];
  const disconnect = async () => {
    if (!confirm('Disconnect the Google Drive? RiGster stops getting the shows’ profiles until a Drive is connected again. The files stay in the Drive.')) return;
    await api('/drive', { method: 'DELETE' });
    reload();
  };
  return (
    <section className="drive-box">
      <h2>RiGster’s Google Drive</h2>
      <p className="muted">
        Each show’s permanent graphics, green screen and tease music are kept here, in a <strong>RiGster</strong> folder with a folder for each
        show, so every laptop with RiGster has them. RiGster can see only the files it puts there, not the rest of the Drive.
      </p>
      {result && <p className={result.ok ? 'notice ok' : 'notice'}>{result.text}</p>}
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          {data.connected ? (
            <p>
              Connected to <strong>{data.email}</strong>
              {data.connectedAt ? <span className="muted"> since {new Date(data.connectedAt).toLocaleDateString()}</span> : null}.{' '}
              {data.files} {data.files === 1 ? 'file' : 'files'} in the shows’ profiles ({formatAmount(data.bytes, 'bytes')}).
            </p>
          ) : (
            <p className="muted">No Google Drive is connected yet.</p>
          )}
          <div className="row">
            {data.googleSetUp && (
              <a className={`button${data.connected ? '' : ' primary'}`} href="/api/drive/connect">
                {data.connected ? 'Connect a different Google Drive' : 'Connect Google Drive'}
              </a>
            )}
            {data.connected && <button onClick={disconnect}>Disconnect</button>}
          </div>
          {data.connected && (
            <p className="muted small">
              Connecting a different Google account’s Drive (like TSTV’s) moves the profiles there: each laptop with RiGster sends that account the files it
              has, the next time it opens a profile.
            </p>
          )}
        </>
      )}
    </section>
  );
}
