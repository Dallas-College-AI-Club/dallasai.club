# Event editor

Open the Events page and choose **Admin sign in**, or open
https://dallasai-leaderboard.vercel.app/admin/#events.
Enter your approved officer email and choose **Send sign-in code**. Enter the
six-digit code from your inbox, then choose **Sign in**. No password is needed.
Use the latest code; request another after a minute if necessary.
Access requires both a
current Neon admin role and membership in the server's approved email list.
Removing either revokes access on the next request.

Choose **New event**, or select an existing event. Enter a title, type, date,
Central time, location, meeting link, description, audience, learning outcomes,
agenda, and preparation. Each learning outcome or agenda item goes on its own
line; agenda lines can include a duration, module, and activity.

Potential events appear first in a distinct group. Other drafts and events with
unpublished changes appear next, with a visible DRAFT label. The form also explains whether the
entire event or only its changes are unpublished.

Choose a shared **Type** from the dropdown. **Manage event types → Add type**
adds a grouping for all officers. Case and extra spaces do not create duplicates.
The server rejects unregistered free-text types.
The standard groups are **Workshop, Meeting, Talk, Hackathon, and Social**. Older club
and project meetings map to Meeting; conversations and presentations to Talk;
skills sessions, project workshops, and user testing to Workshop. Event details
and original history remain intact. Adding an old label reuses its standard group.

**Upload event images** accepts up to three still JPG, PNG, or WebP images, each
under 2 MB and 25 megapixels. Images are decoded, resized to fit 1800 pixels,
converted to WebP, and stripped of metadata. Image descriptions are optional;
an event-title fallback labels images when blank. Public posters use about half
the detail column on desktop, full width on phones, and open larger when clicked. Removing an image from a draft does not alter the published event.
Images remain private until referenced by a published event, and become private
again on unpublish or archive. Stored files remain available for edit history.

- **Save draft** keeps changes private. A date is optional until publication.
- **Preview** opens the actual public website in a private desktop/mobile preview,
  including unsaved text and images. **Try RSVP preview** lets you fill in answers
  and choose **Preview admin result** to see a sample response. Trial answers stay
  in memory and never call the submission API. Other navigation stays disabled. Draft content is passed only between
  the officer's browser windows, without putting it in a public URL or API.
- **Publish event** updates the public calendar, event search, Latest, and RSVP
  eligibility. Scheduled events require a date; potential events may show TBD. Times are optional.
- Clear **Accept RSVPs** and publish to close new registrations.
- **Unpublish** removes the event from the public calendar and prevents new
  registrations. Draft content, previous RSVPs, and edit history are retained.
- **Duplicate event** starts a separate draft with the current details.
- **Archive event** moves a saved event into **Archived** and removes it from
  the public calendar. Save any current edits first. Content, images, RSVPs,
  and revision history are retained. Archived events remain editable; saving
  changes keeps them archived and private.
- **Restore as draft** returns an archived event to **Active**, with the same
  event ID and saved content. It remains private until **Publish event** is
  selected. Existing RSVP records stay associated with the event.

Public pages refresh events when opened, when returning to the tab, and every
minute. Saving a draft of a published event leaves the public version intact.
If someone else edits the same event, the save is rejected and your text remains
in the form. Copy it, refresh the list, and review the latest saved version.
The editor also warns before leaving unsaved changes.

The editor shows **Last updated by** with the officer's account and the saved
timestamp. **Activity history** lists draft saves, publication, unpublishing,
archiving, and restoration, newest first. Every entry includes the actor and
the date and time in Central Time (CST/CDT), including seconds. **Load older
activity** retrieves earlier changes. Existing recorded history is included;
events imported from the website have no office history until an officer saves
a change. Previewing or typing without saving does not create a history entry.
Activity is visible only to signed-in officers and clears on sign-out.

The workshop **AI + Programming for Everyone: From Messy Data to Useful
Answers** is intended to remain a private draft with blank date, time, and
location until those details are decided. No workshop email is sent.

## Deployment and operations

Apply `008_event_archive.sql` after migrations 006 and 007 and before deploying
the archive interface. It adds `archived_at`, prevents an archived row from
having published content, and permits archive/restore revision history. It
does not delete or automatically archive any events. Keep this migration on
rollback; any replacement API must also enforce the archived-state restriction.

Apply `007_office_tools.sql` before deploying the office enhancements. It adds
shared event types, image metadata and the question submission kind. It leaves
existing events, submissions, accounts and history intact. The existing private
Blob store is reused; no public bucket or new secrets are needed.

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
   Neon delivers sign-in codes through its configured email provider. The club
   proxy permits sign-in codes only for approved emails, always uses the
   sign-in purpose, and limits code requests and verification attempts.
   It does not expose password login, signup, or password reset endpoints.
   Register `https://dallasai-leaderboard.vercel.app` and
   `https://dallasai-forms-preview.vercel.app` as trusted domains in the branch's
   Auth configuration before testing.
4. Deploy a protected Vercel preview and verify sign-in with an approved account.
   The same-origin proxy exposes only session lookup, email sign-in codes,
   code verification, and sign-out. Every admin data request checks the upstream
   session without cookie caching and checks the current allowlist and role.
5. Deploy Vercel production, verify `/api/events` and `/admin/`, then publish
   the public site. `EVENTS_API_URL` and `ADMIN_URL` in `data/club.json` point
   to that production deployment. Hugo params `eventsAPIURL` and `adminURL`
   can override them for previews.

Old self-hosted accounts and the authentication implementation remain available
for a deliberate rollback to the previous deployment; removing `NEON_AUTH_URL`
alone does not give the new email-code interface a password screen. Do not delete
old accounts or tables as part of this release.

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
conflict recovery, closed registration, archive/edit/restore/republish with
retained images and RSVPs, unpublishing, the approved Studio design and office
logo at desktop and mobile widths, and sign-out/sign-in. Unit tests cover transactional history, validation, public
versus private data, authorization, Central daylight-saving changes, and RSVPs.
Live checks must not publish synthetic test events or send emails.

## Reading and formatting events

Selecting an existing event opens a read-only details view, including its saved content and activity history. Choose **Edit event** before changing fields, or **Cancel editing** to return to saved details. Creating a new event opens the editor directly. Successful saves and publication return to read-only details with a focused confirmation showing the event name and Central timestamp. Drafts are explicitly private until published.

Select text in Description, audience, or the RSVP introduction and use **Bold**, **Italic**, **Heading**, **Bullets**, or **Numbered list**. Blank lines separate paragraphs. The controls insert simple text markers; **Preview** displays the formatted result. HTML and embedded content are shown as text. The same safe renderer serves public details, private previews, and the office read-only view.

Learning outcomes, agenda, and preparation keep one item per line, with Bold and Italic controls. Agenda lines such as `20 minutes · Welcome · Meet the team` display the duration beside the activity and its description. Existing plain text remains supported.

The public Events page uses normal page scrolling, compact monthly lists, and potential events above the calendar. Selecting an event on smaller screens jumps to its details; the RSVP button appears near the title.
