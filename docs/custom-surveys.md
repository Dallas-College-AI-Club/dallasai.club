# Private custom surveys

Open **Club office → Surveys** and choose a survey from the list. Use **Collection**
to show all surveys, event feedback, or standalone custom surveys. Officers can read the latest
submitted summaries grouped by respondent and chapter, refresh results, open the survey, and copy the
private or question-preview link. These controls do not edit advisor answers.
Registration questions remain in the separate **RSVP answers** group.

## Event feedback and creation

The survey list offers **RSVP answers** and **Create survey**. From a saved event,
**Create event feedback survey** starts a three-question
feedback template linked to that event. It defaults to anyone with a verified email,
with results visible only to admins; officers can restrict access before publishing.
Save a new event draft before creating its feedback survey. Linked surveys appear in
the event overview and in Custom surveys automatically.

RSVP questions collect answers during registration and share the event's publication
state. Feedback surveys have their own publication, expiration, answering link and QR
code. Publishing feedback does not register anyone for the event. After publishing,
use **QR code → Download QR** to save a scannable SVG. The QR is generated locally and
contains the same private answering link; respondents still verify their email.

Builder surveys support written answers, single choice, multiple choice, 1–5 rating,
calendar date and number. A multiple-choice question can mark one answer exclusive;
choosing it clears and blocks the other answers. RSVP questions support written,
single and multiple choice, including an explicit exclusive answer and legacy
“Any of these” / “None of these” labels. Uncheck the exclusive answer to choose others.

Neon stores survey definitions and structured answers as JSON with stable question
IDs, not a changing SQL column per question. CSV export turns question titles into
column headings. Calendar answers retain `YYYY-MM-DD` without timezone conversion;
event timestamps and submission timestamps use the existing Central Time rules.
RSVP answers retain a snapshot of the questions at submission. Custom survey
questions and permissions are fixed when published.

## Duplicate a survey

Open a builder survey and choose **Duplicate survey**. The new draft copies its
questions, audience, access settings, duration and linked event. Rename it and check
the event and access settings before publishing. Responses, invitations, activity
and devices remain with the original. Publishing the copy starts a fresh answering
period and creates its own link and QR code. The fixed Advisor Studio format is not
a builder survey and does not offer this action.

The selector counts active, nonempty responses and shows archived responses
separately. Expired rounds are labeled expired; closed and expired links are not
offered as working invitations. Long result lists load ten responses at a time with
**Load more responses**. Respondents with shared-result access use **Load more saved
results**; their own saved answers are always available on the first load.
The archived response view also loads ten responses per page. Invalid or closed
invitations show a neutral unavailable screen with the club contact address.

Advisor Studio is a private collection round with a 30-day deadline. The
deadline appears in the welcome page, question preview, respondent navigation,
and officer view. The invitation secret stays in the URL fragment and a
same-origin request header, outside ordinary URL/access logs. Never add survey
request bodies or private link headers to logs or analytics.

## Downloads

**Export CSV** under Submitted responses downloads every active response across
all pages, like the event survey export: one row per respondent with name (or
email when there is no name), email, submitted time (Central) and status, then
one column per question in survey order. Rankings read `1. … 2. …`, chosen
options are joined with semicolons, dials read `65 of 100 — <wording>`, and
wording a respondent rewrote for sharing starts `[Shared wording only]`. Builder
surveys have a column for every question; Advisor Studio has a column for each
answer respondents shared. Archived responses stay in Inbox → Archived →
Questions. Formula values are escaped. The file is
`<survey>-responses-<YYYY-MM-DD>.csv`. More than 10,000 responses, or a file over
4 MB, is refused with a message instead of a partial file. The export runs only
from Club Office or a typed address, never from another site's link.

Each response has **Download PDF**. It opens a dialog with one field, **PDF
heading**, filled with the survey title; the heading can change, the answers
cannot. This browser remembers the last heading for each survey. **Download
PDF** saves one respondent's answers as a Letter-size PDF, made in the browser
from the results on screen: the club name, the heading, respondent name and
email, submitted time (Central) and number of answers, then each chapter and
question in survey order, formatted as on screen. Builder questions the
respondent skipped read **No answer**, blank lines in written answers start new
paragraphs, and a question title is kept with its answer. Every page has the
respondent, heading and page number at the foot. The file is
`<survey>-<respondent>-<YYYY-MM-DD>.pdf`, dated by the Central submission day.

The PDF uses the built-in Helvetica font: emoji are left out, and a few symbols
are spelled out (`→` as `->`). When a name or answer has other characters, such
as Korean, the dialog says so and offers **Print / Save as PDF**. That opens the
same document in a print view with the page's own fonts and the browser's print
dialog, where **Save as PDF** keeps every character.

Both downloads write an audit row with the officer's email:
`custom-survey-export-csv:<survey id>`, or
`custom-survey-pdf:<survey id>:<respondent id>` once the PDF is made or the print
view opens. The respondent id is never an email address.

## Access

- Anyone with the current private link may preview the questions. The preview
  uses the original survey layout with disabled answer controls and no results.
- Answering requires a code delivered by Neon Auth to an assigned advisor
  email. The server verifies the Neon session and email verification, binds
  the account ID to the survey member, and issues a survey-scoped device token.
- Device tokens are random, stored as SHA-256 digests, and carried in persistent
  HttpOnly, SameSite=Strict cookies (Secure on HTTPS). They expire with the
  collection round. Returning on the same browser needs no new code. Signing
  out, revoking a device/member, closing the survey, or expiry denies access.
- Officers keep the existing ADMIN_EMAILS plus Neon admin-role check. Advisor
  survey membership grants no inbox or event-editor access. An account may
  already have officer privileges independently of its advisor membership.
- Officer result and CSV routes are GET-only; a PDF download records its
  audit row with a same-origin POST. Advisors can submit only their own
  responses and see only the shared summaries in their assigned survey.
- Cookie-authenticated writes require the configured same origin. No endpoint
  grants roles or accepts a client-selected advisor identity as authorization.

Clearing browser data, using private browsing, or switching browser profiles
requires verification again. Remembering a device does not upload private drafts.

## Sharing and storage

Each response has independent wording-review and inclusion flags, initially
unchecked. Source or wording edits invalidate only that response's flags and
final audience consent. Every concern dial, resource offer, page comment, and
ideal-responsibilities answer has its own choices.

The review page pairs your answers with the other advisor's saved shared wording
under the same question. On phones each pair stacks together. Edit controls sit
beside **Your response**. Questions answered only by the other advisor remain
visible for comparison and are not included in your submission or personal copy.
Only the already-authorized shared results are used; question previews contain no
responses. A resource or concern added by an advisor stays separate from another
advisor's independently added option.

The review page has separate **Mark all wording reviewed** and **Include all in
shared summary** buttons. Click either again to undo only the checks it added;
choices checked individually before the bulk action are kept. Changing a checkbox
individually afterwards also takes it out of that bulk action. The two buttons
work independently, skip empty, stale, and removed responses, and leave final
audience consent unchecked. Editing an answer still clears that answer's review
and inclusion choices. Full downloads use
`formname-full-response_respondent-name_YYYY-MM-DD_HH-mm-ss-CT.docx` (or `.md`).

Admins manage respondent names and email addresses in Custom surveys, including
**Add myself for testing**. Removing access revokes every survey device session
and moves any submitted answers to **Inbox → Archived → Questions**. The
read-only archive uses the retained response, without making another copy.
Restoring access removes it from the archive. Add, remove, restore, and public
registration actions retain the actor and timestamp in the activity log.
People who have not submitted answers do not appear in result cards.

`survey-contract.mjs` rejects unexpected fields, unreviewed/excluded answers,
invalid types/options/hours, extra custom labels, incorrect audience, and forged
structured wording. The server regenerates structured wording from the immutable
definition. Manually rewritten summaries contain narrative text only, with no
hidden original values or labels. There is no numeric analytics for narrative
responses, no full-state upload, and no server draft autosave.

Submission locks the collection round, checks current device/member access,
checks the expected revision, and commits one replacement snapshot plus its
receipt in one transaction. A retry with the same request identity returns the
same receipt. Reusing that identity with changed content or overwriting a newer
revision fails. Receipts hold request digests, not old answers. Current results
never resurrect omitted answers. Database backup retention follows the existing
Neon environment policy; replacing a response is not a backup erasure mechanism.

Full Word and Markdown downloads run locally, contain unshared answers and
review status, and work without submission approval. Word output is an actual
WordprocessingML ZIP. Email is a help-only mailto/copy-address action. No survey
invitation or response email is sent automatically.

## Deployment

Use [Operations](operations.md) for shared configuration, migration order,
session rules, deployment, and rollback. Migration 018 adds indexes for survey
history and device revocation, and bounded cleanup of obsolete device tokens.
This cleanup does not remove respondents, submitted answers, or audit records.

Apply migrations `011_custom_surveys.sql`, `012_survey_respondents.sql`, and
`013_survey_builder.sql` to the approved forms database in order. Their
`custom_*` tables are independent of migration 010's event `survey_responses`.
Runtime grants cover response storage, device sessions, audited respondent
management, and draft/publish/close operations. Admin result routes remain
read-only.

The existing `FORM_TOKEN_SECRET`, `AUTH_BASE_URL`, `NEON_AUTH_URL`,
`NEON_AUTH_COOKIE_SECRET`, and `FORMS_DATABASE_URL` are reused. Rotating the form
secret invalidates derived private links; coordinate link rotation separately.
Approved email addresses may use the Neon code flow, including first-time
accounts. Do not grant an advisor
the Neon admin role merely to answer a survey.

After validation, open the approved round with
`node backend/scripts/open-advisor-survey.mjs`. Pass
`SURVEY_ADMIN_DATABASE_URL` and `SURVEY_ADVISORS` through the private environment;
the latter is JSON with the two `{id,email}` entries for `pearlman` and
`bracewell`. It refuses to overwrite an existing slug or membership. It starts
the 30-day window, creates no answers, and sends no email. Retrieve the links
from the authenticated office.

`npm test` in `backend/` covers request boundaries, scope, remembered devices,
revocation, preview privacy, atomic persistence/rollback, replacement snapshots,
idempotency, the scoped Neon proxy, and the CSV and PDF downloads. Build with
`npm run build`; the PDF code (jsPDF) is a separate file that loads on the
first **Download PDF**.
`node backend/tests/serve-custom-survey.mjs` starts an isolated PGlite UI fixture
at port 4187, with synthetic advisor addresses and code `123456`. The fixture
prints the temporary test URLs. It is not included in the deployed public build.

## Create another survey

Choose **Create custom survey**, then follow **Template → Audience → Questions
→ Preview → Publish**. Blank and quick-feedback templates support text, single
choice, multiple choice, and 1–5 rating questions. Choice order supports dragging
and move buttons. In a multiple-choice question, check **Exclusive** beside one
choice, such as “Any of these” or “None of these”. Choosing it clears and blocks the
other choices until it is unchecked, and the server rejects it combined with others.
Surveys saved without an exclusive choice are unchanged. Admins can save and resume
drafts, try answers locally, and open a mock results popup without saving responses.

Choose Dallas College students, Dallas College staff, open to the public, club
officers, or advisors as the audience. Preview, answering, and results have
independent permissions. Restricted audiences use an explicit approved roster;
an email domain alone does not establish student or staff status. Public surveys
can allow any verified email. A removed address cannot enroll itself again.

New surveys have separate preview and answering links. A preview capability
cannot submit answers or read results. Publicly shareable previews require no
sign-in; restricted previews require a remembered approved device. Results can
be admin-only or shared with current and future approved respondents, with that
audience stated before consent. Original Advisor Studio sharing still uses the
recipient list approved at submission time.

Publishing starts the selected 1–90 day window (30 by default) and freezes
questions and permissions. Closing ends access while retaining results and
audit history. Draft changes and publication use revision checks and idempotent
request receipts. The first Advisor Studio remains its dedicated original
design; new surveys use the generic form renderer.

For responsive checks, the isolated fixture also serves `/responsive`, a
same-origin iframe with six fixed viewport sizes from 320 to 1440 pixels and
visible layout measurements. It never ships in the public build.
