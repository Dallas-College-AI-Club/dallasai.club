# Forms and the club office

Hugo serves the public website on GitHub Pages. The Vercel backend stores club signups, The AI Review subscription requests, RSVPs, AI Review submissions, workshop requests, and questions in Neon. A successful form shows an on-screen confirmation only after the database transaction commits. The form preserves its content if saving fails. Duplicate membership/subscription requests and RSVPs do not create extra records.

## How officers learn about a signup

Open the protected backend `/admin/` page. New submissions appear with review status **New**. Counts and the inbox refresh every minute; Refresh updates immediately. Officers can filter by submission type and review status, review or close submissions, download private attachments, and export up to 10,000 matching records. Name/email search is not shown. The Event RSVPs view, counts and CSV exports include only currently published upcoming events; an Event dropdown selects one. Past RSVP records remain stored. Administrative updates, downloads, and exports are logged.

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
- Join, The AI Review subscription requests, and upcoming-event RSVPs replace their forms with a focused confirmation screen and Done button. Errors preserve the person's entered text.

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

1. Review migrations `003_club_forms.sql`, `004_admin_auth.sql`, and `005_screen_confirmations.sql`. The provisioning script applies all three for a fresh setup and creates restricted roles. It refuses to overwrite existing credentials or roles.
2. For an already provisioned database, apply migration 005 once before deploying this revision. It disables the old email-queue trigger and makes new records active by default. Existing data and unused email tables are retained; no email worker or webhook endpoint is deployed.
3. Save private settings and provision officer accounts. Keep preview admin access limited to the designated tester. Use isolated test data and remove only the records created by a test.
4. From `backend/`, run `npm ci --include=dev --ignore-scripts`, `npm test`, and `npm run build`. The build generates the admin bundle and trusted event registry. Rebuild/redeploy the backend when event registrations change.
5. Apply `006_event_editor.sql`, `007_office_tools.sql`, and `008_event_archive.sql` in order for events, question intake, and assets. Apply `009_submission_comments.sql` before deploying the activity/comment API. Deploy a protected Vercel preview with the correct admin origin. Check all six forms, real database saves, email-code login/signout, unauthorized access, and private uploads/downloads.
6. After review, deploy the Vercel backend and then publish the website. The backend is deployed through the CLI; pushing the website alone does not update it. The public form endpoint is configured in `data/club.json`.

For local development, build the backend and run `npm run dev` at `127.0.0.1:4175`. Set `AUTH_BASE_URL=http://127.0.0.1:4175` and Hugo's `params.formsAPIURL=http://127.0.0.1:4175/api/forms`. Serve the frontend at `127.0.0.1:4174`. A daily authenticated maintenance task expires request-limit and obsolete webhook records; it sends no messages.

## Attachments and privacy

Contributions accept up to three files and 2 MB total: PDF, DOCX, TXT, Markdown, PNG, or JPG. The server checks names, sizes, extensions, and basic file signatures. Files stay private and require admin authorization to download. This is not antivirus scanning. The public privacy page explains the data stored and how to request changes or deletion.

## Verification

`npm test` uses PGlite to test transactions, deduplication, validation, private assets, CSV exports, comment attribution/idempotency, activity pagination and auth/session boundaries without sending email. `node tests/browser.mjs` checks all six forms, mobile confirmations, failed submissions, passwordless sign-in UI, saved alert preferences, comments/history, dark/light logos, and safe rendering against synthetic API responses after a Hugo build to `.preview/forms-site`. `node tests/browser-events.mjs` exercises event editing, image preview, publish/archive/restore and preservation of RSVP input against a local test database. `node tests/browser-site.mjs` audits the public site routes and navigation after a normal Hugo build.
