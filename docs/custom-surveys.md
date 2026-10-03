# Private custom surveys

Open **Club office → Surveys → Custom surveys**. Officers can read the latest
shared summaries side by side, refresh results, open the survey, and copy the
private or question-preview link. These controls do not edit advisor answers.
Event RSVP surveys remain in the separate Event surveys group.

Advisor Studio is a private collection round with a 30-day deadline. The
deadline appears in the welcome page, question preview, respondent navigation,
and officer view. The invitation secret stays in the URL fragment and a
same-origin request header, outside ordinary URL/access logs. Never add survey
request bodies or private link headers to logs or analytics.

## Access

- Anyone with the current private link may preview the questions. The preview
  has no answer fields, submissions, or results.
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
- Officer result routes are GET-only. Advisors can submit only their own
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

Apply `backend/011_custom_surveys.sql` to the approved forms database after the
existing migrations. Its `custom_*` tables are independent of migration 010's
event `survey_responses`. Runtime grants allow current responses, receipts,
device sessions and identity binding; there are no HTTP management/write routes
for officer results or membership grants.

The existing `FORM_TOKEN_SECRET`, `AUTH_BASE_URL`, `NEON_AUTH_URL`,
`NEON_AUTH_COOKIE_SECRET`, and `FORMS_DATABASE_URL` are reused. Rotating the form
secret invalidates derived private links; coordinate link rotation separately.
Existing approved Neon accounts may use the code flow. Do not grant an advisor
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
idempotency, and the scoped Neon proxy. Build with `npm run build`.
`node backend/tests/serve-custom-survey.mjs` starts an isolated PGlite UI fixture
at port 4187, with synthetic advisor addresses and code `123456`. The fixture
prints the temporary test URLs. It is not included in the deployed public build.

Future survey-builder audience choices are a separate design task after this
rollout: Dallas College students, Dallas College staff, public, club officers,
and advisors. This release adds the private Advisor Studio workflow only.
