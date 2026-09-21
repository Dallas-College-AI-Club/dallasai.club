# Forms and the club office

The website remains Hugo on GitHub Pages. The existing Vercel project hosts the form APIs and `/admin/`; Neon stores the records. Admin authentication uses the pinned Better Auth email-code plugin with separate tables and a separate database role. Public membership does not create an admin account or subscribe someone to the newsletter.

## How officers learn about a signup

Every new `club_forms.entries` record creates a notification in `club_forms.outbox` **inside the same database transaction**, through a PostgreSQL trigger. This also covers records inserted through another trusted database tool. Updates are not treated as new signups.

Normal website submissions attempt email delivery immediately. Alerts go to `NOTIFICATION_EMAILS` and link to the specific record in the protected club office. The inbox shows a New badge and per-form counts; it refreshes every minute while open. Officers can mark a record Reviewed or Closed, filter, search, and export a CSV (up to 10,000 matching records). Administrative updates, downloads, and exports are logged.

A provider outage does not roll back the saved signup. Delivery jobs have exclusive leases, bounded attempts, retry delays, and stable Resend idempotency keys. More submissions and the daily Vercel job retry eligible work. Officers can also select **Retry pending deliveries**. The daily schedule works on the entry-level Vercel schedule allowance; a shorter production cadence can be configured on a plan that supports it. A direct database insert waits for a worker invocation. “Sent” means accepted by the email provider, not proof that a person read it. Check Resend delivery logs for bounces or delivery problems. Retrying an old job after Resend's idempotency window can resend an alert.

## Required private configuration

Use `backend/.env.example` as the variable-name reference. Never add credentials to Hugo data, browser scripts, GitHub Pages, or commits.

- `FORMS_DATABASE_URL`: role restricted to the `club_forms` schema.
- `AUTH_DATABASE_URL`: role restricted to the `club_admin_*` authentication tables.
- `FORM_TOKEN_SECRET`, `BETTER_AUTH_SECRET`, `CRON_SECRET`: independent random values, at least 32 characters each. Keep stable across deployments.
- `AUTH_BASE_URL`: exact Vercel origin serving `/admin/`, including a preview's origin if testing a preview. Authentication cookies stay on this origin.
- `PUBLIC_SITE_URL`: website origin used for email confirmation links.
- `ADMIN_EMAILS`: comma-separated addresses allowed to sign in. Verified sessions are checked against this list on every admin API request. An empty list disables admin access.
- `NOTIFICATION_EMAILS`: officer recipients for new records. Separate from the admin allowlist.
- `RESEND_API_KEY`, `MAIL_FROM`: Resend key and a sender on a verified domain. The key needs email and contact/segment access.
- `RESEND_SEGMENT_ID`: dedicated **AI Review** segment. Only confirmed newsletter subscriptions are synced here.
- `RESEND_WEBHOOK_SECRET`: signing secret for `/api/email-webhook`. Subscribe the webhook to `contact.updated`, `contact.deleted`, `email.bounced`, `email.complained`, and `email.suppressed`.
- `BLOB_READ_WRITE_TOKEN`: connected **private** Vercel Blob store. Public stores are not supported for contributions.
- `FORMS_ALLOWED_ORIGINS`: optional additional, exact frontend origins for preview testing. Production club origins are built in.

Existing `DATABASE_URL` and `SESSION_SECRET` remain the leaderboard's credentials.

## Provisioning and launch

1. Review `003_club_forms.sql` and generated `004_admin_auth.sql`. `node backend/scripts/provision.mjs` applies only the new forms/admin schema and creates separate runtime roles using the existing private database-admin connection. It writes new settings to `%LOCALAPPDATA%\dallasai-club-website\secrets.env.forms`, outside Git and OneDrive. It deliberately refuses to overwrite existing credentials or roles. If interrupted, inspect the transaction and private file before retrying.
2. Fill in the approved officer addresses and connect Resend and a private Blob store. Do not use a personal API key in browser code or paste credentials into a task message. Add the private variables to the appropriate Vercel environment.
3. From `backend/`, run `npm ci --include=dev --ignore-scripts`, `npm test`, and `npm run build`. The build creates the admin bundle and a trusted event registry from the Hugo source. The generated registry is included in backend-only deployments. Rebuild and redeploy the backend when event registrations change.
4. Deploy a Vercel preview; set its `AUTH_BASE_URL` and frontend origin accordingly. Test with a separate database or isolated test environment and a designated test mailbox. Verify actual email delivery, OTP login, private upload/download, confirmation, cancellation, and unsubscribe webhook handling.
5. After review, deploy the Vercel backend and then publish the website. Backend deployments are CLI-managed; pushing the website alone does not deploy the APIs. The configured public form endpoint is in `data/club.json`.

For local development, build the backend and run its `npm run dev` on `127.0.0.1:4175`. Use test settings with `AUTH_BASE_URL=http://127.0.0.1:4175` and `PUBLIC_SITE_URL=http://127.0.0.1:4174`. Set Hugo's `params.formsAPIURL` override to `http://127.0.0.1:4175/api/forms` when serving the frontend. Local origins are accepted only outside Vercel unless explicitly configured.

## Publishing The AI Review newsletter

Create a Broadcast in Resend, select the dedicated AI Review segment, preview/test the email, and then send it. Include Resend's unsubscribe link. There is no automatic send on a Hugo article publish. Resend manages delivery suppression; signed webhook events update subscription state in Neon. Membership and event receipts are separate transactional emails. An opt-out is never reversed by merely submitting a form again; a fresh email confirmation is needed.

## Attachments and privacy

Contributions accept up to three files and 2 MB total (PDF, DOCX, TXT, Markdown, PNG, JPG). The server checks size, file names, allowed extensions, and basic file signatures; files are stored privately and served as downloads after admin authorization. This is not antivirus scanning. Do not submit sensitive student records. The public `privacy.html` explains the data collected and the services used. Officers should handle correction/deletion requests through the club contact and review retention needs periodically.

## Verification

`npm test` runs local PostgreSQL-compatible tests with PGlite, covering atomic notifications, deduplication, uploads and rollback, consent, confirmation/opt-out, request quotas, and real Better Auth OTP/session behavior. It sends no real emails. `node tests/browser.mjs` checks all five forms and admin workflows with synthetic API responses in a temporary Chrome session after a Hugo build to `.preview/forms-site`. `CHROME_PATH` can override the executable location. Live provider and deployment checks still require configured services and a designated test mailbox.
