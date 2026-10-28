import { useState, type FormEvent } from 'react';
import { formatDuration, type ShowSettings } from '@tstv/shared';
import { api, useLoad } from '../lib/api.ts';
import { Link, navigate } from '../lib/router.tsx';
import { formatDate } from '../lib/format.ts';

interface ShowListItem {
  id: string;
  name: string;
  settings: ShowSettings;
  activeEpisodes: number;
  latestAirDate: string | null;
}

export function ShowsPage() {
  const { data, error } = useLoad<{ shows: ShowListItem[] }>('/shows');
  const [name, setName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const addShow = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const { id } = await api<{ id: string }>('/shows', { body: { name } });
      navigate(`/shows/${id}`);
    } catch (e) {
      setAddError((e as Error).message);
    }
  };

  return (
    <div className="page">
      <h1>Shows</h1>
      {error && <p className="error">{error}</p>}
      {data && data.shows.length === 0 && <p className="muted">No shows yet. Add the first one below.</p>}
      <ul className="cards">
        {data?.shows.map((show) => (
          <li key={show.id}>
            <Link to={`/shows/${show.id}`} className="card-link">
              <strong>{show.name}</strong>
              <span className="muted">
                {show.activeEpisodes} active episode{show.activeEpisodes === 1 ? '' : 's'} · {formatDuration(show.settings.targetSeconds)} shows
                {show.latestAirDate ? ` · latest ${formatDate(show.latestAirDate)}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <form className="inline-form" onSubmit={addShow}>
        <label>
          Add a show
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Show name, e.g. TSTV News PrimeTime" required maxLength={100} />
        </label>
        <button className="primary" type="submit">
          Add show
        </button>
        {addError && <span className="error">{addError}</span>}
      </form>
    </div>
  );
}
