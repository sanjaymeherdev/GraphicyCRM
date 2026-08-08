// modules/mail-capture/appsScript.js — generates the Google Apps Script
// source the user pastes into script.google.com (see routes.js's
// GET /api/mail-capture/script). This is NOT code that runs inside our own
// server — it's a template string for code that runs on GOOGLE'S servers,
// under the USER'S OWN Google account, as their own personal Apps Script
// project. That's the whole point: Apps Script gets its own per-user OAuth
// consent when the user deploys it (a normal "this script wants to read
// your Gmail" prompt they approve for themselves), completely separate
// from this app's OAuth client — so it isn't limited by the scopes we got
// verified for gmail (send-only; see shared/googleAuth.js's GOOGLE_SCOPES).
//
// The deployed script exposes one doGet(e) endpoint that:
//   - requires ?secret=... to match the SECRET constant below (embedded
//     with the real per-connection secret when generated — see
//     buildScript() — so this is copy-paste ready, no placeholder to swap)
//   - searches the user's Gmail with GmailApp.search() using optional
//     ?from= / ?keyword= filters
//   - only returns messages strictly after ?after= (ms since epoch) so our
//     poller (service.js) never re-captures the same email twice
//   - returns each match's id, sender, subject, date, and a plain-text body
//     (truncated) as JSON

function buildScript(secretToken) {
  return `/**
 * GraphicyCRM — Capture Mail Apps Script
 * ----------------------------------------------------------------------
 * Deployed as a Web App, this lets GraphicyCRM poll YOUR Gmail for new
 * messages matching rules you set in the CRM (Sources → Capture Mail),
 * without GraphicyCRM's own Google connection ever needing Gmail read
 * access — this script runs under your own Google account instead.
 *
 * Do not share the deployed URL publicly — anyone with it AND the secret
 * below can read matching emails from this Gmail account. The secret is
 * what keeps it private even though the URL itself has to be reachable
 * over the open internet for GraphicyCRM's server to poll it.
 */
const SECRET = '${secretToken}';

function doGet(e) {
  const params = (e && e.parameter) || {};

  if (params.secret !== SECRET) {
    return jsonResponse({ error: 'Invalid secret' }, 403);
  }

  try {
    const afterMs = params.after ? Number(params.after) : (Date.now() - 24 * 60 * 60 * 1000);
    const maxResults = Math.min(Number(params.max) || 20, 50);
    const fromFilter = (params.from || '').trim();
    const keywordFilter = (params.keyword || '').trim();

    // Gmail search operators only filter by DAY, not exact time, so we
    // search a slightly wider window (from the day 'after' falls on) and
    // then filter precisely by each message's actual timestamp below —
    // otherwise messages earlier in the same day as the last poll would
    // either get missed or re-sent.
    const afterDate = new Date(afterMs);
    afterDate.setHours(0, 0, 0, 0);
    const afterDateStr = Utilities.formatDate(afterDate, Session.getScriptTimeZone(), 'yyyy/MM/dd');

    let query = 'after:' + afterDateStr;
    if (fromFilter) query += ' from:(' + fromFilter + ')';
    if (keywordFilter) query += ' (' + keywordFilter + ')';

    const threads = GmailApp.search(query, 0, maxResults);
    const messages = [];

    for (const thread of threads) {
      for (const msg of thread.getMessages()) {
        const msgTime = msg.getDate().getTime();
        if (msgTime <= afterMs) continue; // already captured on a previous poll

        const from = msg.getFrom();
        const subject = msg.getSubject() || '';
        const body = (msg.getPlainBody() || '').slice(0, 5000);

        if (fromFilter && from.toLowerCase().indexOf(fromFilter.toLowerCase()) === -1) continue;
        if (keywordFilter) {
          const haystack = (subject + ' ' + body).toLowerCase();
          if (haystack.indexOf(keywordFilter.toLowerCase()) === -1) continue;
        }

        messages.push({
          id: msg.getId(),
          threadId: thread.getId(),
          from: from,
          subject: subject,
          date: msg.getDate().toISOString(),
          snippet: body.slice(0, 300),
          body: body,
        });

        if (messages.length >= maxResults) break;
      }
      if (messages.length >= maxResults) break;
    }

    // Sort oldest-first so if the CRM only advances its cursor to the
    // newest message's timestamp, nothing in between gets skipped.
    messages.sort((a, b) => new Date(a.date) - new Date(b.date));

    return jsonResponse({ messages: messages, checkedAt: Date.now() }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
}

function jsonResponse(obj, _status) {
  // Apps Script's ContentService can't set a custom HTTP status code —
  // callers should check the JSON body's "error" field instead.
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
}

module.exports = { buildScript };