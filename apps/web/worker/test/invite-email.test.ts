import { describe, expect, it } from 'vitest';
import { sendInviteEmail } from '../invite-email.ts';

const invite = { to: 'jordan@utexas.edu', asAdmin: false, invitedBy: 'RG Sureshkumar', site: 'https://tstv-show.tstv-rundown.workers.dev' };
const settings = { INVITE_EMAIL_URL: 'https://script.google.com/macros/s/abc/exec', INVITE_EMAIL_SECRET: 'shh' };

/** A pretend Google Apps Script that answers with `answer`, and remembers what it was asked. */
function google(answer: unknown, status = 200) {
  const asked: { url: string; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    asked.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, asked };
}

describe('invite emails', () => {
  it('says they aren’t set up, without asking Google, until the script’s address and secret are given', async () => {
    const { fetchFn, asked } = google({ ok: true });
    expect(await sendInviteEmail({}, invite, fetchFn)).toEqual({ sent: false, reason: 'not-set-up' });
    expect(asked).toEqual([]);
  });

  it('asks the script to send the invite, with its secret, and says it was sent', async () => {
    const { fetchFn, asked } = google({ ok: true, left: 99 });
    expect(await sendInviteEmail(settings, invite, fetchFn)).toEqual({ sent: true });
    expect(asked).toEqual([{ url: settings.INVITE_EMAIL_URL, body: { secret: 'shh', ...invite } }]);
  });

  it('says the email failed, and why, when Google refuses or can’t be reached', async () => {
    expect(await sendInviteEmail(settings, invite, google({ ok: false, error: 'Not allowed.' }).fetchFn)).toEqual({ sent: false, reason: 'failed', error: 'Not allowed.' });
    expect(await sendInviteEmail(settings, invite, google('<html>Sorry</html>', 500).fetchFn)).toEqual({ sent: false, reason: 'failed', error: 'Google answered 500.' });
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await sendInviteEmail(settings, invite, offline)).toEqual({ sent: false, reason: 'failed', error: 'fetch failed' });
  });
});
