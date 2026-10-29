import { useEffect, useState, type FormEvent } from 'react';
import { formatDuration, parseDuration, TALENT_COLORS, type ShowSettings, type Talent } from '@tstv/shared';
import { api, useLoad } from '../lib/api.ts';
import { Link, navigate } from '../lib/router.tsx';
import { formatDate, formatTime, timeAgo } from '../lib/format.ts';

export interface EpisodeListItem {
  id: string;
  title: string;
  airDate: string;
  airTime: string;
  status: 'active' | 'archived';
  summary: { sections: number; estSeconds: number } | null;
  updatedAt: number;
  createdByName: string | null;
  createdById: string | null;
  publishedAt: number | null;
}

interface ShowData {
  show: { id: string; name: string; settings: ShowSettings };
  episodes: EpisodeListItem[];
}

export function ShowPage({ showId }: { showId: string }) {
  const { data, error, reload } = useLoad<ShowData>(`/shows/${showId}`);
  const [tab, setTab] = useState<'episodes' | 'settings'>('episodes');
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page muted">Loading…</div>;
  const active = data.episodes.filter((e) => e.status === 'active');
  const archived = data.episodes.filter((e) => e.status === 'archived');

  return (
    <div className="page">
      <p className="crumbs">
        <Link to="/">Shows</Link> ›
      </p>
      <h1>{data.show.name}</h1>
      <div className="tabs">
        <button className={tab === 'episodes' ? 'active' : ''} onClick={() => setTab('episodes')}>
          Episodes
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          Show settings
        </button>
      </div>
      {tab === 'episodes' ? (
        <>
          <NewEpisodeForm showId={showId} />
          <EpisodeList episodes={active} target={data.show.settings.targetSeconds} empty="No episodes yet. Add one above." />
          {archived.length > 0 && (
            <>
              <h2>Archived</h2>
              <EpisodeList episodes={archived} target={data.show.settings.targetSeconds} empty="" />
            </>
          )}
        </>
      ) : (
        <ShowSettingsForm showId={showId} name={data.show.name} settings={data.show.settings} onSaved={reload} />
      )}
    </div>
  );
}

function EpisodeList({ episodes, target, empty }: { episodes: EpisodeListItem[]; target: number; empty: string }) {
  if (episodes.length === 0) return empty ? <p className="muted">{empty}</p> : null;
  return (
    <ul className="cards">
      {episodes.map((e) => (
        <li key={e.id}>
          <Link to={`/episodes/${e.id}`} className="card-link">
            <strong>
              {e.title} {e.status === 'archived' && <span className="badge">Archived</span>}
              {!e.publishedAt && <span className="badge draft">Draft</span>}
            </strong>
            <span className="muted">
              {[formatDate(e.airDate), formatTime(e.airTime)].filter(Boolean).join(' at ') || 'No air date'}
              {e.summary ? ` · ${e.summary.sections} sections · ${formatDuration(e.summary.estSeconds)} of ${formatDuration(target)}` : ''}
              {e.updatedAt ? ` · edited ${timeAgo(e.updatedAt)}` : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NewEpisodeForm({ showId }: { showId: string }) {
  const [title, setTitle] = useState('');
  const [airDate, setAirDate] = useState('');
  const [airTime, setAirTime] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const { id } = await api<{ id: string }>(`/shows/${showId}/episodes`, { body: { title, airDate, airTime } });
      navigate(`/episodes/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <form className="inline-form" onSubmit={create}>
      <label>
        New episode
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Oct 30 PrimeTime" required maxLength={120} />
      </label>
      <label>
        Air date
        <input type="date" value={airDate} onChange={(e) => setAirDate(e.target.value)} />
      </label>
      <label>
        Start time
        <input type="time" value={airTime} onChange={(e) => setAirTime(e.target.value)} />
      </label>
      <button className="primary" type="submit">
        Create episode
      </button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

function ShowSettingsForm({ showId, name, settings, onSaved }: { showId: string; name: string; settings: ShowSettings; onSaved: () => void }) {
  const [draftName, setDraftName] = useState(name);
  const [draft, setDraft] = useState(settings);
  const [target, setTarget] = useState(formatDuration(settings.targetSeconds));
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    setDraft(settings);
    setTarget(formatDuration(settings.targetSeconds));
  }, [settings]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const targetSeconds = parseDuration(target);
    if (!targetSeconds) {
      setMessage({ text: 'Type the target length like 30:00.', error: true });
      return;
    }
    try {
      await api(`/shows/${showId}`, { method: 'PATCH', body: { name: draftName, settings: { ...draft, targetSeconds } } });
      setMessage({ text: 'Saved.' });
      onSaved();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  };

  return (
    <form className="settings" onSubmit={save}>
      <label>
        Show name
        <input value={draftName} onChange={(e) => setDraftName(e.target.value)} required maxLength={100} />
      </label>
      <div className="row">
        <label>
          Target length
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="30:00" />
        </label>
        <label>
          Reading speed (words per minute)
          <input type="number" min={60} max={400} value={draft.wordsPerMinute} onChange={(e) => setDraft({ ...draft, wordsPerMinute: Number(e.target.value) })} />
        </label>
      </div>
      <ListEditor label="Cameras" hint="Names producers pick in the rundown, e.g. Anchor Camera." items={draft.cameras} onChange={(cameras) => setDraft({ ...draft, cameras })} />
      <label>
        Default camera
        <select value={draft.defaultCamera} onChange={(e) => setDraft({ ...draft, defaultCamera: e.target.value })}>
          {draft.cameras.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <TalentEditor talent={draft.talent} onChange={(talent) => setDraft({ ...draft, talent })} />
      <ListEditor label="Segment types" hint="Choices for the rundown's Type column." items={draft.segmentTypes} onChange={(segmentTypes) => setDraft({ ...draft, segmentTypes })} />
      <ListEditor
        label="Permanent graphics"
        hint="Graphics used in every episode, like the Station ID and Show Intro. They're loaded on the TriCaster before every show, and the rundown's Graphics column can pick them."
        items={draft.permanentGraphics}
        onChange={(permanentGraphics) => setDraft({ ...draft, permanentGraphics })}
      />
      <div className="row">
        <button className="primary" type="submit">
          Save settings
        </button>
        {message && <span className={message.error ? 'error' : 'ok'}>{message.text}</span>}
      </div>
    </form>
  );
}

function ListEditor({ label, hint, items, onChange }: { label: string; hint: string; items: string[]; onChange: (items: string[]) => void }) {
  const [next, setNext] = useState('');
  const add = () => {
    const value = next.trim();
    if (value && !items.includes(value)) onChange([...items, value]);
    setNext('');
  };
  return (
    <fieldset>
      <legend>{label}</legend>
      <p className="muted small">{hint}</p>
      <div className="chips">
        {items.map((item) => (
          <span key={item} className="chip">
            {item}
            <button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((i) => i !== item))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="row">
        <input
          value={next}
          onChange={(e) => setNext(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={`Add to ${label.toLowerCase()}`}
        />
        <button type="button" onClick={add}>
          Add
        </button>
      </div>
    </fieldset>
  );
}

function TalentEditor({ talent, onChange }: { talent: Talent[]; onChange: (talent: Talent[]) => void }) {
  const [next, setNext] = useState('');
  const add = () => {
    const name = next.trim();
    if (name && !talent.some((t) => t.name === name)) onChange([...talent, { name, color: TALENT_COLORS[talent.length % TALENT_COLORS.length] }]);
    setNext('');
  };
  return (
    <fieldset>
      <legend>Usual talent</legend>
      <p className="muted small">Anchors and correspondents. Their color marks their sections in the rundown and on the prompter.</p>
      <div className="chips">
        {talent.map((t, i) => (
          <span key={t.name} className="chip">
            <input
              type="color"
              value={t.color}
              aria-label={`Color for ${t.name}`}
              onChange={(e) => onChange(talent.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}
            />
            {t.name}
            <button type="button" aria-label={`Remove ${t.name}`} onClick={() => onChange(talent.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="row">
        <input
          value={next}
          onChange={(e) => setNext(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a name"
        />
        <button type="button" onClick={add}>
          Add
        </button>
      </div>
    </fieldset>
  );
}
