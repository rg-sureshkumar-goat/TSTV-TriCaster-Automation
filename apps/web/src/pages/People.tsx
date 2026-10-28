import { useState, type FormEvent } from 'react';
import { api, useLoad, type User } from '../lib/api.ts';
import { timeAgo } from '../lib/format.ts';

interface PeopleData {
  users: { id: string; email: string; name: string; isAdmin: boolean; lastSeenAt: number | null }[];
  invites: { email: string; createdAt: number }[];
}

export function PeoplePage({ me }: { me: User }) {
  const { data, error, reload } = useLoad<PeopleData>('/admin/people');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      setMessage(success ? { text: success } : null);
      reload();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  };

  const invite = (event: FormEvent) => {
    event.preventDefault();
    run(async () => {
      await api('/admin/invites', { body: { email } });
      setEmail('');
    }, `Invited ${email}. They can now sign in with the Google account for that email.`);
  };

  return (
    <div className="page">
      <h1>People</h1>
      <p className="muted">Only people listed here can sign in. Invite someone with the email of their Google account (a personal Gmail works).</p>
      <form className="inline-form" onSubmit={invite}>
        <label>
          Invite by email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" required />
        </label>
        <button className="primary" type="submit">
          Invite
        </button>
      </form>
      {message && <p className={message.error ? 'error' : 'ok'}>{message.text}</p>}
      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <h2>Can sign in</h2>
          <table className="simple">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Last seen</th>
                <th>Admin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td className="muted">{u.lastSeenAt ? timeAgo(u.lastSeenAt) : 'never'}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.isAdmin}
                      disabled={u.id === me.id}
                      aria-label={`${u.name} is an admin`}
                      onChange={(e) => run(() => api(`/admin/users/${u.id}/admin`, { body: { isAdmin: e.target.checked } }))}
                    />
                  </td>
                  <td>
                    {u.id !== me.id && (
                      <button
                        className="link-button danger"
                        onClick={() => confirm(`Remove ${u.name}? They won't be able to sign in. Their name stays on anything they wrote.`) && run(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }))}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Invited, not signed in yet</h2>
          {data.invites.length === 0 ? (
            <p className="muted">No pending invites.</p>
          ) : (
            <table className="simple">
              <tbody>
                {data.invites.map((i) => (
                  <tr key={i.email}>
                    <td>{i.email}</td>
                    <td className="muted">invited {timeAgo(i.createdAt)}</td>
                    <td>
                      <button className="link-button danger" onClick={() => run(() => api(`/admin/invites/${encodeURIComponent(i.email)}`, { method: 'DELETE' }))}>
                        Cancel invite
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
