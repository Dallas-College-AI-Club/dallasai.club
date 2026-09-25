# Forms and the club office

Hugo serves the public website on GitHub Pages. The existing Vercel backend stores club signups, newsletter subscription requests, RSVPs, contributions, and workshop requests in Neon. A successful form shows an on-screen confirmation only after the database transaction commits. The form preserves its content if saving fails. Duplicate membership/subscription requests and RSVPs do not create extra records.

## How officers learn about a signup

Open the protected backend `/admin/` page. Every new record, including trusted database imports, appears with review status **New**. Counts and the inbox refresh every minute while the page is visible; Refresh updates immediately. Officers can filter, search, review or close submissions, download private attachments, and export up to 10,000 matching records. Administrative updates, downloads, and exports are logged.

There are no email alerts, emailed confirmation links, or newsletter broadcasts in this release. Newsletter requests record consent for future updates; email ownership is not verified and `email_verified` remains false. They must not be represented as verified subscribers or automatically enrolled in a future mailing service. The public page explains that newsletters are not currently being sent. People can contact the club to withdraw a request or cancel an RSVP.

## Admin access

Approved officers sign in with individual email addresses and passwords using pinned Better Auth. Public account creation and email-code login are disabled. The server checks `ADMIN_EMAILS` on every admin request, uses secure HTTP-only cookies in production, and limits login attempts. Removing an address revokes its access even if its session is still valid. Password hashes and sessions have their own database role.

Run `node backend/scripts/provision-admins.mjs` once after setting the approved list. It creates accounts with independent random passwords and saves the initial credentials to `%LOCALAPPDATA%\dallasai-club-website\admin-access.json`, outside Git and OneDrive. It refuses to overwrite existing accounts or credentials. Share each initial password only with its officer. The **Change password** control requires the current password and revokes the officer's other sessions. Passwords must contain 12–128 characters. Forgotten passwords require the website administrator; there is no email recovery service.

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
5. Deploy a Vercel preview with the correct admin origin. Check all five forms, real database saves, password login/change/signout, unauthorized access, and private uploads/downloads.
6. After review, deploy the Vercel backend and then publish the website. The backend is deployed through the CLI; pushing the website alone does not update it. The public form endpoint is configured in `data/club.json`.

For local development, build the backend and run `npm run dev` at `127.0.0.1:4175`. Set `AUTH_BASE_URL=http://127.0.0.1:4175` and Hugo's `params.formsAPIURL=http://127.0.0.1:4175/api/forms`. Serve the frontend at `127.0.0.1:4174`. A daily authenticated maintenance task expires request-limit and obsolete webhook records; it sends no messages.

## Attachments and privacy

Contributions accept up to three files and 2 MB total: PDF, DOCX, TXT, Markdown, PNG, or JPG. The server checks names, sizes, extensions, and basic file signatures. Files stay private and require admin authorization to download. This is not antivirus scanning. The public privacy page explains the data stored and how to request changes or deletion.

## Verification

`npm test` uses PGlite to test database transactions, deduplication, validation, upload cleanup, request quotas, and real password authentication/session behavior without sending email. `node tests/browser.mjs` checks all five forms, mobile layouts, failed submissions, password login/change, and safe admin rendering against synthetic API responses after a Hugo build to `.preview/forms-site`. `node scripts/verify-live-forms.mjs <approved-test-email>` (from `backend/`) starts a temporary local API against the configured Neon and Blob services. It checks actual saves, login/signout, New counts, review/export, and attachment access, then removes its own test records and files. It refuses to run if that mailbox already has submissions. Live tests must use the designated test account.
