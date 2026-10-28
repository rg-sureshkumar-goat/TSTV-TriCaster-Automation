import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { Link } from '../lib/router.tsx';
import { formatDate } from '../lib/format.ts';
import type { EpisodeListItem } from './Show.tsx';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<(EpisodeListItem & { showName: string })[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const timer = setTimeout(() => {
      api<{ episodes: (EpisodeListItem & { showName: string })[] }>(`/search?q=${encodeURIComponent(q)}`)
        .then((d) => {
          setResults(d.episodes);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="page">
      <h1>Search</h1>
      <p className="muted">Find episodes, including archived ones, by title, show, slug, segment type or talent.</p>
      <input className="search-box" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search, e.g. Basketball" autoFocus />
      {error && <p className="error">{error}</p>}
      {results && results.length === 0 && <p className="muted">Nothing found.</p>}
      <ul className="cards">
        {results?.map((e) => (
          <li key={e.id}>
            <Link to={`/episodes/${e.id}`} className="card-link">
              <strong>
                {e.title} {e.status === 'archived' && <span className="badge">Archived</span>}
              </strong>
              <span className="muted">
                {e.showName}
                {e.airDate ? ` · ${formatDate(e.airDate)}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
