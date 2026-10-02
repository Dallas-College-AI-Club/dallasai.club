# Event editor

Open the Events page and choose **Admin sign in**, or open
https://dallasai-leaderboard.vercel.app/admin/#events.
Use the email and password for your Neon Auth account. Access requires both a
current Neon admin role and membership in the server's approved email list.
Removing either revokes access on the next request.

Choose **New event**, or select an existing event. Enter a title, type, date,
Central time, location, meeting link, description, audience, learning outcomes,
agenda, and preparation. Each learning outcome or agenda item goes on its own
line; agenda lines can include a duration, module, and activity.

- **Save draft** keeps changes private. A date is optional until publication.
- **Preview** displays the current form without saving or publishing it.
- **Publish event** updates the public calendar, event search, Latest, and RSVP
  eligibility. A date is required. Times are optional.
- Clear **Accept RSVPs** and publish to close new registrations.
- **Unpublish** removes the event from the public calendar and prevents new
  registrations. Draft content, previous RSVPs, and edit history are retained.
- **Duplicate event** starts a separate draft with the current details.

Public pages refresh events when opened, when returning to the tab, and every
minute. Saving a draft of a published event leaves the public version intact.
If someone else edits the same event, the save is rejected and your text remains
in the form. Copy it, refresh the list, and review the latest saved version.
The editor also warns before leaving unsaved changes.

The workshop **AI + Programming for Everyone: From Messy Data to Useful
Answers** is intended to remain a private draft with blank date, time, and
location until those details are decided. No workshop email is sent.

## Deployment and operations

The public site is Hugo on GitHub Pages. The admin interface, event API, forms,
and leaderboard are in the existing Vercel project
`ai-c64d/dallasai-leaderboard`, deployed from `backend/`.

1. Apply `backend/006_event_editor.sql` to the existing `dallasai_club` database
   using the database administrator connection. It adds only event content and
   revision history, and grants the existing forms runtime role access.
2. Configure `NEON_AUTH_URL` to the project's public auth endpoint and
   `NEON_AUTH_COOKIE_SECRET` to a random secret of at least 32 characters.
   The supplied endpoint uses `neondb/auth`; club forms and events remain in
   `dallasai_club`. Keep all database connections and cookie secrets outside Git.
3. Set `AUTH_BASE_URL` to the exact admin origin and `ADMIN_EMAILS` to the
   approved officers. Provision those accounts with the **admin** role in Neon.
   The old locally provisioned officer passwords do not automatically transfer
   to Neon Auth. Do not change everyone's password to perform deployment tests.
   Register `https://dallasai-leaderboard.vercel.app` and
   `https://dallasai-forms-preview.vercel.app` as trusted domains in the branch's
   Auth configuration before testing.
4. Deploy a protected Vercel preview and verify sign-in with an approved account.
   The same-origin proxy exposes only session lookup, email/password sign-in,
   sign-out, and password changes. Every admin data request checks the upstream
   session without cookie caching and checks the current allowlist and role.
5. Deploy Vercel production, verify `/api/events` and `/admin/`, then publish
   the public site. `EVENTS_API_URL` and `ADMIN_URL` in `data/club.json` point
   to that production deployment. Hugo params `eventsAPIURL` and `adminURL`
   can override them for previews.

When managed auth is disabled by removing `NEON_AUTH_URL`, the existing
self-hosted officer authentication remains available for rollback. Do not
delete its accounts or tables as part of this release.

The event API overlays the original JSON/YAML event registry with database
records. Unsaved original events remain public; a saved null public version is
an explicit unpublish, including for original events. A deployed static site
does not revive unpublished events if the API is down. Public pages show a
loading/unavailable notice until the live calendar can be read.

On a release rollback, keep the event migration and history. Do not roll the
public site back to a static calendar while published database edits are in use.
Fix or restore the event API deployment instead.

## Verification

`npm ci --include=dev --ignore-scripts`, `npm test`, and `npm run build`
run from `backend/`. Build the public site with
`hugo --cleanDestinationDir --panicOnWarning`. Install the isolated test browser
with `npx playwright install chromium`, then run
`node backend/tests/browser-events.mjs`.

The browser audit enters the supplied workshop through the actual editor
against an isolated test database, checks draft persistence and blank-date
preview, publishes only locally, and verifies safe display, RSVP input retention,
conflict recovery, closed registration, unpublishing, mobile layouts, and
sign-out/sign-in. Unit tests cover transactional history, validation, public
versus private data, authorization, Central daylight-saving changes, and RSVPs.
Live checks must not publish synthetic test events or send emails.
