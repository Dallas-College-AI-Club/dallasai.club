# Club Office review — full backlog

Generated on October 3, 2026 from the review workflow behind [club-office-review.md](club-office-review.md).
Nine area reviewers read the code and drove a local fixture copy of Club Office in Playwright.
An adversarial verifier then re-checked each area, correcting severities and adding missed issues.

275 findings: 4 critical, 18 high, 139 medium, 114 low.
Areas overlap, so one root cause can appear under several IDs. The summary document groups them.
Line numbers refer to commit 957abc6. Repro script names in verifier notes referred to the
reviewers' scratch folders, which no longer exist.

## Shell, sign-in and navigation

The shell is one static page, backend/admin/index.html. It holds a header (logo link to https://dallasai.club, a hidden "/ Club office" label, Sign out), a "Checking your sign-in…" placeholder, one global #status line, the #login section with separate email and code forms, and the #office section with three panes. Boot happens in backend/admin/index.js (lines 818-831): better-auth's createAuthClient().getSession() runs, then load() fetches /api/admin. Nothing in the office is shown until that inbox request succeeds. All feature modules receive the shared api() wrapper (index.js:90-130). When any request gets a 401, the wrapper calls showLogin() (index.js:131-153), which hides the office and calls clear() on every module, including the event editor, survey builder, comment drafts and contacts. A sessionGeneration counter discards late responses after that. Tabs are aria-pressed buttons switched by showPane() (index.js:695-735), which rewrites the URL with history.replaceState. A hashchange listener (index.js:743-784) handles #events, #surveys, #survey=, #custom-survey=, #entry= and #archived-survey-questions. A 60-second setInterval (index.js:814-817) re-runs load() for counts, the document title "(N) Club office", the "New submissions arrived" notice and browser notifications (browser-alerts.js). Server side, api/auth.mjs proxies four Neon Auth endpoints through lib/neon-auth.mjs. That proxy checks the email against ADMIN_EMAILS, rate-limits by IP (lib/http.mjs limit()), and caps sessions at a fixed 72 hours from creation (lib/admin-session.mjs). lib/auth.mjs requireAdmin additionally requires the Neon "admin" role on every API call. An officer's day: open /admin/, sign in with an emailed 6-digit code if the 72-hour cookie has lapsed, then work across the Inbox, Events and Surveys tabs while the page polls every minute.

### shell-1 · critical · bug · effort M — Any 401 (even from the background poll) wipes unsaved event, survey and comment drafts with no warning, and re-signing in does not restore them

- **Where:** `backend/admin/index.js:131` · **Verdict:** confirmed
- **Impact:** An officer who signed in three days ago and spends ten minutes writing an event description or a follow-up comment loses all of it the moment the deadline passes. That can happen while they are just typing, because the minute poll triggers it.
- **Fix:** On a 401, do not tear down the page. Make #office inert and hidden, and show a re-authentication dialog over it with the email prefilled. Keep module state in memory. Clear it only if a different email signs in, if the officer chooses 'Discard and sign out', or after a short timeout. This still meets the privacy goal of the existing 'Expired session closes private dialogs and clears records' test. A background-poll 401 in particular should show a banner, not run showLogin(). Update that browser test to expect drafts to survive a same-account re-sign-in.
- **Verifier:** I confirmed this and found a worse path. The wipe also happens when the officer clicks Save. In v1.cjs I opened Events, clicked New event, filled title 'shell-verify-draft-save-401' and a summary, routed only the POST /api/events to 401, then clicked 'Save draft'. Result: {loginVisible:true, status:'Your session ended…', title:'', summary:'', formHidden:true}. The cause is api() (index.js:111-114), which calls showLogin() before the throw; showLogin then runs editor.clear() (event-editor.js:631-655, form.reset()). After a mocked re-sign-in the Events pane and tab came back (hash #events), but …

### shell-2 · medium · enhancement · effort S — The client ignores the session deadline, so there is no 'signed in until…' and no warning before the fixed 72-hour cutoff

- **Where:** `backend/admin/index.js:818` · **Verdict:** confirmed
- **Impact:** Officers cannot tell when they will be logged out. Combined with shell-1, the cutoff arrives without warning and often mid-task.
- **Fix:** Store expiresAt from getSession and show 'Signed in as X · until Thu 9:14 AM' next to Sign out. About 30 minutes before the deadline, show a non-blocking banner: 'Your session ends in 30 min — save your work or sign in again now'. It can run the code flow in a dialog without leaving the page. Re-check getSession when the tab becomes visible.
- **Verifier:** neon-auth.mjs:137-144 rewrites session.expiresAt to the true remaining deadline. index.js:820-821 only checks data?.user and never stores or shows expiresAt. The only copy is the static index.html:85-86 'Stay signed in for 3 days'. No timer or visibility check reads the deadline. This is real, but it is an enhancement whose value comes from mitigating shell-1, so I lowered it to medium. Code-read; the fixture's get-session returns no session object, so I could not render it.

### shell-3 · medium · bug · effort S — A temporary server error or timeout on first load shows the sign-in form, as if the officer were signed out

- **Where:** `backend/admin/index.js:485` · **Verdict:** confirmed
- **Impact:** During a Vercel or Neon cold start or brief outage, officers are told to sign in. They request codes they do not need, use up the 5-per-5-minute send limit, and conclude their access is broken.
- **Fix:** Keep 'not signed in' separate from 'could not load'. If getSession returned a user and /api/admin fails with something other than 401, show a load-error state ('Club Office could not load. Retry') with the identity and a Retry button, plus a few automatic retries with backoff. Show the login form only on 401 or a null session.
- **Verifier:** Reproduced in v1.cjs B: signed in, routed /api/admin?** to 503, reloaded. Result: {loginHidden:false, officeHidden:true, emailForm:true}. The status read 'This service is temporarily unavailable. Your information has not been cleared; please try again.', which sits oddly above a blank sign-in form. The cause is index.js:485 `if (!signedIn) showLogin();`. After a correct code, the code-form handler (index.js:602) awaits load(), whose catch also runs showLogin() and drops the officer back to the email step.

### shell-4 · medium · bug · effort S — An approved email without the Neon 'admin' role gets a working code, then a misleading 'Your session ended' loop

- **Where:** `backend/lib/neon-auth.mjs:61` · **Verdict:** confirmed
- **Impact:** A newly onboarded officer whose role was not set in Neon (a step docs/operations.md requires) can never get in and is told their session 'ended' rather than that their account is not set up. This is hard to debug by self-service.
- **Fix:** Return a distinct error from requireAdmin when the session is valid but not authorized (e.g. 403 with code 'not-officer'). In the client, show 'You are signed in as X, but this account is not set up as a club officer. Ask an existing officer to grant the admin role.' and call auth.signOut() to break the loop. Better still, make the proxy's approvedEmail check the role too.
- **Verifier:** Server: the proxy's approvedEmail checks ADMIN_EMAILS only (neon-auth.mjs:61). requireAdmin also requires role 'admin' and otherwise throws 401 (auth.mjs:103-115). docs/operations.md:14 says both are required, so a missed onboarding step leads exactly here. Client, reproduced in v2.cjs part 4: a mocked successful verify, then /api/admin returning 401 'Sign in with an authorized club email address.' Result: {status:'Your session ended. Sign in again to continue.', emailStep:true}. The server's message is lost because showLogin bumps sessionGeneration, so load's catch returns early …

### shell-8 · medium · ux-friction · effort M — Navigation is not in browser history: Back leaves the office, and reload loses the sub-view, filters and open record

- **Where:** `backend/admin/index.js:715` · **Verdict:** confirmed
- **Impact:** On phones especially, officers use the Back gesture to return to the inbox after opening an event or survey, and it throws them out of Club Office. Any reload, crash or new tab loses their place and filters.
- **Fix:** Treat the URL as the source of view state, e.g. #inbox?status=reviewed&kind=question&page=2, #events/<id>, #surveys/custom/<id>. Use pushState for user navigation (tab, group, selected record) and replaceState only for filter tweaks. Handle popstate through the existing unsaved-changes guards (showPane already returns false when an officer cancels).
- **Verifier:** Reproduced in v3.cjs: after Events → Surveys → Inbox, history.length was still 2. showPane (index.js:715-720), the status pills (518-519), the Event surveys group (692), survey-results reset (survey-results.js:463) and the linked-entry cleanup (480) all use replaceState. Also reproduced (v3.cjs f): a reload with a typed comment draft gives no prompt and loses the draft. I lowered it to medium. Inside a pane, most navigation is expand-in-place (details elements), so officers have fewer Back expectations than in a routed app. Leaving the app on Back, and losing the sub-view on reload, are still …

### shell-10 · medium · bug · effort S — A link to a deleted or mistyped entry pins the inbox to that ID: type filter, Refresh and CSV export are silently ignored

- **Where:** `backend/admin/index.js:159` · **Verdict:** confirmed
- **Impact:** An officer following a stale link (for example to an entry another officer has permanently deleted) sees an empty inbox and filters that do nothing. They may conclude the inbox is empty or broken, and a CSV export would come back empty.
- **Fix:** After the first load for a linked entry, always clear the hash, whether or not it was found. If it was not found, show 'That submission no longer exists or the link is incomplete' with a 'Show all New' button. Validate the UUID client-side before requesting.
- **Verifier:** Reproduced in v3.cjs b. /admin/#entry=00000000-0000-4000-8000-000000000000 shows 'No submissions match these filters.' Changing Type to Club signups re-sent '/api/admin?offset=0&id=00000000-…' (no kind). The export href became '/api/admin?offset=0&id=00000000-…&export=csv'. Cause: filters() (index.js:159-165) reads the hash on every load, and the hash is cleared only when the card is found (473-482). Contact-history links (contact-history.js:258) are a realistic source of stale links.

### shell-12 · medium · ux-friction · effort S — The global status line never clears: stale errors stay after recovery, success messages follow you across tabs, and errors look like successes

- **Where:** `backend/admin/index.js:39` · **Verdict:** confirmed
- **Impact:** Officers see a permanent 'Could not connect' warning while everything works, so they learn to ignore the banner and then miss real errors. Unrelated messages cover the top of other panes.
- **Fix:** Turn #status into a toast or notice component with a type (success, info, error), a close button, and auto-dismiss for success and info after about 5 seconds. Clear connection errors on the next successful load, and clear or scope messages per pane on tab switch. Keep errors until dismissed or resolved.
- **Verifier:** Reproduced in v1.cjs C. I aborted one background poll with page.clock: status read 'Could not connect to Club Office. Check your connection and try again.' After two successful polls the same text remained. status() (index.js:39-41) is never cleared by load() or showPane(). It is a sticky card at z-index 5 (style.css:276-287), with one colour for all messages (style.css:291-293).

### shell-14 · medium · bug · effort M — Background refresh rebuilds the inbox and moves cards under the pointer when new submissions arrive

- **Where:** `backend/admin/index.js:426` · **Verdict:** confirmed
- **Impact:** If an officer is about to click 'Archive submission' or 'Mark reviewed' on an expanded card after focus has left the list (for example after pressing Refresh or clicking the page background), the minute timer can shift a different person's card under the click.
- **Fix:** Do not re-render the visible list in the background. Update counts and the title, and show a '2 new submissions · Show' pill that the officer clicks to re-render. If re-rendering is kept, anchor the scroll to the card under the viewport centre.
- **Verifier:** The guard at index.js:426-430 skips re-render only when a comment draft exists or focus is inside #entries. Reproduced in v3.cjs d: with a card and its Activity panel expanded, I clicked the page background (active BODY) and ran the clock 61s. The list was rebuilt; the open Activity panel re-fetched history once, and 0 times when focus stayed inside the list. The rebuild happens on every poll, even when nothing changed. Safari and iOS do not focus buttons or summaries on click, so there the focus guard rarely holds (platform behaviour; WebKit is not installed here to test). The status actions …

### shell-15 · medium · ux-friction · effort S — The logo navigates the office tab to the public site, and Sign out discards inbox comment drafts, both without a prompt

- **Where:** `backend/admin/index.html:25` · **Verdict:** confirmed
- **Impact:** In most admin tools the logo means 'home of this app'. Here it leaves the office and silently drops a half-written note to a member, and Sign out drops it the same way.
- **Fix:** Make the logo go to the office home (Inbox) and add a separate 'View website ↗' link with target=_blank. Add a beforeunload handler when commentDrafts.size > 0, and include comment drafts in the Sign out canLeave check.
- **Verifier:** The logo, index.html:25 `<a class="brand" href="https://dallasai.club">`, has no target. index.js has no beforeunload handler for commentDrafts. The Sign out guard (index.js:629-633) checks editor, customSurveys and surveys (which covers contact notes) but not commentDrafts. Reproduced the same loss via reload (v3.cjs f): 'reload prompt: false | draft survived: false'. I did not click Sign out.

### shell-16 · medium · ux-friction · effort M — On phones the header and hero take 40% of the screen, and the tabs scroll away

- **Where:** `backend/admin/style.css:160` · **Verdict:** confirmed
- **Impact:** Officers on phones scroll two screens before seeing a submission. To move from the inbox's pagination to Events or Surveys they have to scroll all the way back up.
- **Fix:** Shrink the header to about 56px with a 32px logo, and move 'Signed in as' and Sign out into a compact account menu. Remove or collapse the marketing hero inside the office. Make the header and tabs sticky (or use a bottom tab bar on phones), and show each tab's new count in the tab label.
- **Verifier:** Reproduced at 390x844 (v3.cjs c, c-phone.png). Header 0-89px, intro 127-253px, tabs at y=277, first submission at y=1604, about two screens down. The .workspace-label is display:none (style.css:777-779). .office-tabs has no sticky rule (grep for sticky: none on .office-tabs). There is no horizontal overflow (scrollWidth 390).

### shell-26 · medium · bug · effort S — Switching tabs resets the Surveys tab: Custom surveys group, the chosen survey, and the event filter and search are lost

- **Where:** `backend/admin/index.js:722` · **Verdict:** found by verifier
- **Impact:** An officer reading one custom survey's results, or a filtered set of RSVP answers, who hops to the Inbox to check something comes back to a different view and has to find their place again. This happens within a session, not only on reload.
- **Fix:** Keep each pane's sub-state, such as the group, selected survey, filters and page, when switching tabs. Only call show('') on first activation or an explicit refresh. Write the selected custom survey into the hash (#custom-survey=<id>) so the existing restore path keeps it.

### shell-5 · low · copy · effort S — Every code-verification failure shows the same message: rate limit, expired code, bad format and network error all read as a wrong code

- **Where:** `backend/admin/index.js:598` · **Verdict:** confirmed
- **Impact:** After 10 attempts in 5 minutes from one IP, an officer typing the correct code is told it 'could not be verified', so they keep retrying and keep the lockout alive. A network blip shows developer jargon.
- **Fix:** Handle the statuses separately. 429: 'Too many attempts. Wait 5 minutes, then use the newest code.' Expired or invalid: 'That code is wrong or expired. Request a new code.' Network or TypeError: 'Could not reach Club Office. Check your connection.' Never show error.message from fetch directly.
- **Verifier:** Reproduced in v2.cjs part 2. A verify 429 and a 401 both showed 'That code could not be verified. Check the latest email, or request a new code.' An aborted request showed the raw 'Failed to fetch'. Code: index.js:598-601 ignores result.error.status. I lowered severity. The generic message is appropriate for wrong or expired codes, which are the common case. The 400 case cannot occur because of client-side pattern validation. The verify 429 needs more than 10 attempts in 5 minutes from one IP. The 'Failed to fetch' copy on a flaky phone connection is the most likely real annoyance.

### shell-6 · low · ux-friction · effort S — Pasting a code with a space or dash is cut off by maxlength=6 and fails with a generic browser tooltip

- **Where:** `backend/admin/index.html:67` · **Verdict:** confirmed
- **Impact:** Codes copied from email often carry a leading space or are formatted '123 456'. The officer sees a cryptic tooltip and has to retype the code by hand, often on a phone.
- **Fix:** Remove maxlength and pattern. On input or paste, strip non-digits (`value.replace(/\D/g,'').slice(0,6)`), then auto-submit when 6 digits are present. Show inline guidance ('Enter the 6 digits from the email') instead of relying on native validation.
- **Verifier:** Reproduced in v2.cjs part 1 with keyboard.insertText. Inserting '123 456' gave value '123 45', checkValidity false, 'Please match the requested format.' Inserting ' 123456' gave ' 12345'. Cause: index.html:67-69 (pattern plus maxlength=6) truncates before the .trim() at index.js:596 runs. Lowered to low: one-time-code autofill and typing six digits both work, and how often codes paste with spaces depends on the email template, which I could not see.

### shell-7 · low · accessibility · effort S — Sign-in errors appear in a page-level banner disconnected from the field; focus drops to <body> and the wrong code stays in the box

- **Where:** `backend/admin/index.js:537` · **Verdict:** confirmed
- **Impact:** Keyboard and screen-reader users lose their place after each failed attempt. Sighted officers have to clear the old code manually and may not connect the banner to the field.
- **Fix:** Render the error inside the code form (role=alert) and link it with aria-describedby and aria-invalid. Keep focus on the input and select its contents after a failure. Use a distinct error style. Set aria-busy on the form instead of disabling the focused button, or restore focus afterwards.
- **Verifier:** Partly refuted. Pressing Enter in the code field keeps focus there: after a 429, v2.cjs printed active 'INPUT:otp'. loginBusy disables only buttons (index.js:537-544), not the input. Focus drops to BODY only when the Sign in button is clicked or tapped (reproduced: active BODY). The error is announced, because #status has role=status and aria-live=polite (index.html:44). Still true: the message renders outside the card, there is no aria-invalid or aria-describedby, the wrong code stays in the box, and success and error share one style (style.css:276-293). Low.

### shell-9 · low · enhancement · effort M — An officer cannot link a teammate to a specific event, and links to inbox entries exist but are hidden

- **Where:** `backend/admin/index.js:480` · **Verdict:** confirmed
- **Impact:** Officers coordinating in Teams or Discord ('can you reply to this one?', 'check the RSVP survey for Friday's workshop') must describe where to click instead of pasting a link. Teammates then search by hand and can act on the wrong record.
- **Fix:** Add a 'Copy link' button to entry cards, the event editor header and the custom-survey header, generating #entry=<id>, #event=<id> and #custom-survey=<id>. Keep the hash in the URL while that record is open. Add #event=<id> handling in the event editor (select the row and run the canLeave guard).
- **Verifier:** event-editor.js never reads location.hash (grep found no location or history use in it). index.js:480 clears #entry= after opening the card. One correction: in-app #entry= links do exist. The contacts view renders them at contact-history.js:258 (`link.href = '#entry=' + …`) and contact-profile.js:102, so 'nothing produces it' holds only for #custom-survey= and events. This is an enhancement, so I lowered it to low.

### shell-11 · low · ux-friction · effort S — Opening a linked entry silently narrows the 'New' list to that one card, which expands back without notice on the next refresh

- **Where:** `backend/admin/index.js:345` · **Verdict:** confirmed
- **Impact:** The officer believes there is only one new submission. The list then changes under them a minute later.
- **Fix:** While showing a linked entry, display a banner ('Showing 1 linked submission · Show all New') and do not apply background re-renders until it is dismissed. Alternatively, load the normal list and scroll to or highlight the linked card when it is on the page.
- **Verifier:** Confirmed by code; I did not re-run it. filters() drops status, kind and eventId while #entry is present (index.js:160-165). The response then holds just that entry. index.js:350 sets the pill, and 480 clears the hash. The next load, including the 60-second background poll when focus is outside #entries (426-430), uses the normal filters and re-renders the full list without notice.

### shell-13 · low · bug · effort S — The 'New submissions arrived' notice never goes away

- **Where:** `backend/admin/index.js:369` · **Verdict:** confirmed
- **Impact:** After the first arrival the notice is permanent, so it stops meaning anything, and real new arrivals look the same as old ones.
- **Fix:** Clear the notice when the officer refreshes, switches status, or the new count stops increasing. Better: say '3 new since 2:14 PM · Show them', and clear it once they are shown.
- **Verifier:** The only writes to #inbox-alert are index.js:137 (clear, in showLogin) and 369 (set). Nothing clears it on refresh or pill change. I also found a related false trigger, listed below as a missed finding: the officer's own 'Mark new' raises it.

### shell-17 · low · accessibility · effort S — Tabs are toggle buttons rather than a tab list; no arrow-key navigation, no Inbox heading, and focus lost after sign-in

- **Where:** `backend/admin/index.html:98` · **Verdict:** confirmed
- **Impact:** Screen-reader users hear 'toggle button, pressed' with no tab or panel relationship, cannot jump to the Inbox by heading, and must re-find their place after signing in.
- **Fix:** Use role=tablist/tab/tabpanel with aria-selected, aria-controls and roving tabindex with arrow keys, or keep the buttons and add aria-current. Add an 'Inbox' h2. After sign-in or re-authentication, move focus to the h1 or the active pane heading.
- **Verifier:** index.html:98-101 uses aria-pressed buttons inside a nav. There is no keydown or Arrow handling anywhere in index.js. #inbox-pane (index.html:103-106) has no heading, while Events (354) and Event surveys (326) have h2s. After sign-in by click, activeElement is BODY (v1.cjs A: 'active':'BODY#').

### shell-18 · low · ux-friction · effort S — Small sign-in rough edges: email not prefilled after expiry, field not autofocused, stale intro on the code step, static resend label

- **Where:** `backend/admin/index.js:131` · **Verdict:** confirmed
- **Impact:** Re-signing in after expiry takes extra typing, and on a phone the officer must tap into the field first. The copy on the code step is mildly confusing.
- **Fix:** Prefill the email after an expiry. Autofocus the email field (and the code field, which already happens). Change the intro copy per step ('Enter the 6-digit code we sent to X'). Show a live countdown ('Send a new code in 0:42'). Use a plain h1 such as 'Sign in to Club Office'.
- **Verifier:** Reproduced (v2.cjs). activeElement on the login screen is BODY, and index.html has no autofocus. The intro 'Enter your club officer email…' is still visible on the code step (v5-verifying.png). The resend label is fixed text (index.js:565). showLogin and emailStep never prefill the email.

### shell-19 · low · enhancement · effort S — No refresh on returning to the tab and no 'last updated' time, so counts can be up to a minute stale with no sign of it

- **Where:** `backend/admin/index.js:814` · **Verdict:** confirmed
- **Impact:** An officer who switches back to the tab after a meeting sees old counts for up to 60 seconds and cannot tell whether the data is current.
- **Fix:** On visibilitychange to visible, call load({background:true}) right away if the last load is older than about 15 seconds. Show 'Updated 2:14 PM' next to Refresh, and grey it out when stale.
- **Verifier:** index.js:814-817 is the only refresh trigger. There is no visibilitychange handler in any admin module (grep). browser-alerts.js:60 'focus' only calls render(). No last-updated timestamp exists.

### shell-20 · low · ux-friction · effort S — Loading states are vague: 'Checking your sign-in…' covers the whole inbox fetch, and filter changes show only a faded Refresh button

- **Where:** `backend/admin/index.html:43` · **Verdict:** confirmed
- **Impact:** On a slow cold start, officers think sign-in is stuck. After changing a filter they may read or act on the previous filter's list, believing it is the new result.
- **Fix:** Once getSession succeeds, change the text to 'Loading your inbox…' or show the office skeleton. While a filtered load is in flight, dim the list and show an inline 'Loading…' row, or replace the list with skeleton cards as the status pills already do.
- **Verifier:** #session-loading is hidden only at index.js:132 (showLogin) and 352 (after /api/admin succeeds), so 'Checking your sign-in…' covers the whole first inbox fetch. During filter loads only aria-busy and the disabled Refresh change (331-332).

### shell-21 · low · bug · effort S — Sign-in rate limits are keyed only by IP, so officers on the same campus Wi-Fi can lock each other out

- **Where:** `backend/lib/neon-auth.mjs:62` · **Verdict:** confirmed
- **Impact:** When several officers sign in at the start of a club meeting on campus Wi-Fi, later ones are blocked for 5 minutes. The send limit gets a clear message, but the verify limit shows 'code could not be verified'.
- **Fix:** Rate-limit per (IP, email) with a higher per-IP ceiling, and keep the per-email send limit. Surface 429 clearly in the client (see shell-5).
- **Verifier:** limit() keys on HMAC(`${scope}:${ip}`) (http.mjs:89-94). The rate limiter runs only after approvedEmail passes (neon-auth.mjs:97-105), so only approved officers' requests count toward the shared NAT budget and outsiders cannot trigger a lockout. Real but rare. Low.

### shell-22 · low · security · effort M — No 'shared computer' option: every sign-in leaves a 72-hour persistent cookie

- **Where:** `backend/lib/admin-session.mjs:31` · **Verdict:** confirmed
- **Impact:** Student officers often use library or lab computers. Forgetting to press Sign out leaves members' names, emails and messages open to the next person for up to three days.
- **Fix:** Add a 'This is a shared computer' checkbox that keeps the upstream session cookie as a session cookie (no maxAge) and enables a 30-minute idle sign-out in the client. Keep the 72-hour cap for personal devices.
- **Verifier:** persistentAdminCookie (admin-session.mjs:31-58) converts the upstream session cookie to maxAge = remaining (up to 72h). There is no opt-out and no idle timeout in client or server. This is a design choice with a real risk on shared lab computers.

### shell-23 · low · copy · effort S — Code-send failures caused by configuration or the wrong domain say 'try again shortly'

- **Where:** `backend/admin/index.js:550` · **Verdict:** confirmed
- **Impact:** An officer on a bookmarked deployment URL, or facing a misconfiguration, retries forever because the message suggests the problem is temporary.
- **Fix:** Show the server's message for 403 and 503 and include the correct office URL ('Open Club Office at https://… to sign in').
- **Verifier:** sendCode (index.js:550-555) special-cases only 429. The proxy returns 403 'Please use the club admin page.' (neon-auth.mjs:84-85) and 503 'not configured' (20-29); both show 'Please try again shortly.'

### shell-24 · low · enhancement · effort S — Browser alerts do not bring the office tab forward when clicked and give no count

- **Where:** `backend/admin/browser-alerts.js:75` · **Verdict:** confirmed
- **Impact:** Officers who enabled alerts have to hunt for the right browser tab, and cannot judge urgency from the notification.
- **Fix:** Pass the count and kinds to notify() (e.g. '2 new: 1 club signup, 1 question'). Set `n.onclick = () => { window.focus(); showPane('inbox'); n.close(); }`.
- **Verifier:** browser-alerts.js:75-78 creates `new Notification('Dallas AI Club', { body: …, tag: 'club-inbox' })` with no onclick, no count and no renotify. The missing renotify is a separate silent-alert problem, listed below as a missed finding.

### shell-25 · low · copy · effort S — Names are inconsistent and the tab title ignores the current pane

- **Where:** `backend/admin/index.html:8` · **Verdict:** confirmed
- **Impact:** Officers with several office tabs open cannot tell them apart, and on phones the office looks like the public site.
- **Fix:** Use one product name, 'Club Office'. Set titles per pane, e.g. '(3) Inbox · Club Office' or 'Editing: Fall Workshop · Club Office'. Keep a compact 'Club Office' label visible on mobile.
- **Verifier:** index.html:8 and 39 say 'Club office'; index.js:107 and 119 say 'Club Office'. The header brand (index.html:37) says 'Dallas College AI Club' while the title says 'Dallas AI Club'. document.title is set only at index.js:138 and 358-360, the same on every pane.

### shell-27 · low · bug · effort S — The officer's own 'Mark new' (or a colleague's) triggers 'New submissions arrived' and a browser notification

- **Where:** `backend/admin/index.js:365` · **Verdict:** found by verifier
- **Impact:** Alerts fire for the officer's own actions and for teammates restoring entries, so officers learn to ignore them. Combined with shell-13, the notice then sticks permanently.
- **Fix:** Base arrival detection on `latest > lastReceived` (newest created_at) only. Or skip the alert for loads triggered by this officer's own review action.

### shell-28 · low · ux-friction · effort S — No progress feedback while a code is sent or verified; on a slow cold start the only sign is greyed-out buttons

- **Where:** `backend/admin/index.js:537` · **Verdict:** found by verifier
- **Impact:** On a phone during a Vercel or Neon cold start, officers cannot tell whether the tap registered. They reload or switch to their mail app, and may request extra codes, which uses up the 5-per-5-minute send limit.
- **Fix:** Change the button label ('Sending code…', 'Signing in…', then 'Loading your inbox…'), set aria-busy on the form, and keep a visible status line in the card.

### shell-29 · low · bug · effort S — Sign-in calls have no timeout: 'Checking your sign-in…' can spin indefinitely with no retry

- **Where:** `backend/admin/index.js:818` · **Verdict:** found by verifier
- **Impact:** On a stalled mobile connection the officer sees a permanent 'Checking…' with no way forward other than reloading. In production a Vercel function timeout eventually bounds this; a network stall does not.
- **Fix:** Pass fetchOptions with `signal: AbortSignal.timeout(15000)` to the auth client calls. On timeout, show 'Could not reach Club Office' with a Retry button, separate from the sign-in form (see shell-3).

### shell-30 · low · bug · effort S — Browser alerts reuse one tag without renotify, so later alerts can replace the first silently

- **Where:** `backend/admin/browser-alerts.js:75` · **Verdict:** found by verifier
- **Impact:** An officer who has not dismissed the first alert, which often stays in the Windows or macOS notification centre, gets no sound or popup for later arrivals. The feature appears to stop working after the first alert.
- **Fix:** Add `renotify: true`, or use a tag that includes the latest timestamp. Include the count (see shell-24).

### shell-31 · low · performance · effort M — Every background poll rebuilds the list and re-fetches each open 'Activity & comments' panel, even when nothing changed

- **Where:** `backend/admin/index.js:456` · **Verdict:** found by verifier
- **Impact:** Open activity timelines blank and refill every minute, shifting the page under the reader (this adds to shell-14), and each open panel adds a request every minute.
- **Fix:** Skip the re-render when the entry ids and updated_at values are unchanged. When a re-render is needed, reuse existing card nodes (or the loaded activity) instead of rebuilding them.

### shell-32 · low · bug · effort S — The tab-title count includes past-event RSVPs that no count card shows

- **Where:** `backend/admin/index.js:357` · **Verdict:** found by verifier
- **Impact:** '(N) Club office' can read higher than the sum of the count cards. New RSVPs for past events are counted but never surfaced in the counts, which confuses officers trying to reach zero.
- **Fix:** Add an 'Event RSVPs (past)' count card, or exclude rsvp-past from the title and alert totals, so the badge and cards agree.

### shell-33 · low · security · effort S — After Sign out in one tab (or session expiry), other office tabs keep showing member data until they become visible and the next 60-second tick runs

- **Where:** `backend/admin/index.js:814` · **Verdict:** found by verifier
- **Impact:** On a shared lab computer, an officer who clicks Sign out in one tab leaves names, emails and messages readable in any other office tab: indefinitely while it stays in the background, and for up to a minute after someone opens it.
- **Fix:** Broadcast sign-out to other tabs (BroadcastChannel or a localStorage key) so they run showLogin(). On visibilitychange to visible, re-check the session before showing data.

## Inbox

The Inbox is one long vanilla-JS view in backend/admin/index.js. load() (lines 321-496) GETs /api/admin with status/kind/eventId/offset. It rebuilds the six count cards (405-419) and the Event dropdown, then replaces the whole #entries list with <details> groups keyed by event or kind (groupedEntries, 291-320). Each entry is a nested <details> (renderEntry, 168-290). Its summary shows only name, email and timestamp. A second "Submission details" disclosure holds the fields, then come the action buttons (Edit response / Mark reviewed / Archive / Mark new / Delete permanently) and a lazily loaded "Activity & comments" panel (admin/submission-activity.js) that keeps comment drafts in an in-memory Map. On the server (backend/api/admin.mjs), lib/inbox.mjs#inboxFilter builds a WHERE clause that supports only kind/status/id/eventId. The list query is LIMIT 51 OFFSET n with no total. Counts are a global GROUP BY that also returns a 'rsvp-past' bucket the UI never displays. Review changes are a bare UPDATE with no concurrency check (186-197). CSV export comes from lib/submission-export.mjs and is fetched as a blob by the #export link handler (index.js:43-89). A 60-second setInterval (814-817) re-runs load({background:true}). It re-renders the list only when no comment draft exists and focus is outside #entries (426-430). Triaging one entry takes, at minimum: scroll about 1,400px (1440x1000) or about 1.9 screens (390px phone) to reach the first row, expand the row, expand "Submission details", click the mailto link, then "Mark reviewed". That is 4 clicks followed by a full list reload that drops keyboard focus. Logging a reply as a comment adds 3 more clicks. There is no search, no bulk action, no undo and no sort. A redesign should keep the safe, auditable data model. It should change the layout to a compact, scannable list (one-line preview per row, sticky status/filter/search toolbar, bulk select). It should also add a reading pane with fields in a fixed per-kind order and a combined "comment + status" action, and replace the background re-render with a "N new — Show" pill.

### inbox-1 · high · bug · effort S — Typed comment is silently dropped when the officer clicks Mark reviewed/Archive

- **Where:** `backend/admin/index.js:262` · **Verdict:** confirmed
- **Impact:** Officers naturally write 'replied, waiting on answer' and then mark the entry reviewed. The note is never saved, so other officers don't see it and may reply again. The officer believes it was logged.
- **Fix:** Make the comment box part of the status action: 'Add note & mark reviewed' / 'Add note & archive' (one POST that inserts the comment and changes status in one transaction). At minimum, if drafts.get(entry.id) is non-empty when a status button is clicked, save the comment first or ask 'Save your comment before moving this entry?'.
- **Verifier:** Reproduced on a private in-memory copy of office-fixture (v1.mjs). I typed a comment and clicked Mark reviewed. #status showed 'Submission moved to Reviewed.', with no dialog. entry_comments count = 0 and review_status = reviewed. index.js:262-285 never reads commentDrafts. One correction: the text is not gone for good. It stays in the in-memory Map, and opening that entry's Activity panel in the Reviewed view showed it again in the textarea. It is never saved, though, and the hidden draft keeps commentDrafts.size > 0. Because of that, a question inserted afterwards was still missing after 2 …

### inbox-2 · high · ux-friction · effort M — Reading a submission needs two nested disclosures; collapsed rows show no subject or preview

- **Where:** `backend/admin/index.js:171` · **Verdict:** confirmed
- **Impact:** An officer can't scan the inbox for what needs a reply (e.g. which question is about parking). Every entry has to be opened twice just to learn what it says, which makes weekly triage slow, especially on a phone.
- **Fix:** Add a kind-specific one-line preview to each row (question subject plus the first ~80 chars of the message, workshop topic, article title, campus + interests, event name). Render the fields expanded whenever the row is opened (drop the inner details). On desktop, consider a list + reading-pane layout with j/k navigation, so open → read → act happens without reloading the list.
- **Verifier:** index.js:171-176: the summary holds only name, email and time. Fields sit inside a second <details> (228-245). In every repro script I had to click the row summary and then the 'Submission details' summary before any <pre> appeared. The card repeats the time and email (entry-top 189, mailto 200), and no CSS hides the summary spans when the card is open (style.css only has details[open] > summary margin).

### inbox-3 · high · ux-friction · effort M — Entry list starts below the fold; the page is ~7,600px long

- **Where:** `backend/admin/index.html:104` · **Verdict:** confirmed
- **Impact:** Every visit begins with scrolling past reference material. Once in the list, the officer has to scroll thousands of pixels back up to switch status, filter or refresh. On a phone the inbox is mostly chrome.
- **Fix:** Restructure: a compact count strip, then a sticky toolbar (status tabs · type chips · search · Refresh · Export) directly above a dense list (~48px rows). Move 'How people submit' and 'What statuses mean' into a help popover or the page footer, and show the setup notice only to admins. Start groups collapsed beyond the first N, or use a flat list with type chips.
- **Verifier:** Measured on the private fixture (v2.mjs, 60 seeded rows plus 6 base rows) and got the same numbers as the reviewer. At 1440x1000: #filters at y=1133, first entry at y=1394, document 7588px for 50 rows, 101px per row. At 390x844: first entry at 1604, document 7356. The computed position of #filters, .inbox-views and #refresh is 'static', so none of them is sticky. There is no horizontal overflow.

### inbox-5 · high · enhancement · effort M — No bulk actions; each status change is expand + click + full reload

- **Where:** `backend/admin/index.js:255` · **Verdict:** confirmed
- **Impact:** High-volume, no-action items (newsletter signups, RSVPs) bury the questions that do need replies. Clearing them is tedious, so officers leave New cluttered.
- **Fix:** Add row checkboxes, 'Select all on this page/group' and 'Mark reviewed / Archive selected'. Server: action:'review' with ids[] (cap 100) in one transaction with one audit row each. Add a group-header action such as 'Mark all 9 RSVPs for Office audit event reviewed'.
- **Verifier:** index.js:255-287 creates per-entry buttons only. api/admin.mjs:180-197 accepts a single uuid id. #entries has no checkbox or bulk control. Every click calls load(), which rebuilds the whole list. Kept at high because RSVP and subscription volume rises around events, and each item costs an expand, a click and a reload.

### inbox-4 · medium · enhancement · effort M — No search by name, email or text

- **Where:** `backend/lib/inbox.mjs:21` · **Verdict:** confirmed
- **Impact:** 'Did Maria sign up / did we answer her question?' means flipping through New, Reviewed and Archived page by page. Restoring an accidentally archived entry (inbox-16) has the same problem.
- **Fix:** Add a q parameter: name/email ILIKE plus data->>'subject'/'title'/'topic'/'message', searched across all statuses by default with the status shown per row. Use a debounced search box in the sticky toolbar, include it in the CSV export, and add pg_trgm indexes if volume grows.
- **Verifier:** It is true that the inbox list itself has no search: inboxFilter (lib/inbox.mjs:21-38) reads only kind/status/id/eventId. The reviewer missed that name/email lookup is one click away. survey-results.js:66-68 appends a 'Contacts & follow-up' button to '#inbox-pane .heading', and its dialog searches by name/email (lib/contacts.mjs:30-44; a trigger populates contacts on every entry insert). Repro (v5.mjs): searching 'maria' found the contact. 'Open submission' jumped to her archived question, switched the tab to Archived and expanded the card. So 'flipping page by page' to answer 'did Maria sign …

### inbox-6 · medium · bug · effort S — A stale status click silently overrides another officer's change

- **Where:** `backend/api/admin.mjs:188` · **Verdict:** confirmed
- **Impact:** Two officers triaging the same week can silently undo each other's archiving or re-open items, which leads to duplicate follow-ups or lost closure.
- **Fix:** Send expectedStatus (or edit_revision) with action:'review'. Return 409 'Another officer moved this to Archived at 3:12 PM — reload' and refresh just that row. Show 'Last changed by X · time' on the row.
- **Verifier:** Reproduced (v2.mjs) with two browser contexts. A archived entry X. B still showed X under New and clicked Mark reviewed. B saw 'Submission moved to Reviewed.', the DB holds 'reviewed', and the audit reads review:closed,review:reviewed. api/admin.mjs:188 is a bare UPDATE with no expected-status check. The audit keeps both events, but the UI never tells B.

### inbox-7 · medium · bug · effort M — The 60s background refresh wipes text selection, shifts the list and re-fetches open activity

- **Where:** `backend/admin/index.js:449` · **Verdict:** confirmed
- **Impact:** An officer copying a message into an email loses the selection mid-copy. Reading is interrupted by jumps, and open timelines flicker and refetch.
- **Fix:** Don't rebuild the list in the background. Fetch counts plus the ids of new items, and show a 'N new submissions — Show' pill that inserts or reloads on click. If live patching is wanted, diff by entry id and update only badges/new rows, keeping existing DOM nodes.
- **Verifier:** Reproduced with a real mouse drag, not a programmatic selection (v2.mjs). Dragging across the message <pre> selected the text, and document.activeElement was BODY: clicking non-focusable text does not put focus inside #entries. After one 60s tick, getSelection() was ''. The re-fetch of the open Activity panel is confirmed in code: the rebuilt panel has loaded=false, and setting panel.open=true at index.js:460-461 fires 'toggle', which calls load() (submission-activity.js:89-91).

### inbox-8 · medium · bug · effort S — Auto-refresh silently stops while focus is in the list or any comment draft exists, yet the alert says 'Review the inbox below'

- **Where:** `backend/admin/index.js:426` · **Verdict:** confirmed
- **Impact:** The page tells officers new items are below when they are not. 'Refreshes every minute' (index.html:300) is effectively false for an active officer, which increases stale-state actions (inbox-6).
- **Fix:** Replace the silent skip with a visible 'N new — Show' affordance. Refresh counts immediately on visibilitychange/focus. Update the hint copy to describe the actual behavior.
- **Verifier:** Reproduced (v1.mjs). After a mouse click on a row summary, activeElement was SUMMARY inside #entries. A question inserted afterwards was not in the list after a tick, while #inbox-alert said new items were below. The draft case behaves the same way (see inbox-1). Code check: index.js:426-430 is the guard, index.js:814-817 skips polling when the tab is hidden and alerts are off, and grep finds no visibilitychange handler in admin/.

### inbox-10 · medium · bug · effort S — Unsaved comment drafts are discarded by Edit response, contact purge and tab close

- **Where:** `backend/admin/index.js:649` · **Verdict:** confirmed
- **Impact:** Officers lose notes they were writing when they fix a typo in the person's name, or when they close or reload the tab.
- **Fix:** Keep drafts on edit (only drop them when the entry is deleted). Add a beforeunload warning while commentDrafts.size > 0. Optionally mirror drafts in sessionStorage.
- **Verifier:** Reproduced (v3.mjs). I typed 'iv: half note' in a question's comment box, then used Edit response to change the name and clicked Save changes. Status read 'Response updated.' and the textarea was ''. index.js:649 runs commentDrafts.delete(result.entryId) on edits as well as deletes. index.js:662 clears every draft when a contact is purged (contact-history.js:346 calls onContactPurge with no argument). The only beforeunload handlers are in contact-history, event-editor, submission-editor (dialog-only) and survey-builder, so nothing protects comment drafts.

### inbox-11 · medium · ux-friction · effort S — Event questions are buried inside RSVP groups instead of Questions

- **Where:** `backend/admin/index.js:294` · **Verdict:** confirmed
- **Impact:** Questions are the items most likely to need a reply, yet event questions hide among RSVPs that usually need none, so they get missed or answered late.
- **Fix:** Group by kind first and show the event as a chip on the row, or group only RSVPs by event. Always list questions under Questions.
- **Verifier:** Reproduced (v3.mjs). A question with data.eventId (validation.mjs:126-134 adds eventId and eventTitle to event questions) landed in 'Office audit event · 9 on this page'. With Type=Questions the groups were ['Questions · 11 on this page','Office audit event · 1 on this page']. The cause is the grouping key at index.js:294-296.

### inbox-12 · medium · ux-friction · effort S — Count cards are not filters, ignore the status view, and omit past-event RSVPs

- **Where:** `backend/admin/index.js:405` · **Verdict:** confirmed
- **Impact:** The biggest, most prominent element on the page does nothing. The numbers don't match the badge or the current view, so officers can't tell how many reviewed or archived items exist, or why the title count is higher.
- **Fix:** Turn the cards into toggle buttons (aria-pressed) that set the Type filter. Show the count for the selected status (or New/Reviewed/Archived per card). Add a past-RSVP bucket or fold it into the RSVP card.
- **Verifier:** Reproduced (v3.mjs) with one past-event RSVP. The title showed (69) while the six cards summed to 68. The cards are DIV elements with tabIndex -1. Clicking one made 0 /api/admin requests and left Type unchanged. In code, the labels map (index.js:13-20) has no 'rsvp-past' entry, while api/admin.mjs:145 returns that bucket and index.js:357 counts it in the title.

### inbox-13 · medium · ux-friction · effort S — Pagination: no total, groups split across pages, scroll not reset, disabled buttons look active

- **Where:** `backend/admin/index.js:467` · **Verdict:** confirmed
- **Impact:** Officers can't tell how much is left. A type's items are split across pages, and after paging they land mid-list. The 'wait' cursor suggests something is loading.
- **Fix:** Show '1–50 of 54' (count(*) OVER() or a separate count). After paging, scroll the list top into view and focus the list heading. Consider compact rows with larger pages or 'Load more'. Use cursor:not-allowed and a neutral disabled style.
- **Verifier:** Reproduced (v3.mjs). Next moved scrollY from 7729 to 3140 (page 2 is shorter, so the browser clamped the scroll) and focus went to BODY. Page 2 showed six '· N on this page' groups. The disabled Next had cursor 'wait' and kept the accent background rgb(85,70,203) (style.css:75-78). No total count is returned (api/admin.mjs:137-152).

### inbox-15 · medium · bug · effort S — Deep-linked entry mode (#entry=) is invisible and can get stuck on an empty list

- **Where:** `backend/admin/index.js:159` · **Verdict:** confirmed
- **Impact:** A stale or deleted link makes the inbox look empty or broken even after changing filters. A valid link makes the inbox look like it has only one new item.
- **Fix:** Show a banner such as 'Showing one linked submission · Show all New'. Clear the hash on any filter, refresh or paging. If the id isn't found, say 'This submission no longer exists' and fall back to the normal view.
- **Verifier:** Reproduced (v2.mjs). /admin/#entry=<random uuid>, then Type=Questions, then Refresh, still showed 'No submissions match these filters.' with the hash kept: filters() swaps in id while the hash exists (index.js:159-165), and the hash is cleared only when the card is found (473-481). A valid link showed 1 row and also set the export href to '...&id=<uuid>&export=csv', because line 468 runs before line 480 clears the hash. A related problem, filed separately under missed: the single-entry view quietly ends after 60s.

### inbox-16 · medium · ux-friction · effort S — Archive has no undo; restoring means hunting in Archived; the status banner never dismisses

- **Where:** `backend/admin/index.js:274` · **Verdict:** confirmed
- **Impact:** A mis-click on 'Archive submission', which sits next to 'Mark reviewed', is easy to make and slow to reverse. The banner then gets in the way of reading.
- **Fix:** Show a toast with an Undo button (re-POST the previous status) that auto-dismisses after ~8s and has a close button. Keep it in the polite live region.
- **Verifier:** index.js:274-279 sets only a text status. #status is position:sticky at top:10px with z-index 5 (style.css:276-286) and is never cleared on a timer. I checked the restore path: Contacts & follow-up → Open submission does reach an archived entry (v5.mjs). So restoring is not 'hunting' 50 rows per page. It still takes 5 or more actions, and there is no Undo.

### inbox-17 · medium · accessibility · effort S — Keyboard focus is lost after a status change; result counts are never announced

- **Where:** `backend/admin/index.js:272` · **Verdict:** confirmed
- **Impact:** Keyboard and screen-reader officers have to Tab back through the list after every triage action and get no confirmation of what the new view contains.
- **Fix:** After a status change, focus the next entry's summary (or the group/list heading if none). After any load, announce 'Showing 12 reviewed questions' in a polite live region.
- **Verifier:** Reproduced (v1.mjs): activeElement was BODY after Mark reviewed. The list announces nothing after a load: #entries only toggles aria-busy (index.js:331, 490), and the status-tab handler (513-523) clears #status.

### inbox-18 · medium · bug · effort S — Submission fields render in JSONB key order with raw keys (article body before its title)

- **Where:** `backend/admin/index.js:230` · **Verdict:** confirmed
- **Impact:** Editors reviewing AI Review submissions can't see the title without scrolling past the whole draft. Marking a long submission reviewed on a phone takes 7 screens of scrolling.
- **Fix:** Use a per-kind ordered field schema with human labels (Subject → Message; Title → Draft (clamped with 'Show full draft'); Campus → Interests; Event → Date → Location). Put the action bar at the top of the expanded card or make it sticky inside it.
- **Verifier:** Reproduced (v3.mjs). For a contribution, the labels rendered were ['body','title']: jsonb puts shorter keys first, and index.js:230 iterates Object.entries. With a body of about 4,400 characters, the title sat 877px below the card top on desktop and the actions started at 1021px. The labels are raw lowercase keys (index.js:233).

### inbox-19 · medium · enhancement · effort S — Reply is a bare mailto link: no subject or context, not logged, no copy option

- **Where:** `backend/admin/index.js:201` · **Verdict:** confirmed
- **Impact:** Officers retype the context in every reply. Without a 'replied' marker, two officers can answer the same person or nobody does.
- **Fix:** Add a 'Reply' button with mailto:?subject=Re: <subject/topic/title> and a short quoted body, plus a 'Copy email' button. Offer 'Mark replied' to log an activity row (and optionally move the entry to Reviewed), and show 'Replied by X' on the row.
- **Verifier:** index.js:200-201: the link is address.href = 'mailto:' + entry.email, with no subject or body. Nothing logs that a reply was sent. Confirmed in code.

### inbox-26 · medium · bug · effort S — 'Export filtered CSV' exports the last applied filters, not what the dropdowns show

- **Where:** `backend/admin/index.js:468` · **Verdict:** found by verifier
- **Impact:** An officer exporting one event's attendee list gets every upcoming event's RSVPs and may share other students' details by mistake. After following a linked entry, Export quietly returns one row.
- **Fix:** Build the export URL from the current form state when Export is clicked, or apply every filter on change (see inbox-14). Show the filters being exported in the button or a confirmation line ('Export 12 New · Event RSVPs · Office audit event').

### inbox-27 · medium · bug · effort M — Session expiry (401) wipes a comment being typed and closes open editors

- **Where:** `backend/admin/index.js:143` · **Verdict:** found by verifier
- **Impact:** Sessions last 3 days. An officer who returns to an open tab and writes a long follow-up note or response edit loses all of it at the moment the expired session is detected, with no way to recover it.
- **Fix:** On 401 from a background or comment request, keep the office DOM and drafts. Show a re-sign-in banner or modal and retry after sign-in. At minimum, keep drafts in sessionStorage and restore them after sign-in. Run the same canLeave checks that Sign out uses (628-634) before tearing down editors.

### inbox-28 · medium · bug · effort S — A linked submission (#entry=) disappears from the view after the next 60s refresh

- **Where:** `backend/admin/index.js:480` · **Verdict:** found by verifier
- **Impact:** An officer who opens a submission from Contacts and is still reading or deciding sees it vanish a minute later, replaced by a full list that may not contain it. This is confusing and can lead to acting on the wrong card.
- **Fix:** Treat the linked view as an explicit mode: show a banner 'Showing one linked submission · Back to inbox'. Keep that filter until the officer leaves it, and never switch modes during a background refresh.

### inbox-29 · medium · bug · effort S — An officer's own 'Mark new' raises the 'New submissions arrived' alert and browser notification

- **Where:** `backend/admin/index.js:367` · **Verdict:** found by verifier
- **Impact:** The only 'new arrivals' signal fires on the officer's own actions, so officers learn to ignore it and miss real arrivals.
- **Fix:** Base arrival detection on max(created_at) only (or a server 'new since' id list), not on the count of New items. Skip notifying for changes made in this tab.

### inbox-31 · medium · bug · effort S — A failed attachment link opens a raw JSON error page, leaving the office and losing in-memory drafts

- **Where:** `backend/admin/index.js:240` · **Verdict:** found by verifier
- **Impact:** Editors reviewing AI Review submissions get sent to a raw JSON page whose wording is meant for the public, and lose unsaved notes.
- **Fix:** Download through fetch → blob, like the CSV export at index.js:43-89, and show errors in place. Or add a download attribute and check that the attachment is available first.

### inbox-32 · medium · enhancement · effort M — Rows show no follow-up state (comment count, last action, who acted)

- **Where:** `backend/api/admin.mjs:137` · **Verdict:** found by verifier
- **Impact:** In a shared inbox, officers can't see at a glance that 'Sam replied yesterday' or that an entry has 2 notes. This leads to duplicate replies or items nobody answers, especially in Reviewed, where follow-up 'may still be needed'.
- **Fix:** Add comment_count and the last audit action, actor and time to the list query (a LATERAL subquery on audit/entry_comments). Show it as a row chip ('2 notes · Reviewed by Sam · 1d') and offer a 'Has notes / No reply yet' filter.

### inbox-9 · low · bug · effort S — 'New submissions arrived' alert never clears

- **Where:** `backend/admin/index.js:369` · **Verdict:** confirmed
- **Impact:** The alert stays up after the officer has dealt with the new items, so they learn to ignore it.
- **Fix:** Clear it when the officer clicks Refresh, opens the New view, or reviews the new items. Better, make it a dismissible pill with the count and a Show button.
- **Verifier:** grep shows #inbox-alert written only at index.js:369 and cleared only in showLogin (137). Reproduced: the alert still showed in the Reviewed view after switching tabs (v1.mjs).

### inbox-14 · low · ux-friction · effort S — Type applies instantly but Event needs Apply; Apply is the most prominent control

- **Where:** `backend/admin/index.js:797` · **Verdict:** confirmed
- **Impact:** Officers can't predict when filters take effect. A big Apply button that does nothing for Type adds clutter, and the Event filter looks broken until Apply is clicked.
- **Fix:** Apply every filter on change and remove the Apply button, or keep it as a visually secondary fallback for keyboard submit.
- **Verifier:** Reproduced (v3.mjs): changing the Event select made 0 requests. Code check: the kind select has an onchange handler (index.js:797-805), and eventId has none. A worse consequence is that Export uses the stale filter; it is listed separately under missed.

### inbox-20 · low · ux-friction · effort S — Archived view mixes in custom-survey archives with a second pagination, which flashes every minute

- **Where:** `backend/admin/survey-archive.js:30` · **Verdict:** confirmed
- **Impact:** Two stacked pagers in the Archived view are confusing, the inbox pager is pushed away from its list, and the section blinks every minute.
- **Fix:** Move archived custom-survey responses to Surveys → Custom surveys (or a clearly separate tab), keep one pager directly under the inbox list, and never show a loading placeholder during background refresh.
- **Verifier:** Reproduced (v3.mjs). The navs in the Archived view are ['Submission status','Archived survey response pages','Submission pages']. survey-archive.js:29-30 swaps in 'Loading archived survey responses…' on every background tick unless a details element is open. index.js:469 calls it outside the draft/focus guard, so it reloads even while the inbox list is frozen.

### inbox-21 · low · copy · effort S — Entry card copy is redundant and noisy

- **Where:** `backend/admin/index.js:206` · **Verdict:** confirmed
- **Impact:** Low signal-to-noise makes scanning slower and pads each card's height.
- **Fix:** Show relative time ('2 h ago') with the absolute time in a tooltip/<time>. Show the email once as a link, drop 'Received in club inbox', move Reference into a copy-id menu, capitalize badges, and change group headings to 'Questions (8)'.
- **Verifier:** Confirmed in code: the time appears at index.js:175 and 189, the email at 174 and 200, 'Received in club inbox' at 206, and the group heading text at 311-314. The activityTime format includes seconds and the zone (event-activity.js:1-10).

### inbox-22 · low · enhancement · effort S — View and filter state is not in the URL; reload resets to New/All

- **Where:** `backend/admin/index.js:513` · **Verdict:** confirmed
- **Impact:** Officers can't bookmark or share 'Reviewed workshop requests', and a reload or session re-sign-in loses their place.
- **Fix:** Mirror status/kind/eventId/page/q into the query string with replaceState and read it on load (keep the #entry/#events hashes working).
- **Verifier:** Reproduced (v3.mjs). After Archived + Type=Workshop the URL was '/admin/'. After a reload the pressed tab was New and Type was ''.

### inbox-23 · low · enhancement · effort S — CSV export: generic filename, internal flags in 'Other details', no review history

- **Where:** `backend/lib/submission-export.mjs:91` · **Verdict:** confirmed
- **Impact:** Repeated exports pile up as 'club-submissions (3).csv' with no hint of filter or date. The spreadsheet contains internal noise and lacks the follow-up info officers often want.
- **Fix:** Name files like club-submissions-<status>-<type>-YYYY-MM-DD.csv. Exclude hasSurvey/potential, drop or rename 'Submission state', and add 'Last action / by / at' and 'Comments' columns.
- **Verifier:** The download name is hard-coded at index.js:74 and api/admin.mjs:132. knownFields (submission-export.mjs:18-31) leaves out 'potential' and 'hasSurvey', which validation.mjs:100-104 stores on every RSVP, so they end up in 'Other details'. There are no review-history columns.

### inbox-24 · low · accessibility · effort S — Small touch targets; 'Delete permanently' looks identical to benign actions

- **Where:** `backend/admin/style.css:70` · **Verdict:** confirmed
- **Impact:** Thumb-tapping the wrong control on a phone is likely, and the destructive action sits beside Edit response with no visual warning (the confirm dialog does mitigate this).
- **Fix:** Give summaries/links at least 44px tap areas on touch. Give Delete permanently a danger style and separate it from the status buttons (e.g. inside an overflow menu).
- **Verifier:** Reproduced (v3.mjs). In the Archived view, Edit response, Delete permanently, Mark reviewed and Mark new all compute to bg rgb(255,255,255) with text rgb(32,32,43). '.danger' is styled only under .submission-dialog and .contact-dialog (style.css:1368, 1674). I did not re-measure tap heights, but summary is 13px with no padding (style.css:202-206), which fits ~20px. The confirm dialog does mitigate the delete risk.

### inbox-25 · low · enhancement · effort S — No sort option; grouping hides overall chronology

- **Where:** `backend/api/admin.mjs:140` · **Verdict:** confirmed
- **Impact:** When working through a backlog, officers can't handle oldest-first (FIFO) or see the most recent items across all types at a glance.
- **Fix:** Add a Newest/Oldest toggle in the toolbar, and offer an ungrouped chronological list with type chips as the default dense view.
- **Verifier:** Confirmed in code: 'ORDER BY e.created_at DESC,e.id' is fixed (api/admin.mjs:140), and groupedEntries orders groups by first appearance (index.js:291-300). On page 2 (v3.mjs) the order was AI Review submissions, Club signups, subscription, event, Questions, Workshop requests, which is not chronological.

### inbox-30 · low · bug · effort S — A failed background refresh leaves a sticky 'Could not connect' banner after the connection recovers

- **Where:** `backend/admin/index.js:486` · **Verdict:** found by verifier
- **Impact:** After a Wi-Fi drop or laptop sleep, which is common on phones, officers see a permanent connection error while data is in fact refreshing. They may distrust the list or assume their actions are failing.
- **Fix:** Don't show background-refresh errors in the main status banner. Use a subtle 'Last updated 3 min ago · Retry' indicator, and clear it on the next successful load.

### inbox-33 · low · enhancement · effort S — Inbox entries have no 'Contact history' jump, although survey responses do

- **Where:** `backend/admin/index.js:246` · **Verdict:** found by verifier
- **Impact:** Before replying to a question, an officer can't quickly check whether this person has asked before, signed up, or has officer notes.
- **Fix:** Add a 'Contact history' action to each entry that calls contacts.open(entry.email). Consider showing '3 other submissions' on the row.

### inbox-34 · low · accessibility · effort S — Keyboard Refresh drops focus to <body>; the Inbox pane has no heading

- **Where:** `backend/admin/index.js:332` · **Verdict:** found by verifier
- **Impact:** Keyboard users lose their place on every Refresh. Screen-reader users can't jump to the Inbox or the entry list by heading.
- **Fix:** Don't disable the focused Refresh button: use aria-busy or aria-disabled and ignore clicks while loading. Add an 'Inbox' h2 and a list heading ('New · 12 submissions') that receives focus after paging or status changes.

## Contacts & follow-up

Contacts & follow-up is one native <dialog> built by admin/contact-history.js. It is mounted from admin/survey-results.js (lines 27-30 and 63-67), which also adds the "Contacts & follow-up" button to the Inbox heading and to the Event surveys toolbar, plus a "Contact history" button on each event-survey response card (line 355). Inbox submission cards get no such button (index.js 200-288). All contact traffic goes through /api/surveys (api/surveys.mjs 42-74): GET ?contacts=1&search&view&offset returns the directory, 50 per page. GET ?contact=<email> returns one person's timeline, which UNIONs entries, entry comments, contact notes, entry audit rows and contact_activity (lib/contacts.mjs 47-86). POSTs handle contact-note and contact-merge/test/delete/restore/purge (lib/contacts.mjs 87-341) and contact-edit/contact-remove-alias (lib/contact-profile.mjs). Migration 015 adds the contact_emails alias table, revision/is_test/deleted_at columns, contact_activity, a durable file-deletion queue, and a capture trigger that serializes identity changes. Migration 017 adds name_locked. In practice an officer clicks the button and types a query, then has to press Search, because search is submit-only and focus lands on Close. They pick one of several near-identical cards. The person view repeats the directory search chrome, then shows the header lines, a management bar (Edit / Mark as test / Merge / Delete), a note form and a flat 50-per-page timeline. Every destructive action uses an inline confirmation panel inside the dialog, not a native confirm(). Purge also requires typing the primary email. The only native confirm() is the sign-out discard prompt (contact-history.js 585-591), plus beforeunload. Strategic direction: (1) put contact context where triage happens: a "Contact history" button and a "returning contact" summary on each Inbox card. (2) Turn the person view into a profile layout: a compact header with mailto and copy, the follow-up note composer at the top, a labelled and filterable timeline that shows each submission's status, and identity tools moved into an overflow or "Manage identity" section. (3) Make identity changes safe: richer merge candidates, a merge preview, an unmerge or unlink path, scoped drafts and audit receipts for purges. (4) Fix focus, scroll and feedback placement so keyboard users and phone users keep their place.

### contacts-1 · high · ux-friction · effort S — Inbox submission cards have no way to open the submitter's contact history

- **Where:** `backend/admin/index.js:246` · **Verdict:** confirmed
- **Impact:** While triaging, the most natural moment to check whether someone has written before, or to record a follow-up, the officer has to open the global dialog, retype the email, press Search and pick the right card. Most officers will never connect submissions with notes, so the follow-up feature goes largely unused.
- **Fix:** Add a 'Contact history' (or 'Person') button to every Inbox card that calls the same contacts.open(entry.email) used by survey-results. Better still, show a small 'Returning contact · N submissions · last note <date>' line on the card. That needs the counts from contactList joined in /api/admin, or a lazy fetch when the card expands.
- **Verifier:** Reproduced on a private copy of the office fixture (my own seeded rows, not the shared :60284 DB). Expanding the first Inbox card shows only ['workshop@example.edu', 'Edit response', 'Mark reviewed', 'Archive submission'], and getByRole('button', /contact/i) inside the card returns 0. renderEntry (admin/index.js 200-287) adds only the mailto link and the review buttons. survey-results.js:355 gives survey cards contacts.open(response.email), and nothing equivalent is passed into index.js. High stands: the Inbox is where triage happens, and the global button means retyping the person and an …

### contacts-2 · high · bug · effort M — Merging the wrong person is easy and cannot be undone from the UI

- **Where:** `backend/admin/contact-history.js:478` · **Verdict:** confirmed
- **Impact:** Student names repeat often, so an officer can conflate two people. The fault is then permanent without database work, and every later submission from either person is filed under the wrong identity.
- **Fix:** (a) Enrich candidate cards with submission count, kinds, the last-seen date and the names used. (b) Show a side-by-side preview before Confirm and state plainly that the merge links future submissions too. (c) Add 'Unlink this address', which moves an alias back to its own contact row. The original contacts row still exists after a merge, so unlinking is feasible: set contact_emails.contact_email back to the alias and log contact_activity. (d) Say which record is being absorbed: you are viewing A, and the label 'Find the contact to keep' means A disappears into B.
- **Verifier:** Reproduced with two seeded 'Riley Chen' contacts (e1234567@ Eastfield join, rchen2@ RAG question). The merge candidate card read only 'Riley Chen / rchen2@dcccd.edu / Regular contact'. The confirm copy was 'Keep Riley Chen (rchen2@dcccd.edu) and link e1234567@dcccd.edu. 2 website submission(s) will appear together. No original answers, emails or notes will be rewritten.' It never says the merge is permanent or covers future submissions. Afterwards 'Remove unused address' on e1234567 was disabled ([true]) and no unlink, unmerge or split control existed. Server: lib/contacts.mjs 228-231 only …

### contacts-3 · medium · bug · effort S — Unsaved profile draft from one contact is pre-filled into a different contact's editor after a merge

- **Where:** `backend/admin/contact-history.js:318` · **Verdict:** confirmed
- **Impact:** An officer who clicks Save will rename the kept contact and switch its primary address to the absorbed one, an edit to the wrong record made from leftover state the officer cannot see.
- **Fix:** Clear profileDrafts for every address in contact.emails on result.merged (and on any successful management action). Scope drafts to the contact revision they were made on, and show 'Unsaved changes restored from <time>' with a Discard button whenever contactProfile() starts from a draft.
- **Verifier:** Reproduced: on m8@ I typed the name 'Draft name typed on A' in Edit contact, then merged into m9@ without cancelling. On m9@, Edit contact showed name='Draft name typed on A' and primary='m8@example.org', with no restored or unsaved notice. Cause: save() clears profileDrafts only for edited/purged/deleted (contact-history.js 318-320), and edit.onclick searches contact.emails (537-540). I lowered it to medium. After the merge A and B are by definition the same person, and the leftover values are visible in the fields, not hidden. The real harm is that Save would silently undo the merge's …

### contacts-4 · medium · bug · effort S — Purging a test contact wipes every unsaved Inbox comment draft, including drafts on unrelated submissions

- **Where:** `backend/admin/survey-results.js:29` · **Verdict:** confirmed
- **Impact:** Silent loss of typed follow-up text. docs/forms-admin.md promises that unsaved comment text stays in memory during inbox refreshes.
- **Fix:** Pass the purge result through: onContactPurge(result). In index.js, delete drafts only for entries belonging to the purged addresses, or simply keep drafts whose entry is still present after load().
- **Verifier:** Reproduced: I typed 'UNSAVED: called them, will email agenda' into join@'s Activity & comments box, then marked purgeme@ as test and purged it, then closed the dialog. The join@ card was still open (true), but the textarea value was "". Code path: survey-results.js:29 `if (result.purged) onContactPurge();` (no argument) leads to index.js 659-664 `else commentDrafts.clear()`. submission-activity.js restores comment text only from that map (input.value = drafts.get(entry.id)?.text), so the text is gone for good.

### contacts-5 · medium · copy · effort S — Timeline shows raw machine codes ('review:closed', 'survey-starred') and raw kinds ('Open response: subscribe')

- **Where:** `backend/admin/contact-history.js:218` · **Verdict:** confirmed
- **Impact:** Officers see developer jargon in the main follow-up view, and activity rows carry the same large h3 weight as real submissions, which makes the timeline noisy and harder to scan.
- **Fix:** Share one action-label map (review:*, download-attachment, submission-edited, comment-added, survey-starred/unstarred/archived/restored) between submission-activity.js and contact-history.js. Map kinds through the existing `labels` object in contact-profile.js. Render officer activity as a compact one-line row instead of an h3 card.
- **Verifier:** Reproduced: after Mark reviewed on question@, the contact timeline headings were ['review:reviewed', 'Question']. lib/contacts.mjs:74 passes a.action through unchanged, and lib/survey-management.mjs 78-84 writes 'survey-starred' and 'survey-archived' to the same audit table. submission-activity.js 2-9 already maps the review:* codes but is not reused. On the alias side, lib/contact-profile.mjs:15 falls back to e.kind, and after the merge test the link read 'Open response: join'.

### contacts-8 · medium · ux-friction · effort M — Person view repeats the directory search chrome; on a phone the person's history starts more than one screen down

- **Where:** `backend/admin/contact-history.js:59` · **Verdict:** confirmed
- **Impact:** On a phone, officers scroll past search controls and destructive identity buttons to reach what they came for (recent submissions and a note box). Delete sits beside Edit in the first row of actions.
- **Fix:** Treat the person view as its own screen. Collapse or hide the search form (keep only '← All contacts'), use a compact header (name, primary email with mailto/copy, linked emails, badges), then put the note composer and the timeline first. Move Edit, Merge, Mark as test and Delete into a 'Manage identity' disclosure or an overflow menu at the bottom. Rewrite the intro to 'Find a person to see everything they've submitted and record follow-up.'
- **Verifier:** Reproduced at 390x844: dialog clientHeight 758, note form offsetTop 836, first history item offsetTop 1077, with no horizontal overflow (scrollWidth 354 = clientWidth 354). The person view still renders the intro, the search field, the 'Show contacts' select and the filled 'Search contacts' button (contact-history.js 59-67). The management row reads Edit contact, Mark as test, Merge, Delete contact, with Delete in the first row of actions (screenshot c15-purge-confirm.png).

### contacts-10 · medium · ux-friction · effort M — Timeline cards strip context: unlabeled values, missing join fields, no current status, comments don't say which submission

- **Where:** `backend/admin/contact-history.js:237` · **Verdict:** confirmed
- **Impact:** Officers can't answer 'what did this person ask, and is it handled?' from the contact view. They have to open each submission, which closes the dialog (see contacts-11).
- **Fix:** Render labelled fields with the same formatter the Inbox uses. Show each submission's status badge (New / Reviewed / Archived) with inline Mark reviewed / Archive buttons. Nest comments and activity under their submission, or prefix them with its title. Add a filter (All / Submissions / Notes / Activity).
- **Verifier:** Reproduced: the join@ timeline card reads 'Club signup | <time> · Office join | join@example.edu | Example topic | Saved join example | Open submission'. Campus 'Richland' does not appear (0 matches). The RSVP card reads 'Office audit event | 2030-10-04' with no labels. The whitelist is in contact-history.js 237-255, and lib/contacts.mjs:68 selects no review_status, so the contact view cannot show status at all. Comment rows carry only source_email plus 'Open submission'.

### contacts-11 · medium · ux-friction · effort M — 'Open submission' is a one-way trip: the dialog closes, search resets, and there is no route back to the person

- **Where:** `backend/admin/contact-history.js:259` · **Verdict:** confirmed
- **Impact:** Reviewing several of a person's submissions means repeating search, then select, then scroll for each one. Officers also can't share 'look at this person' with each other.
- **Fix:** Open the submission in a side panel or nested dialog over the contact, or keep a 'Back to <name>' affordance after navigating. Add a #contact=<email> hash route so the dialog can be reopened, bookmarked and shared. Remember the last search and person between opens.
- **Verifier:** Reproduced: clicking 'Open submission' closed the dialog (open=false). Reopening Contacts gave heading 'Contacts' and an empty search. The close handler clears content and search (contact-history.js 73-78), and the router has no #contact= route (index.js 743-784). It also has a side effect: load() calls selectInboxStatus(linkedEntry.review_status), then history.replaceState removes #entry= (index.js ~349, 480). The officer's Inbox status filter is silently switched, for example to Archived, and stays that way after the next refresh.

### contacts-13 · medium · security · effort M — No erasure path for real people (privacy requests), and purges leave no audit receipt

- **Where:** `backend/lib/contacts.mjs:267` · **Verdict:** confirmed
- **Impact:** To honor a real deletion request, an officer has to mislabel the person as a 'test contact'. Afterwards nothing records who erased which person, when, or why, so the club can't show that a request was fulfilled or detect a mistaken or abusive purge.
- **Fix:** Add an explicit 'Erase person (privacy request)' action that has the same typed-email guard and an optional reason field. Write a PII-free receipt (actor, time, hashed email, counts, reason) to audit, or add a contact_erasures table, for both test purges and erasures. Keep 'Mark as test' for genuine test data only.
- **Verifier:** Confirmed by code and run. The purge branch (lib/contacts.mjs 266-313) deletes audit rows for the purged entries (289-292) and contact_activity (301-304) and inserts nothing. In my run the audit table had zero rows right after a purge. Permanent deletion of a single submission does write a receipt (lib/submission-management.mjs 188-190 'submission-permanently-deleted'). docs/forms-admin.md:41 says the privacy page explains how to request deletion. Because notes are append-only (014 grants only SELECT and INSERT), Mark as test then purge is the only way to remove a real person who has notes.

### contacts-18 · medium · ux-friction · effort M — Directory cards lack distinguishing context and paging feedback; '← All contacts' always returns to page 1

- **Where:** `backend/admin/contact-history.js:106` · **Verdict:** confirmed
- **Impact:** Hard to pick the right person among same-name students, and paging through the directory loses your place every time you look at someone.
- **Fix:** Use a dense table or list row: name, primary email, last activity date, submission-type chips, a note count or last note date, and Test/Deleted badges. Show 'Showing 51-100 · page 2'. Preserve offset and search on back. Fix pluralization.
- **Verifier:** Reproduced: on page 2 the status still read 'Select a contact to see their history.' with no page number or range. I opened bulk37 from page 2 and clicked back, and Previous was disabled (page 1). Each card is about 117px tall, and cards read '1 website submissions'. One correction: the search text IS kept on back, because only offset is reset (contact-history.js 138-141) and search.value stays. Only the page is lost.

### contacts-19 · medium · ux-friction · effort M — Search is submit-only, not focused on open, and ignores note and submission content

- **Where:** `backend/admin/contact-history.js:32` · **Verdict:** confirmed
- **Impact:** Officers often remember what someone asked ('the RAG workshop person'), not their e-number. Every lookup costs extra clicks.
- **Fix:** Autofocus the search input. Debounce as-you-type search (about 250ms, as Surveys does). Optionally add a 'Search notes and submissions too' toggle that matches contact_notes.body and entries.data text (bounded, admin-only).
- **Verifier:** Reproduced: after opening, focus was on 'BUTTON:Close'. Typing 'riley' left the search field empty. Filling the field without submitting kept the unfiltered 50 cards; only Search narrowed it to the two Riley cards. Searching 'RAG' (the subject of a seeded question) returned 'No matching contacts.' because lib/contacts.mjs 37-40 matches only emails and names. The view select reloads on change (contact-history.js 565-569) while the text field needs submit (559-564).

### contacts-20 · medium · enhancement · effort L — Follow-up is free-text only: no 'needs follow-up' state, owner or due date, and notes can't be corrected

- **Where:** `backend/lib/contacts.mjs:87` · **Verdict:** confirmed
- **Impact:** Weekly volunteer officers can't see who still needs a reply or who took it. Handoffs between officers depend on reading every timeline, and mistakes in notes are permanent.
- **Fix:** Add a lightweight follow-up status on the contact (Needs follow-up / Waiting on them / Done), an optional assignee (an officer email) and a due date, recorded in contact_activity. Add a 'Needs follow-up' directory filter and an Inbox badge. Allow 'Retract note' (soft-hide with audit) instead of hard edits, so the append-only guarantee holds.
- **Verifier:** Confirmed by code. 014_event_response_management.sql:49 grants only SELECT and INSERT on contact_notes. addContactNote (lib/contacts.mjs 87-140) only inserts. There is no edit or retract UI, and contactList selects no follow-up state. This is an enhancement rather than a defect, but a note saved on the wrong person can only be removed by purging that person as a test contact.

### contacts-m1 · medium · bug · effort S — Every 'Save contact changes' locks the name, even a no-op save or an email-only edit, so blank or stale names never update and the log says the name changed

- **Where:** `backend/lib/contact-profile.mjs:155` · **Verdict:** found by verifier
- **Impact:** Officers fixing an address, or just pressing Save, silently freeze the directory name. For newsletter subscribers it stays blank forever, so they are listed and searched by email only. The timeline then claims the officer renamed the person.
- **Fix:** Lock the name only when the submitted name differs from contact.name and is non-blank. Disable Save until the form is dirty. Log 'Updated the contact name' only when it changed. Show a 'Name set by officer · Use latest submitted name' toggle that clears name_locked.

### contacts-m2 · medium · bug · effort S — Session expiry silently wipes unsaved follow-up notes and profile edits

- **Where:** `backend/admin/contact-history.js:600` · **Verdict:** found by verifier
- **Impact:** A volunteer loses a typed follow-up note at the moment they try to save it, with no warning and nothing to recover.
- **Fix:** Keep contact drafts in memory tagged with the officer's email. Restore them if the same officer signs back in, and clear them only on explicit sign-out or when a different user signs in. Alternatively, put the note text in the 401 message as copyable text ('Your note was not saved: …').

### contacts-6 · low · ux-friction · effort S — After a 409 'This contact changed', there is no Refresh control and the stale confirmation stays armed

- **Where:** `backend/admin/contact-history.js:347` · **Verdict:** confirmed
- **Impact:** The officer is told to refresh but given nothing to refresh with. The workaround (← All contacts, then re-select) isn't obvious, and repeated clicks just repeat the error.
- **Fix:** On a 409, automatically reload the contact (preserving profile and note drafts) and show the error next to the action that failed, for example 'Someone else updated this contact. Review the latest history and try again.' Alternatively, add a 'Reload contact' button in the confirmation panel and the header.
- **Verifier:** Reproduced with two contexts. B saved a note on heavy@ while A had the Mark as test confirmation open. A then got 'This contact changed. Refresh its history and review the action again.' at status y=285 while the Confirm button sat at y=690. The confirm button stayed enabled, a second click repeated the same error, A did not see B's note, and no refresh, reload or retry button was visible. I lowered it to low. Revision bumps come only from another officer's action or from that person submitting at the same moment (the capture trigger), which is rare for a small club. '← All contacts' then …

### contacts-7 · low · accessibility · effort S — Keyboard focus is dropped to <body> after almost every action in the dialog

- **Where:** `backend/admin/contact-history.js:83` · **Verdict:** confirmed
- **Impact:** Screen-reader users lose their place and get no announcement of the new view. Keyboard users have to tab back through Close, search, filter and Search before reaching the content.
- **Fix:** Focus the search input on open. After a contact loads, focus the h2 (tabIndex=-1) or the '← All contacts' button. After a note saves, focus the new note or the textarea. After Delete or Purge, focus the list status. Have Cancel fall back to the button that opened the panel (pass it into confirm()).
- **Verifier:** Reproduced: document.activeElement was BODY after selecting a contact by click or by Enter, after Confirm mark as test, and after Save note. On a deleted contact, Cancel in a confirmation also left BODY, because merge.focus() targets a detached button (contact-history.js 398, 553). Part of the claim is refuted: after Enter-selecting a contact, the next Tab landed on '← All contacts', because Chrome keeps the focus-navigation starting point. Keyboard users therefore do not have to tab back through Close, search and filter. The cost falls mainly on screen-reader users, so I set it to low. The …

### contacts-9 · low · ux-friction · effort S — Saving a note jumps the scroll position and shows its confirmation off-screen

- **Where:** `backend/admin/contact-history.js:203` · **Verdict:** confirmed
- **Impact:** On a phone the officer can't tell whether the note saved without scrolling around, and loses their reading position in the timeline.
- **Fix:** Insert the saved note into the timeline in place (or re-render without wiping the composer), keep the scroll position, show 'Saved' next to the Save button (the noteStatus element already exists), and briefly highlight the new note.
- **Verifier:** Half reproduced. At 390x844, with both a 1-item history and a 40-note history, the dialog scrollTop went from 553 before Save note to 0 after, and focus was BODY. That confirms the jump in reading position. The second half, a confirmation shown off-screen, did NOT reproduce. load() empties content, which clamps scrollTop to 0, so the 'Follow-up note saved.' status at about 393px from the dialog top was visible in every run. I lowered it to low: the officer loses their place, but they can see that the note saved.

### contacts-12 · low · bug · effort S — A soft-deleted person who submits again is invisible in the Active directory, and the Inbox gives no hint

- **Where:** `backend/lib/contacts.mjs:36` · **Verdict:** confirmed
- **Impact:** An officer looking up a person who just wrote in is told they don't exist, unless they think to switch the filter to Deleted or All.
- **Fix:** Under Active, when there are no matches, also search deleted contacts and offer 'One deleted contact matches — show it / restore it'. Flag new submissions from deleted contacts in the Inbox and the contact view ('This contact was deleted on <date> by <officer>'). Consider auto-restoring, or at least prompting, when a deleted contact submits again.
- **Verifier:** Reproduced: I deleted del6@, inserted a new workshop entry from del6@, then searched 'del6@' under Active: 'No matching contacts.' 0, and the DB still has deleted_at set. This behaviour is documented and intended (docs/forms-admin.md: 'New submissions do not silently restore a deleted contact.'), and soft-deleting regular contacts is uncommon. So this is a discoverability gap, not a logic bug, and I lowered it to low. The view also never shows deleted_by or deleted_at even though contactHistory returns c.*. The status says only 'Deleted contact ·'.

### contacts-14 · low · copy · effort S — 'Remove test flag?' confirmation describes deletion, not what unmarking does

- **Where:** `backend/admin/contact-history.js:410` · **Verdict:** confirmed
- **Impact:** Confusing at the moment an officer is deciding about the test flag. It reads as if unmarking deletes something.
- **Fix:** Use 'This person will be treated as a regular contact again. Permanent deletion will no longer be available; Delete will hide them from the directory instead. No records change.'
- **Verifier:** Reproduced: Unmark as test opened 'Remove test flag? / Deleting this contact will keep their submissions and allow restoration.' (contact-history.js 409-411). That copy describes Delete, not what unmarking does.

### contacts-15 · low · ux-friction · effort S — Irreversible confirm buttons look identical to ordinary primary buttons

- **Where:** `backend/admin/contact-history.js:381` · **Verdict:** confirmed
- **Impact:** Nothing visual sets the permanent-erase and merge buttons apart from routine saves, which weakens the guard.
- **Fix:** Give .contact-dialog .danger a red fill or outline with a warning icon (both themes), and keep Merge, Unmark and Mark as test confirms neutral so that red means 'cannot be undone'.
- **Verifier:** Reproduced in light and dark screenshots (c15-purge-confirm.png, dark-person.png). 'Delete test contact permanently' and 'Confirm mark as test' are filled purple, the same as 'Search contacts' and 'Save note'. .contact-dialog .danger (style.css 1674-1676) only changes border-color, while .submission-dialog .danger (1368-1372) has a real red treatment. The styling is also inverted: the trigger ('Permanently delete test contact', class 'secondary danger') shows a red outline, and the irreversible confirm looks like a routine primary action.

### contacts-16 · low · bug · effort S — Blank contact name is accepted and permanently locks out future name updates

- **Where:** `backend/lib/contact-profile.mjs:155` · **Verdict:** confirmed
- **Impact:** An accidental clear leaves the person nameless in the directory, and new submissions with their real name will never fix it.
- **Fix:** Either require a non-empty name, or treat a blank name as 'use the latest submitted name' by setting name_locked=false. Show a 'Name locked by officer edit · Unlock' hint in the editor.
- **Verifier:** Reproduced: clearing bulk59's name and saving gave status 'Contact updated', the heading fell back to the email, and the DB had name='' and name_locked=true (lib/contact-profile.mjs 46-50, 155-157). The root cause is broader than a deliberate clear: every save locks the name, including no-op saves and email-only edits of nameless subscribers. That broader case is logged separately as contacts-m1.

### contacts-17 · low · ux-friction · effort S — A typo in Primary email silently creates and promotes an address the person never used

- **Where:** `backend/lib/contact-profile.mjs:117` · **Verdict:** confirmed
- **Impact:** The directory can display an address the person never wrote from, and officers emailing them would use the wrong one.
- **Fix:** Make 'Use as primary' (choose one of the linked addresses) the default control. When a typed address has no submissions, show an inline warning ('No submission has used this address — keep it as primary?') before saving.
- **Verifier:** Reproduced: changing typo@dcccd.edu to typo@dccd.edu saved with 'Contact updated. Its history stays together under this primary email.' and the header read 'Primary email: typo@dccd.edu'. There was no warning that no submission ever used that address (lib/contact-profile.mjs 117-153).

### contacts-21 · low · enhancement · effort S — Primary email in the contact header is plain text: no mailto or copy

- **Where:** `backend/admin/contact-history.js:145` · **Verdict:** confirmed
- **Impact:** Replying to someone after reviewing their history means selecting text by hand, which is awkward on a phone.
- **Fix:** Render the primary and linked emails as mailto links with a 'Copy' button, which suits the page's 'does not send emails' stance. Consider a 'Copy all addresses' action for merged contacts.
- **Verifier:** Reproduced: the contact header has 0 a[href^='mailto:'] links. contact-history.js:145 renders 'Primary email: ' + email as a plain <p>, while the Inbox card links the same address with mailto (index.js 200-201).

### contacts-m3 · low · bug · effort S — Note drafts become invisible after another officer merges or re-primaries the contact, or after a soft delete, but still trigger leave and sign-out prompts

- **Where:** `backend/admin/contact-history.js:170` · **Verdict:** found by verifier
- **Impact:** The officer's typed note seems lost. The browser keeps warning about unsaved changes they cannot find, and sign-out asks them to discard contact notes they cannot see.
- **Fix:** Look up note drafts across every address in contact.emails, as profile drafts already do. For a deleted contact, show the draft read-only with 'Restore this contact to save this note'. List outstanding drafts by person in the leave and sign-out prompt.

### contacts-m4 · low · ux-friction · effort S — Purge confirmation requires a case-exact email and gives no mismatch hint

- **Where:** `backend/admin/contact-history.js:391` · **Verdict:** found by verifier
- **Impact:** An officer cleaning up test data (for example, after a phone keyboard auto-capitalizes) sees a dead button with no explanation and may assume the feature is broken.
- **Fix:** Compare case-insensitively on both client and server (email addresses here are already normalized to lowercase). Add a live hint such as 'Doesn't match bulk30@example.org yet'.

## Event editor

The event editor is one vanilla-JS module, mountEventEditor in backend/admin/event-editor.js. It drives a static form in backend/admin/index.html (lines 350-651): a left "Event library" list with Active/Archived toggles and title search, a read-only overview built by admin/event-overview.js, and a long single-column form in five numbered fieldsets (essentials, when & where, story, images, RSVP survey). A sticky bottom bar holds Save draft / Preview / Publish event, and a second row under the form holds Duplicate / Unpublish / View / Archive / Restore. Rich-text fields get a markdown-ish toolbar (admin/text-formatting.js). RSVP questions use their own builder (admin/survey-editor.js); the custom-survey builder uses a different one (survey-choices.js). Activity history comes from admin/event-activity.js. Every save is a POST to api/events.mjs. The server validates with lib/event-content.mjs draftContent, which handles Central time and DST, stops at the first error, and only then do the lifecycle checks run. lib/events.mjs saveEvent then writes draft and published JSON separately, with an optimistic revision check (409 on mismatch) and a full snapshot in event_history (migrations 006/008). Images are uploaded as base64 JSON and re-encoded by sharp to 1800px WebP in private Vercel Blob storage (lib/event-assets.mjs). Preview posts unsaved content to the server for validation, then sends it by postMessage to an iframe of the public club.html. Today an officer picks an event from the list, which opens a READ-ONLY view. They press "Edit event", scroll a 5,000-5,400px form, and press Save or Publish. That drops them back into read-only, and they press Edit again to keep working. Validation errors come back one at a time in a sticky banner at the top of the page.

### events-1 · critical · bug · effort M — Session expiry during save silently wipes the whole unsaved event (text, agenda, survey questions, images)

- **Where:** `backend/admin/index.js:111` · **Verdict:** confirmed
- **Impact:** An officer who spends 20-30 minutes writing an event, then saves after their 72-hour session has ended, loses everything with no warning and no recovery. The fixed lifetime makes this likely for someone who signed in days earlier.
- **Fix:** On 401 while editing, do not clear the editor. Keep the form in memory, open sign-in in a dialog or new tab, and retry the save after re-authentication. Also keep a per-event local draft backup (localStorage keyed by event id + revision, cleared on successful save) and offer 'Restore unsaved changes from <time>?' when the editor opens. Optionally warn about 10 minutes before the session ends.
- **Verifier:** Code: index.js 111-114 runs showLogin() on any 401; showLogin calls editor.clear() (line 147), which runs form.reset(), survey.set() and images=[] (event-editor.js 631-655). No localStorage is used anywhere in event-editor.js. Session is a fixed 3-day window with refresh disabled (admin-session.mjs 8; auth.mjs session.disableSessionRefresh:true). The impact is wider than 'during save': the 60-second inbox poll (index.js 814-817) also gets the 401 and wipes the form with no action from the officer. I reproduced that (see events-27). This also contradicts docs/event-editor.md, which says 'The …

### events-27 · critical · bug · effort M — Unsaved event edits are wiped within 60s of session expiry by the inbox background poll, with no Save click

- **Where:** `backend/admin/index.js:814` · **Verdict:** found by verifier
- **Impact:** An officer who signed in close to 3 days ago (fixed window, refresh disabled) can lose a half-written event while typing, without pressing anything. No beforeunload or confirm prompt appears, and nothing can be recovered.
- **Fix:** Same root fix as events-1: on 401, never call editor.clear() while the editor is dirty. Show a re-auth overlay over the preserved form and retry. Make background polls skip showLogin, or just show a 'Session ended' banner, when the event or survey editor is dirty. Add a local draft backup keyed by event id and revision.

### events-2 · high · bug · effort S — Pressing Enter in any one-line field saves the draft and drops out of edit mode; Enter in 'New type name' never adds the type

- **Where:** `backend/admin/event-editor.js:492` · **Verdict:** confirmed
- **Impact:** Pressing Enter after typing a title, location or question is a reflex. Officers are thrown out of the editor, a half-finished draft is saved under their name, and 'Add type' looks broken to anyone using the keyboard.
- **Fix:** Block implicit submission: ignore submits whose submitter is not an explicit button click, or handle keydown Enter on inputs. Make Enter in #new-type-name trigger Add type. Move the type manager out of the form, or make it a non-submitting widget.
- **Verifier:** Reproduced (v1.cjs). Enter in the title gave 'Draft saved successfully... Editing is complete.' with formHidden=true. Enter in #new-type-name did the same, #type-status stayed empty, and the typed type name was left in the box (screenshot v1-e3.png). Enter in Location also saved and exited. Cause: form.onsubmit (event-editor.js 492-495) treats implicit submission as submitter 'Save draft', the first submit button (index.html 573-580). Nothing in text-formatting.js intercepts Enter; it only handles Ctrl+B and Ctrl+I in textareas.

### events-3 · medium · ux-friction · effort M — Validation runs only on the server, one error at a time, in a global banner with no field highlight; focus falls to <body>

- **Where:** `backend/lib/event-content.mjs:62` · **Verdict:** confirmed
- **Impact:** Officers fix errors by trial and error and must hunt through a 5,000px form for the bad field. Keyboard and screen-reader users lose their place after every failed save.
- **Fix:** Check the date/time rules, https link, and publish-required date on the client as fields change, and show messages inline (aria-invalid plus aria-describedby). Have the server return field keys (e.g. {field:'endTime'}) so the client can scroll to and focus the field. After any save, restore focus to the submitter or the first invalid field.
- **Verifier:** Reproduced: end 17:00 before start 18:00 gave the server message in #event-status, activeElement=BODY, and 0 aria-invalid fields. One correction: validation is not server-only. The native required attribute on the title and type=url on the meeting link do block the submit and focus the field ('Please fill out this field.' / 'Please enter a URL.'). The date/time, https and survey rules are server-only. Also, draftContent checks surveyQuestions (section 05, line 83) before the date/time rules (section 02, lines 125-141), so errors arrive out of form order. Severity lowered to medium because …

### events-4 · medium · ux-friction · effort M — Edit conflicts can only be resolved by copying every field by hand; refreshing discards your work; no who/what shown

- **Where:** `backend/lib/events.mjs:122` · **Verdict:** confirmed
- **Impact:** When two officers touch the same event (common before a meeting), the second must copy about 15 fields plus survey questions by hand or lose them. Nothing says who changed what.
- **Fix:** On 409, fetch the latest row and show a per-field comparison (theirs vs yours) with 'keep mine / take theirs', or merge automatically when the changed fields don't overlap. At minimum offer 'Save my version as a copy' and show 'Updated by X at T'. Show a 'This event changed since you opened it' notice by checking the revision when editing starts or on focus.
- **Verifier:** The 409 text is at events.mjs 122-126, and no reopen or merge control exists in event-editor.js. I reproduced a 409 with two contexts (v2.cjs). Refresh list prompts to discard and then reloads the server copy (event-editor.js 547-553). This is real, but conflicts need two officers on one event, the save is rejected rather than lost silently, and the discard prompt warns before work is thrown away. So medium, not high. events-27/events-28 make conflicts more likely: a stale selection after a tab switch produces a guaranteed 409.

### events-5 · medium · ux-friction · effort S — Every Save/Publish ends editing; there is no autosave, so saving often is discouraged

- **Where:** `backend/admin/event-editor.js:445` · **Verdict:** confirmed
- **Impact:** Officers learn to save only at the end, which increases exposure to events-1 and events-4. Iterating (save, preview, tweak) costs an extra click and a scroll back to the top each time.
- **Fix:** Keep the editor open after Save draft (show an inline 'Saved 3:21 PM' next to the button) and return to read-only only after Publish or an explicit Done. Add a debounced draft autosave or local backup.
- **Verifier:** Code: save() calls edit(data.event) with the default editable=false (event-editor.js 445), and the message says 'Editing is complete.' Reproduced: formHidden=true after every Save draft. docs/event-editor.md line 103 documents this as intended ('Successful saves and publication return to read-only details'), so it is a design choice. It is still real friction, and it discourages saving often, which makes events-1/27 more costly.

### events-6 · medium · ux-friction · effort M — Publish happens with no confirmation and no summary of what will change on the live site

- **Where:** `backend/admin/event-editor.js:492` · **Verdict:** confirmed
- **Impact:** A mis-tap next to Save draft, especially on a phone, puts an unfinished event on the public calendar and opens RSVPs. Officers republishing an edited live event cannot see which fields they are changing.
- **Fix:** Add a lightweight publish review: a dialog listing the date/time, location, RSVP open/closed and .edu status, plus a field-level diff against the live version, with 'Publish now'. Label the button 'Publish changes' when the event is already live.
- **Verifier:** Reproduced (v1.cjs): Publish produced 0 dialogs and 'Published successfully — live on the website.' Unpublish and Archive both call confirm() (lines 505-522); Publish is a plain submit. The overview uses only row.draft (event-overview.js 9), so the officer gets no live-vs-draft comparison.

### events-7 · medium · ux-friction · effort S — Archive, Unpublish, Restore and Duplicate are hidden until you enter edit mode; Unpublish there discards unsaved edits

- **Where:** `backend/admin/event-overview.js:16` · **Verdict:** confirmed
- **Impact:** To archive last month's event or restore one, officers must pretend to edit it, scroll past the whole form to the bottom row, and accept a warning about edits they never made. The actions are hard to find, and editing is mixed up with lifecycle actions.
- **Fix:** Put a status-aware action menu in the read-only header: Publish/Unpublish, Duplicate, Archive or Restore, View on site. Keep the edit form for content only.
- **Verifier:** Reproduced: the read-only actions are only 'Edit event' and 'View published event ↗' (event-overview.js 16-30). Duplicate, Unpublish, Archive and Restore sit in .secondary-actions inside #event-form (index.html 593-619). The Unpublish confirm text always includes 'Unsaved edits will be discarded.' (line 507), even when nothing is dirty. It is also inconsistent: Archive refuses while dirty ('Save your draft before archiving', lines 514-517), but Unpublish silently discards.

### events-8 · medium · ux-friction · effort S — On a phone, tapping an event in the list opens its details off-screen with no visible change

- **Where:** `backend/admin/event-editor.js:278` · **Verdict:** confirmed
- **Impact:** Phone officers tap an event and think nothing happened, or must scroll past the list every time. The same happens after Cancel editing and lifecycle actions.
- **Fix:** At narrow widths, scroll the overview into view and move focus to its heading after a selection. Better still, use a list → detail navigation on phones with a back button, and collapse the library once an event is chosen.
- **Verifier:** Reproduced at 390x844 (v2.cjs): after tapping a list card, the overview top was 887px with an 844px viewport, so nothing visible changed. edit() never scrolls or moves focus on selection; only the Edit button focuses #event-heading (lines 291-295). The library stacks above the details below 700px (style.css 784-793).

### events-9 · medium · ux-friction · effort M — The form is 5-6 screens long with no section navigation, progress, or collapsing; Cancel sits as a full-width bar at the top

- **Where:** `backend/admin/index.html:414` · **Verdict:** confirmed
- **Impact:** Slow to scan and edit on a phone. It is hard to tell which sections are filled in or required to publish, and leaving is visually confusing.
- **Fix:** Add a sticky section index (01-05) with completion and error dots, collapse optional sections (images, survey, story details) once filled, and shrink the page header while editing. Move Cancel into the sticky action bar as a secondary 'Discard changes', shown only when dirty.
- **Verifier:** Reproduced (v4.cjs): edit-mode page height was 4166px at 1440x1000 (4.2 screens, empty new event) and 5283px at 390x844 (6.3 screens). The title input sits at y=818 on desktop and y=1328 on phone. #cancel-event-edit is as wide as the form (1024 of 1024px, 362 of 362px) because it is appended into the grid .editor-heading (event-editor.js 48-51; style.css 404-408). Screenshot v4-edit-top-390.png.

### events-10 · medium · ux-friction · effort S — RSVP answer options can be edited in two places at once, and there are no add/remove-choice controls (unlike the custom survey builder)

- **Where:** `backend/admin/survey-editor.js:53` · **Verdict:** confirmed
- **Impact:** Officers are unsure which control is the real one. Blank lines in the textarea create empty rows. Learning two different builders (events vs custom surveys) adds training cost.
- **Fix:** Reuse choiceEditor from survey-choices.js (or one shared component) for RSVP questions. Drop the textarea, or keep a 'Paste many options' helper only.
- **Verifier:** Code: survey-editor.js 53-148 renders both the 'Answer options (one per line…)' textarea and the per-choice rows, kept in sync. There are no add or remove buttons; options change only through the textarea. The custom-survey builder has a separate component (survey-choices.js) with explicit Add choice and Remove buttons.

### events-12 · medium · accessibility · effort S — Keyboard focus is lost after reordering or removing questions, changing answer type, removing an image, or a failed save

- **Where:** `backend/admin/survey-editor.js:164` · **Verdict:** confirmed
- **Impact:** Keyboard and screen-reader officers are sent back to the top of the document after every structural edit, which makes building a survey by keyboard impractical.
- **Fix:** After a move, focus the same button on the moved question. After a remove, focus the next question's legend or the Add button. After a type change, re-focus the select. After a failed save, focus the invalid field. Announce changes in a polite status region (survey-choices.js already does 'Moved choice 1 to position 2').
- **Verifier:** Reproduced (v1.cjs): after keyboard Enter on 'Move down', activeElement=BODY; after changing the answer type select, BODY; after a failed save, BODY. render() rebuilds every question node (survey-editor.js 9) and renderImages() rebuilds every image (event-editor.js 128-157), and neither restores focus. Choice ↑/↓ restores focus through renderChoices(focusIndex), as the reviewer said.

### events-13 · medium · bug · effort S — Changing the event Type silently overwrites the officer's .edu email requirement

- **Where:** `backend/admin/event-editor.js:488` · **Verdict:** confirmed
- **Impact:** An officer who sets the .edu restriction and then adjusts the type publishes an event open to any email, or the reverse with Social, blocking non-.edu guests. They won't see it change.
- **Fix:** Apply the Social default only while the officer hasn't touched the checkbox (track a 'user-set' flag), or show an inline notice: 'RSVP email rule changed to .edu only because the type is Social. Undo'.
- **Verifier:** Reproduced (v1.cjs): checked .edu, set Type to Talk, and the box became false; Type to Social turned it back on. The handler is at event-editor.js 488-491. Add type also triggers it: lines 565-566 call typeOptions(data.selected), which switches the event's Type to the type just added, then form.elements.category.onchange(), which resets .edu. So adding a type for later silently changes both the event's type and its email rule.

### events-14 · medium · ux-friction · effort M — Image upload: 2 MB raw-file limit blocks phone photos even though the server shrinks them; generic all-or-nothing error; no reorder or cover choice

- **Where:** `backend/admin/event-editor.js:578` · **Verdict:** confirmed
- **Impact:** Phone officers (typical photos 3-6 MB) can't upload event photos without resizing them elsewhere. Order follows upload order, so changing the lead poster means removing and re-uploading.
- **Fix:** Downscale and compress on the client (canvas/createImageBitmap to about 1800px JPEG/WebP) before checking size. Name the rejected file and reason, and accept the valid ones. Add ↑/↓ reorder and a 'cover image' marker. Disable the picker with an explanation when uploads aren't configured.
- **Verifier:** Client check at event-editor.js 578-589 gives one generic message. Correction: the server also enforces a 2 MB raw-byte limit (event-assets.mjs 99-100: bytes.length > 2097152 returns 413; jsonBody cap 2.9 MB at api/events.mjs 75). Lifting the limit therefore needs client-side downscaling or server changes, not only a client edit. Per-image controls are only the alt input and Remove image (lines 131-155), with no reorder. I did not re-run the file-size reproduction.

### events-15 · medium · ux-friction · effort S — Event list shows raw ISO dates with no time, sorts farthest-future first, and mixes past events into 'Published events'

- **Where:** `backend/admin/event-editor.js:199` · **Verdict:** confirmed
- **Impact:** The next upcoming event, which officers most often need, is buried between far-future and old events. '2030-11-05' and 18:00 need mental conversion, and the list only grows until people archive by hand.
- **Fix:** Group into Upcoming (ascending), Potential, Drafts, and Past (collapsed, with 'Archive all past'). Show 'Tue, Nov 5 · 6:00 PM CT'. Let search match type, location and date.
- **Verifier:** Reproduced (v1.cjs): PUBLISHED EVENTS listed 2030-11-05, 2030-10-04, then 2020-01-15 (my past test event), with no 'past' marker. The sort is descending by date (event-editor.js 202-209), the card shows the raw ISO date (line 237), and search matches only the title (line 201).

### events-18 · medium · enhancement · effort M — No RSVP count or link to responses from the event

- **Where:** `backend/admin/event-overview.js:69` · **Verdict:** confirmed
- **Impact:** To answer 'how many people are coming?' or 'should we close RSVPs?', officers must switch tabs and filter by event by hand.
- **Fix:** Show 'N RSVPs (M this week)' in the read-only header and on list cards, with a 'View responses' link that opens Surveys filtered to this event (add an eventId hash parameter). Warn before editing questions once RSVPs exist.
- **Verifier:** Code-read: grep finds no RSVP count or responses link in event-editor.js or event-overview.js, only static text. The #survey= hash takes an entry id (index.js 222).

### events-19 · medium · enhancement · effort M — Activity history lists who, what and when, but not what changed, and old versions can't be viewed or restored even though they are stored

- **Where:** `backend/admin/event-activity.js:60` · **Verdict:** confirmed
- **Impact:** After a bad edit or a conflict, officers can't see what a teammate changed or roll back. Recovery means retyping from memory.
- **Fix:** Add 'View changes' (field diff against the previous revision) and 'Restore this version as draft' for each history item, using the existing event_history.content.
- **Verifier:** Code: eventActivity selects only revision, action, actor and created_at (events.mjs 72), while event_history.content stores full draft and published snapshots (events.mjs 160-176). event-activity.js 60-67 renders only the action, actor and time.

### events-28 · medium · bug · effort S — Coming back to the Events tab refreshes the list but not the open event, so Edit loads stale data and Save hits a guaranteed 409

- **Where:** `backend/admin/event-editor.js:361` · **Verdict:** found by verifier
- **Impact:** The list looks refreshed, so the officer trusts the detail pane, edits an outdated copy, then lands in the copy-by-hand conflict recovery (events-4) even though they 'refreshed' by changing tabs.
- **Fix:** In load(), when the current id is present in the new rows and the editor is not dirty, call edit(updated, editing). Or show 'This event changed since you opened it, Reload' when the revisions differ. Check the revision when Edit event is pressed.

### events-29 · medium · ux-friction · effort M — Read-only view shows saved-draft values as if live (e.g. 'RSVPs closed', new room) while the public event is unchanged; closing RSVPs means publishing every pending draft edit

- **Where:** `backend/admin/event-overview.js:69` · **Verdict:** found by verifier
- **Impact:** An officer who closes RSVPs when the room is full, or moves the room, and presses Save draft sees 'RSVPs closed' and the new room in the office, while the public keeps registering for the old room. If other half-finished edits sit in the draft, they cannot close RSVPs without publishing those too.
- **Fix:** In the read-only view, label the values (Live vs Draft) and highlight fields that differ from row.published. Make 'Accept RSVPs' (and maybe a room or cancellation notice) a separate operational toggle that applies to the live event immediately, with its own confirmation, independent of the draft.

### events-30 · medium · ux-friction · effort M — Editing RSVP questions on a live event splits the results into separate versions and rejects in-progress public RSVPs, with no warning in the editor

- **Where:** `backend/lib/surveys.mjs:73` · **Verdict:** found by verifier
- **Impact:** Fixing a typo in help text, or reordering options after RSVPs arrive, splits the RSVP summary into two tables that officers must add up by hand. Anyone filling in the RSVP form at the moment of publishing gets an error and must start over.
- **Fix:** When the event has RSVPs and the questions changed, show an inline warning before Publish ('12 RSVPs used the current questions; changing them starts a new results version'). Leave cosmetic edits (help-text typos) out of the version hash, or merge versions in the report when question ids and options match.

### events-11 · low · copy · effort S — Survey and title error messages don't say which question failed, and some are misleading

- **Where:** `backend/lib/surveys.mjs:64` · **Verdict:** confirmed
- **Impact:** With several questions, officers have to inspect each one. The title message suggests the title is too long when it is actually empty.
- **Fix:** Include the question number and field ('Question 3: add question text'; 'Question 2 needs at least 2 options'; 'Question 2 has duplicate options (Beginner)'). Use separate empty vs too-long messages. Better, validate in survey-editor.js and mark the field.
- **Verifier:** Reproduced: one option gave 'Choice questions need 2–30 options.', and 'Beginner/beginner' gave 'Use different answer options.', neither naming the question. A whitespace-only title gave 'Check the event title (maximum 160 characters).' Correction: a truly empty title is caught by native required validation first, so only whitespace-only titles see the misleading text. Related copy: a missing date on Publish gives 'Choose a valid event date.' (event-content.mjs 24) rather than saying a date is required to publish. Lowered to low because these paths are uncommon.

### events-16 · low · enhancement · effort S — An event dated in the past can be published without any warning

- **Where:** `backend/lib/event-content.mjs:17` · **Verdict:** confirmed
- **Impact:** A year typo (2025 for 2026) publishes an event that the public site immediately treats as past, which hides RSVP, and nobody is told.
- **Fix:** Warn on the client before publishing when the start is before now: 'This date is in the past. Publish anyway?'. Optionally set the date input's min to today for new events.
- **Verifier:** Reproduced: date 2020-01-15 published with no warning; day() only checks the format (event-content.mjs 17-26). The public page then treats the event as past and hides RSVP (static/pages/events.js 203-205). I archived the test event afterwards.

### events-17 · low · copy · effort S — Duplicate warns 'Discard your unsaved changes?' but actually copies them, is reachable only in edit mode, and copies the date as-is

- **Where:** `backend/admin/event-editor.js:499` · **Verdict:** confirmed
- **Impact:** Officers can't tell whether accepting will lose their edits. For recurring events the copied date is easy to publish by mistake, creating two events on the same day.
- **Fix:** Offer Duplicate from the read-only menu, copy the saved version, clear the date and times (or prompt 'Pick the new date'), and drop the misleading discard prompt. Say what is copied: details, images, RSVP questions; not RSVPs.
- **Verifier:** Reproduced (v1/v2): with unsaved 'Room 222 (unsaved edit)', Duplicate showed the 'Discard…' prompt, and the copy carried the unsaved location, the date and the questions. Worse: the copy is never treated as dirty, because newEvent→edit() sets saved=values(). Clicking any other event then drops the copy, and the edits it carried, with 0 prompts (v2.cjs 'leaving the unsaved copy prompted? 0'). Survey question ids are also copied verbatim (values() keeps question.id).

### events-20 · low · security · effort S — The online meeting link becomes public, but the field doesn't say so

- **Where:** `backend/admin/index.html:473` · **Verdict:** confirmed
- **Impact:** Officers may paste a private Zoom/Teams link meant only for RSVPs, and anyone (or a scraper) can join the meeting.
- **Fix:** Add a hint: 'Shown publicly on the event page.' Optionally add a 'Send link only to RSVPs' mode that keeps the link private.
- **Verifier:** Code: publicContent copies meetingUrl (event-content.mjs 167). The unauthenticated GET /api/events returns live events (api/events.mjs 44-52). static/pages/events.js 249 renders 'Open meeting link ↗' for every viewer, past events included. The label in index.html 472-478 has no hint that the link is public.

### events-21 · low · ux-friction · effort M — Any officer can add a shared event type, but types can never be renamed or removed

- **Where:** `backend/lib/event-assets.mjs:37` · **Verdict:** confirmed
- **Impact:** Typos and one-off types pile up in every officer's Type dropdown, which undermines the 'five standard groups' guidance.
- **Fix:** Confirm before adding ('Add "Study grup" for all officers?'). Let officers hide or merge unused custom types.
- **Verifier:** Code: addEventType inserts with no confirm (event-assets.mjs 47-51), and there is no delete or rename endpoint. One correction: a typo can enter only through Add type, because validateEventAssets rejects categories that are not existing types (lines 58-66). Once added, it stays for everyone.

### events-22 · low · bug · effort S — Refresh list on a brand-new unsaved event doesn't discard it, even after the officer agrees to discard

- **Where:** `backend/admin/event-editor.js:547` · **Verdict:** confirmed
- **Impact:** The confirm dialog says something that doesn't happen, and the officer is asked twice.
- **Fix:** When updated is missing, call discardEdits() (or reset to the empty state) after load.
- **Verifier:** Reproduced (v2.cjs): New event, typed a title, Refresh list, accepted the discard prompt. The form stayed visible with the title, and clicking another event prompted again (1 dialog). Code: event-editor.js 547-553 re-edits only when the id is found in rows.

### events-23 · low · ux-friction · effort S — Removing a question or image is instant with no undo; the only escape is Cancel editing, which throws away everything

- **Where:** `backend/admin/survey-editor.js:165` · **Verdict:** confirmed
- **Impact:** One mis-click deletes a carefully worded question with all its options. Getting it back means discarding every other unsaved change.
- **Fix:** Show an 'Removed Question 2 · Undo' toast for a few seconds, or confirm when the question has text or options.
- **Verifier:** Reproduced: 2 questions became 1 with 0 dialogs (survey-editor.js 165). Image removal is images.splice plus renderImages (event-editor.js 150-153), also with no confirm or undo.

### events-24 · low · ux-friction · effort S — The status banner stays stuck over content and repeats the save confirmation

- **Where:** `backend/admin/style.css:275` · **Verdict:** confirmed
- **Impact:** On a phone the banner takes about 100px of an already long form, and officers see the same message twice.
- **Fix:** Make success messages auto-dismiss toasts and add a close button. Show errors next to the field (see events-3). Stop the sticky banner from overlapping content.
- **Verifier:** Reproduced: 'Preview only. Your changes have not been saved.' stays in the sticky #event-status after the preview closes (v2.cjs). The banner is also never cleared when native validation blocks a submit: after an empty-title submit it still showed the earlier 'The end must be after the start…' error next to the native 'Please fill out this field.' bubble (v1.cjs). CSS is at style.css 275-286.

### events-25 · low · ux-friction · effort S — Preview dialog: Desktop/Mobile toggles don't show which is active, and on phones the header takes about a third of the screen

- **Where:** `backend/admin/event-editor.js:104` · **Verdict:** confirmed
- **Impact:** Officers can't tell which view they're looking at. On a phone, previewing gives little room to read the page, and there is no 'Publish' or 'Back to editing' action in the dialog.
- **Fix:** Add aria-pressed and a selected style. Hide the toggle below about 600px and make the dialog full-screen with a compact header. Add 'Publish' and 'Keep editing' actions to the preview footer.
- **Verifier:** Reproduced at 390x844: #preview-desktop and #preview-mobile have aria-pressed=null, and the iframe top is 286px with height 591px. Also, after Close preview, activeElement remained BUTTON#close-site-preview inside the now-closed dialog. showModal ran while the Preview button was disabled, so there was no real focus target to restore.

### events-26 · low · accessibility · effort S — The event list uses aria-pressed for selection, and clicks during a save are ignored silently

- **Where:** `backend/admin/event-editor.js:234` · **Verdict:** confirmed
- **Impact:** Screen-reader officers hear 'toggle button, pressed' instead of 'current event'. Sighted officers think the click was lost.
- **Fix:** Use aria-current="true" (or a listbox pattern) for the selected card. While busy, show 'Wait for the save to finish' or queue the navigation.
- **Verifier:** Reproduced: the selected card has aria-pressed='true' and no aria-current (event-editor.js 234). canLeave() returns false while busy with no message (line 174).

### events-31 · low · ux-friction · effort S — Read-only overview omits the end date/time and shows a raw 24-hour start time

- **Where:** `backend/admin/event-overview.js:42` · **Verdict:** found by verifier
- **Impact:** Officers can't check the end time (or catch an overnight or end-before-start mix-up) without entering edit mode and scrolling to section 02.
- **Fix:** Render 'Tue, Dec 1 · 6:00–8:30 PM CT' (with the end date when it differs), and show 'Date needed before publishing' instead of TBD for non-potential drafts.

## Event surveys

Event surveys is the "Event surveys" sub-tab under Surveys. admin/survey-results.js (mountSurveyResults) builds it by hand on top of a few static nodes in admin/index.html (lines 324-347): an event <select> (#survey-event), a search box, an Active/Archived/All saved select, a "Starred only" checkbox and a duplicate "Contacts & follow-up" button. Below those are page-level "Compile summary" / "Export matching CSV" buttons, then the results. Results are grouped by event, one <details> per event, and each event group contains one collapsed <details> card per person. A person's Star/Archive/Contact history/Edit buttons and their answers only show once that card is expanded. Pages hold 50 responses with Previous/Next. GET /api/surveys (api/surveys.mjs) runs lib/surveys.mjs surveyResults: a page query, a count, and a DISTINCT ON query over all survey_responses that fills the event dropdown. With ?summary or ?export it runs lib/survey-report.mjs instead: reportRows (capped at 10,000), then summarizeResponses or responsesCSV. Star/archive POSTs go to lib/survey-management.mjs manageResponse, and edit/delete goes to submission-management changeSubmission with surface 'survey'. The summary opens in a modal <dialog> as a text bullet list per question version, with counts, percentages and collapsible written answers. Officers usually arrive in one of two ways: (a) Inbox > RSVP card > "View survey answers", which sets #survey=<entryId> and shows that single response with view=All saved and a "Show all responses" button (index.js:218-224), or (b) the Surveys tab, which always resets every filter (show() at survey-results.js:485-493). Archived custom-survey answers (admin/survey-archive.js) do not live in Surveys at all. They show inside Inbox when status=Archived and Type is All or "Questions", and Custom surveys points there ("View archived responses in Inbox → Archived → Questions", custom-surveys.js:292). The shared fixture had only one event-survey response and no public RSVP endpoint. So I also ran a private in-memory copy of tests/helpers/office-fixture.mjs from my scratch folder (scratchpad/event-surveys/server.mjs), seeded through the real submit()/saveEvent()/manageResponse() code with: 66 RSVPs to one event (with a mid-stream question-label edit), a potential/TBD event, a past event, an event with no questions, a soonest event whose slug sorts last, and archived custom-survey members.

### event-surveys-2 · high · ux-friction · effort M — No single place answers "how many people RSVP'd for event X": Surveys leaves out RSVPs without survey rows, Inbox leaves out past events

- **Where:** `backend/lib/surveys.mjs:164` · **Verdict:** confirmed
- **Impact:** The most common question needs two tabs and some mental arithmetic, and the numbers never match. Past events without questions can only be counted via Inbox > Event RSVPs (past), 50 at a time.
- **Fix:** Make the Event surveys landing an event overview table built from entries kind='rsvp' LEFT JOIN survey_responses: event, date, upcoming/past/potential, RSVP count, answered-survey count, newest RSVP, and actions (View responses / Summary / CSV). Clicking a row filters the list. Label RSVPs without answers as 'RSVP only (no questions at the time)' rather than hiding them.
- **Verifier:** saveSurveyResponse returns early when there is no response (surveys.mjs:164), and the Surveys dropdown is built only from survey_responses (surveys.mjs:192-195). In the private fixture the dropdown left out 'ES No Questions Meetup', which has 5 RSVPs in Inbox. One correction: Inbox does cover past events through 'Event RSVPs (past)' plus an Event filter (inbox.mjs:35-37). Inbox still never shows a total for a filtered event, only 'Page N' with 50 cards. The Events pane (event-overview.js) shows no RSVP count either. So no screen answers 'how many RSVPs for X'.

### event-surveys-5 · high · bug · effort M — Star/Archive/Edit reloads the whole list: expanded cards collapse, the page jumps to the top, focus is lost

- **Where:** `backend/admin/survey-results.js:328` · **Verdict:** confirmed
- **Impact:** Triaging RSVPs one by one means finding your place again after every click. Keyboard and screen-reader users lose their position entirely. This happens on every star/archive.
- **Fix:** Update just that card from the POST result (toggle the star label, or remove the card with an 'Archived · Undo' toast) instead of calling load(). If a reload is unavoidable, keep the open state per entry_id (as Inbox already does in index.js) and move focus to the next card or the status message.
- **Verifier:** Reproduced (v1.cjs). With 3 cards expanded and focus on the 10th card's Star, pressing Enter changed scrollY from 2233 to 0 and open cards from 3 to 0, and moved activeElement to BODY. The status line then read 'Response starred.' instead of the count. Cause: manage() calls load() (survey-results.js:328), which runs replaceChildren (403) and sets el.open=Boolean(entryId) (298). Edit does the same through the editor callback (line 18): after Save in v3.cjs the card came back collapsed.

### event-surveys-12 · high · ux-friction · effort M — Two unrelated "Archive" states for the same RSVP (Inbox review status vs survey archive)

- **Where:** `backend/lib/survey-management.mjs:65` · **Verdict:** confirmed
- **Impact:** Officers triage the same RSVP twice with the same word meaning different things. Inbox fills with 'New' RSVPs that were already handled in Surveys, which hides real new items (club signups, questions).
- **Fix:** Use one triage state per RSVP shared by both views. Either survey archive also sets review_status, or Surveys shows and changes the Inbox status. Rename the survey-only flag (e.g. 'Hide from reports') if it must stay separate. Consider treating RSVPs as reviewed by default in Inbox counts.
- **Verifier:** Reproduced. After archiving es66 in Surveys, /api/admin?id= returned review_status 'new' and the Inbox card badge still read 'new'. The reverse also holds: responseFilter uses only survey_response_state.archived_at (survey-management.mjs:29), so an RSVP archived in Inbox (review_status closed) still counts in survey summaries and CSV. The Inbox activity log for es66 showed the raw code 'survey-archived', so the two states are visibly unrelated.

### event-surveys-1 · medium · bug · effort M — "Any of these" counting marks contradictory options (e.g. "I cannot attend any of these") as chosen in the summary and CSV

- **Where:** `backend/lib/survey-report.mjs:6` · **Verdict:** confirmed
- **Impact:** Officers plan headcount and scheduling from these numbers. The summary and spreadsheet can say people who are available everywhere cannot attend, and nothing on screen marks which counts are inferred.
- **Fix:** Count implied selections only when the officer marks a choice as 'implies all' in the question editor (store that flag on the question). Otherwise report 'Any of these' as its own choice. Show implied counts separately, e.g. 'Monday — 23 chosen + 12 via Any of these'. Add a unit test with a negative option like 'I cannot attend'.
- **Verifier:** Reproduced against a private in-memory copy of the reviewer's seed, running the real lib code (scratchpad/event-surveys-verify/server.mjs, v1.cjs). The summary showed 'Which days work? :: Monday — 35 | ... | Any of these — 12 (21.1%) | I cannot attend any of these — 12 (21.1%)'. survey-report.mjs:6-13 excludes only labels that start with None/Not sure. Lowered to medium: the 'Any of these' expansion is intended and documented (docs/forms-admin.md:78-79, tests/survey-management.test.mjs:32), and the wrong count only appears when a question has both 'Any of these' and a negative option worded …

### event-surveys-3 · medium · ux-friction · effort S — Event group header shows the count "on this page", not the event total, and one event is split across pages

- **Where:** `backend/admin/survey-results.js:437` · **Verdict:** confirmed
- **Impact:** Officers read the bold group header as the RSVP count and under-report attendance. Expanding/collapsing per event is unreliable when an event spans pages.
- **Fix:** Return per-event totals with the page (GROUP BY event_id over the same filter) and show 'ES Game Night · 2030-11-01 · 65 responses (45 shown)'. Better still, default to the event overview (event-surveys-2) and paginate within one event.
- **Verifier:** Reproduced with All events selected. Page 1 headers were 'ES Soonest Social · 2 / ES Potential Workshop · 3 / ES Game Night · 45 on this page'. Page 2 was 'ES Game Night · 20 / Office audit event · 1 / ES Past Hackathon · 3'. The header text comes from survey-results.js:437.

### event-surveys-4 · medium · ux-friction · effort M — Fixing a question's wording starts a new "version": summaries and CSV columns split, labelled with an opaque hash

- **Where:** `backend/lib/surveys.mjs:73` · **Verdict:** confirmed
- **Impact:** A typo fix after RSVPs open silently splits every chart and spreadsheet. Officers have to add groups by hand and can't tell what 'version 83cf74a3' means.
- **Fix:** Compare versions on question id + type + options only, so label/help-text edits merge (show the newest label). Where versions really differ, name them by date ('Questions as of Oct 3, 2:15 PM'), put the largest group first, and show an overall total. In the CSV, merge columns per question id when options are compatible and drop the hash suffixes.
- **Verifier:** Reproduced. The summary groups were 'ES Game Night · 4 responses · version dd78911e' and then '... 61 responses · version 459137ca', with no combined total. surveyVersion hashes the full questions JSON, labels included (surveys.mjs:73-76). The event editor shows no warning that editing wording splits reports: grepping event-editor.js finds no version or 'already answered' message.

### event-surveys-6 · medium · ux-friction · effort M — Answers sit behind a per-person expand: no table view to scan what everyone said

- **Where:** `backend/admin/survey-results.js:296` · **Verdict:** confirmed
- **Impact:** To skim answers (who picked Evening, who has dietary needs) an officer has to expand up to 50 cards per page, or open the summary, which drops names for choice questions.
- **Fix:** For a selected event, offer a 'Table' view: one row per person, one column per question (choice answers as short text, long text truncated with expand), sticky header, sortable by name/date, and row actions (star/archive) visible without expanding. Keep the card view for phones.
- **Verifier:** Measured: a card is 101px collapsed and 283px expanded with one question. A collapsed page of 50 is #survey-results height 6008px. Answers exist only inside each <details> (survey-results.js:370-393).

### event-surveys-7 · medium · ux-friction · effort S — "Show all responses" after an Inbox deep link widens to every event plus archived responses, not "this event"

- **Where:** `backend/admin/survey-results.js:482` · **Verdict:** confirmed
- **Impact:** An officer reading one RSVP who wants the rest of that event's answers lands in an unfiltered mixed list and has to rebuild the filters by hand.
- **Fix:** Rename it to 'Show all responses for <event title>'. Set #survey-event to the entry's event_id and switch the view back to Active (or keep All but label it).
- **Verifier:** Reproduced. After the deep link, 'Show all responses' left event='' and view='all', the status said '75 matching saved responses', and the hash was '#surveys'. reset() never restores view or event (survey-results.js:460-465, 482).

### event-surveys-8 · medium · bug · effort S — The same "Compile event summary" gives different totals depending on how the officer got there

- **Where:** `backend/admin/survey-results.js:489` · **Verdict:** confirmed
- **Impact:** Two officers report different RSVP numbers for the same event. Archived (e.g. spam/test) responses leak into reports.
- **Fix:** Event-level summary/CSV should always use one well-defined scope (Active, unless the officer picks otherwise in the dialog). Show the scope in the dialog header, e.g. '65 active responses (1 archived excluded)'.
- **Verifier:** Reproduced. From the Surveys tab with ES Game Night selected, the summary h3 read '65 matching responses · all pages'. From the deep link to the archived es02, 'Compile event summary' read '66 matching responses · all pages'. Cause: show(id) sets view='all' (line 489), and summary(id) drops only entryId (line 183).

### event-surveys-9 · medium · ux-friction · effort M — "View survey answers" lands with the answers below the fold, an "All events" selector, irrelevant summary buttons and a wasted request

- **Where:** `backend/admin/index.js:219` · **Verdict:** confirmed
- **Impact:** Officers click 'View survey answers' and see no answers, only controls. It looks like nothing happened, especially on a phone.
- **Fix:** Show the answers inline in the Inbox RSVP card (they're already loaded via /api/admin?edit) and keep 'Open in Surveys' as a secondary link. If the jump stays, set the hash before showPane, scroll to and focus the expanded card, set the selector to that event, and hide the summary/export controls in single-response mode.
- **Verifier:** Reproduced. Clicking the real Inbox button fired '/api/surveys?eventId=&entryId=&...view=active' and then '...entryId=98df...&view=all'. The cause is that showPane('surveys', true) runs surveys.show('') before index.js:222 sets the hash. The answers <dl> began at y=1190 in a 1000px viewport (v1-deeplink.png), the selector read 'All events, including past events', and four summary/export buttons sat above the card.

### event-surveys-10 · medium · ux-friction · effort S — Survey filters reset on every tab switch and aren't in the URL

- **Where:** `backend/admin/survey-results.js:485` · **Verdict:** confirmed
- **Impact:** Checking an RSVP in Inbox and coming back means re-picking the event and search each time. A filtered view can't be bookmarked or shared with another officer.
- **Fix:** Keep filter state across tab switches (only reset on sign-out/clear()). Store eventId/view/search/page in the hash, e.g. #surveys?event=es-game-night&view=active, and restore it on load.
- **Verifier:** Reproduced. I selected ES Game Night and typed 'es0', went to Inbox and came back: event='' and search='' with hash '#surveys'. showPane calls surveys.show(...) on every switch (index.js:731), and show() resets all filters (survey-results.js:485-492).

### event-surveys-11 · medium · ux-friction · effort S — Event selector sorts by URL slug, has no counts or upcoming/past grouping, and group headers have no date

- **Where:** `backend/lib/surveys.mjs:194` · **Verdict:** confirmed
- **Impact:** As events pile up, finding this week's event in a slug-ordered native select gets slow, and same-named events can be confused.
- **Fix:** Order by date (upcoming soonest first, then TBD, then past newest first) inside <optgroup>s, append counts ('· 65 responses'), and always show the date in group/summary headers. A searchable combobox, or the event overview table from event-surveys-2, scales better.
- **Verifier:** Reproduced option order: Past Hackathon, Game Night 2030-11-01, Potential Workshop TBD, Office audit 2030-10-04, Soonest Social 2030-10-10. The soonest event is last because ORDER BY event_id sorts by slug (surveys.mjs:194). Group and summary headers show the title only (survey-results.js:222, 437).

### event-surveys-13 · medium · security · effort S — From Surveys, an RSVP still "New" in Inbox can be permanently deleted after one survey-only archive

- **Where:** `backend/lib/submission-management.mjs:170` · **Verdict:** confirmed
- **Impact:** Inbox's safeguard (archive in Inbox before deleting) can be bypassed. A teammate who never saw an RSVP in Inbox can lose it to an officer cleaning up survey answers.
- **Fix:** Require the same gate on both surfaces (the Inbox status is closed, or both flags are set). In the delete dialog, show the Inbox status ('This RSVP is still New in Inbox').
- **Verifier:** Reproduced up to the dialog, without deleting. es66's Archived card offered 'Delete permanently' while Inbox showed the entry as new. The gate differs by surface (submission-management.mjs:170-178), and the delete removes the whole entries row (line 183). Not raised: the delete still takes two deliberate steps and a warning dialog.

### event-surveys-14 · medium · enhancement · effort M — Summary is a plain text list: no bars, no "who chose this", and the list can't be filtered by answer

- **Where:** `backend/admin/survey-results.js:242` · **Verdict:** confirmed
- **Impact:** Common follow-ups like 'who picked Afternoon?' or 'list everyone with dietary needs' need a CSV export and a spreadsheet.
- **Fix:** Add CSS-only horizontal bars next to each count (no charting library needed). Make each choice clickable to filter the response list (an answer filter on questionId+value). Link each written answer to its card or contact, and add 'Copy emails' for the filtered set.
- **Verifier:** Code-read plus the summary text in v1. Choices render as plain text 'label — n (p%)' (survey-results.js:244-255). Written answers show 'name: value' with no link to the person (277-284). responseFilter has no answer filter (survey-management.mjs:4-31).

### event-surveys-16 · medium · security · effort S — Survey CSV exports of names, emails and answers aren't recorded in the audit log

- **Where:** `backend/api/surveys.mjs:90` · **Verdict:** confirmed
- **Impact:** A bulk export of personal data from Surveys leaves no trace, which contradicts the documented privacy promise.
- **Fix:** Insert an audit row (actor, 'survey-export-csv', with the filter as JSON or eventId) before streaming, the same way admin.mjs does.
- **Verifier:** Code-read. In api/surveys.mjs:88-100 the export branch streams responsesCSV with no audit insert. api/admin.mjs:124-127 inserts 'export-csv'. docs/forms-admin.md:7 says exports are logged.

### event-surveys-20 · medium · ux-friction · effort M — On a phone the first response starts about 1,200px down the page

- **Where:** `backend/admin/style.css:1541` · **Verdict:** confirmed
- **Impact:** Officers checking RSVPs on a phone, a stated use case, scroll more than a screen before seeing a single name, and again after every action (see event-surveys-5).
- **Fix:** On narrow screens collapse search/view/star into a 'Filters' disclosure showing the active filter count, put the event picker and count first, use icon+label compact buttons, and make each collapsed row one line (name · first answer · time).
- **Verifier:** Reproduced at 390x844: the first #survey-results .survey-response sat 1211px from the top (v3-phone-top.png).

### event-surveys-21 · medium · enhancement · effort M — No bulk actions, and Star/Archive only appear after expanding each person

- **Where:** `backend/admin/survey-results.js:350` · **Verdict:** confirmed
- **Impact:** Cleaning up test/spam RSVPs or starring a shortlist takes expand + click + full reload per person.
- **Fix:** Show a star toggle in the collapsed row. Add row checkboxes with 'Star / Archive / Export selected', backed by a batch action that is still audited per entry.
- **Verifier:** Code-read. The actions sit inside the collapsed <details> (survey-results.js:313-371). There are no checkboxes. manageResponse accepts a single entryId (survey-management.mjs:35-41).

### event-surveys-22 · medium · ux-friction · effort M — Archived custom-survey answers live in Inbox under Archived and Type "Questions", away from Surveys

- **Where:** `backend/admin/survey-archive.js:12` · **Verdict:** confirmed
- **Impact:** Officers looking for archived custom-survey answers go to the wrong tab. Officers filtering Inbox for website 'Questions' find unrelated survey answers mixed in.
- **Fix:** Move archived respondents' answers into Surveys > Custom surveys > <survey> as an 'Archived respondents' section (responseSections already supports includeArchived). Remove the Inbox block and the 'question' kind coupling. Default each archived person to collapsed and replace 'Question responses ·' with the respondent's name and archive date.
- **Verifier:** Reproduced. Inbox > Archived with Type All showed 'Archived survey responses / Advisor Studio / Question responses · pearlman@example.com' with both details open. The block stays visible with Type=Questions and is hidden with Type=Club signups (survey-archive.js:12-15).

### event-surveys-24 · medium · enhancement · effort M — Respondents panel doesn't show who has submitted, and Remove access has no confirmation

- **Where:** `backend/admin/survey-respondents.js:85` · **Verdict:** confirmed
- **Impact:** Officers can't see who still needs a reminder. A mis-tap ends someone's access on every device, and a network blip leaves the panel stuck with no obvious way out.
- **Fix:** Join custom_survey_responses to show 'Submitted Oct 3' / 'Not yet' per respondent, with a 'Copy emails of non-respondents' button. Add an inline confirm or Undo toast for removal. Show the pending change with explicit Retry and Discard buttons.
- **Verifier:** Code-read. Remove runs change() with no confirm (survey-respondents.js:85-94), and respondentList selects no submitted_at (lib/survey-respondents.mjs:19). Partly mitigated: removal can be undone with 'Restore access' under Archived respondents. A retry is just the same click again, since the serialized input matches, but the UI never says so. The missing submitted/not-yet status is the most useful part of this finding.

### event-surveys-25 · medium · accessibility · effort S — Choice editor: keyboard reordering loses focus, the drag grip is a do-nothing tab stop, and choices can drop below 2

- **Where:** `backend/admin/survey-choices.js:12` · **Verdict:** confirmed
- **Impact:** Keyboard users have to re-find their place after every move and pass a useless stop on every row. Officers learn a question is invalid only at publish time.
- **Fix:** After a move, refocus the same control at the new index. Make the grip non-focusable (tabindex=-1, aria-hidden) or give it arrow-key handling. Disable Remove at 2 choices with a hint, and show the duplicate-choice warning inline.
- **Verifier:** Code-read, not re-run. move() calls render(), which runs root.replaceChildren with no refocus (survey-choices.js:12-20). The grip is a focusable <button draggable> with drag handlers only (28-36). Remove has no minimum (75-82), and the 2-choice minimum is enforced only at publish (lib/survey-builder.mjs:82-87). This is the custom-survey builder, outside Event surveys.

### event-surveys-27 · medium · ux-friction · effort S — Browser Back after "View survey answers" leaves Club Office instead of returning to the RSVP

- **Where:** `backend/admin/index.js:222` · **Verdict:** found by verifier
- **Impact:** An officer who opens one RSVP's answers and presses Back (or swipes back on a phone) is thrown out of the office. They have to reopen it, re-filter Inbox and find the card again.
- **Fix:** pushState for the deep link (and tab switches), and restore the pane on popstate. In single-response mode, show a '← Back to Inbox' link that returns to the same filters and the expanded card.

### event-surveys-28 · medium · bug · effort S — Officer edits to survey answers are invisible in Surveys, the summary and CSV

- **Where:** `backend/lib/survey-management.mjs:34` · **Verdict:** found by verifier
- **Impact:** Answers changed by an officer look like the respondent's own words in Surveys, summaries and spreadsheets. Teammates can't tell original answers from corrections, which undermines trust in the results.
- **Fix:** Return e.edit_revision/e.updated_at in responseSelect. Show 'Edited by an admin · <time>' on the card (as Inbox does) with a link to the activity. Add an 'Edited' column to the CSV and an edited count in the summary header.

### event-surveys-29 · medium · bug · effort S — Renaming or rescheduling an event leaves Surveys showing the old title/date and mixes both in cards and CSV

- **Where:** `backend/lib/surveys.mjs:194` · **Verdict:** found by verifier
- **Impact:** After an event moves, the Surveys picker and per-card 'Event date' show the wrong date. Exports carry two titles and dates for one event, so filtering or pivoting by Event in a spreadsheet splits the attendees.
- **Fix:** Label the dropdown and group headers from the current published event (as api/admin.mjs already merges with getEvents), falling back to the snapshot only for deleted events. In the CSV use the current title/date and add 'Event date when RSVP'd' only if it differs. Show a 'Potential / TBD' badge.

### event-surveys-32 · medium · ux-friction · effort M — Editing RSVP question wording on a live event gives no warning, yet it rejects people mid-RSVP and splits reports

- **Where:** `backend/lib/surveys.mjs:94` · **Verdict:** found by verifier
- **Impact:** A small typo fix after RSVPs open makes anyone with the RSVP form already open get an error on submit. It also starts a new question version that splits every summary and CSV (event-surveys-4). The officer gets no warning.
- **Fix:** When saving a published event that has survey responses and changed questions, show '<n> people already answered. Wording-only changes will be merged; changing options starts a new version.' Exclude label/description from the version hash so typo fixes don't reject RSVPs in progress.

### event-surveys-15 · low · ux-friction · effort S — CSV problems: UTC ISO timestamps, hash columns, sparse all-events sheet, generic filename

- **Where:** `backend/lib/survey-report.mjs:120` · **Verdict:** confirmed
- **Impact:** Officers re-format timestamps, delete noise columns, and end up with several files of the same name in Downloads.
- **Fix:** Use Central time in the same format as the Inbox CSV. Drop or shorten the version column. For All events, export one sheet per event (zip) or only the shared columns plus a JSON-free answer column. Name files '<event-slug>-<YYYY-MM-DD>-responses.csv' using the selected event. Add RSVP status / potential columns.
- **Verifier:** Reproduced. With an event selected, the page-level export saved 'event-surveys-responses.csv' because download() gets eventId undefined (line 163). A CSV generated through lib in snap.mjs has 'Received (UTC)' set to '2026-10-03T20:41:49.141Z', a 64-character 'Question version' column, and headers suffixed '[25c8d7a4]'. The Inbox CSV uses 'Received (Central)' (submission-export.mjs:56). Lowered to low: these are annoyances that don't block anything.

### event-surveys-17 · low · bug · effort S — Export failures with a non-JSON body show a raw parser error

- **Where:** `backend/admin/survey-results.js:156` · **Verdict:** confirmed
- **Impact:** On a timeout or proxy error the officer sees a developer error and no next step.
- **Fix:** Wrap response.json() in a try/catch and fall back to 'Could not export responses (HTTP 504). Try again or narrow the filters.'
- **Verifier:** Reproduced by routing the export to a 504 text/html response. The status read "Unexpected token '<', "<html><bod"... is not valid JSON" (survey-results.js:156).

### event-surveys-18 · low · copy · effort S — Empty state and count wording: "0 matching… Expand a person", "1 matching responses"

- **Where:** `backend/admin/survey-results.js:449` · **Verdict:** confirmed
- **Impact:** It's unclear whether there are no RSVPs, no questions on the event, filters that are too narrow, or a deleted response.
- **Fix:** Add proper empty states: 'No responses match “xyz”. Clear search' / 'This event has no RSVP questions; see Inbox for RSVPs' / 'This response was deleted'. Pluralize correctly and show 'Page 1 of 2'.
- **Verifier:** Reproduced. A search for 'no-such-person-xyz' gave '0 matching saved responses. Expand a person to read answers or manage their response.' with 'Page 1' and 0 cards. 'es66@' gave '1 matching saved responses.' and the deep-link summary h3 read '1 matching responses · all pages'.

### event-surveys-19 · low · ux-friction · effort S — Duplicate and redundant controls crowd the page (four summary/export buttons for one event, repeated headings)

- **Where:** `backend/admin/survey-results.js:440` · **Verdict:** confirmed
- **Impact:** More scrolling and more choices to second-guess, especially on phones.
- **Fix:** Keep one action bar scoped to the current selection ('Summary', 'Export CSV'). Remove the per-group buttons when an event is selected (or always, in favour of the event overview). Change the heading to the selected event's name and date and drop the per-card event date.
- **Verifier:** Seen in v1-deeplink.png: page-level 'Compile summary'/'Export matching CSV' plus the group's 'Compile event summary'/'Export event CSV', and 'Contacts & follow-up' inside the filters. In deep-link mode the page-level summary covers only the single response.

### event-surveys-23 · low · bug · effort S — Custom-survey results are listed in random order (by UUID)

- **Where:** `backend/lib/survey-results.mjs:21` · **Verdict:** confirmed
- **Impact:** Newest submissions aren't first and the order isn't alphabetical, so finding a given respondent across 10-per-page pages is guesswork.
- **Fix:** Order by r.submitted_at DESC (or display_name), with advisor_id as a tiebreaker, and consider a name search.
- **Verifier:** Code-read. The query orders by 'ORDER BY m.active DESC,m.advisor_id DESC' (lib/survey-results.mjs:21), and new members get advisor_id randomUUID() (lib/survey-respondents.mjs:138). The order is therefore effectively random.

### event-surveys-26 · low · accessibility · effort S — Star toggle changes both its label and aria-pressed

- **Where:** `backend/admin/survey-results.js:346` · **Verdict:** confirmed
- **Impact:** Screen-reader users can't tell what pressing the button will do.
- **Fix:** Use a constant accessible name ('Star response') with aria-pressed, or a changing label without aria-pressed. Put the glyph in aria-hidden spans.
- **Verifier:** Reproduced via DOM. A starred card's button had text '★ Unstar' with aria-pressed='true', and the card heading strong was '★ ES Person 62' with no text alternative.

### event-surveys-30 · low · copy · effort S — Survey star/archive actions appear as raw codes in Inbox activity, and Surveys has no activity view

- **Where:** `backend/admin/submission-activity.js:2` · **Verdict:** found by verifier
- **Impact:** Officers see developer codes in the timeline. From Surveys they can't tell who archived or starred a response, or when.
- **Fix:** Add labels ('Starred in Surveys', 'Archived in Surveys', etc.) to the actions map. Reuse submissionActivity inside each survey card, or show 'Archived by X · time' next to the Archived badge (updated_by/updated_at are already stored in survey_response_state).

### event-surveys-31 · low · ux-friction · effort S — Stars are one shared flag for all officers with no attribution, though the code calls the filter a bookmark

- **Where:** `backend/lib/survey-management.mjs:52` · **Verdict:** found by verifier
- **Impact:** An officer building a personal shortlist with 'Starred only' can have it changed silently by a teammate who unstars a response, and has no way to see who did it.
- **Fix:** Say it's shared ('Team star') and show 'Starred by <officer>' on the card using updated_by, or make stars per officer (key the state by entry_id plus actor) if personal bookmarks are what officers want.

## Custom surveys

Custom surveys sit under Surveys → Custom surveys. admin/custom-surveys.js mounts a catalog: a "Create custom survey" button, one flat <select> listing every survey (title · status · counts), "Refresh results", and below it, for the selected survey: a permissions hint, Close survey (two-step inline confirm), private/preview links with copy buttons, the respondent roster (admin/survey-respondents.js), a "Survey activity" log, and per-person result cards from surveys/results-ui.js, 10 at a time with "Load more responses". The builder (admin/survey-builder.js) is a 5-step wizard: Template → Audience (permissions plus roster) → Questions (with the survey-choices.js choice editor) → Preview (survey-trial.js local trial and mock results dialog) → Publish. Every step change or nav click calls save(): a POST draft-change followed by a GET draft, and render() rebuilds the whole panel with replaceChildren. The server (lib/survey-builder.mjs changeDraft) checks revisions, accepts only save/publish/close, records each change in custom_survey_changes, and freezes questions and permissions once published. Respondents (lib/survey-respondents.mjs) can only be added or removed (archived) one at a time. Public "verified" surveys let anyone enrol by verifying an email (lib/custom-surveys.mjs rememberDevice). Results (lib/survey-results.mjs) are per-person snapshots of active members. There are no aggregates and no export, and archived answers live in Inbox → Archived → Questions. Today an officer can build, preview, publish, share and close a survey without reading the docs. But publish errors don't say which question is wrong, and the following are missing entirely: draft delete or cancel, duplicating a survey, reopening or extending one, bulk-adding respondents, seeing who has responded, and reading results in aggregate. Keyboard and screen-reader users lose focus on every builder action.

### custom-surveys-1 · high · security · effort S — Public surveys that share results expose other respondents' email addresses as their 'name'

- **Where:** `backend/lib/custom-surveys.mjs:112` · **Verdict:** confirmed
- **Impact:** On a public survey, anyone on the internet who verifies any email can read every other respondent's answers along with their email address. Respondents only agreed to share their 'name'. Officers get no warning that this combination of settings makes results effectively world-readable. Whether production behaves the same depends on Neon leaving user.name empty for OTP sign-ups; I verified this only in the fixture.
- **Fix:** Never fall back to the email for the shared display name. Ask self-registering respondents for a display name, or show 'Respondent 3'. In the builder, when audience=public and results=respondents, show an explicit warning ('Anyone who verifies an email can read all answers'), or disallow that combination.
- **Verifier:** Reproduced on my own survey 'csv-PUB 357148' (public, verified, results=respondents). One respondent submitted 'Idea A'. A second email that only verified and never answered got bootstrap results ["csv-stranger-…@example.com","csv-pa-357148@example.com"], including the text 'Idea A'. That stranger now also appears in the admin roster. Production should behave the same: rememberDevice uses `(user.name || user.email)` (lib/custom-surveys.mjs 112). The installed better-auth 1.7.5 email-otp sign-in creates new users with `name: name || ""` …

### custom-surveys-3 · high · accessibility · effort M — Every builder action rebuilds the DOM, dropping keyboard focus to <body> and leaving scroll mid-page

- **Where:** `backend/admin/survey-builder.js:194` · **Verdict:** confirmed
- **Impact:** Keyboard and screen-reader users have to Tab back from the top of the page after every action, which makes reordering or editing 10+ questions impractical. Phone users land mid-page on the next step and don't see where it starts.
- **Fix:** After render(), restore focus deliberately: the moved button at its new position, the new question's title input, the changed select, or the step heading (tabindex=-1) on step change, and scroll it into view. Better still, update only the affected card instead of re-rendering the whole panel.
- **Verifier:** Reproduced, and worse than stated. activeElement was BODY after Add respondent, Add question, an answer type change, keyboard Enter on 'Move question 2 up', and a step change. With 6 questions, the first Tab after 'Move question 5 up' landed on '1. Template' at the top of the builder, and it took 31 Tabs to get back to the moved question's controls. On a 390px phone, after Save and continue, the new step's h3 sat 419px above the viewport (scrollY 1108). The event editor does restore focus (survey-editor.js renderChoices(focusIndex)), so the pattern already exists in the codebase.

### custom-surveys-4 · high · enhancement · effort M — Custom-survey results have no summary, counts, averages or CSV export

- **Where:** `backend/admin/custom-surveys.js:245` · **Verdict:** confirmed
- **Impact:** Officers can't see the outcome of a 'Quick feedback' survey (average rating, which option won) without opening every card and tallying by hand. For 40 responses that means 4 'Load more' clicks and 40 expansions, with no way to share the data with other officers.
- **Fix:** Reuse the event-survey summary pattern. Add a 'Summary' view at the top showing answered/skipped counts per question, choice counts and percentages, a rating distribution and average, and written answers grouped together, plus 'Export CSV'. Then show per-person cards as a second tab.
- **Verifier:** custom-surveys.js 245-250 renders results only through responseSections. surveys/results-ui.js (98 lines) exports only partitionResponses and responseSections, with no aggregate. Event surveys have 'Compile summary' and 'Export matching CSV' (admin/survey-results.js 128-129). In my 4-response survey there was no summary or export control. My first regex for this also matched the 'Remove access for CSV…' buttons, so ignore that count.

### custom-surveys-6 · high · ux-friction · effort M — Respondents can only be added one at a time, and each add reloads the whole page

- **Where:** `backend/admin/survey-respondents.js:102` · **Verdict:** confirmed
- **Impact:** Inviting a class or club cohort of 30 to 50 approved emails takes 30 to 50 separate submissions, each jumping to the top of the page. Most invited surveys have more than a handful of people, so this is the main bottleneck in running one.
- **Fix:** Add a 'Paste emails' textarea that accepts one 'Name <email>' or bare email per line, with a preview, duplicate and invalid detection, and a single batched request. Make Name optional, defaulting to the local part. Keep focus and scroll in the roster after changes by updating it in place instead of calling load().
- **Verifier:** Both fields are required (survey-respondents.js 103-115) and the server takes one add per request (survey-respondents.mjs 56-71). The builder hint says restricted audiences need each email approved, so every student or staff survey hits this. Each change calls onChanged, which is load() in the catalog. Reproduced: a roster change reset scrollY from 2357 to 0 and moved focus to BODY.

### custom-surveys-2 · medium · ux-friction · effort M — Publish fails with generic errors that don't say which question or field is wrong

- **Where:** `backend/lib/survey-builder.mjs:26` · **Verdict:** confirmed
- **Impact:** Officers have to go back to Questions and scan up to 30 question cards to find the problem. With a long survey on a phone, publishing turns into trial and error.
- **Fix:** Validate on the client before publishing and show a checklist on the Preview and Publish steps, e.g. 'Question 4: choice 2 is empty', with a link that jumps to and focuses the field. Have the server return the index of the offending question or field so errors can be shown inline. Also mark required fields.
- **Verifier:** Reproduced. Publishing with choices 'Morning'/'morning' shows only 'Each choice must be different.' with no question named. A blank title shows 'Check the survey text and length.' with aria-invalid=null and focus on BODY. Drafts accept blanks (survey-builder.mjs 88, 96 `!publishing`), so problems only surface at publish. I lowered it to medium because typical club surveys have 3-10 questions, so the scan is tedious rather than blocking.

### custom-surveys-5 · medium · ux-friction · effort M — No way to cancel creating a survey or delete drafts and test surveys, so the list grows forever

- **Where:** `backend/lib/survey-builder.mjs:170` · **Verdict:** confirmed
- **Impact:** A mis-click on Create, every 'Add myself for testing' trial survey, and every abandoned draft stay in the single dropdown permanently. Over terms, finding the real survey gets harder, and officers can't clean up without database access.
- **Fix:** Add a 'Cancel' button to the builder that returns to the catalog without saving, plus 'Delete draft' for drafts. For closed surveys, add 'Archive' (hide from the list, keep results) and possibly Delete when there are 0 responses. Put the confirmation inline.
- **Verifier:** changeDraft accepts only save, publish and close (survey-builder.mjs 170), and no repo code deletes custom_surveys rows. Clicking the Custom surveys group while the builder is open does nothing, because of the early return at index.js 671-679 (reproduced). My own crashed run left 'csv-B 107244 · draft', which I cannot remove. You can abandon a new build by switching to Event surveys (discard confirm), but that's not obvious. I lowered it to medium: the list gets cluttered over terms, but it doesn't block any core task.

### custom-surveys-7 · medium · ux-friction · effort S — 'Remove access' acts in one click with no confirmation; the respondent's answers vanish and their devices are revoked

- **Where:** `backend/admin/survey-respondents.js:85` · **Verdict:** confirmed
- **Impact:** A mis-tap on a phone can cut off the wrong respondent, including the real Advisor Studio advisors. Their results disappear from view, and they must verify their email again even after Restore.
- **Fix:** Use the same inline 'Confirm remove / Cancel' pattern as Close survey, naming the person and mentioning whether they have a saved response. Alternatively, show an 'Undo' toast for a few seconds.
- **Verifier:** Reproduced: one click on 'Remove access for CSV R25' opened 0 dialogs, scrollY jumped from 2357 to 0, and focus moved to BODY. Because the page jumps to the top, the officer can't easily see who was removed. Restore exists and brings answers back, which limits the damage, so medium is right.

### custom-surveys-8 · medium · bug · effort S — Default audience is 'Advisors', and respondents see it as a banner label

- **Where:** `backend/admin/survey-builder.js:29` · **Verdict:** confirmed
- **Impact:** A student-club officer who skips the select publishes a student survey labelled 'ADVISORS', which confuses respondents and looks unprofessional. The default is a leftover from the original Advisor Studio.
- **Fix:** Default to 'Dallas College students', or make the audience a required choice with no preselection. Show the audience prominently on the Publish summary with a 'Change' link.
- **Verifier:** survey-builder.js 29 has `audience: 'advisors'`. My UI-created survey showed 'Default audience value: advisors', and the Publish step read '2 questions · Advisors'. The respondent page shows audienceNames[welcome.audience] (surveys/form-ui.js 105).

### custom-surveys-9 · medium · ux-friction · effort S — Publishing has no confirmation and no success or 'share it now' handoff

- **Where:** `backend/admin/survey-builder.js:538` · **Verdict:** confirmed
- **Impact:** Publishing is irreversible (questions and permissions freeze) but takes one click. Afterwards officers get no confirmation that it worked, and the next step ('copy this link and send it to your N respondents') isn't highlighted, while 'Close survey' is the most prominent action.
- **Fix:** Add a final confirm summary: 'Publish to N approved respondents; closes Oct 17, 3:20 PM CT; questions can't be changed after this'. After success, show a 'Published' panel with a large 'Copy answering link' button, the deadline, and a pre-filled email/BCC option. Move Close survey lower or into a menu.
- **Verifier:** Reproduced: after Publish there were 0 dialogs and no notice, and the URL was /admin/#surveys. The only 'published' text was the activity log entry. 'Close survey' is the first button. The Publish step lists 'Days open after publishing' but no respondent count and no actual close date/time. The deadline equals the publish moment plus N days, so the officer can't choose a time of day.

### custom-surveys-10 · medium · enhancement · effort M — No duplicate, reopen or extend: a typo or a missed deadline means rebuilding from scratch

- **Where:** `backend/lib/survey-builder.mjs:231` · **Verdict:** confirmed
- **Impact:** Fixing a typo after publishing, extending a deadline for late respondents, or rerunning last term's feedback survey all mean retyping every question and re-adding every respondent.
- **Fix:** Add 'Duplicate as new draft', copying questions, permissions and optionally the roster. Add 'Extend deadline' for open or expired surveys, which is low risk because questions stay frozen. Consider 'Reopen' for surveys closed by mistake, with an audit entry.
- **Verifier:** Server: survey-builder.mjs 219-235. There is no reopen, extend or duplicate action, and no route changes expires_at after publish. After I closed 'csv-B 122240', the count of reopen/extend/duplicate/delete controls was 0.

### custom-surveys-11 · medium · enhancement · effort M — The roster doesn't show who has responded or verified, and there's no way to contact non-responders

- **Where:** `backend/lib/survey-respondents.mjs:19` · **Verdict:** confirmed
- **Impact:** Officers can't tell who still needs a reminder without cross-checking result cards by name. Sending the link means copying addresses one by one into an email.
- **Fix:** Add a status chip per respondent (Not opened / Verified / Responded with date), a filter for 'Not responded', and 'Copy emails' or a mailto/BCC button for all or for non-responders.
- **Verifier:** respondentList selects only advisor_id, display_name, email and active (survey-respondents.mjs 19). In my survey with 4 of 25 submitted, the roster text had no respond/submitted/verified marker. The docs state 'No survey invitation or response email is sent automatically.'

### custom-surveys-12 · medium · bug · effort S — Results appear in random order (by UUID), with no sort or search

- **Where:** `backend/lib/survey-results.mjs:21` · **Verdict:** confirmed
- **Impact:** Officers can't find the newest responses, or a specific person's response, without paging through everything. Order can also look arbitrary between surveys.
- **Fix:** Order by r.submitted_at DESC (with advisor_id as a tiebreaker) and display 'newest first'. Add a name/email filter and the ability to jump to a respondent from the roster.
- **Verifier:** Reproduced, not just code-read. Respondents submitted in the order R12, R03, R07, R20, about 1s apart. Results showed R07, R12, R20, R03, which is neither submission time nor alphabetical (survey-results.mjs 21 orders by advisor_id, a random UUID). The custom results view has no search.

### custom-surveys-13 · medium · ux-friction · effort S — 'Refresh results' and every roster change re-render everything, jumping to the top and collapsing expanded results

- **Where:** `backend/admin/custom-surveys.js:21` · **Verdict:** confirmed
- **Impact:** While reading results or managing the roster, officers lose their place after every refresh or change and have to scroll back down. This is especially tiring on a phone.
- **Fix:** Refresh only the affected section (results list or roster) in place. Preserve which <details> are open and the scroll position, and announce the change in a status message.
- **Verifier:** Reproduced: with a result card open at scrollY 2650, Refresh results reset scrollY to 0 and left 0 cards open. load() starts with root.replaceChildren (custom-surveys.js 21), and both refresh (303) and the roster's onChanged (225) call it.

### custom-surveys-14 · medium · bug · effort S — A respondent typed on the Audience step but not added is silently discarded when moving on

- **Where:** `backend/admin/survey-builder.js:185` · **Verdict:** confirmed
- **Impact:** An officer who expects 'Save and continue' to save what they typed loses the invitee. They then hit 'Add at least one approved respondent before publishing' at the last step, or worse, publish without that person.
- **Fix:** If the roster fields aren't empty when changing step, add the respondent automatically or block with 'Add CS Typed Not Added before continuing?'. Consider moving the roster to its own step after Questions.
- **Verifier:** Reproduced: I added 'CSV One', then typed 'CSV Typed' plus an email and clicked Save and continue. The wizard moved to Questions with 0 dialogs. Going back showed 1 roster row (CSV One only) and an empty Name field. canLeave (593-599) checks only `saved`.

### custom-surveys-v1 · medium · ux-friction · effort M — Results are buried below the full roster and two activity logs; on public surveys every email that merely verifies is added to that roster

- **Where:** `backend/admin/custom-surveys.js:224` · **Verdict:** found by verifier
- **Impact:** The main reason to open a survey, reading results, means scrolling past every invitee row and its Remove button. That's several phone screens for a cohort survey, and on public surveys the roster grows with every visitor who verifies.
- **Fix:** Use tabs or sections in the survey view (Overview/Results, Respondents, Activity), with results first. Collapse the roster behind a count ('25 respondents · 4 responded'), with search and paging. On public surveys, separate registered-but-not-answered people from responders.

### custom-surveys-v2 · medium · ux-friction · effort M — 'Add myself for testing' on a live survey turns the officer's test answers into real results (shared with respondents under the officer's email) that can never be deleted

- **Where:** `backend/admin/survey-respondents.js:131` · **Verdict:** found by verifier
- **Impact:** Officers who test a published survey skew its results and expose their own email to respondents. The test response lingers permanently in the archived count and in Inbox → Archived, so a clean survey means rebuilding it.
- **Fix:** Steer testing to the local trial and preview link before publishing. If self-testing a live survey is allowed, mark officer test responses as tests, exclude them from shared results and counts, and add 'Delete test response'. Don't use an email as the display name.

### custom-surveys-v3 · medium · bug · effort S — 'Load more responses' uses offset paging over a random-UUID order, so responses arriving or removed between pages are duplicated or silently skipped

- **Where:** `backend/lib/survey-results.mjs:21` · **Verdict:** found by verifier
- **Impact:** While reading results during an active survey, an officer who clicks Load more sees the same people twice and misses new responses. Nothing indicates the list is incomplete until they refresh, which also resets their scroll position.
- **Fix:** Use keyset pagination on a stable key such as (submitted_at DESC, advisor_id) with an 'after' cursor. Also show 'N new responses since you opened this · Refresh'.

### custom-surveys-v4 · medium · bug · effort S — A deep-link hash goes stale when another survey is picked, so reloading or sharing the URL shows a different survey, and unknown ids silently fall back to the newest survey

- **Where:** `backend/admin/custom-surveys.js:62` · **Verdict:** found by verifier
- **Impact:** An officer who copies the URL to show a teammate 'these results' sends a different survey. After a reload, the page's Close survey and Remove access controls apply to a survey other than the one they were just viewing; the title in the select is the only cue.
- **Fix:** On selection, call history.replaceState with '#custom-survey=<id>'. When a deep-linked id isn't in the catalog, show 'That survey wasn't found' and select nothing, instead of falling back to the first survey.

### custom-surveys-v5 · medium · ux-friction · effort S — A save started from the top step bar fails silently on phones: the error and Retry render about 3,500px below while every control is disabled and leaving is blocked

- **Where:** `backend/admin/survey-builder.js:560` · **Verdict:** found by verifier
- **Impact:** On a flaky phone connection, the officer sees the builder grey out with no message. They can't edit, copy their text out of disabled fields, or switch tabs, and the only way out is reloading and accepting the beforeunload prompt.
- **Fix:** Put a sticky status and Retry bar next to the step bar, or scroll and focus the status when a save fails. Leave inputs readable and selectable rather than disabled while a save is pending. Offer 'Keep editing offline' or 'Discard and leave' after a failed save.

### custom-surveys-15 · low · ux-friction · effort S — Archived custom-survey answers live in Inbox → Archived → Questions, away from the survey

- **Where:** `backend/admin/custom-surveys.js:290` · **Verdict:** confirmed
- **Impact:** Officers must leave the survey and know to look in an unrelated Inbox filter to see answers from someone they removed. That's easy to miss, and switching tabs loses their place.
- **Fix:** Show an 'Archived responses (N)' section collapsed at the bottom of the survey's own results (responseSections already supports `includeArchived`). Keep the Inbox listing as a secondary route.
- **Verifier:** The code matches: the results API is activeOnly:true (api/custom-surveys.mjs 126-128). The link goes to '#archived-survey-questions', which index.js turns into an Inbox filter. `data.results.some(r => !r.active …)` on line 288 is dead code. responseSections supports includeArchived, but the API would also need an archived page. I lowered it to low: this only matters after removing someone who has answered, and the survey page links to the archive.

### custom-surveys-16 · low · ux-friction · effort M — Concurrent-edit conflict is a dead end: 'Reload before saving' with no reload and no way to keep edits

- **Where:** `backend/admin/survey-builder.js:173` · **Verdict:** confirmed
- **Impact:** When two officers touch the same draft, the second loses all their unsaved edits, with no comparison or copy option.
- **Fix:** Offer 'Load latest version' (with the officer's unsaved text kept visible to copy), or a simple field-level merge, since drafts are small JSON. Show who saved last and when.
- **Verifier:** Reproduced with two tabs on my draft 'csv-D draft'. Tab 2's Save and continue showed 'Another admin changed this survey. Reload before saving.' The visible buttons were only the step buttons, Save and continue and Save draft and leave: no reload and no retry. Tab 2's typed welcome text can't be kept except by copying it by hand.

### custom-surveys-17 · low · ux-friction · effort S — Survey activity is flooded with a 'Saved draft' entry for every step click

- **Where:** `backend/lib/survey-builder.mjs:291` · **Verdict:** confirmed
- **Impact:** The audit trail, meant to show who changed or published what, is mostly noise. Each no-op step also costs two network round trips.
- **Fix:** Skip the save request when the definition hasn't changed (compare against the last saved JSON). Optionally collapse consecutive saves by the same officer into one 'Edited draft (n saves)' entry.
- **Verifier:** Reproduced: building and publishing one survey wrote 9 activity entries, 8 of them 'Saved draft'. go() always calls save() (185-191), and save() always POSTs and then GETs the draft (150-165), even when nothing changed.

### custom-surveys-18 · low · ux-friction · effort S — Removing a question or choice has no undo, and changing the answer type wipes typed choices

- **Where:** `backend/admin/survey-builder.js:416` · **Verdict:** confirmed
- **Impact:** A mis-click deletes a carefully written question or choice list. The next step click auto-saves the deletion.
- **Fix:** Show an 'Undo' toast after removal. Keep the previous options in memory when the type changes so switching back restores them.
- **Verifier:** Code: 'Remove question' splices immediately (416-420), and choice Remove does the same (survey-choices.js 78-82). A type change to text or scale sets options to [] (367-371), while single↔multiple keeps them. There is no undo anywhere in the builder. 'Remove question N' also has the same small outlined style as the neighbouring move buttons (reviewer screenshot 64).

### custom-surveys-19 · low · ux-friction · effort S — Visual hierarchy is inverted: the main wizard action looks secondary while choice 'Remove' looks primary

- **Where:** `backend/admin/style.css:69` · **Verdict:** confirmed
- **Impact:** The eye goes to destructive or secondary actions instead of moving forward. The small 36px targets are harder to hit on phones.
- **Fix:** Give the wizard's forward action a primary style and a 44px target. Make choice Remove and move buttons quiet icon buttons with labels. Lay choice rows out so controls stay on one line at 390px.
- **Verifier:** Computed styles in the fixture: 'Save and continue →' has a white background, 12px text and 36px height. Choice 'Remove' has an accent background rgb(85,70,203) and 42px height. This comes from `.entry-actions button` at style.css 674-678 overriding the primary class, while choice buttons have no class. The reviewer's 390px screenshot 64 shows each choice's Remove wrapping onto its own line.

### custom-surveys-20 · low · bug · effort S — Respondents can still be added to closed surveys

- **Where:** `backend/lib/survey-respondents.mjs:91` · **Verdict:** confirmed
- **Impact:** It looks as if a closed survey can still collect answers. Officers may invite people who then hit 'Survey unavailable', and the audit log fills with meaningless changes.
- **Fix:** Make the roster read-only for closed or expired surveys, with a note: 'Closed — reopen or duplicate to invite more people'. Reject adds on the server when status is closed.
- **Verifier:** Reproduced: after closing my survey 'csv-B 122240', I added 'CSV Late' and a 'Remove access for CSV Late' button appeared. changeRespondent locks only roster_revision and never checks status (survey-respondents.mjs 91-116).

### custom-surveys-21 · low · ux-friction · effort M — Survey selection isn't kept in the URL; Surveys always opens on Event surveys; phone dropdown truncates status

- **Where:** `backend/admin/custom-surveys.js:302` · **Verdict:** confirmed
- **Impact:** There are extra clicks on every visit, and officers can't bookmark or share 'the survey I'm reading'. On phones, draft, open and closed surveys can't be told apart.
- **Fix:** Write '#custom-survey=<id>' on selection and remember the last-used survey group. Replace the select with a list or cards grouped by status (Drafts / Open / Closed), each showing a status chip, response count and deadline.
- **Verifier:** Reproduced: the Surveys tab opens with event=true and custom=false pressed (index.js 730). select.onchange = show (302) never writes the hash. It's worse when the officer arrives by deep link: the URL keeps the old id, so a reload shows a different survey. I've reported that separately in missed.

### custom-surveys-22 · low · copy · effort S — Copy and context mismatches: 'Create a custom survey' when editing; draft view shows results scaffolding

- **Where:** `backend/admin/survey-builder.js:195` · **Verdict:** confirmed
- **Impact:** Officers aren't sure whether they're editing an existing draft or creating a duplicate, and draft pages read like live surveys with missing data.
- **Fix:** Use 'Edit draft: <title>' as the heading when editing. For drafts, hide the results scaffolding and show a draft card ('Draft · last saved by X at Y · Continue editing · Delete'). Confirm 'Draft saved' after leaving.
- **Verifier:** Reproduced: the H2 reads 'Create a custom survey' while editing an existing draft through 'Continue editing draft' (v7 screenshot). The draft catalog view still renders the 'Submitted responses' h3 and 'Saved responses · read-only…'. There is no 'Draft saved' notice after Save draft and leave.

### custom-surveys-23 · low · performance · effort S — Opening a survey makes three sequential requests before results appear

- **Where:** `backend/admin/custom-surveys.js:225` · **Verdict:** confirmed
- **Impact:** On a phone connection, switching surveys shows 'Loading respondents…' and blank results for three round trips.
- **Fix:** Fire results, members and draft in parallel (Promise.all) and render each section as it arrives. Load the activity log lazily when its <details> is opened.
- **Verifier:** Code-read: show() awaits results (76), then `await mountRespondents(...)`, which awaits the members GET (survey-respondents.js 10), then awaits the draft GET (228). responseSections is appended only at 245-250, so the three round trips run in sequence before results render.

### custom-surveys-24 · low · ux-friction · effort L — Two different question editors with different rules and controls (event RSVP vs custom survey)

- **Where:** `backend/admin/survey-editor.js:54` · **Verdict:** confirmed
- **Impact:** Officers who build both kinds of survey must learn two interfaces with different limits and features. The event editor's duplicated textarea and row editor for the same options is confusing.
- **Fix:** Build one shared question-editor component with consistent limits, types (including rating and 'Other') and reorder controls. Drop the duplicated options textarea, or keep it behind a 'Paste options' toggle.
- **Verifier:** Code-read of survey-editor.js: 3 types (30-32), 'Answer options (one per line, 2–30 options)' textarea (54-56) plus a row editor with pointer drag (78-88), 'Allow an Other answer' (149), 'Move up'/'Move down' (154-155) and a 20-question cap (182). The custom builder allows 30 questions and 12 choices, uses HTML5 drag, and has no Other option.

### custom-surveys-v6 · low · ux-friction · effort S — Admin result cards show only the typed display name, never the email, so same-name respondents can't be told apart or matched to the roster

- **Where:** `backend/lib/survey-results.mjs:16` · **Verdict:** found by verifier
- **Impact:** Officers type invitee names freely, so two 'Alex' entries are indistinguishable in results. Following up with a specific respondent means cross-referencing the roster by name.
- **Fix:** Include the email (admin-only) as secondary text in admin result cards. Link each card to its roster row, and the roster row back to the response.

### custom-surveys-v7 · low · accessibility · effort S — Choice drag grip is a keyboard tab stop that does nothing, adding 5 tab stops per choice

- **Where:** `backend/admin/survey-choices.js:28` · **Verdict:** found by verifier
- **Impact:** Screen-reader and keyboard users hear 'Drag choice N to reorder, button' with nothing to activate, and a 12-choice question costs about 60 Tabs to cross.
- **Fix:** Make the grip tabindex=-1 and aria-hidden, since the ↑/↓ buttons already cover keyboard reordering. Alternatively, have the grip handle ArrowUp and ArrowDown. Merge the move and Remove controls into a compact per-row menu.

## Accessibility

Club Office is one static page, backend/admin/index.html. Vanilla ES modules (backend/admin/index.js, event-editor.js, survey-results.js, custom-surveys.js, survey-builder.js, contact-history.js, submission-editor.js, submission-activity.js) build almost every view by wiping and rebuilding the DOM: `replaceChildren` or a full `render()` runs after nearly every action or reload. Nothing puts focus back afterwards, so after most actions keyboard focus falls to <body>. Navigation uses `<nav>` elements full of `aria-pressed` toggle buttons: three top tabs (index.html:98-102), survey groups (315-322), inbox status views (248-273) and the Events Active/Archived switch (363-370). The panes are `<section aria-label>` regions with no tab/tabpanel link between them. Each inbox entry, inbox group and survey response is an unnamed `<details>` with nested `<details>` inside. The Inbox pane has no heading below the page h1. Status messages go to many separate `role=status` nodes: global #status, #event-status and #survey-status, plus two per inbox entry (110 counted on the default inbox). #status and #event-status are sticky, as is the Save/Preview/Publish bar in the event form (style.css:275-286, 528-537). All modals are native `<dialog>` opened with showModal and given aria-labelledby. The submission editor, survey report and trial-results dialogs return focus correctly; the site preview and contacts dialogs do not. Theming uses CSS custom properties with a dark-mode block (style.css:13-33, 869-886). Text contrast passes everywhere in dark mode and fails for one token pair in light mode. Field and control borders (--line) are about 1.3:1 in both themes. I ran keyboard-only paths in the fixture: triage an entry, create and save an event, open survey results, build a custom survey. All of them can be finished by keyboard, but focus is lost at most steps. The arrow-key re-render bug also stops the answer-type selects being changed with arrow keys.

### a11y-1 · high · accessibility · effort M — Inbox, survey and event actions rebuild the list and send keyboard focus to <body>; Tab then restarts at the top of the list

- **Where:** `backend/admin/index.js:263` · **Verdict:** confirmed
- **Impact:** A keyboard or screen-reader officer working down 50 entries loses their place after every Mark reviewed / Archive / Mark new and is thrown back to the first group. A screen reader says nothing about where focus went. Triage, the core weekly task, takes many extra key presses per entry.
- **Fix:** Before re-rendering, record the next entry's id (or the current one if it stays in view). After load(), focus that entry's <summary>, or the group summary, or a tabindex=-1 list heading when the list is empty. Apply the same pattern to survey star/archive (focus the same card's toggle by entry_id), to event library selection (keep the button by id instead of rebuilding, or focus the overview h3), to Cancel editing (focus 'Edit event'), and to cross-pane jumps (focus the destination pane's heading). The cleanest fix is a small focusAfterRender(key) helper used by all modules.
- **Verifier:** Reproduced (v1-inbox.cjs, review POST intercepted so nothing changed): focused 'Mark reviewed', pressed Enter. activeElement became BODY, #status read 'Submission moved to Reviewed.', and the next Tab landed on 'Club signups · 9 on this page' at the top of the list. Also reproduced BODY focus after: '☆ Star' on an event-survey response (v7, POST intercepted); choosing a library event and 'Cancel editing' on both new and existing events (v5); 'Refresh results' in Custom surveys (v6). 'View survey answers' was code-read only: showPane() hides #inbox-pane under the focused button …

### a11y-2 · medium · accessibility · effort S — Answer-type and template selects re-render the form on 'change', so the arrow keys change the value once and then focus is lost

- **Where:** `backend/admin/survey-builder.js:118` · **Verdict:** confirmed
- **Impact:** Officers using only a keyboard (Windows/Chrome, or NVDA/JAWS in focus mode) cannot step through options with the arrow keys: each key press commits a change and drops focus. A user who arrows past 'Choose one' while browsing gets the wrong type and has to find their place again. This fails WCAG 3.2.2 On Input, because changing a setting moves focus.
- **Fix:** Do not rebuild the whole form when a select changes. Update only the dependent part (for example, show or hide the choices editor inside the same fieldset), or re-render and then focus the same select again by a stable key such as question id plus field name. The simplest stopgap is to save `document.activeElement`'s data-key before render() and focus the matching element afterwards.
- **Verifier:** Reproduced. In the event RSVP editor, ArrowDown on Answer type set the value to 'single' and focus went to BODY; a second ArrowDown left it at 'single' (v3). In the builder, ArrowDown on Starting template switched to 'feedback', silently added 3 questions and dropped focus. ArrowUp on Target audience changed advisors to officers, which also forces answer='invited' (survey-builder.js:251-253), and dropped focus (v6). This fails WCAG 3.2.2, and arrowing changes data by accident. I lowered it to medium: mouse users are unaffected, and keyboard users can still choose a value by opening the list …

### a11y-3 · medium · accessibility · effort S — Buttons disable themselves while they have focus (Refresh, Next/Previous, Add comment, Save/Publish), so focus falls to <body>

- **Where:** `backend/admin/index.js:332` · **Verdict:** confirmed
- **Impact:** After routine actions such as refreshing, paging or commenting, keyboard and screen-reader users lose their position, and sometimes leave an open dialog. On save errors they must find the form again from the top of the page.
- **Fix:** While a control is busy, use aria-disabled='true' plus a busy guard in the handler instead of the disabled attribute, at least for the focused control. Otherwise, save document.activeElement before disabling and restore it, or move focus to a sensible target, once the work finishes. For Next/Previous, move focus to the list heading or first item after the page loads and announce 'Page 2 of N'. For Preview, open the dialog only after re-enabling controls, or store the trigger and focus it on the dialog's 'close' event.
- **Verifier:** Reproduced: Refresh by keyboard left focus on BODY (index.js:332). 'Add comment' left BODY (submission-activity.js:119-120). Save draft with an http:// link showed 'Use a full https:// meeting link.' with focus on BODY (event-editor.js:429-431). Preview then Escape returned focus to BODY: Preview was disabled when showModal() ran, so the dialog had nothing to return focus to (event-editor.js:412 runs before the finally block re-enables controls). Next on the last page and contacts Next were confirmed by code (index.js:466; contact-history.js:84 disables both buttons at the start of every …

### a11y-4 · medium · accessibility · effort M — The custom-survey builder never places focus: changing step, adding or moving a question, or adding a respondent all leave focus on <body>

- **Where:** `backend/admin/survey-builder.js:194` · **Verdict:** confirmed
- **Impact:** Building a survey by keyboard means starting from the top of the builder after every action. Screen-reader users get no cue that the step changed or where the new question is, so a multi-step task becomes disorienting.
- **Fix:** After a step change, focus the step's h3 (give it tabindex=-1). After Add question, focus the new question's 'Question' input, as survey-editor.js already does. After Move, refocus the same button on the question's new position, or the matching move button, by question id. After Remove, focus the next question's legend or the 'Add question' button. After a respondent change, focus the status message or the add form. Better still, re-render only the panel that changed.
- **Verifier:** Reproduced on my own draft (v6): 'Create custom survey', 'Save and continue →', 'Add question', 'Move question 4 up', 'Move choice 1 down' and 'Remove choice 1' each left focus on BODY. The choice move is announced through role=status ('Moved choice 1 to position 2.'), but focus is still lost. render() always starts with root.replaceChildren (survey-builder.js:194), and save() disables every control (lines 144-146). Nothing elsewhere restores focus.

### a11y-5 · medium · accessibility · effort S — The sticky Save/Preview/Publish bar hides the focused field (WCAG 2.4.11), entirely on phones

- **Where:** `backend/admin/style.css:528` · **Verdict:** confirmed
- **Impact:** Officers editing events on a phone, the documented use case, type into or tab onto fields they cannot see. Where an error names a field, that field is often the one hidden under the bar.
- **Fix:** Add `html { scroll-padding-bottom: <bar height + 24px> }` (and scroll-padding-top for the sticky status) so focused elements scroll clear of the bar. Alternatively, make the bar static below about 700px and repeat the primary actions after section 05.
- **Verifier:** Reproduced by Tabbing through a new event (v3/v5). At 1440x900, endDate and endTime were 73% covered by .primary-actions and the summary textarea 52%; the bar is 73px tall. At 390x844 the bar is 72px tall, and Tab focus on Location was 100% covered, preparation 70%, and the Introduction format buttons 85%. style.css has no scroll-padding anywhere (grep). In my own save-error screenshot the meeting-link field happened to be visible, so whether the errored field ends up under the bar depends on scroll position, but the 2.4.11 obscuring itself is real.

### a11y-6 · medium · accessibility · effort S — Sticky status banners stay up forever and cover focused controls; success and failure look the same

- **Where:** `backend/admin/style.css:275` · **Verdict:** confirmed
- **Impact:** Keyboard users moving upward lose sight of the focused item, which fails WCAG 2.4.11. Every sighted officer gets a stale banner taking space on a small screen and can't tell success from failure at a glance.
- **Fix:** Clear success messages after about 6 seconds, or add a dismiss button, and keep error messages until they are fixed. Add html { scroll-padding-top: 72px } while a banner shows, or make the banner non-sticky and announce the message through a visually hidden live region instead. Use distinct styles for success and error (an icon or heading, not colour alone).
- **Verifier:** Reproduced. After Mark reviewed, Shift+Tabbing back up the list put an entry summary ('Farah Synthetic5…') 73% under the sticky #status (top 10-59px). #status is always rgb(121,82,10), the amber notice colour, for success and failure alike. #event-status is always accent purple for both (style.css:287-293). In v3-save-error.png the banner covers the event title field and the 'Find an event' label. I also found that showPane() never clears #status (index.js:695-735). An inbox message therefore stays sticky in the Events pane, at the same top:10px and z-index:5 as #event-status (both measured …

### a11y-7 · medium · accessibility · effort M — Server-side validation errors are not tied to their fields: no aria-invalid, no focus on the field, message far away

- **Where:** `backend/admin/event-editor.js:479` · **Verdict:** confirmed
- **Impact:** Officers, especially screen-reader and phone users, have to work out which field the banner means and scroll to find it, and it is often hidden under the sticky bar (a11y-5). This makes WCAG 3.3.1 Error Identification hard to meet in practice.
- **Fix:** Have the API return a field key with each validation error ({error, field:'meetingUrl'}). On the client, set aria-invalid='true', add an inline message element linked with aria-describedby, and focus the field. Also mirror server rules on the client where it is cheap, for example pattern='https://.*' on meetingUrl and requiring date when startTime is set. Clear aria-invalid on input.
- **Verifier:** Reproduced: meetingUrl 'http://example.com/meet' passes the browser check (validity.valid=true), then Save draft returns 'Use a full https:// meeting link.' with focus on BODY and aria-invalid=null. The only error path is say(e.message) (event-editor.js:479-480), and the server message comes from lib/event-content.mjs:121-122. Confirmed by code that the login OTP input has no aria-invalid or aria-describedby, and nothing references #code-instructions (index.html:59-71). No grep hit for aria-invalid anywhere in admin/.

### a11y-8 · medium · accessibility · effort M — Office tabs are aria-pressed toggle buttons in a <nav>, not tabs; pane names don't match the tabs; the active tab disappears in forced colours

- **Where:** `backend/admin/index.html:98` · **Verdict:** confirmed
- **Impact:** Screen-reader officers hear 'toggle button pressed' instead of 'tab, selected, 1 of 3' and get no link from the control to the region it shows. Officers using Windows High Contrast cannot tell which section or status filter is active.
- **Fix:** Because the panes are deep-linked by hash, the simplest correct pattern is links (<a href="#events">) with aria-current="page" on the active one. Otherwise, implement role=tablist/tab/tabpanel with aria-selected, aria-controls and roving tabindex with arrow keys. Name each pane after its tab (or label it with a visible h2). Add `@media (forced-colors: active)` rules that mark the selected item with a border or `outline: 2px solid Highlight`.
- **Verifier:** CDP accessibility tree shows 'button:Inbox pressed=true', and navigation landmarks 'Club office', 'Submission status' and 'Submission pages'. There are no tab roles. Pane labels differ from the tab names: 'Event editor' and 'Survey results' for the Events and Surveys tabs (index.html:314, 350). With forcedColors:'active', all five tab buttons computed border-bottom 2px solid rgb(0,0,0) (v7-forced-tabs.png shows identical underlines). The inbox views computed white versus transparent backgrounds, which look the same on Canvas. The same forced-colours loss applies to the selected event-library …

### a11y-9 · medium · accessibility · effort M — The Inbox has no headings below the h1; entries and groups are unnamed <details>; 50 identical 'Mark reviewed' buttons

- **Where:** `backend/admin/index.js:169` · **Verdict:** confirmed
- **Impact:** Screen-reader officers can't jump between groups or entries with heading navigation (H/3). A screen reader's list of buttons shows dozens of identical 'Mark reviewed' entries with no person attached, which risks acting on the wrong record.
- **Fix:** Add a visible or visually hidden h2 'Inbox' to the pane, render each group summary inside an h3 (or label the group with aria-labelledby on its summary), and put the entry name in an h4 inside the summary. Add the entry's status and type to the summary text. Give the action buttons aria-describedby pointing at the entry's name, or aria-labels such as 'Mark reviewed: Ava Synthetic0'.
- **Verifier:** Reproduced: the only visible heading on the default Inbox is 'H1:Your club office'. CDP shows many 'group:' nodes with empty names (the entry and group <details>). Code: the entry summary has only name, email and time (index.js:171-176), and action buttons are plain node('button', label) repeated for each of the 50 entries (lines 247-261). 'Submission details' and 'Activity & comments' summaries also repeat 50 times.

### a11y-10 · medium · accessibility · effort S — Input, select and textarea borders are about 1.3:1 against their background (fails WCAG 1.4.11 non-text contrast)

- **Where:** `backend/admin/style.css:85` · **Verdict:** confirmed
- **Impact:** Low-vision officers, or anyone outdoors on a phone, struggle to see where the event-form and comment fields are, because the fields sit white-on-white inside cards.
- **Fix:** Add a stronger --field-border token at 3:1 or more against --surface, for example about #8b8b9c in light mode and about #6e6c80 in dark mode, and use it for inputs, selects, textareas and checkboxes. Keep --line for decorative dividers.
- **Verifier:** Computed: --line #e0e0e9 against --surface #fff is 1.31:1, against --page 1.21:1; in dark mode #353442 against #1c1c24 is 1.39:1. Inputs use border 1px solid var(--line) on a surface background inside surface cards (style.css:79-90, 474-484), so the border is the only visual boundary. That fails 1.4.11.

### a11y-12 · medium · accessibility · effort M — The 60-second auto-refresh rebuilds the open entry list even while an officer is reading, with no way to pause it (WCAG 2.2.2)

- **Where:** `backend/admin/index.js:426` · **Verdict:** confirmed
- **Impact:** A screen-reader user reading an entry in browse mode, where focus does not move, has their reading position reset to the top every minute. A sighted keyboard user whose focus is on the filters sees the list jump. There is no setting to stop it.
- **Fix:** Don't replace the rendered list in the background. Update the counts and title, and show a polite 'N new submissions. Show them' button that reloads on demand. Alternatively, offer a visible 'Pause auto-refresh' toggle and skip the background re-render while any entry is open.
- **Verifier:** Reproduced with page.clock (v8). I opened an entry, clicked plain text in it (focus moves to BODY, as any click on non-focusable text does) and selected the text, then fastForward(61000). The original node was replaced, its open state was restored, scrollY was unchanged (1580), but the text selection was wiped. With focus inside #entries the rebuild was correctly skipped (index.js:426-430). So the reviewer's 'reading position reset to the top' overstates it: scroll and open state are kept. The real costs are lost selections (copying text from a submission), a possible screen-reader …

### a11y-13 · medium · accessibility · effort S — The contacts dialog swaps its content without moving focus; focus lands on <body> outside the modal

- **Where:** `backend/admin/contact-history.js:124` · **Verdict:** confirmed
- **Impact:** Screen-reader officers following up with a contact hear nothing when the view changes and, inside a modal, have to Tab around to find out where they are.
- **Fix:** Make the contact-heading h2 tabindex=-1 and focus it after every load(). For paging, focus the first result or the status message. The survey report dialog already does this (reportHeading.focus()), so reuse that pattern.
- **Verifier:** Reproduced: choosing a contact changed the heading to 'Lena Synthetic47' with activeElement=BODY (not inside the dialog). '← All contacts' also left BODY. Mitigation: the next Tab went back into the dialog near the old position, because modal inertness and the focus starting point are kept. One correction to the reviewer's area summary and strengths: the contacts dialog does return focus to 'Contacts & follow-up' on Escape and on Close (reproduced), thanks to native dialog focus restoration.

### a11y-v1 · medium · accessibility · effort S — 'Open submission' in Contacts scrolls to the entry but returns keyboard focus to the 'Contacts & follow-up' button at the top of the page

- **Where:** `backend/admin/contact-history.js:259` · **Verdict:** found by verifier
- **Impact:** A keyboard or screen-reader officer following up on a contact sees the entry, but the next key press takes them back to the page header. A screen reader announces the Contacts button, not the submission they asked for.
- **Fix:** After load() opens a linked card, call card.querySelector('summary').focus({ preventScroll: true }) right after scrollIntoView. For links that close a dialog and navigate, set a flag so the destination takes focus instead of the dialog's restored opener.

### a11y-11 · low · accessibility · effort S — Inbox Inbox status and Events Active/Archived switches: unselected labels 4.23:1, selected state shown only by a 1.31:1 background

- **Where:** `backend/admin/style.css:252` · **Verdict:** confirmed
- **Impact:** It's easy to miss which view is active (New, Reviewed or Archived). Officers may archive or restore entries thinking they are in a different view.
- **Fix:** Darken the unselected label to --text at about 80% (≥4.5:1), and mark the selected segment with a 2px accent border or underline plus a check icon (≥3:1). Add a forced-colors rule.
- **Verifier:** Computed: muted #676778 on --line #e0e0e9 is 4.23:1. The selected segment's background (#fff on #e0e0e9) is 1.31:1. The other cue, the label colour changing from muted to --text, is only 2.91:1 between the two colours, so the selected state is below 3:1 either way. Under forced colours the selected state disappears (see a11y-8). Low is right because the text note under the switch (#inbox-view-note) also states the current view.

### a11y-14 · low · accessibility · effort S — Over 100 role=status regions on the inbox; messages never cleared; notices inserted already filled may not be announced

- **Where:** `backend/admin/submission-activity.js:28` · **Verdict:** confirmed
- **Impact:** Announcements are noisy or missing. The 'survey closed' confirmation may never be spoken, and the stale 'new submissions' alert stays on screen after the officer has handled them.
- **Fix:** Use one visually hidden polite announcer (and one assertive one for errors) that every module calls through an announce(message) helper, plus inline text that is not a live region. Clear #inbox-alert when the officer views the New list or after the next refresh with nothing new. For the event save, either focus the confirmation or update #event-status, not both.
- **Verifier:** Counted 110 [role=status]/[aria-live] elements on the default inbox with 50 entries: two per entry from submission-activity.js:28-29 and 108-109, plus page-level ones. Confirmed by code that #inbox-alert is cleared only in showLogin (index.js:137), that custom-surveys.js:142-147 prepends an already-filled role=status notice while root is rebuilt, and that event-editor.js:446-477 writes the same text to #event-status and to a focused role=status confirmation. Whether the announcements are actually missed or doubled is inferred, not tested with a screen reader.

### a11y-15 · low · accessibility · effort S — Light-mode placeholder text is about 4.0:1, including instructions such as 'One outcome per line'

- **Where:** `backend/admin/style.css:91` · **Verdict:** confirmed
- **Impact:** Low-vision officers may miss the 'one per line' instruction and enter learning outcomes or agenda items in the wrong format.
- **Fix:** Remove the opacity (muted alone is 5.1:1 on white). Better, move instructions out of placeholders into the existing visible hints and link them with aria-describedby.
- **Verifier:** Computed: --muted at opacity 0.85 on white blends to about rgb(126,126,140), which is 4.00:1. Placeholders carry instructions ('One outcome per line', index.html:507). One correction to the recommendation: muted alone on white is 5.54:1, not 5.1:1. 5.10:1 is muted on --page.

### a11y-16 · low · accessibility · effort S — The focus ring on event library cards is clipped by the scroll container and covered by the sticky group headings

- **Where:** `backend/admin/style.css:319` · **Verdict:** confirmed
- **Impact:** Keyboard officers have trouble seeing which event card is focused before pressing Enter, and could open the wrong event.
- **Fix:** Inside the list, use `.event-choice:focus-visible { outline-offset: -3px }` or a 2px inset box-shadow, add a few px of padding to #event-list, and set scroll-padding-top on #event-list to the sticky heading's height.
- **Verifier:** Reproduced (v7-event-choice-focus.png): with the first .event-choice focused, the ring shows only at the bottom and lower sides. The top is hidden under the sticky 'DRAFTS & UNPUBLISHED CHANGES' h3 (style.css:326-337), and the sides are clipped by #event-list (overflow-y:auto, padding-left 0, offsetWidth equal to clientWidth, 262px).

### a11y-17 · low · accessibility · effort S — Toggle buttons change both their label and aria-pressed; glyphs are read aloud; event cards use aria-pressed for selection

- **Where:** `backend/admin/survey-results.js:346` · **Verdict:** confirmed
- **Impact:** Screen-reader officers hear confusing state ('Unstar, pressed'), long card names, and 'north east arrow' or 'right arrow' in link text.
- **Fix:** For toggles, keep one fixed label ('Star') with aria-pressed, or keep the changing label and drop aria-pressed. For selection in the event list, use aria-current='true' and a short name: the title as the name, with date and status in aria-describedby. Hide decorative glyphs in <span aria-hidden='true'> and add visually hidden '(opens in new tab)' text to target=_blank links.
- **Verifier:** Reproduced: the star button's text is '☆ Star' with aria-pressed=false. Code switches the label to '★ Unstar' while setting pressed=true (survey-results.js:346-349), and browser-alerts.js:178-181 does the same. Event library cards use aria-pressed for selection (event-editor.js:234), and their names include date, status and the full timestamp.

### a11y-18 · low · accessibility · effort S — Drag handles are focusable buttons that do nothing from the keyboard

- **Where:** `backend/admin/survey-choices.js:28` · **Verdict:** confirmed
- **Impact:** Keyboard and screen-reader users meet a button that promises reordering and does nothing, and must tab past an extra dead stop on every choice.
- **Fix:** Give the drag handles tabindex='-1' and aria-hidden='true', since the ↑/↓ buttons already cover keyboard reordering. Or make Enter/Space on the handle start keyboard reordering, with arrow keys to move and an announcement of the result.
- **Verifier:** Reproduced in the builder: focusing 'Drag choice 1 to reorder' and pressing Enter, Space and ArrowDown left the order as ['alpha','beta'] with focus still on the grip. survey-choices.js:28-36 has only drag handlers. The event RSVP editor's '↕' handle (survey-editor.js:70-97) has pointer handlers only, confirmed by code.

### a11y-19 · low · accessibility · effort S — Hints and instructions are not linked to their controls; 'required' is marked inconsistently

- **Where:** `backend/admin/index.html:446` · **Verdict:** confirmed
- **Impact:** Screen-reader officers tabbing through the form never hear the time-zone rule, the image limits or the Social default, and only learn after the browser rejects the form that the title is required.
- **Fix:** Give each hint an id and reference it from its control with aria-describedby. Add a visible '(required)' or asterisk legend for the title, or label every optional field consistently.
- **Verifier:** Confirmed by code: the hints at index.html:446-453, 527-530 and 552-555 are sibling <p class='hint'> elements with no aria-describedby. The only aria-describedby in admin/ is the formatting hint (text-formatting.js:33). The OTP input has no describedby link to #code-instructions. The required title has no visible marker, while '(optional)' is used for some fields but not others.

### a11y-20 · low · accessibility · effort S — No skip link and 18 Tab stops to reach the first entry; filters and pagination are marked up as <nav> landmarks

- **Where:** `backend/admin/index.html:248` · **Verdict:** confirmed
- **Impact:** Keyboard officers walk through the help and alert controls on every visit, and screen-reader landmark lists are crowded with things that are not site navigation.
- **Fix:** Add a 'Skip to submissions' link (and one per pane). Turn the filter and pagination wrappers into role=group or plain <div>s with a label, and keep <nav> for the office tabs only. Move the help <details> and alert controls below the list, or into a collapsed 'Inbox settings' area.
- **Verifier:** Reproduced: 18 Tab presses from the top to the first entry summary, in exactly the listed order. The inbox view exposes 3 navigation landmarks; the 'up to 8' figure counts those in hidden panes. There is no skip link, but <main> exists, so 2.4.1 is technically met through landmarks. Low is correct.

### a11y-21 · low · accessibility · effort S — Heading levels go backwards in the builder preview, archived survey responses and the trial-results dialog

- **Where:** `backend/surveys/form-ui.js:23` · **Verdict:** confirmed
- **Impact:** Screen-reader heading navigation suggests the wrong structure, as if each preview question were a new top-level section.
- **Fix:** Add a headingLevel option to questionFields and responseSections (default 2 on public pages, 4 inside admin panels). Give the Inbox an h2 so the archive h3 sits correctly. Start dialogs at h2.
- **Verifier:** Reproduced on the builder Preview step. Heading order was H2 'Create a custom survey', H3 'Preview', H2 per question (including an empty H2 for an untitled question), then H4 title. Code: form-ui.js:23 renders each question as h2. survey-archive.js:286 starts at h3 under the page h1, and survey-trial.js:130 uses h3 as the dialog title.

### a11y-v2 · low · accessibility · effort S — Contact confirmation 'Cancel' always moves focus to 'Merge with another contact', and focus is lost on deleted contacts

- **Where:** `backend/admin/contact-history.js:398` · **Verdict:** found by verifier
- **Impact:** Keyboard users who back out of a destructive confirmation land on a different action, Merge, which invites a mis-activation. On deleted contacts their focus disappears entirely.
- **Fix:** Pass the trigger button into confirm() and focus it on Cancel, falling back to the panel heading when it is gone.

### a11y-v3 · low · accessibility · effort S — When the session expires mid-task, the office is hidden with focus on <body>, and the sign-in field is not focused

- **Where:** `backend/admin/index.js:111` · **Verdict:** found by verifier
- **Impact:** A screen-reader officer whose 3-day session lapses during triage hears at most a polite message and has to hunt for the sign-in form. Their focus context is gone.
- **Fix:** When showLogin() runs because of expiry, focus the email input (or the login h1 with tabindex=-1). Announce 'Your session ended' through role=alert.

### a11y-v4 · low · bug · effort S — The global status banner is never cleared on pane switch, so stale inbox messages stay sticky in Events and Surveys and stack under #event-status

- **Where:** `backend/admin/index.js:695` · **Verdict:** found by verifier
- **Impact:** Officers on the Events or Surveys pane see an unrelated, old inbox message pinned over their form. Screen-reader users get no cue that it is stale.
- **Fix:** Clear #status in showPane(), or scope messages to each pane. Combine with the auto-dismiss of success messages proposed in a11y-6.

### a11y-v5 · low · accessibility · effort S — Event RSVP question buttons are named 'Move up' / 'Move down' / 'Remove question' with no question number, and removal is immediate

- **Where:** `backend/admin/survey-editor.js:153` · **Verdict:** found by verifier
- **Impact:** With up to 20 RSVP questions, a screen reader's buttons list shows 20 identical 'Remove question' entries. Voice-control users ('click Remove question') get ambiguous targets. One wrong activation silently deletes a question.
- **Fix:** Use the builder's naming, e.g. aria-label `Remove question ${index + 1}` (optionally with its text). After removal, move focus to the next question's legend or to 'Add question'.

### a11y-v6 · low · accessibility · effort S — The website preview 'Desktop' / 'Mobile' switch does not expose which mode is active

- **Where:** `backend/admin/event-editor.js:104` · **Verdict:** found by verifier
- **Impact:** Screen-reader officers previewing an event cannot tell whether they are looking at the mobile or desktop layout. Sighted users can infer it only from the iframe width.
- **Fix:** Toggle aria-pressed (or render them as a radio group) and give the active one the selected style used by the other segmented controls.

## Visual design and layout

Club Office is a single page (backend/admin/index.html) with three hand-rolled tab panes: Inbox, Events and Surveys. Surveys holds a second tab bar for Event and Custom surveys. All styling comes from one 1712-line stylesheet (backend/admin/style.css). It defines colour tokens on :root with a prefers-color-scheme dark override, and every <button> is a filled accent (primary) button unless it has class "secondary" or sits inside .entry-actions. Every pane sits under the same marketing header: an app header with an 88px logo, the eyebrow "THE OFFICER WORKSPACE", the h1 "Your club office" and the tagline "A little planning. A lot of possibility." (index.html:90-97). The Inbox then stacks, top to bottom: Refresh and Contacts buttons, six count cards that do nothing when clicked (index.js:405-419), two <details> explainers, a browser-alerts block, New/Reviewed/Archived buttons, a Type/Event filter form with Apply, an Export link with a hint line, and finally the list. In the list, submissions are grouped into collapsible cards by kind or event (index.js:291-320), and each submission is itself a collapsed <details> card with a nested "Submission details" disclosure (index.js:168-290). Events uses a master/detail layout: a sticky event library on the left, the editor on the right with five numbered fieldsets and a sticky action bar. Custom surveys is a long vertical stack: a <select> survey picker, links, respondents and results.

### visual-1 · high · ux-friction · effort M — No submission is visible on the first screen; the list starts 1.4 to 2.5 screens down

- **Where:** `backend/admin/index.html:90` · **Verdict:** confirmed
- **Impact:** An officer who signs in weekly, often on a phone, to triage has to scroll past branding, statistics and help text before seeing a single item. New items never show above the fold, so 'is there anything for me?' always costs a scroll.
- **Fix:** Make the list the first thing below a slim header. Shrink the app header to about 56px (32px logo) and drop the eyebrow, h1 and tagline. Turn the six count cards into one row of type filter chips (see visual-8). Move both explainers and the browser-alerts text into a Help page or a '?' popover; keep a one-line alerts toggle in the header or a settings menu. Put chips, status control and Export in a sticky toolbar. Target: first submission above y=250 on desktop and y=200 on phone.
- **Verifier:** Re-measured in the fixture (inbox.cjs). At 1440x1000 the header is 0-117, intro 167-275, tabs 299-351, heading row 381, #counts 448-709, explainers 733/780, alerts 911, status buttons 1037, filters 1133-1245, #entries 1334, and the first .entry is at y=1394. At 390x844 the first .entry is at y=1604 and the counts block is 404px tall. A 'Setup still needed: uploads.' notice also sits in this stack (index.html:237). Nothing collapses or hides this content elsewhere in CSS or JS.

### visual-2 · high · ux-friction · effort L — Reading a message takes three disclosure clicks, and collapsed rows don't show what was submitted

- **Where:** `backend/admin/index.js:171` · **Verdict:** confirmed
- **Impact:** Triage means opening every card twice to learn what each person asked. Officers can't scan for urgent questions or spot spam, and the 50-item page runs about 6100px tall.
- **Fix:** Replace the nested <details> with a dense list row about 44-56px tall: status dot, name, type chip, subject or first line of message (or event title for RSVPs), relative time, and Mark reviewed / Archive buttons at the right. Clicking a row opens a detail panel on the right at 1100px and wider, or a full-screen sheet on phone. Show the message immediately with human labels (map keys to 'Subject', 'Message', 'Event', 'Campus'), drop the duplicate email, timestamp and 'Received in club inbox', and keep Reference and Activity collapsed at the bottom.
- **Verifier:** Confirmed. The collapsed summary renders only STRONG:name, SPAN:email and SMALL:time (index.js:172-176). The message sits in a nested 'Submission details' <details>, and its labels are raw keys: 'topic', 'campus', 'message', 'interests'. The expanded card repeats the email and time and prints 'Received in club inbox'. Two additions: human labels already exist in submission-editor.js:7-26 (Campus, Interests, Topic, Details, Subject, Message), but renderEntry (index.js:230-235) ignores them; and every key is rendered even when empty, so an empty value becomes an empty grey <pre> box. When name …

### visual-25 · high · bug · effort S — Questions about an event are filed inside that event's RSVP group, mixed in with RSVPs

- **Where:** `backend/admin/index.js:294` · **Verdict:** found by verifier
- **Impact:** Questions are the items that need a reply, and an event question ('Is parking free? event is today') is hidden among RSVPs that officers usually skim or skip. The Questions card says 9 while the Questions group shows fewer.
- **Fix:** Group by kind (questions always under Questions, with the event as a chip on the row), or label event groups by content, e.g. 'Office audit event — 8 RSVPs, 1 question', and sort questions first. Show type and subject in every collapsed row (see visual-2).

### visual-4 · medium · ux-friction · effort S — Button hierarchy is inconsistent: routine actions are filled primary and Apply's width jumps from 639px to 72px

- **Where:** `backend/admin/style.css:55` · **Verdict:** confirmed
- **Impact:** Visual weight no longer signals what to do next. Officers' eyes go to Refresh, Apply and Next instead of the actions that move work forward, and the filter bar shifts layout whenever the type changes.
- **Fix:** Allow one primary per view: New event, Publish, Create survey, and the Mark reviewed quick action in the inbox detail pane. Make Refresh a quiet text button next to an 'Updated 1 min ago' label. Make pagination buttons secondary. Auto-apply the Event select like Type and remove Apply; if it stays, give it a fixed width (`grid-template-columns: 1fr 1fr max-content`).
- **Verifier:** Measured. Apply is 639px wide with the Event select hidden and 73px after choosing RSVP. #refresh, survey Refresh and the Previous/Next pagination buttons compute to rgb(85,70,203) filled. Inside an open entry, 'Add comment' is filled while the status actions are white. The Type select auto-reloads (index.js:797-805), so Apply only matters for the Event select.

### visual-5 · medium · bug · effort S — CSS bug: anything inside .entry-actions is forced to secondary style, so intended primary and danger buttons look neutral

- **Where:** `backend/admin/style.css:69` · **Verdict:** confirmed
- **Impact:** In the builder the only filled control can't be clicked to move forward, and the real next step looks optional. Officers have to hunt for how to proceed.
- **Fix:** Scope the secondary override to buttons without a role class, e.g. `.entry-actions button:not(.primary):not(.danger)`. Or stop using .entry-actions as a styling hook and add explicit .btn-primary / .btn-secondary / .btn-danger classes. Remove the filled style from the aria-current step chip (use an underline or outline) so the step indicator doesn't compete with the action.
- **Verifier:** Opened the builder via 'Create custom survey', which saves nothing until a step is saved. 'Save and continue →' computes to bg rgb(255,255,255), 12px, 36px tall, while the aria-current chip '1. Template' is filled accent. The cause is the rule `button.secondary, .entry-actions button` (style.css:69-74) combined with survey-builder.js:549-554 passing ''. The same rule neutralises the inbox 'Delete permanently' button with class 'danger'. Nuance: step chips call go(i) (survey-builder.js:205), so clicking the filled current chip just re-saves the same step.

### visual-7 · medium · ux-friction · effort M — Status banner never clears, follows the officer across tabs, and success and error look the same

- **Where:** `backend/admin/style.css:275` · **Verdict:** confirmed
- **Impact:** A stale confirmation covers content and can mislead on another tab. Officers can't tell at a glance whether an action succeeded or failed, and two messages can stack invisibly.
- **Fix:** Use one toast region (fixed bottom-centre on phone, bottom-right on desktop) with success, error and info variants (icon plus colour). Auto-dismiss success after about 5s, keep errors until dismissed with a close button, and clear on tab change. Keep aria-live, and don't use sticky in-flow banners.
- **Verifier:** Reproduced with a mocked review POST. 'Submission moved to Reviewed.' stays position:sticky at top=10, 49px tall and 1348px wide while scrolling, and still reads the same after switching to Events. A mocked event save error put #event-status at top=10 h=49 directly over it. #status is always notice-amber rgb(121,82,10) for both success and errors. The banner also covers the sticky Event library's 'Find an event' label (status-overlap.png).

### visual-8 · medium · enhancement · effort M — The six count cards can't be clicked, duplicate the Type filter, and the status buttons have no counts

- **Where:** `backend/admin/index.js:405` · **Verdict:** confirmed
- **Impact:** Officers naturally tap 'Questions 9' expecting to see those nine, and nothing happens. They then have to find the same choice in a dropdown further down. Status counts (how many reviewed items still need follow-up) are not shown anywhere.
- **Fix:** Merge cards and Type select into one horizontally scrollable row of filter chips, e.g. 'All 54 · Signups 9 · Subscriptions 9 · RSVPs 9 · Submissions 9 · Workshops 9 · Questions 9', where the number is the new count and the selected chip is aria-pressed. Add counts to the status control ('New 54 · Reviewed 3 · Archived 12'), and put the total new count as a badge on the Inbox nav item.
- **Verifier:** The card is a DIV with no role, tabIndex -1, cursor auto and no handler. The status buttons have no counts. Caveat for the fix: the API returns only new and total per kind (api/admin.mjs:145-149), with no reviewed or archived counts, so status counts need a server change.

### visual-9 · medium · ux-friction · effort S — Surveys has a second tab bar styled exactly like the main tabs, plus a redundant 'Surveys' heading

- **Where:** `backend/admin/index.html:315` · **Verdict:** confirmed
- **Impact:** Officers lose track of where they are; it looks like the whole navigation changed. On phone the two bars and the heading take about 190px before any survey content.
- **Fix:** In a left-nav layout make Event surveys and Custom surveys nested nav items, or use the same segmented control as Events Active/Archived. Rename the inner h2 to match the selection, or drop it. If tabs stay, use role=tablist/tab/tabpanel for the top level only.
- **Verifier:** Both navs have class office-tabs (y=299 and y=381 at 1440). The inner h2 reads 'Surveys', and #survey-reload is filled primary. At 390 the first survey response is at y=1211.

### visual-10 · medium · ux-friction · effort M — Nothing stays pinned while scrolling: tabs, filters and pagination are only reachable by scrolling a ~6000px list

- **Where:** `backend/admin/style.css:210` · **Verdict:** confirmed
- **Impact:** To change status, switch to Events or go to page 2, officers scroll up to 6000px, which is painful on a phone. They also can't see how far through the list they are.
- **Fix:** Make the navigation persistent: a left nav on desktop, a bottom tab bar on phone. Make the inbox toolbar (chips, status control, search, '1-50 of 54 ‹ ›') sticky at the top of the work area. Add a 'Back to top' affordance on long lists, or use a scrolling list pane inside a fixed-height master/detail layout on desktop.
- **Verifier:** .office-tabs computes to position static, top -2701 (1440) and -2723 (390) at scrollY=3000. #entries is 6117px tall at 1440 and 5694px at 390. The pager exists only at the bottom and reads 'Page N' with no total.

### visual-11 · medium · ux-friction · effort M — 'View survey answers' jumps to another tab and the officer loses their place in the Inbox

- **Where:** `backend/admin/index.js:219` · **Verdict:** confirmed
- **Impact:** Checking one person's RSVP answers costs two long scrolls, and in a batch of RSVPs it happens every time. It nudges officers to skip reading the answers.
- **Fix:** Show the answers inline in the inbox detail pane (render the same dl from survey-results.js card()), with 'Open in Surveys' as a secondary link. If cross-tab navigation stays, save and restore window.scrollY per pane in showPane(), and scroll the target response into view.
- **Verifier:** Reproduced. Clicking 'View survey answers' at scrollY=5107 lands at scrollY=0 on Surveys, with the single result at y=988. Clicking Inbox returns scrollY=0. showPane (index.js:695-735) never saves or restores scroll.

### visual-12 · medium · copy · effort S — The marketing hero and taglines repeat on every tab and take about a third of the first screen

- **Where:** `backend/admin/index.html:92` · **Verdict:** confirmed
- **Impact:** Returning officers pay a scroll tax on every visit for copy meant for first impressions, and the important work sits lower on every screen.
- **Fix:** Remove the hero from the signed-in app. Use a compact top bar: 32px logo, 'Club Office', an Inbox / Events / Surveys / Contacts nav, and an account menu with 'Signed in as …' and Sign out. Give each work area a plain page title (h1 'Inbox') with its single primary action on the right. On the sign-in card use 'Club Office sign-in' as the heading and keep the friendly line as body text.
- **Verifier:** .office-intro sits outside the panes (index.html:90-97) and renders on all three tabs (screenshots of Inbox, Events and Surveys at 1440). The header is 117px with an 88px logo (89px with 64px at 390). Events adds a second eyebrow, h2 and tagline. 'Signed in as' appears at the bottom-right of the hero (y=255). .workspace-label is hidden below 900px (style.css:777-779). Overlaps visual-1 but is still a valid separate copy and IA point.

### visual-13 · medium · ux-friction · effort S — Help explainers and hint paragraphs sit above the work instead of being available on demand

- **Where:** `backend/admin/index.html:108` · **Verdict:** confirmed
- **Impact:** About 300px of reference text that officers read once sits between them and their work on every visit. It also adds three extra Tab stops (17 Tab presses from page start to the first submission).
- **Fix:** Move reference content to a Help page or slide-over reachable from the nav and a '?' next to the status control. Put the 10,000-row limit in the Export error and tooltip, and the alerts state in a settings menu or a small bell icon. If anything stays inline, add spacing between the panels and give summaries at least 44px tap height.
- **Verifier:** The panels are at 733 (h48) and 780, so their borders touch with no margin. Summaries measure 20px tall at 1440 and 390, and padding clicks do not toggle. Keyboard: 18 Tab presses from the top to the first entry summary (reviewer said 17).

### visual-14 · medium · accessibility · effort S — Low-contrast field and button borders, and failing contrast on unselected segmented-control labels

- **Where:** `backend/admin/style.css:22` · **Verdict:** confirmed
- **Impact:** On a phone in daylight or a low-quality laptop screen, empty inputs and secondary buttons are hard to find (e.g. the empty 'Find a contact' and 'Add respondent' fields). 'Reviewed' and 'Archived' read as disabled.
- **Fix:** Add a stronger `--control-border` (about #8b8b9c light, #6a6880 dark, at least 3:1) for inputs and secondary buttons, and keep --line for decorative dividers. Give the segmented track a lighter fill (e.g. --subtle) or darken unselected text to --text at 80%, aiming for 4.5:1.
- **Verifier:** Recomputed. #e0e0e9 on #fff is 1.31:1. Muted #676778 on the #e0e0e9 segmented track is 4.23:1, for 14px semibold text that is not large text, so 4.5:1 is required. Borders are the only boundary for inputs and secondary buttons (style.css:79-90, 69-74).

### visual-15 · medium · bug · effort S — Comment drafts are lost when the officer clicks the logo, which leaves the app in the same tab without warning

- **Where:** `backend/admin/index.html:25` · **Verdict:** confirmed
- **Impact:** An officer halfway through a follow-up note who clicks the logo expecting the Inbox loses the note, and leaves the office.
- **Fix:** Point the logo to /admin/ (Inbox), and put 'View public site ↗' in the account menu with target=_blank. Add a beforeunload guard when commentDrafts.size > 0.
- **Verifier:** Reproduced with external traffic stubbed. I typed a comment, then clicked .brand (href https://dallasai.club, no target). The URL became https://dallasai.club/ with no beforeunload dialog. The beforeunload listeners exist only in contact-history.js:578, event-editor.js:617, submission-editor.js:60 and survey-builder.js:568, and none checks commentDrafts. Related, not reproduced: the Sign out guard (index.js:629-634) does not check commentDrafts either, and showLogin clears them (index.js:143).

### visual-16 · medium · ux-friction · effort M — Same action, different control: four Refresh styles, Export as link vs button, search everywhere except the Inbox

- **Where:** `backend/admin/index.html:297` · **Verdict:** confirmed
- **Impact:** Officers relearn the controls on every tab, and the Inbox, the most-used view, is the only one without search.
- **Fix:** Build a small shared component set and use it everywhere: a page header (title plus one primary action), a toolbar (search, filter chips, status segmented control with counts, Export as a secondary button, and an 'Updated · Refresh' text button), and a list/detail pattern. Use the Events library pattern for Custom surveys too, with a list showing status chip, response count and expiry.
- **Verifier:** Code and screenshots agree. #refresh and #survey-reload are filled primary; #reload-events is small, full-width secondary (style.css:312-318); custom-surveys 'Refresh results' is secondary. Inbox Export is an <a> (index.html:297) while Surveys uses buttons. The Inbox filter form has only Type and Event, with no search. Event surveys uses an Active/Archived/All <select> (survey-results.js:49-55).

### visual-17 · medium · enhancement · effort L — Custom surveys is one long vertical stack of mixed links, buttons and paragraphs with no overview

- **Where:** `backend/admin/custom-surveys.js:51` · **Verdict:** confirmed
- **Impact:** Officers can't see at a glance which surveys are open, expiring or have new responses, and the share links look like body text rather than actions.
- **Fix:** Use master/detail like Events. On the left, a survey list grouped Open / Drafts / Closed, each row showing response count and expiry. On the right, a detail view with a header (title, status chip, one primary action: Continue editing or Copy answering link) and Overview / Respondents / Results sub-views. Present share links as a 'Share' button group with copy feedback.
- **Verifier:** The DOM order output matches: h2, p, primary Create, select plus Refresh, read-only note, permissions hint, Close survey, then the link/button/link/button row, Respondents, then activity disclosures. Option strings look like 'custom-surveys PUBLIC 522383 · open · 2 active responses'. The picker defaults to the first catalog row (an open survey in my run, a draft in the reviewer's run). The stack and overview problem is real either way.

### visual-26 · medium · ux-friction · effort M — Browser Back leaves Club Office, and the tab, status and filter state is never in the URL

- **Where:** `backend/admin/index.js:715` · **Verdict:** found by verifier
- **Impact:** On a phone the back gesture is the natural 'go to previous tab' action, and it exits the office instead. A reload, or a link sent to another officer, loses the view they were working in.
- **Fix:** Use pushState for pane changes and encode status, kind, event and page in the hash or query (e.g. #inbox?status=reviewed&kind=question&page=2). Restore it on load and on popstate. Keep replaceState only for transient adjustments.

### visual-27 · medium · bug · effort S — Next/Previous keep the scroll position, so the officer lands at the bottom of the new page

- **Where:** `backend/admin/index.js:810` · **Verdict:** found by verifier
- **Impact:** Officers think they are reading the next items but skip about 40 rows at the top of page 2, or have to scroll back roughly 5000px. On a phone it is easy to miss that the page changed at all.
- **Fix:** After a page change, scroll the list top (or a sticky toolbar) into view and move focus to a list heading that announces 'Showing 51-100 of N'. Or replace paging with 'Load more', which appends rows.

### visual-28 · medium · ux-friction · effort M — The Archived view adds an unrelated custom-survey list with its own filled pager above the inbox pager

- **Where:** `backend/admin/survey-archive.js:12` · **Verdict:** found by verifier
- **Impact:** Two pagers stack at the bottom of a long list, and it is unclear which controls which list. Archived custom-survey answers live in Inbox > Archived, not in Custom surveys where officers would look for them.
- **Fix:** Move archived custom-survey responses into Custom surveys (per survey, under an Archived segment). If they must stay in Inbox, give them their own segment or tab with a secondary pager, and keep a single inbox pager next to the inbox list.

### visual-3 · low · ux-friction · effort M — Grouping by type breaks chronological order and splits groups across pages

- **Where:** `backend/admin/index.js:291` · **Verdict:** confirmed
- **Impact:** Officers lose 'what came in most recently' and can miss items that fall onto page 2 with no hint they exist. 'N on this page' never tells them how many are left.
- **Fix:** Default to one chronological list, with date dividers (Today, This week) if wanted. Leave grouping to the Type chips and offer 'Group by event' only inside the RSVP filter. Show totals ('1-50 of 54') in a pagination control at both top and bottom, or use 'Load more' / infinite scroll.
- **Verifier:** Partly confirmed. groupedEntries (index.js:291-320) does regroup a newest-first page by kind or event. Group order on page 1 was signups, AI Review, Workshop, Questions, Office audit event, subscription, each labelled 'N on this page'. One sub-claim is refuted: items on page 2 can never be newer than those on page 1, because the server orders by created_at DESC before LIMIT/OFFSET (api/admin.mjs:140). The 4 items left over in the fixture were the oldest. Rows keep timestamps and a Next button exists, so the remaining problem is lost cross-kind chronology and groups that may reorder on …

### visual-6 · low · ux-friction · effort S — 'Delete permanently' looks like every other action and sits between 'Edit response' and 'Mark reviewed'

- **Where:** `backend/admin/index.js:250` · **Verdict:** confirmed
- **Impact:** In the Archived list, an officer reaching for 'Mark reviewed' or 'Mark new' can hit the irreversible action, which is the same size, style and neighbour. The confirmation dialog catches it, but the list gives no visual warning.
- **Fix:** Add a global `.danger` style (red text and border in both themes, filled red only in the confirmation dialog). Move destructive actions to the end of the row behind a gap or a '⋯ More' menu. Order the row by frequency: Mark reviewed / Archive first, then Edit, then Delete.
- **Verifier:** Reproduced with a client-side mocked archived entry. The order is Edit response | Delete permanently | Mark reviewed | Mark new, all bg #fff and border #e0e0e9 (dark: #1c1c24/#353442). No global .danger rule exists. Survey cards add 'danger' to a secondary button (survey-results.js:367) and get the same neutral look. Lowered to low: it only appears in the Archived list, and the confirmation dialog names the person and focuses Cancel first (submission-editor.js:193), so a mis-click is caught.

### visual-18 · low · ux-friction · effort S — Event editor header: full-width 'Cancel editing' outweighs Publish, and four rows come before the first field

- **Where:** `backend/admin/style.css:404` · **Verdict:** confirmed
- **Impact:** The biggest control in the editor header is the one that throws work away (it does confirm when changes exist). The form is 4375px tall, with no section jump links.
- **Fix:** Make the header one row: title, status chip, 'Last saved …', and a small 'Cancel' text button on the right. Move Activity history to a drawer or tab. Show a single formatting toolbar for the focused textarea. Add a sticky in-page section index (01-05) on desktop. On phone, shorten the bar labels ('Save', 'Preview', 'Publish').
- **Verifier:** #cancel-event-edit measures 1024px wide at 1440 because .editor-heading is a grid. Order is h3, draft notice, full-width Cancel, then 'Not saved yet.' I counted 6 formatting toolbars, 57px each (the reviewer said five; surveyIntro also gets one). A new event's form is 3536px tall; the reviewer's 4375px was probably an event with content. The phone sticky-bar heights are unverified by me.

### visual-19 · low · accessibility · effort S — Too many type sizes and weights; timestamps render at 10.8px and names at weight 900

- **Where:** `backend/admin/style.css:1423` · **Verdict:** confirmed
- **Impact:** Small dates and badges are hard to read on a phone. The size jumps make it unclear what is a heading and what is data.
- **Fix:** Define a 5-step scale as tokens (12 / 14 / 16 / 20 / 28) with two weights (400 and 600), use 12px as the floor, and replace stray rem/em values. Set an explicit size on summary span/small, and set `strong { font-weight: 600 }` in summaries.
- **Verifier:** The summary <small> computes to 10.8333px (no font-size at style.css:1423-1428). Group summaries are 16.8px against 13px entry names. Correction: weight 900 is computed but has no visible effect, because @font-face maps 500-900 to the single semibold file (style.css:7-12) and font-synthesis:none prevents faux bold.

### visual-20 · low · ux-friction · effort S — Empty and zero states are bare text in the Inbox but designed in Events

- **Where:** `backend/admin/index.js:450` · **Verdict:** confirmed
- **Impact:** Clearing the New queue, the main goal of a triage visit, gets no acknowledgement. 'Match these filters' suggests a filter problem when there is none.
- **Fix:** Write distinct messages per case. New queue empty: 'All caught up — nothing new since <time>', with a link to Reviewed (n). Filtered empty: 'No <type> in <status>' plus a 'Clear filters' button. Reuse the .empty-state component.
- **Verifier:** New + 'Event RSVPs (past)' renders 'No submissions match these filters.', the same string used for every empty case (index.js:450-452), while Events has a designed .empty-state.

### visual-21 · low · ux-friction · effort S — Dark-mode logo is an opaque black square, and some colours are hard-coded outside the token system

- **Where:** `backend/admin/style.css:1368` · **Verdict:** confirmed
- **Impact:** These are minor, but they make the dark theme look unfinished. Untokenised colours will drift further as features are added.
- **Fix:** Export the dark logo with a transparent background, or put it on var(--surface). Add --danger, --danger-surface and --backdrop tokens for both themes, remove the dead fallbacks, and use one radius scale (8/12/16).
- **Verifier:** The dark logo renders as an opaque black square on the #1c1c24 header (top-dark.png). Partly overstated: `.submission-dialog .danger` is hard-coded, but in light mode it renders as a legible dark-red filled danger button (delete-dialog-light.png), so it does not look broken. The leftover fallbacks and mixed backdrops are real but invisible to officers.

### visual-22 · low · ux-friction · effort S — Hover ring on tabs looks like a focus outline, and disabled buttons show a 'wait' cursor

- **Where:** `backend/admin/style.css:66` · **Verdict:** confirmed
- **Impact:** This is minor polish: the ring is mistaken for keyboard focus, and the spinner cursor suggests something is loading.
- **Fix:** Exclude tabs and segmented buttons from the hover ring (use a background tint instead). Use `cursor: not-allowed` for disabled controls and `wait` only on elements marked aria-busy.
- **Verifier:** Hovering #events-tab computes box-shadow 0 0 0 3px accent/14%. The disabled Previous on page 1 computes cursor:wait.

### visual-23 · low · copy · effort S — Copy: pluralisation errors and boilerplate on every card

- **Where:** `backend/admin/contact-history.js:109` · **Verdict:** confirmed
- **Impact:** These are small errors that make the tool feel unpolished, and the boilerplate adds noise to each card.
- **Fix:** Use Intl.PluralRules or a small plural() helper. Drop 'Received in club inbox' (it is always true for listed items) and state that guarantee once in Help.
- **Verifier:** The Contacts dialog shows '1 website submissions' (several rows), and #survey-status read '1 matching saved responses. Expand a person...'.

### visual-24 · low · ux-friction · effort M — Nested cards and padding squeeze phone reading width; the event library scrolls inside the page

- **Where:** `backend/admin/style.css:1399` · **Verdict:** confirmed
- **Impact:** Long questions and article drafts become tall narrow columns on phone, and scroll gestures sometimes move the inner list instead of the page.
- **Fix:** On phone, show list rows edge-to-edge without a group card, and open the detail full screen with 16px gutters and no nested boxes (plain text, not pre-in-card). Replace the inner-scroll event library with a full-height list screen that drills into the editor (list, then detail with a back button).
- **Verifier:** At 390 the #event-list scrollHeight/clientHeight is 1014/270, an inner scroller inside the page. The nested group, card and pre padding comes from CSS (style.css:1399-1407, 1415-1418, 658-666, 1533-1541). I did not re-measure the 306px summary column.

### visual-29 · low · bug · effort S — The tab-title count includes past-event RSVPs that no count card shows

- **Where:** `backend/admin/index.js:357` · **Verdict:** found by verifier
- **Impact:** Once an event ends, its unreviewed RSVPs drop out of every card but still inflate the tab badge and appear in the list, so the numbers on screen disagree with each other.
- **Fix:** Add a 'Past RSVPs' chip or card (the Type select already has that option), or exclude rsvp-past from the title count. Show one authoritative total in the status control.

### visual-30 · low · ux-friction · effort S — Changing the Type, refreshing or paging shows no loading state, and the old list stays fully interactive

- **Where:** `backend/admin/index.js:331` · **Verdict:** found by verifier
- **Impact:** On a slow phone connection officers can't tell whether the filter has applied. They may read, or act on, the previous list believing it is already filtered.
- **Fix:** While aria-busy is true, dim the list and show an inline 'Loading…' or skeleton, and disable row actions until the new list renders. Add an 'Updated hh:mm' label next to a quiet Refresh.

### visual-31 · low · ux-friction · effort S — Site preview: 'Close preview' is the filled primary button, and the Desktop/Mobile toggles show no selected state

- **Where:** `backend/admin/index.html:635` · **Verdict:** found by verifier
- **Impact:** This is minor. The heaviest control in the preview is the exit, and officers can't see which device mode is active except by judging the iframe width.
- **Fix:** Make Desktop/Mobile a segmented control (aria-pressed, the same style as Active/Archived) and make Close a secondary or icon button in the sticky header.

## Reliability and state

Club Office is a single 128.6 KB minified ES module (44 KB gzip; about 30 KB of it is the better-auth/better-fetch login client) built by scripts/build.mjs from admin/index.js. vercel.json serves /admin/* with Cache-Control: no-store. All data access goes through one wrapper, api() in admin/index.js:90-130. It sets a 20 s AbortSignal timeout, turns network failures into a friendly message, and treats any 401 as "session ended": it calls showLogin() (index.js:131-153), which clears every module (event editor, surveys, contacts, custom surveys, comment drafts). Each feature module (event-editor.js, survey-results.js, custom-surveys.js, contact-history.js, survey-archive.js, submission-activity.js) keeps its own closure state and generation counters. Most of them re-render their whole area with replaceChildren() after every fetch or change. The inbox polls every 60 s with one setInterval (index.js:814-817). The `loading` flag stops polls from overlapping, and background re-renders are skipped while focus is inside #entries or any comment draft exists. Writes are POSTs checked server-side for the same Origin (lib/auth.mjs:118-124). Server errors are mapped by lib/http.mjs fail() to a RequestError message, or to a generic 503. Most mutating endpoints use optimistic revisions plus requestId/commentId idempotency keys (lib/events.mjs:122, lib/submission-management.mjs:149, lib/submission-activity.mjs:52-76, lib/survey-builder.mjs). The officer sees results through a sticky #status banner (style.css:275), per-pane status lines, and per-card status text. The race guards held up in my tests. The weak spots are the 401 path (it wipes unsaved work), the "not signed in yet" error path, full re-renders that drop focus and scroll, and a few fetches that skip the api() wrapper.

### reliability-1 · critical · bug · effort M — An expired session (any 401, including the silent 60 s poll) wipes unsaved event edits, comment drafts and contact notes

- **Where:** `backend/admin/index.js:111` · **Verdict:** confirmed
- **Impact:** An officer who signed in three days ago and spends 20 minutes writing an event, or a follow-up comment, loses all of it the moment the session lapses. It happens even if they never click anything, because the background poll triggers it. Nothing can be recovered.
- **Fix:** Separate 'session ended' from 'clear private data'. On a 401, keep the modules' in-memory state and show a modal sign-in dialog over the page (OTP inline). After sign-in, retry the failed request. Clear data only on an explicit Sign out or a different user. As a safety net, mirror event-editor, builder and comment drafts to sessionStorage keyed by user. Also expose session expiresAt to the client so the page can warn about 10 minutes before the 72 h cutoff.
- **Verifier:** Re-ran this in v1.cjs. With a typed new event and POST /api/events returning 401, the login screen appeared with 'Your session ended…' and both title and summary read back as "". The code path matches: index.js:111-113 calls showLogin(), which runs commentDrafts.clear() and editor.clear(), and editor.clear() runs form.reset() (event-editor.js:647). I did not re-run the reviewer's test C: it reloaded the page through /test-signin, so it does not isolate showLogin, but the clear() calls settle it anyway. Keeping critical (data loss). The browser-alerts copy tells officers to 'Keep the office …

### reliability-2 · medium · bug · effort S — Any error on the first inbox load sends a signed-in officer to the sign-in form, and a malformed #entry link causes a sign-in loop

- **Where:** `backend/admin/index.js:485` · **Verdict:** confirmed
- **Impact:** A cold start, a brief Neon/Vercel blip or a mangled link makes an officer who is already signed in request a new email code. A bad link can lock them out entirely until they edit the URL by hand.
- **Fix:** Call showLogin() only for status 401. For other failures before the first success, show the office shell with an inline 'Could not load the inbox' state and a Retry button, plus automatic retry with backoff. If a #entry id is invalid or not found, drop it from the URL and explain ('That submission link is invalid or the record was deleted').
- **Verifier:** Reproduced in v1.cjs and v2.cjs. A 503 on the first GET /api/admin with a valid session shows the sign-in form, ironically with the banner 'Your information has not been cleared'. It was still on the sign-in form after the backend recovered. A true cold load of /admin/#entry=not-a-real-id (fresh page, cookie already set) sends /api/admin?offset=0&id=not-a-real-id, gets 400 'Invalid filter.' and shows the login form with the hash still present. The re-sign-in loop follows from code (index.js:602 load() → 400 → 485 showLogin); I could not run the OTP step in the fixture. Note: the same …

### reliability-3 · medium · ux-friction · effort M — Starring, archiving or adding a respondent in Surveys reloads and rebuilds the whole view: the card collapses, the page jumps to the top and focus is lost

- **Where:** `backend/admin/survey-results.js:403` · **Verdict:** confirmed
- **Impact:** Triaging responses (star the good ones, archive the tests) means re-scrolling and re-expanding after every click, and on a phone this becomes very tedious. Keyboard and screen-reader users are thrown back to the top of the document each time.
- **Fix:** Update the changed card in place from the POST response (star or archive state), and refresh counts in the background without clearing the list. Return focus to the toggled button. For respondent changes, re-render only the respondents section (call mountRespondents again on that root), not the whole catalog. If a full reload is needed, keep the old DOM until the new data arrives and restore the open state and scroll position the way index.js:431-463 does.
- **Verifier:** Reproduced in v3.cjs with the star POST faked, so nothing changed on the server. scrollY went from 664 to 248, the card came back collapsed, and activeElement was BODY. The requests were one POST plus one full GET reload. Code: manage() → load() → replaceChildren() (survey-results.js:328, 403), and cards rebuild with el.open = Boolean(entryId) (line 298). Downgraded to medium: real friction, but star/archive triage of survey responses is a secondary task next to the inbox.

### reliability-4 · medium · bug · effort S — The sticky status banner never clears, so a 'Could not connect' error stays after the connection recovers

- **Where:** `backend/admin/index.js:39` · **Verdict:** confirmed
- **Impact:** Officers are told the office is offline when it is working, or they see a stale confirmation from an earlier action. On phones the banner permanently hides part of the list.
- **Fix:** Clear errors that came from background loads when the next load succeeds. Auto-hide success messages after about 5 s. Add a close button to the banner. Give errors and successes different styles, and tag each message with its source so a background poll only clears messages it set.
- **Verifier:** Reproduced in v4.cjs. setOffline(true) plus a poll gave 'Could not connect to Club Office…'. After setOffline(false) and a successful poll the same text was still in #status. Code: status() only sets text (index.js:39-41), and load() never clears it. Only Refresh and the status buttons call status() with no argument. The banner is global, so it also shows over the Events and Surveys panes.

### reliability-5 · medium · ux-friction · effort M — An event edit conflict (409) leaves the officer to copy many fields by hand, and getting the latest version discards their edits

- **Where:** `backend/admin/event-editor.js:479` · **Verdict:** confirmed
- **Impact:** Merging by hand across title, description, agenda, outcomes, images and RSVP questions is error-prone. Officers are likely to overwrite or lose either their own work or a colleague's.
- **Fix:** On a 409, fetch the latest row and show a per-field diff (yours vs. theirs) with 'Keep mine', 'Use theirs' and 'Merge', then save against the new revision. At minimum, offer 'Overwrite with my version' after confirmation, and preserve the user's values while reloading.
- **Verifier:** Code-read plus a related run. event-editor.js:479-480 only calls say(e.message), and Refresh list goes through canLeave() (line 548), so you either discard your edits or keep a stale form. In v10.cjs and v12.cjs I got the exact 409 text 'Another admin updated this event…' with no merge path. Two missed findings below (25, 26) show this 409 is also reached when no other admin edited at all, which makes the weak recovery more costly.

### reliability-6 · medium · bug · effort S — After a 5xx or timeout, the custom survey builder locks every control and blocks leaving the Surveys tab

- **Where:** `backend/admin/survey-builder.js:173` · **Verdict:** confirmed
- **Impact:** During an outage or a server bug, the officer is stuck in the builder. Inbox and Events are unreachable without reloading the page, and the reload's beforeunload warning suggests they will lose work.
- **Fix:** Keep the retry-with-same-requestId logic, but don't trap the user. After a failed save, keep the fields editable (a new signature can use a new requestId once the old one is resolved by a GET draft?id check). Put Retry next to the error. Allow leaving after a confirmation ('Your last change may not be saved'). On retry, first check edit_revision with GET draft to decide whether the save already landed.
- **Verifier:** Reproduced in v6.cjs. With draft-change returning 503, the only enabled control in the builder was 'Retry the same save'. Clicking the Inbox tab left the Surveys pane visible with 'Retry the pending save before leaving…'. Retry succeeded once the route was removed. Code: survey-builder.js:173 keeps pending for status ≥500 or no status (transport errors and timeouts included), and canLeave() returns false while pending (586-591).

### reliability-8 · medium · bug · effort S — Saving an edit to a response silently discards the officer's unsent comment on that response; purging a contact clears all comment drafts

- **Where:** `backend/admin/index.js:649` · **Verdict:** confirmed
- **Impact:** A half-written follow-up note disappears without warning just because the officer fixed a typo in the person's name.
- **Fix:** Delete the draft only when result.removed is true. In the purge callback, delete drafts only for the purged contact's entries, or keep them, since the cards will disappear anyway.
- **Verifier:** Reproduced in v7.cjs with the edit-submission POST faked. After typing a comment, editing the response and saving, the status read 'Response updated.' and the comment textarea was "". Code: index.js:649 calls commentDrafts.delete(result.entryId) unconditionally. The purge path calls onContactPurge() with no argument (survey-results.js:29), which leads to commentDrafts.clear() (index.js:662).

### reliability-9 · medium · bug · effort S — Inbox comment drafts have no unload warning and are not checked on Sign out

- **Where:** `backend/admin/index.js:629` · **Verdict:** confirmed
- **Impact:** Closing the tab, reloading or signing out with a comment in progress loses it silently, unlike every other editor in the office.
- **Fix:** Add `commentDrafts.size` to a beforeunload handler and to the sign-out guard ('You have N unsent comments'). Consider persisting comment drafts to sessionStorage.
- **Verifier:** Reproduced in v7.cjs: page.close({runBeforeUnload:true}) with a comment draft in commentDrafts produced no dialog. Grep shows beforeunload only in contact-history.js:578, event-editor.js:617, submission-editor.js:60 and survey-builder.js:568, with nothing for commentDrafts. The sign-out guard at index.js:629-633 does not check drafts either.

### reliability-10 · medium · bug · effort S — Status buttons allow conflicting double submissions, and the server has no check on the expected status, so stale cards silently revert other officers' changes

- **Where:** `backend/api/admin.mjs:187` · **Verdict:** confirmed
- **Impact:** The final status depends on which network request lands last, and two officers triaging at once can undo each other's work without knowing.
- **Fix:** Disable all action buttons on the card while a request is in flight. Send `from: entry.review_status` and have the server reply 409 'Another officer already moved this to Archived' when it doesn't match, then refresh that card.
- **Verifier:** Reproduced in v5.cjs with a faked POST delayed 1.5 s. 'Archive submission' and 'Edit response' stayed enabled while 'Mark reviewed' was pending, and two POSTs were sent: ['review:reviewed','review:closed']. Server side, api/admin.mjs:187-190 updates review_status with no check on the expected current status. Reverting another officer's change from a stale card follows from that and is code-read.

### reliability-11 · medium · accessibility · effort S — After any inbox status change, the whole list is rebuilt and keyboard focus falls back to the page body

- **Where:** `backend/admin/index.js:449` · **Verdict:** confirmed
- **Impact:** Keyboard and screen-reader officers must tab from the top of the page through the header, tabs, filters and preferences after every triage action. Sighted users get no 'next item' flow either.
- **Fix:** Before re-rendering, remember the index of the card that was acted on. Afterwards, focus the next card's summary, or the list heading if it's empty, and announce the move ('Moved to Reviewed. Next: …'). Better still, remove that one card from the DOM instead of rebuilding the list.
- **Verifier:** Reproduced in v5.cjs. Focusing 'Mark reviewed' and pressing Enter (POST faked) left document.activeElement as BODY. replaceChildren at index.js:449 removes the focused button, and nothing restores focus.

### reliability-12 · medium · bug · effort S — Event image uploads share the 20 s API timeout and report a slow upload as 'Check your connection'

- **Where:** `backend/admin/event-editor.js:600` · **Verdict:** confirmed
- **Impact:** Officers adding flyers from a phone on campus Wi-Fi or cellular hit a misleading failure and retry, possibly uploading duplicates. Meanwhile the form is locked with no Cancel button.
- **Fix:** Give api() a per-call timeout option (for example 90 s for uploads). Report TimeoutError separately ('The upload is taking longer than expected…'). Downscale or compress images client-side (canvas → WebP at about 1600 px) before upload. Add a Cancel button that aborts the request.
- **Verifier:** Reproduced in v8.cjs with the upload route delayed 22 s. During the upload the title input was disabled. After about 20 s #image-status read 'Could not connect to Club Office. Check your connection and try again.', and the request had reached the route (reached=1). Code: the fixed AbortSignal.timeout(20000) at index.js:95, with a catch-all message at 105-108. The server keeps uploaded blobs and has no cleanup for unreferenced ones (event-assets.mjs only deletes on a failed insert), so orphans are plausible.

### reliability-14 · medium · bug · effort S — Any comment draft freezes background refresh of the inbox list indefinitely while the counts keep changing

- **Where:** `backend/admin/index.js:428` · **Verdict:** confirmed
- **Impact:** An officer who started a note and moved on sees a list that never updates and disagrees with the counts above it. They may act on entries another officer has already handled.
- **Fix:** Drop the `!commentDrafts.size` condition and rely on the focus check, since drafts are re-hydrated anyway. Or show a 'New updates — Refresh' pill instead of silently skipping the re-render.
- **Verifier:** Reproduced in v4.cjs. With a draft on card 2 (card collapsed, focus outside the list), two polls with modified data left the first card as 'Ava Synthetic0' while #counts changed. After the draft was cleared, the next poll showed the renamed entry. Worse than reported: a draft orphaned on a card that has left the view (see missed finding reliability-29) freezes refresh for the whole session with no visible cause.

### reliability-16 · medium · ux-friction · effort S — Opening the Surveys tab resets the search, view, star filter and page, and always returns to Event surveys

- **Where:** `backend/admin/index.js:731` · **Verdict:** confirmed
- **Impact:** Officers who jump to the Inbox to check one person lose their survey filters and paging, and have to rebuild them on every round trip.
- **Fix:** Keep the survey filter state in the module across tab switches, and refetch only when it is stale. Remember the last survey group (and selected custom survey) in the hash or in module state. Reset only on explicit deep links such as #survey=<id>.
- **Verifier:** Reproduced in v3.cjs. After searching 'office' with view 'all' and going Inbox → Surveys, the search was "" and the view 'active'. After choosing Custom surveys and going Events → Surveys, custom-surveys-group showed aria-pressed=false. Code: show() resets search, view and star (survey-results.js:485-492), and showPane('surveys') always calls surveyGroup(false) unless the hash carries a custom-survey id (index.js:722-733).

### reliability-25 · medium · bug · effort S — Event saves have no idempotency key: retrying after a lost or timed-out response shows a false 'Another admin updated this event' conflict

- **Where:** `backend/admin/event-editor.js:420` · **Verdict:** found by verifier
- **Impact:** An officer on phone or campus Wi-Fi, or hitting the 20 s timeout during a slow Neon response, is told a colleague overwrote their work and to copy every field by hand. In reality their own save landed, or their publish already went live.
- **Fix:** Add a requestId to event saves (as submission edits and survey drafts already do), store it in event_history, and return the stored row on replay. Until then, on a transport error GET the event: if updated_by is the current user and the draft equals the submitted content, treat the save as successful.

### reliability-26 · medium · bug · effort S — Switching tabs reloads the event list but leaves the open event overview stale, so 'Edit event' starts from an old revision and saving is guaranteed to fail with 409

- **Where:** `backend/admin/event-editor.js:366` · **Verdict:** found by verifier
- **Impact:** Officers who check the inbox and come back to an event they were looking at edit outdated content. Every save then fails with a scary conflict, and the manual copy-and-reopen recovery (reliability-5) can lose either version.
- **Fix:** At the end of load(), if `current` exists, look up the refreshed row and re-render it (edit(updated, editing) when not dirty, as #reload-events already does at line 552). If the officer is editing and the revision changed, show a 'This event changed since you opened it' notice before they type.

### reliability-27 · medium · bug · effort S — A failing attachment link navigates the whole office tab to a raw JSON error page and silently drops comment drafts

- **Where:** `backend/admin/index.js:240` · **Verdict:** found by verifier
- **Impact:** After the 72 h session cutoff, or once a file has been cleaned up ('Attachment removal is queued for retry'), clicking a resume or article attachment drops the officer out of the app onto a developer-style JSON page and loses unsent notes.
- **Fix:** Download attachments through fetch(), as the inbox CSV export does (credentials, timeout, content-type check, blob → object URL), so errors appear in #status and 401s go through the session handling. At minimum, add target="_blank" or a download attribute, and have the server return a small HTML error page for browser navigations.

### reliability-28 · medium · ux-friction · effort S — Pressing Enter in any single-line event field saves the draft and exits the editor; Enter in 'New type name' saves the event instead of adding the type

- **Where:** `backend/admin/event-editor.js:492` · **Verdict:** found by verifier
- **Impact:** Officers who press Enter by habit after typing a title, location, time or image description are thrown out of the editor mid-task and must click Edit again. Adding a new event type with Enter silently does not work.
- **Fix:** Block implicit submission from text inputs: a keydown handler that ignores Enter on input elements, or a hidden disabled first submit button. Make Enter in #new-type-name trigger #add-type. Consider keeping the editor open after a draft save.

### reliability-29 · medium · bug · effort S — Changing a card's status with an unsent comment drops the comment without warning, and the orphaned draft then freezes inbox auto-refresh for the session

- **Where:** `backend/admin/index.js:262` · **Verdict:** found by verifier
- **Impact:** A common flow is writing 'Replied by email' and archiving. If the officer forgets to click Add comment, the note is lost while the UI says comments are kept. The inbox then stops auto-updating with no visible reason.
- **Fix:** When a status button is clicked and the card has an unsent draft, either save the comment first (same commentId) or ask 'Save your comment before archiving?'. Drop orphaned drafts or keep them visible, and remove the commentDrafts.size gate (see reliability-14).

### reliability-7 · low · performance · effort S — The survey builder saves (POST plus GET) on every step click, even with no changes, and floods the activity log

- **Where:** `backend/admin/survey-builder.js:185` · **Verdict:** confirmed
- **Impact:** Each step change waits for two round trips, which is slow on phones. The survey activity history stops telling anyone who changed what.
- **Fix:** In go(), skip save() when `saved` is true. Drop the follow-up GET unless previewLink is missing (or return previewLink from draft-change). Optionally, merge consecutive draft_saved rows by the same actor within a few minutes on the server.
- **Verifier:** Reproduced in v6.cjs. Back, then Save and continue, then '3. Questions' with no edits sent 3× POST draft-change, 3× GET draft and 1× GET members. The draft's 'Survey activity' then listed 6 'Saved draft' rows for one short session. Server: survey-builder.mjs inserts a custom_survey_changes row on every save with no 'unchanged' check (lines 286-300). Downgraded to low: it costs a few round trips and adds noise, with no wrong data.

### reliability-13 · low · bug · effort S — Survey CSV export shows raw JavaScript errors, has no timeout and no double-click guard

- **Where:** `backend/admin/survey-results.js:156` · **Verdict:** confirmed
- **Impact:** Vercel gateway errors and timeouts (common for large exports) produce developer jargon. Repeated clicks start several downloads.
- **Fix:** Reuse the inbox export's code: a re-entry guard, AbortSignal.timeout(30000), `response.json().catch(() => null)`, a content-type check and friendly TypeError/TimeoutError messages. Move it into a shared downloadCsv() helper, since there are already two copies.
- **Verifier:** Reproduced in v8.cjs. A 502 HTML body produced 'Unexpected token '<', "<html><bod"... is not valid JSON', and an aborted request produced 'Failed to fetch'. Code: survey-results.js:151-158 uses no signal, an unguarded response.json() and no re-entry flag. Downgraded to low: it only shows on failures in a secondary export path.

### reliability-15 · low · bug · effort S — An #entry=<id> hash that matches no card keeps silently filtering the inbox, so every filter shows 'No submissions match'

- **Where:** `backend/admin/index.js:159` · **Verdict:** confirmed
- **Impact:** Following an old link from contact history, a bookmark or chat makes the inbox look empty, and nothing on screen says a hidden filter is active.
- **Fix:** When the linked entry is not returned, clear the hash and show 'That submission no longer exists or was deleted.' While a link is active, show a visible 'Showing one linked submission · Show all' chip.
- **Verifier:** Reproduced in v1.cjs and v2.cjs. #entry=<valid but missing uuid> shows 'No submissions match these filters.' with no status message, and it persists through Type=Questions and Refresh. The reviewer overstates 'every filter', though: clicking a status button that isn't pressed runs history.replaceState(…, location.pathname) (index.js:518-519) and clears the hash. Clicking Reviewed then New brought back 50 cards. Downgraded to low because the most prominent filter is a way out.

### reliability-17 · low · bug · effort S — A comment save that overlaps a list refresh leaves the saved text in the box with no confirmation, inviting a resubmit

- **Where:** `backend/admin/submission-activity.js:129` · **Verdict:** confirmed
- **Impact:** The officer can't tell whether the comment was saved and may post it twice.
- **Fix:** Delete the draft and handle success before the isConnected check, since commentDrafts is shared. Mark in-flight drafts in the map so a re-rendered card shows 'Saving…' and disables its input.
- **Verifier:** Reproduced in v7.cjs with the comment POST faked and delayed 2 s. Clicking Add comment and then Refresh left the re-rendered card's textarea holding 'relv racing comment', enabled, with an empty status. Code: `if (!panel.isConnected) return;` runs before drafts.delete (submission-activity.js:129-130).

### reliability-18 · low · bug · effort S — The 'New submissions arrived' alert never clears and also fires when another officer marks an item New

- **Where:** `backend/admin/index.js:365` · **Verdict:** confirmed
- **Impact:** A permanent 'new arrivals' notice teaches officers to ignore it, and false desktop notifications add noise.
- **Fix:** Clear the alert on Refresh, when the New view is opened, or when the count drops. Base 'arrived' only on `latest > lastReceived` (max created_at), not on newCount. Include the number of new items in the notice.
- **Verifier:** Persistence reproduced in v4.cjs. After a poll with counts bumped, the alert stayed after Refresh and after switching to Reviewed. The only clear is in showLogin (index.js:137). The 'Mark new' trigger is code-read and certain: newCount sums the global new counts (index.js:357), so an officer's own 'Mark new' makes newCount > lastNewCount on the follow-up load(), which shows the alert and calls alerts.notify(). Their own action produces a desktop notification.

### reliability-19 · low · ux-friction · effort S — The archived survey responses panel is rebuilt as 'Loading…' on every 60 s poll

- **Where:** `backend/admin/survey-archive.js:30` · **Verdict:** refuted
- **Impact:** The panel flickers every minute while the officer is reading, and on slow connections it collapses to one line, so the page jumps.
- **Fix:** For background refreshes, fetch first and replace only when the data changed, keeping the existing DOM meanwhile. Skip the archive fetch entirely when the inbox pane is hidden.
- **Verifier:** The mechanism is real only in states that barely matter. Each archived response is rendered with responseSections([{...response, active:true}]), so groups.active.length===1 and person() renders it open (surveys/results-ui.js:35-36, 82-83). Whenever there is at least one archived survey response, root.querySelector('details[open]') is truthy and survey-archive.js:29 skips the background rebuild. So 'flickers while the officer is reading' does not happen. In v9.cjs the flicker appeared only because the fixture has 'No archived survey responses.', which swaps one line of text for another. What …

### reliability-20 · low · copy · effort S — The inbox activity timeline shows raw action codes such as 'survey-starred'

- **Where:** `backend/admin/submission-activity.js:60` · **Verdict:** confirmed
- **Impact:** The history reads like a log file and officers can't tell what happened.
- **Fix:** Add labels ('Starred survey response', 'Archived survey response', etc.). Use a generic 'Updated' fallback, as event-activity.js:63 does, and add a unit test that every audit action written on the server has a client label.
- **Verifier:** Code-read. survey-management.mjs:75-85 writes survey-starred, survey-unstarred, survey-archived and survey-restored into club_forms.audit. submission-activity.mjs:16-24 returns every audit row for the entry, and the client map (submission-activity.js:2-9) has no labels for them, so the fallback `actions[item.action] || item.action` (line 60) prints the raw code. The reviewer's screenshot t12 agrees.

### reliability-21 · low · performance · effort S — Polling ignores page visibility: it refetches a full inbox page every minute on other tabs and doesn't refresh when the officer returns

- **Where:** `backend/admin/index.js:814` · **Verdict:** confirmed
- **Impact:** Wasted mobile data and server queries (four SQL queries per poll per open tab). Officers coming back from another app see stale data with no indication.
- **Fix:** Refresh immediately on visibilitychange to visible. When the inbox pane is hidden, poll a lightweight counts-only endpoint (for example ?counts=1) for the title and alerts, and load entries only when the inbox is shown.
- **Verifier:** Code-read. index.js:814-817 polls whenever the document is visible (or alerts are on), whichever pane is shown, and there is no visibilitychange or focus listener. Each poll also calls surveyArchive.load, plus a full re-render when allowed. One clarification: with alerts off, hidden browser tabs do NOT poll. 'Other tabs' in the finding means the Events and Surveys panes.

### reliability-22 · low · performance · effort M — The unhashed 128 KB bundle is served no-store and re-downloaded on every visit; the auth client is about 30 KB of it

- **Where:** `backend/vercel.json:67` · **Verdict:** confirmed
- **Impact:** Each weekly visit on a phone re-downloads and re-parses the whole app. This is a small cost today, but it grows with every feature.
- **Fix:** Emit content-hashed filenames (esbuild entryNames '[name]-[hash]'), inject them into index.html, and serve /admin/*.js with `public, max-age=31536000, immutable` while keeping index.html no-store. Optionally use dynamic import() for the builder, contacts and auth client.
- **Verifier:** Code-read. vercel.json sets no-store on /admin/(.*), and scripts/build.mjs writes the fixed outfile public/admin/index.js, which index.html:653 loads by that fixed name. The size breakdown is the reviewer's own and I did not re-measure it. no-store does guarantee fresh code after a deploy; hashed names keep that benefit and add caching.

### reliability-23 · low · enhancement · effort S — Generic 503 errors carry no reference ID, so officers can't report what failed

- **Where:** `backend/lib/http.mjs:12` · **Verdict:** confirmed
- **Impact:** When something keeps failing, officers can only say 'it said try again'. Maintainers have no matching log line to find the bug.
- **Fix:** Generate a short id per failure, log it with the route, action and error name, return `{ error, reference }`, and have api() append 'Reference: ABC123' to the message.
- **Verifier:** Code-read. http.mjs:11-21 logs only {code} and returns a fixed message with no reference id.

### reliability-24 · low · bug · effort S — Next and Previous stay clickable while a page loads; a double tap skips a page and sends extra requests

- **Where:** `backend/admin/index.js:810` · **Verdict:** confirmed
- **Impact:** On a slow phone connection, an impatient second tap skips 50 submissions without the officer noticing.
- **Fix:** Disable both pagination buttons, plus the status and Type controls, while a non-background load is in flight. Alternatively, ignore clicks while `loading` and show a busy state on the list.
- **Verifier:** Reproduced in v5.cjs with an 800 ms delay. #next stayed enabled during the load, and two clicks requested offsets ['50','100','50'] before ending on Page 2 (page 3 was empty). Code: index.js:810-813 increments offset on every click, and the changed filters string forces a reload with the newer offset.

### reliability-30 · low · ux-friction · effort S — While an event save or image upload is in flight, tab switches, New event, list clicks and Sign out are silently ignored

- **Where:** `backend/admin/event-editor.js:173` · **Verdict:** found by verifier
- **Impact:** On a slow connection the officer taps tabs or buttons, nothing happens, and they get no explanation. They may reload the page and lose the upload or save.
- **Fix:** When busy, show 'Please wait for the save/upload to finish' in #event-status (as the survey builder's canLeave does) and give a visible busy state with a Cancel option for uploads.

### reliability-31 · low · security · effort S — Sign-out and sign-in are not shared across tabs: other open office tabs keep showing private submissions after signing out

- **Where:** `backend/admin/index.js:814` · **Verdict:** found by verifier
- **Impact:** On shared lab or library computers, signing out in one tab does not hide the club's personal data in the others. Officers with several tabs also have to sign in to each one again.
- **Fix:** Broadcast sign-out and sign-in over BroadcastChannel (or a localStorage key) and call showLogin() or load() in the other tabs. Also re-check the session on visibilitychange to visible.
