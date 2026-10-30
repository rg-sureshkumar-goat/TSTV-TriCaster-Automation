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

/** What happened to an invite's email (RG, Oct 30, 2026): sent, not set up yet, or failed. */
type EmailResult = { sent: true } | { sent: false; reason: 'not-set-up' | 'failed'; error?: string };

function emailNote(email: string, result: EmailResult | undefined): { text: string; error?: boolean } {
  if (result?.sent) return { text: `An email with the website’s link is on its way to ${email}.` };
  if (!result || result.reason === 'not-set-up') return { text: `No email was sent (invite emails aren’t set up yet): tell them to sign in with Google or Microsoft using ${email}.` };
  return { text: `The email to ${email} didn’t go out (${result.error ?? 'unknown problem'}). The invite still works: tell them yourself, or try Resend email.`, error: true };
}

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

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await api<{ email?: EmailResult }>('/admin/invites', { body: { email, asAdmin } });
      const note = emailNote(email, result.email);
      setMessage({ text: `Invited ${email} with ${asAdmin ? 'an admin' : 'a contributor'} account. ${note.text}`, error: note.error });
      setEmail('');
      setAsAdmin(false);
      reload();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  };

  const resend = async (address: string) => {
    try {
      const result = await api<{ email?: EmailResult }>(`/admin/invites/${encodeURIComponent(address)}/resend`, { body: {} });
      setMessage(emailNote(address, result.email));
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  };

  const setAdmin = (person: Person, isAdmin: boolean) =>
    run(() => api(`/admin/users/${person.id}/admin`, { body: { isAdmin } }), `${person.name} now has ${isAdmin ? 'an admin' : 'a contributor'} account.`);

  return (
    <div className="page">
      <h1>People</h1>
      <p className="muted">
        Only people listed here can sign in. Invite someone with the email of their Google or Microsoft account (a personal Gmail, or a UT account at name@utexas.edu or eid@eid.utexas.edu); they get an email with the website’s link. Admins can do
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
                      <button className="link-button" onClick={() => resend(i.email)}>
                        Resend email
                      </button>{' '}
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
