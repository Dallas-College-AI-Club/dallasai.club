# Forms and the club office

Hugo serves the public website on GitHub Pages. The Vercel backend stores club signups, The AI Review subscription requests, RSVPs, AI Review submissions, workshop requests, and questions in Neon. A successful form shows an on-screen confirmation only after the database transaction commits. The form preserves its content if saving fails. Duplicate membership/subscription requests and RSVPs do not create extra records.

## How officers learn about a signup

Open the protected backend `/admin/` page. New submissions appear with review status **New**. Counts and the inbox refresh every minute; Refresh updates immediately. Officers can filter by submission type and review status, review or close submissions, download private attachments, and export up to 10,000 matching records. Name/email search is not shown. The Event RSVPs view, counts and CSV exports include only currently published upcoming events (including potential events with TBD dates); an Event dropdown selects one. Past RSVP records remain stored. Administrative updates, downloads, and exports are logged.

**Enable browser alerts** requests browser permission and shows a generic alert when the new count increases. The officer must keep the office tab open; browser throttling can delay background checks. New counts and an on-screen notice also update without notification permission. The on/off preference is remembered in this browser and synchronized across office tabs. Alerts stop at sign-out or when the office is closed; reopening the office resumes a remembered on preference only when browser permission is still granted. Email alerts remain disconnected; the UI states this explicitly. Neon login-code delivery is a separate service and does not send inbox alerts.

The office uses the approved Studio appearance with locally served Geist typography and the Desk layout (event list beside the editor). Appearance controls and alternative themes, fonts, and layouts have been removed; old saved preferences no longer apply. The office follows the browser’s light/dark setting while retaining the Studio design. The supplied black-on-white and white-on-black logos are used only in the office, including its sign-in page and favicon. The public website's branding is unchanged.

## Submission activity and comments

**Received in club inbox** means the record is stored in Neon. **Mark reviewed** means an officer has looked at it; **Mark closed** means no further action is planned. Neither action sends a reply, removes the record, unsubscribes a person, or publishes an article. A closed record can be marked new or reviewed again.

Each entry’s **Activity & comments** panel shows existing status-change and attachment-download audit records as well as new comments. It displays the officer email and Central timestamp, newest first, with pagination for older activity. Comments are private to authenticated officers. Unsaved comment text stays in memory during inbox refreshes and is cleared on sign-out; it is persisted only after Add comment succeeds.

Migration `009_submission_comments.sql` adds `club_forms.entry_comments` with separate `entry_id`, `author_email`, `created_at`, and `body` columns. Server authentication supplies the author and the database supplies the timestamp. Comment IDs make retries idempotent; comment and activity insertion share one transaction. Comments remain attached when an entry is closed or reopened. The runtime role can read and insert comments, not edit or delete them.

CSV exports have separate Subject / title and Message / body fields, dedicated membership/event fields, readable labels, Central timestamps, and a record reference instead of a JSON Details cell. Quotes, multiline text, Unicode and spreadsheet formula protection are preserved.

## How people submit

- **The AI Review → Contribute an article** opens the submission page with a title, draft text and optional private attachments. Submit for review saves it under **AI Review submissions** and replaces the submitted form with a confirmation screen and Done button. It does not automatically publish an article.
- **Ask about this event** opens a question dialog, carries the event context into the inbox and confirms receipt within the dialog. **Ask the club** in the footer opens the same dialog for a general question.
- **Request a workshop** opens the workshop request dialog. Confirmation replaces the form, with a Close button. Dialog close controls stay visible while scrolling.
- Join and The AI Review subscription requests replace their forms with a focused confirmation screen and Done button. Event RSVPs open a popup with a Close button after submission. Errors preserve the person's entered text.

There are no email alerts, emailed confirmation links, or newsletter broadcasts in this release. Newsletter requests record consent for future updates; email ownership is not verified and `email_verified` remains false. They must not be represented as verified subscribers or automatically enrolled in a future mailing service. The public page explains that newsletters are not currently being sent. People can contact the club to withdraw a request or cancel an RSVP.

## Admin access

Approved officers sign in with a code emailed by Neon Auth. No password is needed.
The server checks both `ADMIN_EMAILS` and the current Neon admin role on every
admin request, uses secure HTTP-only cookies, and limits code requests and
verification attempts. Public account creation and password login are not
exposed through the club backend. Removing an email or Neon admin role revokes
access on the next request. See [Event editor](event-editor.md) for the current
login and deployment instructions.

The older self-hosted account tables and `provision-admins.mjs` script are retained
only for rollback. Do not run that script to create current Neon administrators.
Provision approved accounts with the admin role in the Neon Console instead.
Login codes are authentication emails; signup alerts, form confirmations, and
newsletter delivery remain disabled.

## Private settings

Use `backend/.env.example` as the variable reference. Never put credentials in browser scripts, Hugo data, or commits.

- `FORMS_DATABASE_URL`: runtime role restricted to the forms schema.
- `AUTH_DATABASE_URL`: runtime role restricted to the admin authentication tables.
- `FORM_TOKEN_SECRET`, `BETTER_AUTH_SECRET`, `CRON_SECRET`: independent random secrets of at least 32 characters. Keep them stable. The form secret hashes request quota identifiers.
- `AUTH_BASE_URL`: exact backend origin serving the admin page, including the preview origin when testing.
- `ADMIN_EMAILS`: comma-separated approved officer addresses. An empty list disables admin access.
- `BLOB_READ_WRITE_TOKEN`: connected private Blob store for contributions.
- `FORMS_ALLOWED_ORIGINS`: optional exact frontend origins for preview testing.

The leaderboard's existing `DATABASE_URL` and `SESSION_SECRET` remain unchanged. Resend credentials are not required or used.

## Provisioning, testing, and launch

1. Review migrations `003_club_forms.sql`, `004_admin_auth.sql`, and `005_screen_confirmations.sql`. The provisioning script applies these and migration 010 for a fresh setup and creates restricted roles. It refuses to overwrite existing credentials or roles.
2. For an already provisioned database, apply migration 005 once before deploying this revision. It disables the old email-queue trigger and makes new records active by default. Existing data and unused email tables are retained; no email worker or webhook endpoint is deployed.
3. Save private settings and provision officer accounts. Keep preview admin access limited to the designated tester. Use isolated test data and remove only the records created by a test.
4. From `backend/`, run `npm ci --include=dev --ignore-scripts`, `npm test`, and `npm run build`. The build generates the admin bundle and trusted event registry. Rebuild/redeploy the backend when event registrations change.
5. Apply `006_event_editor.sql`, `007_office_tools.sql`, and `008_event_archive.sql` in order for events, question intake, and assets. Apply `009_submission_comments.sql` before deploying the activity/comment API and `010_event_surveys.sql` before deploying surveys. Deploy a protected Vercel preview with the correct admin origin. Check all six forms, real database saves, email-code login/signout, unauthorized access, and private uploads/downloads.
6. After review, deploy the Vercel backend and then publish the website. The backend is deployed through the CLI; pushing the website alone does not update it. The public form endpoint is configured in `data/club.json`.

For local development, build the backend and run `npm run dev` at `127.0.0.1:4175`. Set `AUTH_BASE_URL=http://127.0.0.1:4175` and Hugo's `params.formsAPIURL=http://127.0.0.1:4175/api/forms`. Serve the frontend at `127.0.0.1:4174`. A daily authenticated maintenance task expires request-limit and obsolete webhook records; it sends no messages.

## Attachments and privacy

Contributions accept up to three files and 2 MB total: PDF, DOCX, TXT, Markdown, PNG, or JPG. The server checks names, sizes, extensions, and basic file signatures. Files stay private and require admin authorization to download. This is not antivirus scanning. The public privacy page explains the data stored and how to request changes or deletion.

## Verification

`npm test` uses PGlite to test transactions, deduplication, validation, private assets, CSV exports, comment attribution/idempotency, activity pagination and auth/session boundaries without sending email. `node tests/browser.mjs` checks all six forms, mobile confirmations, failed submissions, passwordless sign-in UI, saved alert preferences, comments/history, dark/light logos, and safe rendering against synthetic API responses after a Hugo build to `.preview/forms-site`. `node tests/browser-events.mjs` exercises event editing, image preview, publish/archive/restore and preservation of RSVP input against a local test database. `node tests/browser-site.mjs` audits the public site routes and navigation after a normal Hugo build.

## Potential events and RSVP surveys

The office tabs are **Inbox**, **Events**, and **Surveys**. In Events, check **Potential event** to publish an idea while leaving its date blank (shown as **TBD**). It appears below the calendar under Potential events and opens the normal event details. It remains eligible for the upcoming RSVP inbox while published. Scheduled events still require a date.

**Require a college or alumni email ending in .edu** is an event-level setting, enabled by default when an officer chooses **Social**. It can be changed for any event. The public form and server enforce it; ordinary events still accept other valid email addresses. This checks address format, not email ownership.

Name and email are built in. The RSVP survey editor adds up to 20 written-answer, choose-one, or choose-several questions with help text, required answers and an optional Other field. Choice questions allow 2–30 options. Publish changes to make them available; saving a draft leaves the current form unchanged.

Migration 010 stores the original question snapshot and answers per RSVP in `club_forms.survey_responses`. Basic RSVP and answers commit in one transaction. A duplicate email/event cannot overwrite answers; the confirmation explains that the original is saved. A changed question version causes an open old form to request reopening before submitting. Authorized admins can correct saved answers through **Edit response**; the original questions and version stay unchanged.

Inbox shows event, date/TBD, name and email with a link to **View survey answers**. Surveys shows complete responses, filtered by event or RSVP and paginated by 50, including responses to past or archived events. Only authenticated officers can read this API. Question and event snapshots retain their original wording after edits. Event surveys include plain summaries and CSV exports; graphical analytics are tracked in [issue #34](https://github.com/Dallas-College-AI-Club/dallasai.club/issues/34). No email notifications are sent.

After building the public and admin sites, `node tests/browser-surveys.mjs` exercises the question editor, TBD publication, conditional email validation, full database persistence, Inbox/Surveys, safe text rendering, reload, mobile layouts and clearing results on sign-out.

## Managing event answers and contacts

In **Surveys → Event surveys**, expand an event, then a person to read their answers.
Use **Star / Unstar**, **Archive / Restore**, the **Active / Archived / All saved**
selector, **Starred only**, and the name/email search. Archiving a response hides it
from the default survey view without changing its answers or its basic Inbox RSVP.
Opening a specific RSVP from Inbox also finds archived responses.

**Compile summary** opens a pop-up with the selected results and an **Export CSV**
button. Its controls stay visible while answers scroll. Close or Escape dismisses
and clears the compiled view; it does not occupy space on the response list.
**Export matching CSV** also remains available from the page. Both use the selected
filters across all pages. Each event also has summary/export buttons. Changed question versions remain
separate. Choice percentages use the people who answered that question as the
denominator; multi-select totals can exceed 100%. Written and Other answers are
collapsible. CSV exports each response on one line, with semicolon-separated answers
and separate Yes/No columns for every multiple-choice option. This makes each date
and time visible in its own column. A selection of **Any of these** marks ordinary
choices **Yes (Any of these)** while keeping None and Not sure unselected. Formula
values are escaped. CSV does not control Excel's column widths or wrap settings.
Reports refuse more than 10,000 matches explicitly; narrow the event/search rather
than receiving a silently incomplete export.

**Contacts & follow-up**, available from Inbox and Event surveys, consolidates
website submissions by normalized email. **Merge with another contact** lets an
officer explicitly link a person's e-number and named school email addresses.
Search for and select the contact to keep, then review **Confirm merge**. Its
primary email is retained. Both email addresses find the same combined history,
including future submissions. Original submission emails, answers and notes are
preserved. Contacts with the same name are never automatically merged.
A contact shows the names used, submitted
messages, Inbox comments, response-management activity and officer follow-up notes.
Notes carry the authenticated author and database timestamp. Retrying a saved note
does not create duplicates. This does not read a mailbox or send emails. Private
standalone-survey drafts and unsubmitted answers are not included.

**Delete contact** removes a regular contact from the Active directory only.
Select **Deleted** and **Restore contact** to bring it back; saved submissions and
notes remain available. New submissions do not silently restore a deleted contact.
**Mark as test** applies to every email linked to that contact and does not delete
anything by itself. For a marked test contact, **Permanently delete test contact**
shows the affected counts and requires typing its primary email. Confirmation
erases its linked website entries, event survey answers, comments, notes, contact
history, aliases and attachments. This cannot be restored. Regular and test
contacts cannot be merged unless their test settings are first reviewed to match.
Concurrent changes invalidate a management confirmation and require a refresh.

Apply `backend/015_contact_identity_management.sql` after migration 014 before
deploying contact management. It backfills aliases without merging or deleting
any existing people. File deletions are queued in the same transaction as a test
purge and attempted immediately; the existing maintenance job retries storage
failures. Standalone private survey membership and admin login accounts remain
separate; marking a directory contact as test does not grant access to or remove
those accounts.

Apply `backend/014_event_response_management.sql` after migrations 009 and 010,
before deploying these controls. It backfills contacts from existing entries and
captures future submissions with a trigger. State is kept in `survey_response_state`
separately from `survey_responses`; notes are append-only. Keep this
additive migration on a code rollback. It does not delete or archive existing data.

Answer choices can be edited individually and reordered using drag handles or
keyboard-accessible arrow buttons. Bulk entry with one option per line still works.
In the event preview, try answers and open **Preview admin result** to review a
clearly labeled sample. Those trial answers are never submitted or saved to Neon.

## Editing and deleting submissions

Inbox groups submissions by event, or by form type when there is no event. Expand
a person to read details, edit, or change their review status. **Event RSVPs (past)**
is separate from the upcoming filter. **All submissions** includes both, and past
RSVP links and exports remain available.

**Edit response** is available in Inbox and Event surveys. It opens the saved
name, email and response fields; event answers use their original questions.
Changes require an explicit save, are logged with the acting admin, and reject
stale edits. Retries do not duplicate a change. Changing an email removes its old
verification flag; existing responses with the same email/event cannot be overwritten.

In Archived, **Delete permanently** opens a warning with Cancel selected first.
Confirmation removes the entry from both Inbox and Event surveys, including its
answers, comments and attachments. Its contact and linked aliases are removed only
when no other submission, contact note or custom survey membership uses them.
Deletion receipts retain only identifiers, the admin, time and a digest. Private
Advisor Studio responses remain read-only and use their separate archive.

Apply `backend/016_submission_management.sql` after migration 015 before deploying.
This additive migration preserves existing data. Attachment deletion is queued in
the database transaction, attempted immediately, and retried by maintenance on failure.
For local browser checks, build then run `node tests/serve-submission-management.mjs`;
its records are synthetic and kept only in memory at `http://127.0.0.1:4194/admin/`.
