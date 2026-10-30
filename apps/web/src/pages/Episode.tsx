import { lazy, Suspense, useMemo, useState } from 'react';
import { breakGraphic, clipSecondsBySection, computeRundown, cueLabel, formatDuration, isCameraCueId, formatOverUnder, sectionSecondsFrom, talentColors, type Broadcast, type RundownTiming, type ShowSettings } from '@tstv/shared';
import { TalentPanel } from '../rundown/TalentPanel.tsx';
import { api, useLoad, type User } from '../lib/api.ts';
import { Link, navigate } from '../lib/router.tsx';
import { formatDate, formatTime } from '../lib/format.ts';
import { RundownGrid } from '../rundown/RundownGrid.tsx';
import { useEpisodeDoc, type CueEvent, type Presence } from '../rundown/useEpisodeDoc.ts';
import { exportCsv, exportPdf } from '../rundown/export.ts';
import { ConnectionBadge, PresenceList } from '../components/RoomStatus.tsx';
import { Popover } from '../components/Popover.tsx';
import type { EpisodeListItem } from './Show.tsx';

// The script editor is large, so it loads only when someone opens a script.
const ScriptWindow = lazy(() => import('./Script.tsx').then((m) => ({ default: m.ScriptWindow })));

interface EpisodeData {
  episode: EpisodeListItem & { showId: string };
  show: { id: string; name: string; settings: ShowSettings };
}

/** The episode's rundown. With a section id, that section's script is open in a window over it. */
export function EpisodePage({ episodeId, sectionId, user }: { episodeId: string; sectionId?: string; user: User }) {
  const { data, error, reload } = useLoad<EpisodeData>(`/episodes/${episodeId}`);
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page muted">Loading…</div>;
  return <EpisodeView data={data} sectionId={sectionId} user={user} reload={reload} />;
}

function EpisodeView({ data, sectionId, user, reload }: { data: EpisodeData; sectionId?: string; user: User; reload: () => void }) {
  const { episode, show } = data;
  const readOnly = episode.status === 'archived';
  const room = useEpisodeDoc(episode.id, user, reload);
  const timing = useMemo(
    () => computeRundown(room.rows, show.settings.targetSeconds, sectionSecondsFrom(room.scriptWords, clipSecondsBySection(room.rows, room.media)), show.settings.breakSeconds),
    [room.rows, room.scriptWords, room.media, show.settings.targetSeconds, show.settings.breakSeconds],
  );
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const me = { id: user.id, name: user.name };
  // This episode's anchors and correspondents color their sections, ahead of the show's usual talent.
  const settings = useMemo(() => ({ ...show.settings, talent: talentColors(room.talent, show.settings.talent) }), [show.settings, room.talent]);
  const names = (role: string) => room.talent.filter((t) => t.role === role).map((t) => t.name);
  const exportInfo = {
    showName: show.name,
    episodeTitle: episode.title,
    airDate: formatDate(episode.airDate),
    airTime: episode.airTime,
    defaultCamera: show.settings.defaultCamera,
    breakGraphic: breakGraphic(show.settings),
    anchors: names('anchor'),
    correspondents: names('correspondent'),
  };

  const canPublish = episode.createdById === user.id || user.isAdmin;
  const publish = async (on: boolean) => {
    if (on && !confirm('Publish this rundown? Everyone who can sign in will be able to see it and write its scripts.')) return;
    if (!on && !confirm('Unpublish this rundown? Only you and admins will see it until it’s published again.')) return;
    try {
      await api(`/episodes/${episode.id}/${on ? 'publish' : 'unpublish'}`, { method: 'POST' });
      reload();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const archive = async () => {
    if (!confirm('Archive this episode? It becomes read-only but stays searchable. Only the admin can un-archive it.')) return;
    try {
      await api(`/episodes/${episode.id}/archive`, { method: 'POST' });
      reload();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete “${episode.title}” for good? Its rundown and scripts are erased and can’t be brought back.`)) return;
    try {
      await api(`/episodes/${episode.id}`, { method: 'DELETE' });
      navigate(`/shows/${show.id}`);
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
              {episode.publishedAt ? (
                <span className="badge published">Published</span>
              ) : (
                <span className="badge draft" title="Only the producer who created it and admins can see a draft">
                  Draft · not visible to everyone yet
                </span>
              )}
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
          {!episode.publishedAt && canPublish && !readOnly && (
            <button className="primary" onClick={() => publish(true)}>
              Publish rundown
            </button>
          )}
          {episode.publishedAt && canPublish && !readOnly && (
            <button className="link-button" onClick={() => publish(false)}>
              Unpublish
            </button>
          )}
          <PresenceList others={room.others} />
          <button onClick={() => window.open(`/prompter/${episode.id}`, '_blank')} title="Opens the prompter in a new window, for the prompter computer">
            Open prompter
          </button>
          {(canPublish || user.isAdmin) && <AppKeyButton episodeId={episode.id} />}
          {canPublish && !readOnly && <LiveButton episodeId={episode.id} live={room.broadcast.live} onError={setMessage} />}
          {!canPublish && room.broadcast.live && <span className="badge live">● Live</span>}
          <button onClick={() => exportCsv(timing, exportInfo)}>Export CSV</button>
          <button onClick={() => exportPdf(timing, exportInfo)}>Export PDF</button>
          {!readOnly && <button onClick={archive}>Archive</button>}
          {readOnly && user.isAdmin && <button onClick={unarchive}>Un-archive</button>}
          {user.isAdmin && (
            <button className="danger" onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </div>
      {message && <p className="error">{message}</p>}

      <PrompterBar others={room.others} lastCue={room.lastCue} timing={timing} live={room.broadcast} />

      {room.synced && room.doc && <TalentPanel doc={room.doc} talent={room.talent} colors={settings.talent} readOnly={readOnly} />}

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
        <RundownGrid episodeId={episode.id} doc={room.doc} timing={timing} settings={settings} talent={room.talent} cued={room.cued} media={room.media} airTime={episode.airTime} me={me} readOnly={readOnly} isAdmin={user.isAdmin} others={room.others} setFocus={room.setFocus} />
      )}

      {sectionId && (
        <Suspense fallback={null}>
          <ScriptWindow
            key={sectionId}
            episode={episode}
            show={show}
            room={room}
            timing={timing}
            sectionId={sectionId}
            user={user}
            onClose={() => navigate(`/episodes/${episode.id}`, { keepScroll: true })}
          />
        </Suspense>
      )}
    </div>
  );
}

/**
 * Start live broadcast (RG, Oct 29, 2026): pressed when the show goes on air. From then until End live
 * broadcast, the show app's automation follows the prompter.
 */
function LiveButton({ episodeId, live, onError }: { episodeId: string; live: boolean; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    const question = live
      ? 'End the live broadcast? The show app stops following the prompter.'
      : 'Start the live broadcast? The show app’s automation will follow the prompter from now on.';
    if (!confirm(question)) return;
    setBusy(true);
    try {
      await api(`/episodes/${episodeId}/live`, { body: { live: !live } });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={live ? 'live-on' : 'go-live'} disabled={busy} onClick={toggle}>
      {live ? '● Live · End live broadcast' : 'Start live broadcast'}
    </button>
  );
}

/**
 * The episode's key for the show app (Phase 4): copy it into the app to connect the app to this episode.
 * Making a new key cuts off any app still using the old one.
 */
function AppKeyButton({ episodeId }: { episodeId: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = async (renew = false) => {
    try {
      const data = await api<{ key: string }>(`/episodes/${episodeId}/app-key`, renew ? { method: 'POST' } : undefined);
      setKey(data.key);
      setNote(renew ? 'New key made. Any show app using the old one is disconnected.' : null);
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  return (
    <>
      <button
        onClick={(e) => {
          setAnchor(anchor ? null : e.currentTarget);
          if (!key) void load();
        }}
        aria-expanded={Boolean(anchor)}
      >
        Show app key
      </button>
      {anchor && (
        <Popover anchor={anchor} align="right" onClose={() => setAnchor(null)}>
          <div className="app-key" role="dialog" aria-label="Show app key">
            <p className="small">Paste this key into the show app to connect it to this episode. Keep it to the crew: anyone with it can follow the episode.</p>
            <code aria-label="Key">{key ?? 'Loading…'}</code>
            <div className="buttons">
              <button
                className="primary"
                disabled={!key}
                onClick={async () => {
                  await navigator.clipboard.writeText(key ?? '');
                  setNote('Copied.');
                }}
              >
                Copy
              </button>
              <button onClick={() => confirm('Make a new key? Any show app using the old one will be disconnected.') && void load(true)}>Make a new key</button>
            </div>
            {note && <p className="small muted">{note}</p>}
          </div>
        </Popover>
      )}
    </>
  );
}

/** Where the prompter is and the last cue it fired, and whether the show app is connected. */
function PrompterBar({ others, lastCue, timing, live }: { others: Presence[]; lastCue: CueEvent | null; timing: RundownTiming; live: Broadcast }) {
  const prompter = others.find((o) => o.prompter)?.prompter;
  const app = others.find((o) => o.app)?.app;
  if (!prompter && !lastCue && !app && !live.live) return null;
  const section = (id: string) => timing.rows.find((c) => c.row.id === id);
  const cue = (() => {
    if (!lastCue) return '';
    const c = section(lastCue.sectionId);
    if (lastCue.kind === 'section') return `${c?.label ?? 'A section'} started`;
    const element = c?.row.kind === 'section' ? c.row.elements.find((e) => e.id === lastCue.elementId) : undefined;
    const name = element ? cueLabel(element) : lastCue.elementId && isCameraCueId(lastCue.elementId) ? 'Camera cue' : 'A cue';
    return `${name}${c ? ` (${c.label})` : ''}`;
  })();
  return (
    <div className="prompter-bar" role="status" aria-label="Prompter">
      {live.live && (
        <span className="badge live" title={live.by ? `Started by ${live.by.name}` : undefined}>
          ● Live since {new Date(live.startedAt ?? Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
      )}
      <strong>Prompter</strong>
      {prompter ? (
        <span>
          {prompter.label ? `on ${prompter.label}` : 'at the top'} · {prompter.paused ? 'paused' : prompter.speed === 0 ? 'stopped' : prompter.speed > 0 ? `speed ${prompter.speed}` : `backwards ${-prompter.speed}`}
        </span>
      ) : (
        <span className="muted">not open</span>
      )}
      {app && (
        <span>
          <strong>Show app</strong> {app.mode === 'live' ? 'LIVE on the TC1' : 'on the simulator'}
          {!app.switcherConnected && ' · switcher not connected'}
          {app.paused && ' · automation paused'}
        </span>
      )}
      {lastCue && (
        <span>
          Last cue: <strong>{cue}</strong> <span className="muted small">{new Date(lastCue.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
        </span>
      )}
    </div>
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
