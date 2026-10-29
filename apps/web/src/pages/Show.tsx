import { useEffect, useState, type FormEvent } from 'react';
import { formatDuration, parseDuration, TALENT_COLORS, type ShowSettings, type Talent } from '@tstv/shared';
import { api, useLoad, type User } from '../lib/api.ts';
import { Link, navigate } from '../lib/router.tsx';
import { formatDate, formatTime, timeAgo } from '../lib/format.ts';
import { LogoPicker, ShowLogo } from '../components/ShowLogo.tsx';

export interface EpisodeListItem {
  id: string;
  title: string;
  airDate: string;
  airTime: string;
  status: 'active' | 'archived';
  /** Content length; breaks counts the commercial breaks between blocks, timed by the show's break length. */
  summary: { sections: number; estSeconds: number; breaks?: number } | null;
  updatedAt: number;
  createdByName: string | null;
  createdById: string | null;
  publishedAt: number | null;
}

interface ShowData {
  show: { id: string; name: string; logo: string | null; settings: ShowSettings };
  episodes: EpisodeListItem[];
}

export function ShowPage({ showId, user }: { showId: string; user: User }) {
  const { data, error, reload } = useLoad<ShowData>(`/shows/${showId}`);
  const [tab, setTab] = useState<'episodes' | 'settings'>('episodes');
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page muted">Loading…</div>;
  const active = data.episodes.filter((e) => e.status === 'active');
  const archived = data.episodes.filter((e) => e.status === 'archived');
  // Admins can delete an episode for good, to save space.
  const onDelete = user.isAdmin
    ? async (episode: EpisodeListItem) => {
        if (!confirm(`Delete “${episode.title}” for good? Its rundown and scripts are erased and can’t be brought back.`)) return;
        try {
          await api(`/episodes/${episode.id}`, { method: 'DELETE' });
        } catch (e) {
          alert((e as Error).message);
        }
        reload();
      }
    : undefined;

  return (
    <div className="page">
      <p className="crumbs">
        <Link to="/">Shows</Link> ›
      </p>
      <h1 className="with-logo">
        <ShowLogo name={data.show.name} logo={data.show.logo} size={40} />
        {data.show.name}
      </h1>
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
          <EpisodeList episodes={active} settings={data.show.settings} empty="No episodes yet. Add one above." onDelete={onDelete} />
          {archived.length > 0 && (
            <>
              <h2>Archived</h2>
              <EpisodeList episodes={archived} settings={data.show.settings} empty="" onDelete={onDelete} />
            </>
          )}
        </>
      ) : (
        <ShowSettingsForm showId={showId} name={data.show.name} logo={data.show.logo} settings={data.show.settings} onSaved={reload} />
      )}
    </div>
  );
}

function EpisodeList({ episodes, settings, empty, onDelete }: { episodes: EpisodeListItem[]; settings: ShowSettings; empty: string; onDelete?: (episode: EpisodeListItem) => void }) {
  const length = (s: NonNullable<EpisodeListItem['summary']>) => s.estSeconds + (s.breaks ?? 0) * settings.breakSeconds;
  if (episodes.length === 0) return empty ? <p className="muted">{empty}</p> : null;
  return (
    <ul className="cards">
      {episodes.map((e) => (
        <li key={e.id} className={onDelete ? 'with-action' : ''}>
          <Link to={`/episodes/${e.id}`} className="card-link">
            <strong>
              {e.title} {e.status === 'archived' && <span className="badge">Archived</span>}
              {!e.publishedAt && <span className="badge draft">Draft</span>}
            </strong>
            <span className="muted">
              {[formatDate(e.airDate), formatTime(e.airTime)].filter(Boolean).join(' at ') || 'No air date'}
              {e.summary ? ` · ${e.summary.sections} sections · ${formatDuration(length(e.summary))} of ${formatDuration(settings.targetSeconds)}` : ''}
              {e.updatedAt ? ` · edited ${timeAgo(e.updatedAt)}` : ''}
            </span>
          </Link>
          {onDelete && (
            <button className="link-button danger" aria-label={`Delete ${e.title}`} onClick={() => onDelete(e)}>
              Delete
            </button>
          )}
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

function ShowSettingsForm({ showId, name, logo, settings, onSaved }: { showId: string; name: string; logo: string | null; settings: ShowSettings; onSaved: () => void }) {
  const [draftName, setDraftName] = useState(name);
  const [draftLogo, setDraftLogo] = useState(logo);
  const [draft, setDraft] = useState(settings);
  const [target, setTarget] = useState(formatDuration(settings.targetSeconds));
  const [breakLength, setBreakLength] = useState(formatDuration(settings.breakSeconds));
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    setDraft(settings);
    setTarget(formatDuration(settings.targetSeconds));
    setBreakLength(formatDuration(settings.breakSeconds));
  }, [settings]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const targetSeconds = parseDuration(target);
    if (!targetSeconds) {
      setMessage({ text: 'Type the target length like 30:00.', error: true });
      return;
    }
    const breakSeconds = parseDuration(breakLength);
    if (breakSeconds === undefined) {
      setMessage({ text: 'Type the commercial break length like 2:00, or 0:00.', error: true });
      return;
    }
    try {
      await api(`/shows/${showId}`, { method: 'PATCH', body: { name: draftName, logo: draftLogo, settings: { ...draft, targetSeconds, breakSeconds: breakSeconds ?? 0 } } });
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
      <fieldset>
        <legend>Logo</legend>
        <p className="muted small">A small picture that tells this show apart in the list of shows.</p>
        <LogoPicker name={draftName} value={draftLogo} onChange={setDraftLogo} />
      </fieldset>
      <div className="row">
        <label>
          Target length
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="30:00" />
        </label>
        <label>
          Commercial break length
          <input value={breakLength} onChange={(e) => setBreakLength(e.target.value)} placeholder="2:00" title="Each break between blocks. 0:00 leaves breaks out of the show's timing." />
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
      <ListEditor label="Story types" hint="Choices for the rundown's Story Type column." items={draft.segmentTypes} onChange={(segmentTypes) => setDraft({ ...draft, segmentTypes })} />
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
