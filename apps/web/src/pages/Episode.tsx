import { useMemo, useState } from 'react';
import { computeRundown, formatDuration, formatOverUnder, type ShowSettings } from '@tstv/shared';
import { api, useLoad, type User } from '../lib/api.ts';
import { Link } from '../lib/router.tsx';
import { formatDate, formatTime } from '../lib/format.ts';
import { RundownGrid } from '../rundown/RundownGrid.tsx';
import { useEpisodeDoc } from '../rundown/useEpisodeDoc.ts';
import { exportCsv, exportPdf } from '../rundown/export.ts';
import type { EpisodeListItem } from './Show.tsx';

interface EpisodeData {
  episode: EpisodeListItem & { showId: string };
  show: { id: string; name: string; settings: ShowSettings };
}

export function EpisodePage({ episodeId, user }: { episodeId: string; user: User }) {
  const { data, error, reload } = useLoad<EpisodeData>(`/episodes/${episodeId}`);
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page muted">Loading…</div>;
  return <EpisodeView data={data} user={user} reload={reload} />;
}

function EpisodeView({ data, user, reload }: { data: EpisodeData; user: User; reload: () => void }) {
  const { episode, show } = data;
  const readOnly = episode.status === 'archived';
  const room = useEpisodeDoc(episode.id, user, reload);
  const timing = useMemo(() => computeRundown(room.rows, show.settings.targetSeconds), [room.rows, show.settings.targetSeconds]);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const me = { id: user.id, name: user.name };
  const exportInfo = { showName: show.name, episodeTitle: episode.title, airDate: formatDate(episode.airDate), airTime: episode.airTime, defaultCamera: show.settings.defaultCamera };

  const archive = async () => {
    if (!confirm('Archive this episode? It becomes read-only but stays searchable. Only the admin can un-archive it.')) return;
    try {
      await api(`/episodes/${episode.id}/archive`, { method: 'POST' });
      reload();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const unarchive = async () => {
    try {
      await api(`/episodes/${episode.id}/unarchive`, { method: 'POST' });
      reload();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const over = timing.overUnderSeconds;
  return (
    <div className="page wide">
      <p className="crumbs">
        <Link to="/">Shows</Link> › <Link to={`/shows/${show.id}`}>{show.name}</Link> ›
      </p>
      <div className="episode-head">
        {editing ? (
          <EpisodeDetailsForm episode={episode} onDone={() => { setEditing(false); reload(); }} />
        ) : (
          <div>
            <h1>
              {episode.title} {readOnly && <span className="badge">Archived · read-only</span>}
            </h1>
            <p className="muted">
              {[formatDate(episode.airDate), formatTime(episode.airTime)].filter(Boolean).join(' at ') || 'No air date set'}
              {!readOnly && (
                <button className="link-button" onClick={() => setEditing(true)}>
                  Edit title, date and time
                </button>
              )}
            </p>
          </div>
        )}
        <div className="episode-actions">
          <ConnectionBadge status={room.status} synced={room.synced} />
          <PresenceList others={room.others} />
          <button onClick={() => exportCsv(timing, exportInfo)}>Export CSV</button>
          <button onClick={() => exportPdf(timing, exportInfo)}>Export PDF</button>
          {!readOnly && <button onClick={archive}>Archive</button>}
          {readOnly && user.isAdmin && <button onClick={unarchive}>Un-archive</button>}
        </div>
      </div>
      {message && <p className="error">{message}</p>}

      <div className="timing-bar" aria-live="polite">
        <span>
          Total <strong>{formatDuration(timing.totalSeconds)}</strong>
        </span>
        <span>
          Target <strong>{formatDuration(timing.targetSeconds)}</strong>
        </span>
        <span className={Math.abs(over) < 1 ? 'ok' : over > 0 ? 'over' : 'under'}>
          <strong>{formatOverUnder(over)}</strong>
        </span>
        <span className="muted">
          {Object.entries(timing.blockSeconds)
            .map(([letter, s]) => `${letter} ${formatDuration(s)}`)
            .join(' · ')}
        </span>
      </div>

      {!room.synced || !room.doc ? (
        <p className="muted">Loading the rundown…</p>
      ) : (
        <RundownGrid doc={room.doc} timing={timing} settings={show.settings} airTime={episode.airTime} me={me} readOnly={readOnly} others={room.others} setFocus={room.setFocus} />
      )}
    </div>
  );
}

function ConnectionBadge({ status, synced }: { status: string; synced: boolean }) {
  if (status === 'connected' && synced) return <span className="status live" title="Changes save and appear for everyone automatically">● Live</span>;
  if (status === 'connecting') return <span className="status waiting">● Connecting…</span>;
  return <span className="status offline" title="Your changes will sync when the connection returns">● Offline, reconnecting…</span>;
}

function PresenceList({ others }: { others: { clientId: number; name: string; color: string }[] }) {
  if (others.length === 0) return null;
  const names = [...new Map(others.map((o) => [o.name, o])).values()];
  return (
    <span className="presence" title={`Also here: ${names.map((o) => o.name).join(', ')}`}>
      {names.slice(0, 5).map((o) => (
        <span key={o.clientId} className="avatar" style={{ background: o.color }}>
          {o.name
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </span>
      ))}
    </span>
  );
}

function EpisodeDetailsForm({ episode, onDone }: { episode: EpisodeListItem; onDone: () => void }) {
  const [title, setTitle] = useState(episode.title);
  const [airDate, setAirDate] = useState(episode.airDate);
  const [airTime, setAirTime] = useState(episode.airTime);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api(`/episodes/${episode.id}`, { method: 'PATCH', body: { title, airDate, airTime } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="inline-form">
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </label>
      <label>
        Air date
        <input type="date" value={airDate} onChange={(e) => setAirDate(e.target.value)} />
      </label>
      <label>
        Start time
        <input type="time" value={airTime} onChange={(e) => setAirTime(e.target.value)} />
      </label>
      <button className="primary" onClick={save}>
        Save
      </button>
      <button onClick={onDone}>Cancel</button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
