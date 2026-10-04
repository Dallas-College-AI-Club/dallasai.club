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
| `SHORT_IO_API_KEY`, `SHORT_IO_DOMAIN` | Optional server-only Short.io key and connected short domain for creating sharing links |
| `TINYURL_API_TOKEN` | Optional server-only backup token for new links if Short.io is unavailable |
| `FORMS_ALLOWED_ORIGINS` | Optional exact frontend preview origins |
| `DATABASE_URL`, `SESSION_SECRET` | Existing leaderboard runtime connection and player signing key |
| `AUTH_DATABASE_URL`, `BETTER_AUTH_SECRET` | No longer read; still set in Vercel and safe to remove later |

Keep signing secrets stable. Rotating `FORM_TOKEN_SECRET` invalidates existing
derived survey links; coordinate that separately. Old digests must not be presented
as working links. `SESSION_SECRET` rotation invalidates player tokens. Resend and
the retired email queue are not used by the deployed intake flows.

For automatic short links, connect `go.dallasai.club` to Short.io and add its CNAME
record pointing to `cname.short.io`. Keep the main website's DNS records unchanged.
Create a secret API key scoped to that domain under **Integrations & API**. Save it
as a Vercel Secret named `SHORT_IO_API_KEY`, and set `SHORT_IO_DOMAIN` to
`go.dallasai.club` after DNS and HTTPS are verified. A new deployment loads these
settings. For backup creation, save a TinyURL API token with Create permission as
the Vercel Secret `TINYURL_API_TOKEN`. Its Free account allows 30 links per month.

Short.io's Free plan includes five custom domains and 1,000 links over the account's
lifetime, including API-created links, as of October 4, 2026. No paid plan is required
for this flow. The server uses Short.io's fixed API host and checks the returned
destination and short address. If Short.io fails or is not configured, the server
tries TinyURL. Both use stable aliases for retries; the saved link is preserved
when the preferred provider recovers. Saved manual links, including Advisor Studio's
`https://tinyurl.com/advisor-survey`, are never automatically replaced. Provider errors
do not change the original invitation or saved responses.

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
| 019 | Officer Help topics (`club_forms.help_entries`) |
| 020 | Help guidebook categories, editable starter topics, and topic-linked audit receipts |
| 021 | Officer-recorded event attendance and registration snapshots for RSVPs without questions |
| 022 | Optional custom-survey short link and permission for officers to update it |

Apply `018_survey_maintenance.sql` before deploying the new maintenance handler.
It grants deletion only for device tokens, not survey responses. The migration is
repeatable. Cleanup is bounded and retries on later daily runs if there is a backlog.

Apply `019_help_entries.sql` to let officers add their own Help topics. Until it is
applied with migration 020, Help reports that topics are not set up, and
saving a topic answers 503 naming the required migrations. The topics are stored
only in Neon, never in this public repository. The migration is repeatable and grants
the runtime role select, insert, delete and updates of the editable columns.

Apply `020_help_guidebook.sql` before deploying the guidebook. It adds categories
and a stable topic ID to audit receipts, then inserts nine editable starter topics.
Reruns preserve officer edits and do not recreate deleted starter topics. Receipts
survive topic deletion without retaining the title or body. Older unlinked receipts
remain in Activity; their original topic cannot be reconstructed. Keep this additive
migration on a code rollback.

Apply `021_event_participation.sql` before deploying event attendance and combined
survey reports. It creates `club_forms.event_attendance`, keyed by event ID and
normalized email, grants the runtime role select/insert/update, and backfills
missing RSVP snapshots with empty question and answer arrays. Reruns preserve
existing answer snapshots and attendance. Deleting a contact's email record
cascades its attendance records. Attendance changes and report exports use the
existing officer audit table; keep this additive migration on a code rollback.

Apply `022_survey_share_link.sql` using the database owner before deploying the
sharing-link catalog. It adds nullable metadata and a column-level update grant;
it does not rewrite invitations, questions, respondents or answers. Runtime
credentials intentionally cannot alter the schema. Keep the additive column on
rollback. Availability questions and reply-by dates use existing event/survey JSON
and need no schema migration.

Feedback completion is calculated from nonempty saved responses across every
published same-event custom survey, including archived respondents and closed or
expired rounds. Drafts are excluded; partial completion remains missing feedback.
The RSVP list, count, summary, and CSV share the participation filters. Combined
reports accept `type=all|rsvp|feedback` and optional `surveyId` to scope only their
feedback source. Combined CSV retains the custom-survey same-origin and 4 MB
limits. The ordinary list defaults to RSVPs.

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

Event-participation backend verification (2026-10-04, disposable local PGlite):
30 targeted tests passed across `event-participation`, `survey-management`,
`surveys`, and `submission-management`. This includes migration reruns/runtime
grants, attendance audit rollback, 53 matching RSVPs across pages, partial and
archived feedback evidence, per-survey report scope, and combined-export origin
and size limits. Thirty-three distinct mutation probes caused their regression
tests to fail. These are local backend checks; release browser and production
verification are recorded separately.

Admin-refinement verification (2026-10-04, local worktree): the 189-test backend
suite passed, including linked event feedback, calendar/number answers, deletion
totals and exclusive RSVP choices. Three additional appearance tests passed.
Thirteen deliberately removed protections caused
the matching regression assertions to fail. A local PGlite fixture with 10,006
submissions completed 120 concurrent reads successfully (about 1.6 seconds total);
32 duplicate submissions returned successfully and saved exactly one record.
These measurements exercise local correctness, not Vercel or Neon capacity.

The subsequent survey-list and appearance-button revision passed all 192 backend
tests and all 57 office browser scenarios. Five theme/router mutations failed as
expected. In the built
local office, manual browser checks confirmed persisted theme selection, collection
filtering, event-feedback creation, QR display, duplication with copied questions
and no copied invitations, publication with a distinct link, and separate list rows.
The survey list was visually checked at 320px and 1280px, with no horizontal
overflow.

The accepted Guidebook Help implementation passed the 193-test backend suite and
all 57 office browser scenarios. An additional migration-repeat test passed with
the targeted 17-test Help/router run (194 backend tests total). Nine in-memory
mutations verified active-delete and archived-edit rejection, topic attribution,
history isolation and pagination, direct-link identity, and migration preservation
of edits and deletions. The Help browser scenario checks plain-text rendering,
numbered steps, category buttons, draft navigation, copied links and reloads,
Inline history, archive/restore/delete, retained deletion receipts, and legacy
export links. Session-expiry recovery also passed. Dark desktop and light 390px
phone layouts were visually checked with no horizontal overflow. The production
migration dry run rolled back successfully and confirmed runtime category-edit
permissions; it found no existing officer topics to alter.

Live release QA caught the game-night wording “None of these times” falling outside
the initial exclusive-choice list. The public RSVP/preview, officer response editor,
and server now also recognize that wording and “Not sure yet”, even when another
choice is explicitly marked exclusive. The server regression failed before the fix
and passed afterwards; public/editor mutation checks detected removal of the fix.
The 58-scenario office browser suite now includes the real game-night availability
question, with specific dates and Other cleared and disabled until the exclusive
choice is unchecked. No test RSVP was submitted to production.

Use `node backend/tests/serve-custom-survey.mjs` for the isolated survey UI at port
4187 and `node backend/tests/serve-submission-management.mjs` for inbox editing at
4194. Each fixture prints its test URLs. These fixtures are excluded from the build.
`node backend/tests/serve-survey-audit.mjs` serves a public custom survey and 23
synthetic responses at port 4188. Its `/test-controls` page can drop a submission
reply after the save commits, or reject one oversized CSV download. Use it to
verify retries, consent, pagination, and error recovery without real respondents.
Never submit synthetic test data or send test email through production.

Typed-answer verification (2026-10-04): all 270 backend tests and all 67 Office
browser scenarios passed. The RSVP browser lifecycle and all nine grouped-survey
browser scenarios passed, including
zero-valued numbers, invalid email rejection, dated choices, empty RSVP-enabled
events, default dropdowns, saved-response editing, CSV exports and phone layouts.
Fourteen backend mutation probes and four browser probes each made their relevant
regression fail when a fix was removed. The event visibility and dropdown checks
also reproduced their failures before the fixes.
The same event browser workflow checks disabled-RSVP sharing, the transition to
a linked open feedback survey after an event, custom short-link names, occupied
names preserving the old link, and restoring the generated name. Focused mutation
checks cover these paths, provider conflicts, feedback eligibility, and Home tile
counts and destinations.

An owner-approved, schema-only Neon branch verified real cloud persistence with
synthetic data: 90 concurrent RSVP attempts saved exactly 30 registrations, and 36
custom-survey attempts saved exactly 12 responses. Each participant retried three
times. Nine Game Night date/period groups retained their matching dates and choices;
contradictory exclusive choices were rejected. Separate typed RSVP and custom-survey
saves confirmed JSON numbers (including zero), choice arrays, ISO calendar dates,
minute-precision clock times and normalized emails. The test branch was deleted
after verification. This checked correctness under concurrent retries, not maximum
service capacity. No production response was created or altered by these tests.

A second schema-only Neon run verified the single availability question: 90 RSVP
attempts saved 30 records and 30 custom-survey attempts saved 10 records. Structured
statuses, date/period selections, alternative dates and optional times survived
reload; contradictory answers were rejected and the legacy response was unchanged.
That branch was deleted too. Availability, sharing and Home-count regression probes
caught 46 backend mutations and 13 browser mutations, in addition to the earlier
typed-answer probes. The sharing provider implementation separately caught 40
backend and five browser mutations before integration.

Migration 022 was applied to production through the explicitly owner-authorized
Neon SQL editor on 2026-10-04. A fresh restricted-role connection confirmed the
nullable text column and its update privilege. SHORT_IO_DOMAIN remains unset while
DNS is being prepared; new links use the configured TinyURL fallback. Existing
saved URLs are retained.

After review, deploy a protected Vercel preview with its own `AUTH_BASE_URL` and
trusted Neon Auth origin. Verify database permissions and private files. Deploy the
backend using `vercel --prod --scope ai-c64d` from `backend/`, then publish the public
site. Pushing Git alone does not deploy Vercel. GitHub Pages publishes passing pushes
to `main` or `hugo` and rebuilds daily at 08:15 UTC for scheduled articles.

Deploy both the backend and the public site before publishing RSVP questions with
new answer types. Existing responses keep their original question snapshots;
updating an event form must not rewrite previously submitted answers.

Keep the live event API available during rollback. Original event files are a base
registry; database drafts, unpublishing and archives override them. Reverting to a
static calendar would restore intentionally unpublished events.

## Local preview

Run Hugo on `127.0.0.1:4174`. To test local services, build the backend and run
`npm run dev` from `backend/` at `127.0.0.1:4175`. Set `AUTH_BASE_URL` to that origin
and use Hugo params `formsAPIURL`, `eventsAPIURL`, and `adminURL` for the local API.
Keep production and test credentials separate.
