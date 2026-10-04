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

The editor shows **Last updated by** with the officer's account (**You** for your own saves) and the saved
timestamp. **Activity history** lists draft saves, publication, unpublishing,
archiving, and restoration, newest first. Every entry includes the actor and
the date and time in Central Time, shown as CT (for example 'Thu, Oct 2, 11:34 PM CT'). **Load older
activity** retrieves earlier changes. Existing recorded history is included;
events imported from the website have no office history until an officer saves
a change. Previewing or typing without saving does not create a history entry.
Activity is visible only to signed-in officers and clears on sign-out.

Check the current event in Club Office for publication status and confirmed details.
When a scheduled event has no confirmed time or location, the public page should
say that those details are still to be announced.

## Deployment and operations

Use [Operations](operations.md) for service configuration, email-code access,
migration order, release checks, and rollback. Event migrations 006–008 must precede
the editor deployment. They preserve original events, responses, images, and history.
Archived events remain private, and database publication status overrides the
original static registry even during a public API outage.

## RSVP forms and saved data

RSVP forms support short answers, long written answers, single and multiple choices,
dates, times, numbers, email addresses and **Date availability**. Availability is
one question with a grid of up to 31 dates and 1–12 editable periods. Leave
**Required answer** unchecked to allow skipping it. Game Night uses Afternoon and
Evening and requires one availability answer; individual dates do not require a
selection. Other events can use Morning or exact labels such as 18:30–20:00.
Specify the timezone once in the question's help text.

**Not available** and **Not sure yet** apply to all dates and disable the grid.
**Not available** also allows optional alternative dates; **Suggest alternative
dates** asks for at least one. Each suggested date has an optional clock time.
**Clear availability** returns to an unanswered question.

Set **Reply-by date (optional)** to show the deadline in a rounded box on the
event page, RSVP form and officer overview. This is the requested reply date;
**Accept RSVPs** still controls registration. The top of each event and RSVP form
has its public event QR, **Share event**, and **Download QR**. Phones use native
sharing when supported; otherwise Share copies the event link. The existing QR
library generates SVG through the event API without reading respondent data.

First publication creates a stable short link using the same provider as custom
surveys. The public address, Share action and QR all use that saved link. Editing,
archiving or restoring keeps it; duplicating an event creates a different link.
**Open the new short link and QR in tabs to check them after publishing** is on
by default. Clear it to opt out; the setting is saved with the event. Draft saves
do not create links or open tabs. If the browser blocks a tab, the saved overview
retains links to open both checks. If link creation fails, the event still saves
and **Create short link** retries without publishing again.

The data path is deliberately direct:

- `backend/admin/survey-editor.js` edits the event's question definitions.
- `static/app/rsvp-dialog.js` renders both public RSVP and private trial forms.
- `backend/surveys/availability-ui.js` supplies the shared grid for RSVP, custom
  surveys and officer response editing; `availability-values.js` formats results.
- `backend/lib/surveys.mjs` validates the question version and every answer.
- `backend/lib/survey-availability.mjs` validates dates, periods and global states.
- `backend/lib/submissions.mjs` saves the RSVP and its question/answer snapshot in
  one database transaction. A retry returns the original record.
- `backend/lib/survey-report.mjs` reads those saved snapshots for summaries and CSV.

Question IDs identify answers. Publishing revised questions generates a new version;
earlier responses keep their original definitions and meanings. Dates use `YYYY-MM-DD`,
times use `HH:mm`, numbers remain JSON numbers, and emails are trimmed/lowercased.
An availability answer is either an empty string (skipped) or an object with
`status`, `selections: [{date, periods}]`, and `alternatives: [{date, time}]`.
Dates are ISO strings; an omitted suggested time is an empty string. Status is
`available`, `unavailable`, `unsure`, or `alternative`. The server rejects mixed
global states and selected periods, unlisted slots, invalid dates/times and duplicates.
CSV includes a readable answer and separate date/period columns. Older choice
questions retain their labels and optional `choiceDate` metadata unchanged.

Event surveys lists RSVP-enabled events before the first response. Reopening a survey
page starts its dropdown filters at their defaults; a direct event link remains scoped
to that event. Saved responses remain available after closure or archiving.

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
