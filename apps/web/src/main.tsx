import { StrictMode, useEffect, useState } from 'react';
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
import { WelcomePage } from './pages/Welcome.tsx';
import { applyStoredTheme, useTheme } from './lib/theme.ts';
import './styles.css';

applyStoredTheme();

function App() {
  const path = usePath();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  const loadMe = () =>
    api<{ user: User }>('/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  useEffect(() => {
    loadMe();
    const signedOut = () => setUser(null);
    window.addEventListener('tstv:signed-out', signedOut);
    return () => window.removeEventListener('tstv:signed-out', signedOut);
  }, []);

  // The privacy page is public: Google's sign-in setup links to it.
  if (path === '/privacy') return <main><PrivacyPage /></main>;
  if (user === undefined) return <div className="page-loading">Loading…</div>;
  if (user === null || path === '/signin') return <SignInPage />;
  if (user.needsName) return <WelcomePage email={user.email} onDone={loadMe} />;

  const signOut = async () => {
    await api('/auth/signout', { method: 'POST' });
    location.href = '/signin';
  };

  let page;
  let m: RegExpMatchArray | null;
  if (path === '/' || path === '/shows') page = <ShowsPage />;
  else if ((m = path.match(/^\/shows\/([\w-]+)$/))) page = <ShowPage showId={m[1]} user={user} />;
  // A section's script opens in a window over its episode's rundown.
  else if ((m = path.match(/^\/episodes\/([\w-]+)(?:\/sections\/([\w-]+))?$/))) page = <EpisodePage episodeId={m[1]} sectionId={m[2]} user={user} />;
  else if (path === '/search') page = <SearchPage />;
  else if (path === '/people' && user.isAdmin) page = <PeoplePage me={user} />;
  else if (path === '/usage' && user.isAdmin) page = <UsagePage />;
  else page = <div className="empty">That page doesn’t exist. <Link to="/">Go to Shows</Link></div>;

  return (
    <>
      <header className="topbar">
        <div className="topbar-start">
          <ThemeSwitch />
          {user.isAdmin && (
            <Link to="/usage" className={`icon-link${path === '/usage' ? ' active' : ''}`} aria-label="Usage" title="Usage: today’s use of Cloudflare’s free plan">
              ⓘ
            </Link>
          )}
          <Link to="/" className="brand">
            <span className="brand-mark">TSTV</span> Rundowns
          </Link>
        </div>
        <nav>
          <Link to="/" className={path === '/' || path.startsWith('/shows') ? 'active' : ''}>Shows</Link>
          {user.isAdmin && <Link to="/people" className={path === '/people' ? 'active' : ''}>People</Link>}
          <Link to="/search" className={path === '/search' ? 'active' : ''}>Search</Link>
        </nav>
        <div className="me">
          <span title={user.email}>
            {user.name} <span className="role">({user.isAdmin ? 'Admin' : 'Contributor'})</span>
          </span>
          <button className="link-button" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main>{page}</main>
    </>
  );
}

/** Switches the whole website between light and dark mode. */
function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  const dark = theme === 'dark';
  return (
    <button className="theme-switch" role="switch" aria-checked={dark} aria-label="Dark mode" title={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      <span className="theme-track">
        <span className="theme-thumb">{dark ? '☾' : '☀'}</span>
      </span>
    </button>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
