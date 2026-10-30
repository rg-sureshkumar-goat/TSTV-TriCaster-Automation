// Invite emails (RG, Oct 30, 2026): when an admin invites someone, the website asks a Google Apps Script
// (apps/web/email/invite-email.gs) to email them the link, from the Google account the script lives in.
// Free, with no domain needed. Set up with INVITE_EMAIL_URL and INVITE_EMAIL_SECRET (docs/PHASE-1.md).
import type { Env } from './env.ts';

export type InviteEmailResult = { sent: true } | { sent: false; reason: 'not-set-up' | 'failed'; error?: string };

/** Emails an invite. Never throws: the invite stands whether or not the email goes out. */
export async function sendInviteEmail(
  env: Pick<Env, 'INVITE_EMAIL_URL' | 'INVITE_EMAIL_SECRET'>,
  invite: { to: string; asAdmin: boolean; invitedBy: string; site: string },
  fetchFn: typeof fetch = fetch,
): Promise<InviteEmailResult> {
  if (!env.INVITE_EMAIL_URL || !env.INVITE_EMAIL_SECRET) return { sent: false, reason: 'not-set-up' };
  try {
    // Google answers a web app's POST with a redirect to the result, which fetch follows.
    const response = await fetchFn(env.INVITE_EMAIL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.INVITE_EMAIL_SECRET, ...invite }),
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let answer: { ok?: boolean; error?: string } = {};
    try {
      answer = JSON.parse(text) as { ok?: boolean; error?: string };
    } catch {
      // Google's own error page, not the script's answer.
    }
    if (response.ok && answer.ok) return { sent: true };
    return { sent: false, reason: 'failed', error: answer.error ?? `Google answered ${response.status}.` };
  } catch (e) {
    return { sent: false, reason: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}
