// The first time someone signs in, they type their first and last name, so everyone can tell who they
// are even when their Gmail account's name isn't their real one (RG, Oct 29, 2026).
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api.ts';

export function WelcomePage({ email, onDone }: { email: string; onDone: () => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api('/me/name', { body: { firstName, lastName } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="signin">
      <form className="signin-card welcome" onSubmit={save}>
        <div className="brand-mark big">TSTV</div>
        <h1>Welcome</h1>
        <p className="muted">Type your name, so everyone you work with knows who you are. You’re signed in as {email}.</p>
        <label>
          First name
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={60} autoFocus autoComplete="given-name" />
        </label>
        <label>
          Last name
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={60} autoComplete="family-name" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">
          Continue
        </button>
      </form>
    </div>
  );
}
