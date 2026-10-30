// TSTV Rundowns invite emails (RG, Oct 30, 2026). The website asks this Google Apps Script to send each
// invite, from the Google account it lives in (RG's Gmail for now; a TSTV Gmail later: paste it there and
// update the website's two settings). It's free, needs no domain, and Gmail allows about 100 a day.
//
// Setup (docs/PHASE-1.md, "Invite emails"): paste this into a new project at script.google.com, set the
// script property SECRET (Project Settings → Script properties), then Deploy → New deployment → Web app,
// Execute as: Me, Who has access: Anyone. Only a request carrying SECRET sends anything.

function doPost(e) {
  var request = {};
  try {
    request = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'The request wasn’t readable.' });
  }
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || request.secret !== secret) return reply({ ok: false, error: 'Not allowed.' });
  var to = String(request.to || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return reply({ ok: false, error: 'That isn’t an email address.' });
  var site = String(request.site || '');
  if (!/^https:\/\//.test(site)) return reply({ ok: false, error: 'The website’s address is missing.' });
  var by = String(request.invitedBy || 'An admin');
  var role = request.asAdmin ? 'an Admin' : 'a Contributor';

  var text =
    by + ' invited you to TSTV Rundowns, Texas Student Television’s rundown, script and prompter website, as ' + role + '.\n\n' +
    'Sign in here: ' + site + '\n\n' +
    'Use "Sign in with Google" or "Sign in with Microsoft" with this email address (' + to + '). The first time, you’ll be asked for your first and last name.\n';
  var html =
    '<p>' + escape(by) + ' invited you to <strong>TSTV Rundowns</strong>, Texas Student Television’s rundown, script and prompter website, as ' + role + '.</p>' +
    '<p><a href="' + escape(site) + '" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Open TSTV Rundowns</a></p>' +
    '<p>Use <strong>Sign in with Google</strong> or <strong>Sign in with Microsoft</strong> with this email address (' + escape(to) + '). The first time, you’ll be asked for your first and last name.</p>';

  MailApp.sendEmail({ to: to, name: 'TSTV Rundowns', subject: 'You’re invited to TSTV Rundowns', body: text, htmlBody: html });
  return reply({ ok: true, left: MailApp.getRemainingDailyQuota() });
}

function reply(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function escape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
