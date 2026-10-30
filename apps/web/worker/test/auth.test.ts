import { describe, expect, it } from 'vitest';
import { microsoftEmail } from '../auth.ts';
import type { Env } from '../env.ts';

/** A pretend database that knows these people and invites (by email), and admins from ADMIN_EMAILS. */
function env(known: string[], admins = ''): Env {
  const prepare = () => ({
    bind: (email: string) => ({ first: async () => (known.includes(email) ? { 1: 1 } : null) }),
  });
  return { DB: { prepare } as unknown as Env['DB'], ADMIN_EMAILS: admins } as Env;
}

const ut = '00000000-0000-0000-0000-00000000aaaa';

describe('Sign in with Microsoft', () => {
  it('lets a UT account in by its utexas.edu email when that’s the one invited', async () => {
    const claims = { tid: ut, preferred_username: 'ABC123@eid.utexas.edu', email: 'Jordan.Lee@utexas.edu' };
    expect(await microsoftEmail(env(['jordan.lee@utexas.edu']), claims)).toBe('jordan.lee@utexas.edu');
    // Invited by EID instead: the sign-in name.
    expect(await microsoftEmail(env(['abc123@eid.utexas.edu']), claims)).toBe('abc123@eid.utexas.edu');
  });

  it('doesn’t believe an email from an organization that doesn’t own its domain', async () => {
    const claims = { tid: 'other-org', preferred_username: 'someone@evil.example', email: 'jordan.lee@utexas.edu' };
    expect(await microsoftEmail(env(['jordan.lee@utexas.edu']), claims)).toBe('someone@evil.example');
  });

  it('uses a personal account’s own email, and an admin’s', async () => {
    expect(await microsoftEmail(env([]), { tid: '9188040d-6c67-4c5b-b112-36a304b66dad', preferred_username: 'rg@outlook.com', email: 'x@utexas.edu' })).toBe('rg@outlook.com');
    expect(await microsoftEmail(env([], 'rg@utexas.edu'), { tid: ut, preferred_username: 'rg1@eid.utexas.edu', email: 'rg@utexas.edu' })).toBe('rg@utexas.edu');
    expect(await microsoftEmail(env([]), { tid: ut, preferred_username: 'not an email' })).toBeNull();
  });
});
