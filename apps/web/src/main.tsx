import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, type User } from './lib/api.ts';
import { Link, usePath } from './lib/router.tsx';
import { SignInPage } from './pages/SignIn.tsx';
import { ShowsPage } from './pages/Shows.tsx';
import { ShowPage } from './pages/Show.tsx';
import { EpisodePage } from './pages/Episode.tsx';
import { SearchPage } from './pages/Search.tsx';
import { PeoplePage } from './pages/People.tsx';
import { UsagePage } from './pages/Usage.tsx';
import { PrivacyPage } from './pages/Privacy.tsx';
import './styles.css';

// The script editor is large, so it loads only when someone opens a script.
const ScriptPage = lazy(() => import('./pages/Script.tsx').then((m) => ({ default: m.ScriptPage })));

function App() {
  const path = usePath();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api<{ user: User }>('/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
    const signedOut = () => setUser(null);
    window.addEventListener('tstv:signed-out', signedOut);
    return () => window.removeEventListener('tstv:signed-out', signedOut);
  }, []);

  // The privacy page is public: Google's sign-in setup links to it.
  if (path === '/privacy') return <main><PrivacyPage /></main>;
  if (user === undefined) return <div className="page-loading">Loading…</div>;
  if (user === null || path === '/signin') return <SignInPage />;

  const signOut = async () => {
    await api('/auth/signout', { method: 'POST' });
    location.href = '/signin';
  };

  let page;
  let m: RegExpMatchArray | null;
  if (path === '/' || path === '/shows') page = <ShowsPage />;
  else if ((m = path.match(/^\/shows\/([\w-]+)$/))) page = <ShowPage showId={m[1]} />;
  else if ((m = path.match(/^\/episodes\/([\w-]+)$/))) page = <EpisodePage episodeId={m[1]} user={user} />;
  else if ((m = path.match(/^\/episodes\/([\w-]+)\/sections\/([\w-]+)$/))) page = (
      <Suspense fallback={<div className="page muted">Loading…</div>}>
        <ScriptPage key={m[2]} episodeId={m[1]} sectionId={m[2]} user={user} />
      </Suspense>
    );
  else if (path === '/search') page = <SearchPage />;
  else if (path === '/people' && user.isAdmin) page = <PeoplePage me={user} />;
  else if (path === '/usage' && user.isAdmin) page = <UsagePage />;
  else page = <div className="empty">That page doesn’t exist. <Link to="/">Go to Shows</Link></div>;

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">TSTV</span> Rundowns
        </Link>
        <nav>
          <Link to="/" className={path === '/' || path.startsWith('/shows') ? 'active' : ''}>Shows</Link>
          <Link to="/search" className={path === '/search' ? 'active' : ''}>Search</Link>
          {user.isAdmin && <Link to="/people" className={path === '/people' ? 'active' : ''}>People</Link>}
          {user.isAdmin && <Link to="/usage" className={path === '/usage' ? 'active' : ''}>Usage</Link>}
        </nav>
        <div className="me">
          <span title={user.email}>{user.name}</span>
          <button className="link-button" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main>{page}</main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
