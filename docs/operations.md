# Club website operations

This is the shared setup and release reference. Officer workflows are documented in
[Forms and inbox](forms-admin.md), [Events](event-editor.md), and
[Custom surveys](custom-surveys.md). Live event and survey status belongs in Club
Office; historical planning notes in this repository are not publication rules.

## Services and access

- Hugo Extended 0.162.1 builds the public site for GitHub Pages, `dallasai.club`.
- Vercel project `ai-c64d/dallasai-leaderboard` serves forms, events, leaderboard,
  Club Office, and Survey Studio. Deploy from `backend/` with Node 24.x.
- Neon stores club data in `dallasai_club`; managed Neon Auth supplies emailed
  sign-in codes. Both `ADMIN_EMAILS` and a current Neon `admin` role are required
  on every officer request. A survey respondent needs neither officer privilege.
- Officer sessions last 72 hours from the verified upstream session's creation,
  including after browser restarts. Upstream renewal cannot extend that deadline.
  Sign-out, clearing cookies, or revoking access ends it earlier. Keep Neon's
  upstream session lifetime at least 72 hours; the configured seven days meets this.
- Cookies are HTTP-only and secure on HTTPS. Each API request verifies upstream
  authorization without relying on a cached browser session.
- Survey devices have separate cookies scoped to the survey API. A device expires
  with its round or is revoked on sign-out/removal. Daily maintenance deletes only
  expired/revoked device tokens, at most 1,000 per run. Responses and audit history
  remain stored.

Neon Auth is the only officer sign-in. The password fallback was removed on
2026-10-03; git history keeps it. Without `NEON_AUTH_URL`, admin sign-in returns
503. Give each officer the `admin` role in Neon and add their address to
`ADMIN_EMAILS`. Migration 004 and the `public.club_admin_*` tables remain as history
and are no longer read.

## Configuration

Use `backend/.env.example`. Keep credentials outside Git, Hugo data, and browser
code. The private settings are under `%LOCALAPPDATA%/dallasai-club-website`.

| Setting | Purpose |
| --- | --- |
| `FORMS_DATABASE_URL` | Restricted forms runtime role; never the owner connection |
| `FORM_TOKEN_SECRET` | Request quota hashes and derived private links; at least 32 characters |
| `AUTH_BASE_URL` | Exact origin serving the office and surveys |
| `NEON_AUTH_URL`, `NEON_AUTH_COOKIE_SECRET` | Managed auth endpoint and cookie secret |
| `ADMIN_EMAILS` | Approved officer emails; empty disables officer access |
| `BLOB_READ_WRITE_TOKEN` | Private attachments and event images |
| `CRON_SECRET` | Authenticates daily maintenance; at least 32 characters |
| `FORMS_ALLOWED_ORIGINS` | Optional exact frontend preview origins |
| `DATABASE_URL`, `SESSION_SECRET` | Existing leaderboard runtime connection and player signing key |
| `AUTH_DATABASE_URL`, `BETTER_AUTH_SECRET` | No longer read; still set in Vercel and safe to remove later |

Keep signing secrets stable. Rotating `FORM_TOKEN_SECRET` invalidates existing
derived survey links; coordinate that separately. Old digests must not be presented
as working links. `SESSION_SECRET` rotation invalidates player tokens. Resend and
the retired email queue are not used by the deployed intake flows.

## Database migrations

Apply numbered migrations in order using the database administrator connection.
Keep runtime connections restricted. The original leaderboard setup is retained in
`archive/leaderboard-setup.zip`; migration 002 adds its request quotas.

| Migrations | Capability |
| --- | --- |
| 003–005 | Forms, retired password-auth tables, on-screen confirmations; retire email-queue trigger |
| 006–009 | Event editor, office tools, event archives, submission comments |
| 010 | Event RSVP questions and answer snapshots |
| 011–013 | Custom survey rounds, respondents, consent, and builder |
| 014–017 | Response management, contact identities, submission and profile editing |
| 018 | Custom-survey history/device indexes and permission to clean obsolete devices |

Apply `018_survey_maintenance.sql` before deploying the new maintenance handler.
It grants deletion only for device tokens, not survey responses. The migration is
repeatable. Cleanup is bounded and retries on later daily runs if there is a backlog.

The original `provision.mjs` bootstraps only part of the current schema and refuses
to overwrite existing credentials. Never treat rerunning it as an upgrade; review
and apply the remaining migrations. Preserve additive migrations on code rollback.

## Read-only production checks

From `backend/`, `node scripts/club-db-read.mjs "SELECT kind, count(*) FROM club_forms.entries GROUP BY kind"`
runs one statement against production and prints the rows. It reads `FORMS_DATABASE_URL` from
`%LOCALAPPDATA%/dallasai-club-website/secrets.env.forms` (created from `vercel env pull`), refuses
any database other than `dallasai_club`, and runs inside a READ ONLY transaction that is always
rolled back. `verify-connections.mjs` and `verify-storage.mjs` also touch production; read them
before running.

## Verification and release

From `backend/` run:

```sh
npm ci --include=dev --ignore-scripts
node --test --test-concurrency=2 tests/*.test.mjs
npm run build
```

From the repository root run `hugo --cleanDestinationDir --panicOnWarning`.
Browser fixtures use synthetic data and local databases. Test public routes, form
validation and retries, mobile layouts, sign-in/sign-out, event changes, and custom
survey creation, preview, submission, replacement, access removal, and result paging.
The CI office workflow runs `node tests/browser-office.mjs`.

Use `node backend/tests/serve-custom-survey.mjs` for the isolated survey UI at port
4187 and `node backend/tests/serve-submission-management.mjs` for inbox editing at
4194. Each fixture prints its test URLs. These fixtures are excluded from the build.
`node backend/tests/serve-survey-audit.mjs` serves a public custom survey and 23
synthetic responses at port 4188. Its `/test-controls` page can drop a submission
reply after the save commits, or reject one oversized CSV download. Use it to
verify retries, consent, pagination, and error recovery without real respondents.
Never submit synthetic test data or send test email through production.

After review, deploy a protected Vercel preview with its own `AUTH_BASE_URL` and
trusted Neon Auth origin. Verify database permissions and private files. Deploy the
backend using `vercel --prod --scope ai-c64d` from `backend/`, then publish the public
site. Pushing Git alone does not deploy Vercel. GitHub Pages publishes passing pushes
to `main` or `hugo` and rebuilds daily at 08:15 UTC for scheduled articles.

Keep the live event API available during rollback. Original event files are a base
registry; database drafts, unpublishing and archives override them. Reverting to a
static calendar would restore intentionally unpublished events.

## Local preview

Run Hugo on `127.0.0.1:4174`. To test local services, build the backend and run
`npm run dev` from `backend/` at `127.0.0.1:4175`. Set `AUTH_BASE_URL` to that origin
and use Hugo params `formsAPIURL`, `eventsAPIURL`, and `adminURL` for the local API.
Keep production and test credentials separate.
