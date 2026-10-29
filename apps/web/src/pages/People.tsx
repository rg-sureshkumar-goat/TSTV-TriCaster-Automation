// The admin's People page: who can sign in, and who's invited. Admins can do everything; contributors
// can build rundowns and write scripts (decided Oct 29, 2026). Click a person to change their access.
import { Fragment, useState, type FormEvent } from 'react';
import { api, useLoad, type User } from '../lib/api.ts';
import { timeAgo } from '../lib/format.ts';

interface Person {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  lastSeenAt: number | null;
}

interface PeopleData {
  users: Person[];
  invites: { email: string; asAdmin: boolean; createdAt: number }[];
}

const role = (isAdmin: boolean) => (isAdmin ? 'Admin' : 'Contributor');

export function PeoplePage({ me }: { me: User }) {
  const { data, error, reload } = useLoad<PeopleData>('/admin/people');
  const [email, setEmail] = useState('');
  const [asAdmin, setAsAdmin] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
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
    run(
      async () => {
        await api('/admin/invites', { body: { email, asAdmin } });
        setEmail('');
        setAsAdmin(false);
      },
      `Invited ${email} with ${asAdmin ? 'an admin' : 'a contributor'} account. They can now sign in with the Google account for that email.`,
    );
  };

  const setAdmin = (person: Person, isAdmin: boolean) =>
    run(() => api(`/admin/users/${person.id}/admin`, { body: { isAdmin } }), `${person.name} now has ${isAdmin ? 'an admin' : 'a contributor'} account.`);

  return (
    <div className="page">
      <h1>People</h1>
      <p className="muted">
        Only people listed here can sign in. Invite someone with the email of their Google account (a personal Gmail works). Admins can do
        everything; contributors can build rundowns and write scripts.
      </p>
      <form className="inline-form" onSubmit={invite}>
        <label>
          Invite by email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" required />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={asAdmin} onChange={(e) => setAsAdmin(e.target.checked)} />
          Give Admin Access
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
          <table className="simple people">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Account</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <Fragment key={u.id}>
                  <tr className={open === u.id ? 'open' : ''}>
                    <td>
                      <button className="link-button person-name" aria-expanded={open === u.id} onClick={() => setOpen(open === u.id ? null : u.id)}>
                        {u.name}
                      </button>
                      {u.id === me.id && <span className="muted small"> (you)</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>{role(u.isAdmin)}</td>
                    <td className="muted">{u.lastSeenAt ? timeAgo(u.lastSeenAt) : 'never'}</td>
                  </tr>
                  {open === u.id && (
                    <tr className="person-panel">
                      <td colSpan={4}>
                        <div className="buttons">
                          {!u.isAdmin && (
                            <button className="primary" onClick={() => setAdmin(u, true)}>
                              Give Admin Access
                            </button>
                          )}
                          {u.isAdmin && u.id !== me.id && (
                            <button onClick={() => confirm(`Make ${u.name} a contributor? They'll lose admin access.`) && setAdmin(u, false)}>Remove Admin Access</button>
                          )}
                          {u.id !== me.id && (
                            <button
                              className="danger"
                              onClick={() =>
                                confirm(`Remove ${u.name}? They won't be able to sign in. Their name stays on anything they wrote.`) &&
                                run(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }))
                              }
                            >
                              Remove from the website
                            </button>
                          )}
                          {u.id === me.id && <span className="muted small">This is you. Another admin can change your account.</span>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
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
                    <td>{role(i.asAdmin)}</td>
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
