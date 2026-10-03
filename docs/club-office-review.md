# Club Office UI/UX review — October 3, 2026

## Scope and method

Reviewed `https://dallasai-leaderboard.vercel.app/admin/` ("Club Office") from an officer's point
of view: how it is built, what gets in the way, what is broken and what to change.

- **Production, read only.** Tab switches, scrolling and expanding panels only. Nothing was saved,
  archived or published. All writes go through one POST helper, so opening a record does not change it.
- **Local fixture, with changes.** Nine area reviewers (shell, inbox, contacts, events, event
  surveys, custom surveys, accessibility, visual, reliability) read the code and drove
  `tests/helpers/office-fixture.mjs` with synthetic records in Playwright. Each area then went to an
  adversarial verifier, which re-ran the claims, corrected severities and added what was missed.
- **Completeness critic.** A final agent looked for what no area covered: intake, exports, event
  lifecycle, notifications, governance, very large content, error states. It investigated each gap
  and grouped duplicate findings by shared root cause.
- **Result.** 290 findings: 4 critical, 22 high, 147 medium, 117 low, including 15 from the critic.
  One was refuted. Every item with its file and line, impact, fix and verifier note is in
  [club-office-review-backlog.md](club-office-review-backlog.md), which ends with the critic's 57
  root-cause groups. This page groups the findings by root cause.

Line numbers refer to commit `957abc6`.

## How it is built

- **Client.** A vanilla-JS single-page app in `backend/admin/`, about 7.7k lines: `index.html`,
  `index.js`, 17 feature modules and a ~1.7k-line `style.css`. `scripts/build.mjs` bundles it with
  esbuild into `backend/public/admin/`: a 128.6 KB module, 44 KB gzipped, of which about 30 KB is the
  better-auth client.
- **Server.** Vercel Node functions in `backend/api/` call `backend/lib/`, which uses Neon Postgres.
  Officers sign in with an emailed one-time code through Neon Auth. A session lasts a fixed 72 hours
  with refresh disabled. Every call also requires the Neon `admin` role.
- **Requests.** All of them go through `api()` in `index.js:90-130`, which adds a 20 s timeout and
  friendly errors. Any 401 calls `showLogin()`, which clears every module.
- **Rendering.** Most modules rebuild their whole area with `replaceChildren()` after each fetch or
  change. The inbox re-runs `load()` every 60 s (`index.js:814-817`).

## What already works

- **Server-side safety.** Most writes use optimistic revisions plus `requestId`/`commentId`
  idempotency keys. Every status change, edit, download and comment lands in an attributed activity
  timeline. Requests are checked for the same Origin, and filters and SQL are parameterized.
- **Output safety.** All admin rendering uses `textContent`, and event rich text goes through an
  escaping formatter (`lib/event-format.mjs:1-8`). Attachments download as
  `application/octet-stream` with `nosniff` and an audit row.
- **Two officers at once.** Permanent delete re-checks the archived status inside its transaction,
  edits carry `expectedRevision`, and comments, notes and edits are idempotent by `requestId`.
- **Central time.** Event validation rejects times skipped or repeated at daylight-saving changes.
- **Request hygiene.** `sessionGeneration`, stale-filter checks and `reloadPending` drop late or
  superseded responses.
- **Inbox.** Archive is reversible. Permanent delete is offered only for archived entries, with Cancel
  focused first, and expanded rows stay open across reloads.
- **CSV export.** It has a 10,000-row cap, a BOM for Excel, Central timestamps, formula-injection
  escaping and an audit entry.
- **Layout.** Nothing scrolls sideways from 320 px to 1440 px, the dark theme is solid, and all modals
  are native `<dialog>`.

Any redesign should keep this data model and these guards. Most of the problems below are in the
client. Root cause 11 is the main exception: it is in the server's intake and export code.

## What officers hit, by root cause

### 1. An expired session wipes unsaved work (critical)

`shell-1`, `events-1`, `events-27`, `reliability-1`, `inbox-27`, `contacts-m2`

Any 401 runs `showLogin()` (`index.js:111-153`), which empties the event editor, survey builder,
comment drafts and contact notes. The 60-second poll can trigger this while an officer is typing,
with no click from them. The session is a fixed 72 hours and the client never shows its deadline
(`shell-2`). An officer who signed in three days ago can lose a 30-minute event draft in one tick.

**Fix.** On a 401, keep the module state in memory. Make `#office` inert and show a sign-in dialog
over it with the email filled in, then retry the failed request. Clear data only on Sign out or when
a different account signs in. A 401 from a background poll should show a banner, not sign the
officer out. Also show "Signed in until …" and warn about 30 minutes before the cutoff. Keep the
existing privacy test, but change it to expect drafts to survive a same-account sign-in.

### 2. Typed text is dropped in other ways too (high)

`inbox-1`, `inbox-10`, `reliability-8`, `reliability-9`, `reliability-29`, `contacts-4`, `visual-15`, `inbox-31`

- **Status buttons.** Mark reviewed and Archive ignore a comment typed in the same card. The note is
  never saved, and the hidden draft then freezes auto-refresh (`inbox-8`, `reliability-14`).
- **Other actions.** Edit response, contact purge, Sign out, the logo link and failed attachment
  links also drop comment drafts without a prompt.

**Fix.** Offer "Add note & mark reviewed" as one transaction. Otherwise, save the draft first or ask.
Add a `beforeunload` check that covers comment drafts, and open the logo and attachments in a new tab.

### 3. Every action rebuilds the view, losing focus and scroll position (high)

`a11y-1`, `a11y-3`, `a11y-4`, `event-surveys-5`, `custom-surveys-3`, `custom-surveys-13`,
`reliability-3`, `reliability-11`, `inbox-17`, `events-12`

Star, Archive, Mark reviewed, roster changes and builder steps all call `load()`/`render()`. Expanded
cards collapse, the page jumps to the top and focus drops to `<body>`. In one test it took 31 Tab
presses to get back to a reordered question. The event survey editor already restores focus
(`survey-editor.js` `renderChoices(focusIndex)`), so the codebase has a pattern to follow.

**Fix.** Update the affected card in place from the POST result. Where a full render is unavoidable,
use one small helper that records the next focus target by id and restores it after the render.

### 4. The Inbox's layout gets in the way of triage (high)

`inbox-2`, `inbox-3`, `inbox-5`, `visual-1`, `visual-2`, `visual-8`, `visual-10`, `visual-12`,
`visual-13`, `visual-25`, `inbox-4`, `inbox-11`, `inbox-12`, `inbox-13`

- **Below the fold.** The first submission sits at y=1394 on desktop and y=1604 on a phone. A
  marketing header, six count cards (which can't be clicked), two explainers, the alerts block,
  status buttons and the filter form all come first, and none of them stay pinned.
- **Hidden content.** Collapsed rows show only name, email and time. Reading one message takes two or
  three disclosure clicks.
- **No tools.** There is no search, no bulk action, no undo and no sort.
- **Misfiled questions.** Questions about an event are filed inside that event's RSVP group.

**Fix.**
- A slim header with the type filters, status (with counts), search, Refresh and Export in a sticky
  toolbar above a dense list.
- Each row is about 48 px: a status dot, name, type, a subject or first line of the message, relative
  time and inline Reviewed/Archive buttons.
- Opening a row shows the message at once, with the human field labels that already exist in
  `submission-editor.js:7-26`. Use a reading pane on wide screens and a full-screen sheet on phones.
- Add checkboxes with bulk Mark reviewed/Archive, backed by `ids[]` in one transaction on the server.
- Show a "N new — Show" pill instead of rebuilding the list in the background.
- Move the help text into a "?" popover.

### 5. Navigation state isn't kept (medium)

`shell-8`, `shell-26`, `event-surveys-10`, `event-surveys-27`, `reliability-16`, `visual-26`

- **Back.** Browser Back leaves Club Office.
- **Reload.** It loses the sub-view, filters and open record.
- **Tab switch.** It resets Surveys to Event surveys and clears its search and filters.

**Fix.** Put pane, sub-view, filters and the open record in the URL with `history.pushState`, and
restore from it on load.

### 6. Status messages are hard to trust (medium)

`shell-12`, `a11y-6`, `visual-7`, `reliability-4`, `shell-3`, `shell-4`

- **Stale banner.** The sticky `#status` banner never clears, follows the officer across tabs and
  looks the same for success and failure.
- **Misleading sign-in prompts.** A cold-start 5xx shows the sign-in form. An approved email without
  the Neon `admin` role loops on "Your session ended".

**Fix.** Show messages as toasts with distinct success and error styles that close on their own. Treat
"could not load" as its own state with a Retry button. Explain the missing role in words.

### 7. The event editor punishes normal habits (high)

`events-2`, `events-3`, `events-5`, `events-6`, `events-7`, `events-9`, `events-13`, `events-28`,
`reliability-25`, `reliability-26`

- **Enter.** Pressing Enter in any one-line field saves a draft and leaves the editor, because
  `form.onsubmit` treats it as Save draft (`event-editor.js:492-495`). Enter in "New type name"
  never adds the type.
- **Saving.** Every Save or Publish ends editing. Validation comes from the server one error at a
  time and points at no field. Publish asks for no confirmation.
- **Hidden actions.** Archive, Unpublish and Duplicate show only in edit mode.
- **Type change.** Changing Type silently overwrites the .edu email requirement.
- **Stale event.** Returning to the tab leaves the open event stale, so the next Save hits a
  guaranteed 409. Event saves have no idempotency key.

**Fix.**
- Block implicit submit.
- Stay in edit mode after saving and add autosave to a local backup.
- Validate on the client per field, and fill in `aria-invalid`.
- Confirm Publish with a summary of what changes on the live site.
- Show lifecycle actions in view mode.
- Refetch the open event when the tab is shown, and add a `requestId` to event saves.

### 8. Surveys answer the wrong questions (high)

`event-surveys-2`, `event-surveys-12`, `event-surveys-13`, `custom-surveys-4`, `custom-surveys-6`,
`custom-surveys-5`, `custom-surveys-10`, `event-surveys-1`

- **RSVP counts.** No screen answers "how many RSVPs for event X". RSVPs without survey rows drop out
  of Surveys.
- **Two archives.** The same RSVP has two unrelated "Archive" states, one in the Inbox and one in
  Surveys. From Surveys, an RSVP still New in the Inbox can be deleted permanently.
- **Custom-survey gaps.** Results have no summary or CSV export. Respondents are added one at a time,
  each add reloads the page, and drafts can't be deleted or duplicated.
- **Wrong totals.** "Any of these" counting marks contradictory options as chosen.

**Fix.**
- Make the Event surveys landing an event table: RSVPs, answered surveys, newest RSVP, and links to
  responses, summary and CSV.
- Give each RSVP one triage state shared by both views.
- Reuse the event-survey summary and CSV code for custom surveys, and add a "Paste emails" roster
  import.

### 9. Contacts sit outside the triage flow (high)

`contacts-1`, `contacts-2`, `contacts-8`, `contacts-11`, `contacts-19`, `contacts-20`

- **Not on Inbox cards.** Inbox cards have no link to the person's history.
- **Unsafe merge.** Merging the wrong person is easy, the candidate cards look alike and it can't be
  undone. The original contact row survives a merge, so an unlink is feasible.
- **Search.** It runs only when the officer presses Search.
- **Dead end.** "Open submission" closes the dialog with no way back to the person.

**Fix.**
- Add a "Contact history" button and a "returning contact" line to Inbox cards.
- Enrich merge candidates, preview the merge and add "Unlink this address".
- Make search run as the officer types.
- Turn the person view into a profile with a note composer at the top.

### 10. Visual system and accessibility (medium)

`visual-4`, `visual-5`, `visual-9`, `visual-14`, `visual-16`, `a11y-2`, `a11y-5`, `a11y-7`,
`a11y-8`, `a11y-9`, `a11y-10`

- **Buttons.** Button weight is close to random. A CSS rule forces everything in `.entry-actions` to
  the secondary style, so danger buttons look neutral.
- **Contrast.** Field borders are about 1.3:1, which fails WCAG 1.4.11.
- **Tabs and headings.** The tabs are `aria-pressed` buttons, not a tablist. The Inbox has no
  headings below the `h1`.
- **Hidden focus.** The sticky Save bar hides the focused field.
- **Selects.** Answer-type selects re-render on `change`, so the arrow keys work once.

**Fix.** Allow one primary action per view and make destructive actions red. Raise the border
contrast. Use tab semantics or plain links. Add headings and accessible names to groups and entries.
Add `scroll-padding-bottom` for the sticky bar.

### 11. Intake and exports silently lose records (high)

`critic-1`, `critic-2`, `critic-3`, `critic-5`, `inbox-26`

- **Resubmissions vanish.** Join, Subscribe and RSVP deduplicate on a key with no time component
  (`lib/validation.mjs:137-141`). `lib/submissions.mjs:46` runs `ON CONFLICT DO NOTHING`, so someone
  whose earlier record was archived can sign up again with a new campus or interests. They are
  told they're welcome, the new details are dropped and nothing reaches New.
- **Partial exports.** "Export filtered CSV" always applies the current status tab, and there is no
  "All statuses" option. In the fixture, a Club signups export returned 11 of 31 rows with no
  warning (`index.html:278`).
- **Tabling limit.** Public forms allow 12 submissions per hour per IP (`lib/http.mjs:85`). At a club
  fair on one tablet or campus Wi-Fi, the 13th student gets "Too many requests". Club Office has no
  way to add a paper or walk-in signup.
- **Unpublished events.** Unpublishing or archiving an event re-files its RSVPs as past, so they
  drop out of the RSVP count, even for an event years ahead (`api/admin.mjs:145`).

**Fix.** On a duplicate, keep the new details as a revision, move the record back to New with a
"Resubmitted" badge and word the confirmation honestly. Make exports default to all statuses, and
label the button and filename with what they contain. Rate-limit by IP plus email, or give
officers a signed tabling link. Add "Add submission" for manual entries, using the same dedupe,
contact capture and audit as the public forms.

### 12. New work only reaches officers who keep a desktop tab open (high)

`critic-4`, `critic-6`, `critic-12`

Alerts fire only while a desktop office tab is open (`browser-alerts.js:75`). On Android Chrome the
page-level `Notification` constructor is not allowed, so "Enable browser alerts" reports success
and then never shows anything. This was inferred from code and documented browser behaviour, and
needs checking on a real phone. Questions and workshop requests share one New queue and one alert
with subscriptions and RSVPs, which need no reply. Every submission type has the same three
generic states.

**Fix.** Add an opt-in officer digest by email or a Discord/Slack webhook, listing only actionable
items with deep links. If browser alerts stay, use a service worker and `showNotification`. Give
actionable kinds their own queue, and give each kind the outcomes it needs: answered,
accepted/published, scheduled, cancelled, withdrawn.

### Also found by the critic (medium and low)

- **`critic-7`, large content.** Every 60-second poll ships the full text of all 50 cards, about
  2 MB with long AI Review drafts. One such draft renders as a 23,000 px card on a phone.
- **`critic-8`, Edit response conflicts.** A 409 is a dead end: Save retries the same stale
  revision, and the only way out discards the officer's typing.
- **`critic-9`, no officer management.** There are no roles and no audit view. Changing access
  needs Vercel and Neon admins, and logged exports and deletions are never shown.
- **`critic-10`, leaderboard.** The public leaderboard has no moderation, so an offensive nickname
  can only be removed with database tools.
- **`critic-11`, event day.** There is no capacity, waitlist, check-in list or attended/no-show
  record.
- **`critic-13`, Events loading state.** While loading, and after a failure, Events shows
  "Active 0 · Archived 0" and the empty-state invitation.
- **`critic-14`, permanent comments.** Comments can't be edited or deleted, so one on the wrong card,
  or one containing private details, stays in that person's contact history.
- **`critic-15`, docs vs UI.** Officer docs and the UI use different words for the same states.

### Security and privacy items

- **`custom-surveys-1` (high).** A public "verified" survey that shares results with respondents shows
  each respondent's email as their name, because `rememberDevice` stores `user.name || user.email`
  (`lib/custom-surveys.mjs:112`). Anyone who verifies any email can then read the others. Reproduced
  in the fixture only. Production depends on whether Neon leaves `user.name` empty for OTP sign-ups.
- **`event-surveys-13`.** Covered under root cause 8: an RSVP still New in the Inbox can be deleted
  permanently from Surveys.
- **`event-surveys-16`.** Survey CSV exports aren't written to the audit log.
- **`contacts-13`.** Real people have no erasure path, and purges leave no receipt.
- **`inbox-26`.** "Export filtered CSV" exports the last filters applied, not what the dropdowns
  show. It can include other events' attendees.
- **`critic-9` and `critic-14`.** Exports and deletions are logged but no screen shows the log.
  Comments containing private details can't be removed.

### Seen on production (read-only)

- On a phone, the first inbox entry starts about 1,465 px down.
- Expanded entries repeat the email and timestamp, show filler such as "Received in club inbox" and
  nest panels four levels deep.
- Event dates appear in three different formats.
- The Active events list includes 19 past events (`events-15`).
- Reloading the page loses the Custom surveys sub-tab.
- "Contacts & follow-up" is a whole workspace squeezed into a dialog.
- Plurals are wrong in places, such as "1 website submissions".

## Strategy

Fix data loss first, then let officers keep their place, then rework the Inbox, then the rest.
Each phase can ship on its own.

| Phase | Goal | Main items | Size |
| --- | --- | --- | --- |
| 0 | Stop losing work and data | Sign-in dialog on 401 with state kept (1). Comment + status in one action, `beforeunload` for drafts (2). Block implicit submit in the event editor. Hide respondent emails (`custom-surveys-1`). Resubmissions reach New, and exports cover all statuses and what the filters show (11). A tabling-safe rate limit (`critic-3`). Block permanent delete of New RSVPs from Surveys. Add a `requestId` to event saves | S–M each |
| 1 | Keep the officer's place | In-place card updates and a focus-restore helper (3). Toasts that clear (6). Navigation state in the URL (5). Separate "could not load" from "signed out" | M |
| 2 | Rework the Inbox for triage | Slim header, sticky toolbar with search, dense rows with previews, reading pane or sheet, bulk actions, a "N new" pill, help in a popover, questions filed under Questions (4). Contact history on cards (9) | L |
| 3 | Fix the Events and Surveys workflows | Stay in edit mode after saving, autosave, field-level validation, Publish confirmation, RSVP counts on events (7). Event overview table, one shared RSVP state, custom-survey summary, CSV and roster paste (8) | M–L |
| 4 | Finish | Contacts profile view, merge preview and unlink, follow-up state (9). Tab semantics, headings, contrast and button hierarchy (10). Erasure path and export auditing | M |
| 5 | Reach officers and run events | Officer digest and an actionable queue with per-kind outcomes (12). Manual "Add submission". Audit-log view and officer management (`critic-9`). Leaderboard moderation, event-day check-in and waitlist (`critic-10`, `critic-11`) | M–L |

Phase 0 needs no layout changes and closes every critical item. Phase 1's focus helper and in-place
updates set up Phase 2. Without them, the redesigned Inbox would keep the same focus and scroll bugs.

## Requested enhancements

Requested by an officer on October 3, 2026. Custom surveys are special-occasion surveys for a
targeted audience. Event surveys are generic and open to anyone. Both requests below follow from
that difference.

### A. Export a custom-survey response as a document to circulate

**Today.** Custom-survey results appear only as on-screen cards (`surveys/results-ui.js`
`responseSections`, `admin/custom-surveys.js:245-250`). They have no CSV, PDF or Word export
(`custom-surveys-4`). Event surveys export CSV only.

**Proposal.**
- **Where.** Add "Download Word (.docx)" and "Print / Save as PDF" to each response card. Add
  "Download all (.docx)" with one respondent per page.
- **Word.** Reuse the dependency-free generator in `surveys/personal-copy.js` (`makeDocx`). It is a
  minimal WordprocessingML package that Advisor Studio respondents already download as their
  personal copy. Change its input from the personal copy to `{title, subtitle, note, sections: [{heading,
  items: [{question, answer}]}]}` so both callers share it. This needs no new dependency, and the
  admin bundle stays small.
- **PDF.** Add a print stylesheet (`@media print`) for a single-response view and call
  `window.print()`. The browser's "Save as PDF" writes the file. This works under the admin CSP
  (`style-src 'self'`). Server-side PDF rendering with headless Chrome is heavy for a Vercel function
  and isn't needed.
- **Layout.** Survey title, respondent and submitted date (Central), then section headings, each
  question in bold and its answer, in the order `responseSections` already computes. Keep the
  existing answer notes, such as "Shared wording only" and dial positions. End with a footer:
  sharing audience, exporting officer and date.
- **Audit.** Record each export in the survey activity log: who, which responses, when. Survey
  CSV exports aren't audited today either (`event-surveys-16`).
- **Consent.** Advisor Studio tells respondents the audience is "Authorized club officers and the
  other advisor for this survey". Exports should contain only what respondents included in their
  shared summary, which is already all that results show. Print the audience statement in the
  document and show it in the export dialog. Circulating more widely would need different consent
  wording for future respondents.

### B. Create a custom survey from a file (CSV, HTML, Word, PDF)

**Today.** The builder (`admin/survey-builder.js`, `lib/survey-builder.mjs`) holds a flat list of
1–30 questions in four types: text, single choice, multiple choice and scale. The only
special-occasion survey so far, Advisor Studio, needed far more:
- **Structure.** 20 questions in 5 chapters, with per-chapter comments.
- **Question types.** 8 of them, including ranking, dials and focus groups.
- **Sharing.** Sharing rules and a review-before-sharing step.
- **Code.** A 1,767-line hand-written UI (`surveys/advisor-ui.js`), a 331-line contract
  (`lib/survey-contract.mjs`) and a JSON definition (`surveys/advisor-definition.json`).

Each new special survey is a coding project today.

**Proposal, in order.**
1. **Let the builder hold what special surveys need.** Add sections with an intro and an optional
   comment box, plus a ranking question type. A dial can be a scale with labelled ends. Surveys like
   Advisor Studio then become data instead of code. This step comes first, because an import can
   only produce what the builder can represent.
2. **Import as a draft, never publish directly.** "Create from file" on Custom surveys parses the
   file and opens the builder on the Questions step with a report, for example "Imported 18
   questions in 4 sections; 2 lines skipped" with the skipped lines shown. The officer reviews,
   previews and publishes as today. The draft passes through the existing server validation in
   `lib/survey-builder.mjs`, so imported and hand-built surveys share the same limits.
3. **Formats, most reliable first.**
   - **CSV (deterministic).** One row per question: section, question, help text, type, options
     separated by `|`, required. Offer a template, and export existing surveys in the same format
     so a survey can be copied, edited in a spreadsheet and re-imported.
   - **HTML forms (deterministic).** Parse in the browser with `DOMParser`. A `fieldset`/`legend`
     becomes a section; radio buttons, checkboxes and selects become single or multiple choice; a
     `textarea` or text input becomes text; range and number inputs become a scale. Never render
     the imported HTML.
   - **Word or PDF (free-form).** These have no fixed structure, so a rules-based parser will
     mislabel questions. Option (a): extract the text (a `.docx` is a zip of XML; PDF needs pdf.js)
     and apply simple conventions: numbered lines are questions, bullet lines are options. Option
     (b): send the extracted text to Claude on the server with the builder's JSON schema as the
     required output, then validate it like any other draft. Option (b) copes with real documents.
     It also adds an API key, a cost per import, and sends the document text to Anthropic. That's
     fine for survey questions, but not for files containing respondent data.

**Suggested order.** A first: it's small and reuses existing code. For B, step 1 before steps 2–3,
and CSV and HTML import before Word and PDF.

## Still open

- **Code-quality pass.** The officer also asked how to simplify the code and remove stale code. Two
  analyses are running. Their combined results will go in `docs/club-office-cleanup.md`.
- **Not exercised.** These need production or a real device:
  - Real Vercel Blob image storage.
  - The public-site preview iframe.
  - Production Neon behaviour for `user.name`.
  - Neon role provisioning (`shell-4`).
  - Browser alerts on Android.
- **Not investigated.**
  - Leaderboard score cheating: scores come from the client.
  - What officers see about queued attachment-deletion retries.
  - "View published event" links hard-coded to `https://dallasai.club` (`event-overview.js:25`,
    `event-editor.js:343`), which ignore preview deployments.
  - A retention policy for the Archived list.
