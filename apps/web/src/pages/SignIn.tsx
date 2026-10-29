import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

interface Options {
  google: boolean;
  dev: { email: string; name: string }[] | null;
}

const ERRORS: Record<string, string> = {
  'not-invited': 'That Google account isn’t on the invite list yet. Ask the TD to invite you, then try again.',
  expired: 'Sign-in took too long. Please try again.',
  google: 'Google sign-in didn’t work. Please try again.',
  'not-configured': 'Google sign-in isn’t set up yet. Ask the TD.',
};

export function SignInPage() {
  const [options, setOptions] = useState<Options | null>(null);
  const params = new URLSearchParams(location.search);
  const error = ERRORS[params.get('error') ?? ''];
  const returnTo = location.pathname === '/signin' ? '/' : location.pathname;

  useEffect(() => {
    api<Options>('/auth/options').then(setOptions).catch(() => setOptions({ google: false, dev: null }));
  }, []);

  const devSignIn = async (email: string) => {
    await api('/auth/dev-login', { body: { email } });
    location.href = returnTo;
  };

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="brand-mark big">TSTV</div>
        <h1>TSTV Rundowns</h1>
        <p className="muted">Rundowns, scripts and the prompter for Texas Student Television.</p>
        {error && <p className="error">{error}</p>}
        {options?.google && (
          <a className="button primary google" href={`/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`}>
            Sign in with Google
          </a>
        )}
        {options && !options.google && !options.dev && <p className="muted">Sign-in isn’t set up yet.</p>}
        {options?.dev && (
          <div className="dev-signin">
            <p className="muted small">Local development only: sign in as a pretend person.</p>
            {options.dev.map((u) => (
              <button key={u.email} onClick={() => devSignIn(u.email)}>
                {u.name}
              </button>
            ))}
          </div>
        )}
        <p className="muted small">Only people the TD has invited can sign in.</p>
        <p className="muted small">
          <a href="/privacy">Privacy</a>
        </p>
      </div>
    </div>
  );
}
