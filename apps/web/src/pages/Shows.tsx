import { useState, type FormEvent } from 'react';
import { formatDuration, type ShowSettings } from '@tstv/shared';
import { api, useLoad } from '../lib/api.ts';
import { Link, navigate } from '../lib/router.tsx';
import { formatDate } from '../lib/format.ts';
import { LogoPicker, ShowLogo } from '../components/ShowLogo.tsx';

interface ShowListItem {
  id: string;
  name: string;
  logo: string | null;
  settings: ShowSettings;
  activeEpisodes: number;
  latestAirDate: string | null;
}

type Layout = 'list' | 'cards';
const LAYOUT_KEY = 'tstv-shows-layout';

/** List or cards, remembered in this browser. */
function useLayout(): [Layout, (layout: Layout) => void] {
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) === 'cards' ? 'cards' : 'list';
    } catch {
      return 'list';
    }
  });
  const choose = (next: Layout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Private browsing: it lasts until the page closes.
    }
  };
  return [layout, choose];
}

export function ShowsPage() {
  const { data, error } = useLoad<{ shows: ShowListItem[] }>('/shows');
  const [name, setName] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [layout, setLayout] = useLayout();

  const addShow = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const { id } = await api<{ id: string }>('/shows', { body: { name, logo } });
      navigate(`/shows/${id}`);
    } catch (e) {
      setAddError((e as Error).message);
    }
  };

  const details = (show: ShowListItem) =>
    `${show.activeEpisodes} active episode${show.activeEpisodes === 1 ? '' : 's'} · ${formatDuration(show.settings.targetSeconds)} shows${show.latestAirDate ? ` · latest ${formatDate(show.latestAirDate)}` : ''}`;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Shows</h1>
        <div className="segmented" role="group" aria-label="Layout">
          <button aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>
            ☰ List
          </button>
          <button aria-pressed={layout === 'cards'} onClick={() => setLayout('cards')}>
            ▦ Cards
          </button>
        </div>
      </div>
      {/* At the top, so it's easy to reach however many shows there are. */}
      <form className="inline-form" onSubmit={addShow}>
        <label>
          Add a show
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Show name, e.g. TSTV News PrimeTime" required maxLength={100} />
        </label>
        <LogoPicker name={name} value={logo} onChange={setLogo} />
        <button className="primary" type="submit">
          Add show
        </button>
        {addError && <span className="error">{addError}</span>}
      </form>
      {error && <p className="error">{error}</p>}
      {data && data.shows.length === 0 && <p className="muted">No shows yet. Add the first one above.</p>}
      {layout === 'list' ? (
        <ul className="cards">
          {data?.shows.map((show) => (
            <li key={show.id}>
              <Link to={`/shows/${show.id}`} className="card-link with-logo">
                <ShowLogo name={show.name} logo={show.logo} size={36} />
                <span>
                  <strong>{show.name}</strong>
                  <span className="muted">{details(show)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="show-cards">
          {data?.shows.map((show) => (
            <li key={show.id}>
              <Link to={`/shows/${show.id}`} className="show-card">
                <ShowLogo name={show.name} logo={show.logo} size={72} />
                <strong>{show.name}</strong>
                <span className="muted small">{details(show)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
