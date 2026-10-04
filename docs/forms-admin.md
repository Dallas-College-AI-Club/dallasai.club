# Forms and the club office

Hugo serves the public website on GitHub Pages. The Vercel backend stores club signups, The AI Review subscription requests, RSVPs, AI Review submissions, workshop requests, and questions in Neon. A successful form shows an on-screen confirmation only after the database transaction commits. The form preserves its content if saving fails. Duplicate membership/subscription requests and RSVPs do not create extra records. When a repeat signup brings different details, they are added to the original entry as a note and the entry returns to New for officers to review.

## How officers learn about a signup

Open the protected backend `/admin/` page. It opens on **Home**, a page of tiles showing what needs officers this week (see below); **Inbox** holds the full list. New submissions appear with review status **New**. Counts update every minute while the office is open. New arrivals show a **N new · Show** button instead of reshuffling the list, and Refresh reloads it immediately. Officers can filter by submission type and review status, review or close submissions, download private attachments, and export up to 10,000 matching records. Name/email search is not shown. The Event RSVPs view, counts and CSV exports include only currently published upcoming events (including potential events with TBD dates); an Event dropdown selects one. Past RSVP records remain stored. Administrative updates, downloads, and exports are logged.

The **Browser alerts** switch in the account menu requests browser permission and shows an alert, with counts by type, when a newer submission arrives. An officer’s own status changes never raise one. The officer must keep the office tab open; browser throttling can delay background checks. New counts and an on-screen notice also update without notification permission. The on/off preference is remembered in this browser and synchronized across office tabs. Alerts stop at sign-out or when the office is closed; reopening the office resumes a remembered on preference only when browser permission is still granted. Email alerts remain disconnected; the UI states this explicitly. Neon login-code delivery is a separate service and does not send inbox alerts.

The office uses the approved Studio appearance with locally served Geist typography. The header shows the black-square club logo (white artwork on black, in light and dark mode alike), the club name and the account button, and the sections are tabs across the top at every width: **Home**, **Inbox** (with the New count), **Events**, **Surveys**, **Contacts** and **Help**. On narrow phones the tabs wrap onto a second line so every tab stays in view, and a focused tab shows its whole focus ring. On wider screens the account menu scrolls with its button. Events uses the Desk layout (event list beside the editor). Count cards and Home tiles with new submissions, and the selected event chip, are highlighted with the selected tint and an accent line; the open submission and the open survey response get the accent line; everything else keeps plain lines. Group labels use small capitals, and unpublished events keep the yellow **DRAFT · Not published** badge. The header offers Light, Dark and System buttons and remembers the choice in this browser. System follows the device appearance. Surveys uses the Quiet Office library, and Help uses the Guidebook reading layout; the rest retains the Studio design. The supplied 500×500 black-on-white and white-on-black logos are used only in the office: the header and sign-in page use the black-square logo, and the favicon follows the light/dark setting. The public website's branding is unchanged.

### Home

**Home** is the landing page (`#/home`; the brand link returns to it). One read of `/api/admin?home=1` fills its tiles, and like the Inbox list it signs the officer in, shares the counts poll and is cleared on sign-out or after ten minutes paused:

- **Needs review** counts every New submission. New RSVPs are grouped by event (cancelled RSVPs are not counted), each with **Show all**, which opens that event's RSVPs in the Inbox (`#/inbox?type=rsvp-all&event=<id>`). The newest other New submissions are listed with **Mark reviewed**, which works like the Inbox button (a typed note is saved with it) and refreshes the counts; **Open inbox** opens the list.
- **Next event** is the first upcoming event with a date: its date, type, RSVP count and **Open event**. Potential events without a date are listed on their own line.
- **Custom survey** is the open custom survey with its response count and link expiry; **Open responses** opens it in Surveys › Custom surveys, where each response's PDF and the CSV export are.
- **Drafts & unpublished changes** shows unpublished events as event cards; choosing one opens it in Events.
- **Inbox totals** include saved and archived records, with past and upcoming RSVPs combined. A separate audited deletion count contributes to the overall total without restoring deleted data. Type links open all saved statuses for that type.
- **Recent activity** is collapsed until opened and lists officers' recent actions (reviews, exports, event and custom-survey changes, Help topic changes). It never shows a member's name, email, comment or submitted text.
- **Quick actions**: **New event**, **Create custom survey** (opens the survey builder) and **Find a contact** (opens Contacts with the search box focused).

While Home is shown, the minute-by-minute check redraws it only when a count has changed.

### Inbox counts and RSVPs by event

The Inbox count cards are folded by default. The fold's summary still says what is new, for example “Counts · 3 new: 2 RSVPs, 1 question”; open it to see each type's New and total counts. Browser alerts use the same wording and keep **The AI Review** capitalized.

RSVPs in the list are grouped by event. Each event group shows how many RSVPs match the current filters in total, not only those on the page, and has **Show all** for that event. The Type filter also offers **RSVPs for all events** (upcoming and past). For any RSVP type, event chips with **All events** appear above the list on wider screens; on phones, and when there are more than eight events, the Event dropdown is used instead. The chosen event stays in the address, and Export filtered CSV follows it.

## Submission activity and comments

**Received in club inbox** means the record is stored in Neon. **Mark reviewed** means an officer has looked at it; **Archive submission** means no further action is planned. Neither action sends a reply, removes the record, unsubscribes a person, or publishes an article. An archived record can be marked new or reviewed again.

Each entry’s **Activity & comments** panel shows existing status-change and attachment-download audit records as well as new comments. It shows the acting officer (your own actions as **You**) and the Central time, newest first, with pagination for older activity. Comments are private to authenticated officers. Unsaved comment text stays in memory during inbox refreshes and is cleared on sign-out; it is persisted only after Add comment succeeds.

Migration `009_submission_comments.sql` adds `club_forms.entry_comments` with separate `entry_id`, `author_email`, `created_at`, and `body` columns. Server authentication supplies the author and the database supplies the timestamp. Comment IDs make retries idempotent; comment and activity insertion share one transaction. Comments remain attached when an entry is closed or reopened. The runtime role can read and insert comments, not edit or delete them.

CSV exports have separate Subject / title and Message / body fields, dedicated membership/event fields, readable labels, Central timestamps, and a record reference instead of a JSON Details cell. Quotes, multiline text, Unicode and spreadsheet formula protection are preserved.

## How people submit

- **The AI Review → Contribute an article** opens the submission page with a title, draft text and optional private attachments. Submit for review saves it under **Articles** and replaces the submitted form with a confirmation screen and Done button. It does not automatically publish an article.
- **Ask about this event** opens a question dialog, carries the event context into the inbox and confirms receipt within the dialog. **Ask the club** in the footer opens the same dialog for a general question.
- **Request a workshop** opens the workshop request dialog. Confirmation replaces the form, with a Close button. Dialog close controls stay visible while scrolling.
- Join and The AI Review subscription requests replace their forms with a focused confirmation screen and Done button. Event RSVPs open a popup with a Close button after submission. Errors preserve the person's entered text.

There are no email alerts, emailed confirmation links, or newsletter broadcasts in this release. The AI Review subscription requests record consent for future updates; email ownership is not verified and `email_verified` remains false. They must not be represented as verified subscribers or automatically enrolled in a future mailing service. The public page explains that newsletters are not currently being sent. People can contact the club to withdraw a request or cancel an RSVP.

## Setup and access

[Operations](operations.md) is the shared reference for email-code officer access,
72-hour sessions, private settings, ordered migrations, local previews, verification,
and deployment. Form emails and newsletters remain disabled; Neon delivers login
codes separately. Apply all migrations required by the features below before release.

When a session ends while an officer is working, Club Office hides the office and asks
the same officer to sign in again. Typed notes, comments, contact notes and unsaved event
or survey edits stay in that tab's memory and are not lost. Requests that were refused are
sent once more after sign-in. Records stay in the hidden page for at most 10 minutes, then
they are dropped. Unsaved work is never written to browser storage. Signing out, or
signing in as a different account, discards it.

## Attachments and privacy

Contributions accept up to three files and 2 MB total: PDF, DOCX, TXT, Markdown, PNG, or JPG. The server checks names, sizes, extensions, and basic file signatures. Files stay private and require admin authorization to download. This is not antivirus scanning. The public privacy page explains the data stored and how to request changes or deletion.

## Verification

`npm test` uses PGlite to test transactions, deduplication, validation, private assets, CSV exports, comment attribution/idempotency, activity pagination and auth/session boundaries without sending email. `node tests/browser.mjs` checks all six forms, mobile confirmations, failed submissions, passwordless sign-in UI, saved alert preferences, comments/history, dark/light logos, and safe rendering against synthetic API responses after a Hugo build to `.preview/forms-site`. `node tests/browser-events.mjs` exercises event editing, image preview, publish/archive/restore and preservation of RSVP input against a local test database. `node tests/browser-site.mjs` audits the public site routes and navigation after a normal Hugo build.

## Potential events and RSVP surveys

The office tabs are **Inbox**, **Events**, **Surveys** and **Help**. In Events, check **Potential event** to publish an idea while leaving its date blank (shown as **TBD**). It appears below the calendar under Potential events and opens the normal event details. It remains eligible for the upcoming RSVP inbox while published. Scheduled events still require a date.

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

**Contacts** is its own tab (`#/contacts`). **Contacts & follow-up** in Inbox and
Event surveys opens the tab's directory, and a survey response's **Contact history**
opens that person directly; email addresses never appear in the address bar. The
tab keeps its search or open person while officers use other tabs. It consolidates
website submissions by normalized email. **Merge with another contact** lets an
officer explicitly link a person's e-number and named school email addresses.
Search for and select the contact to keep, then review **Confirm merge**. Its
primary email is retained. Both email addresses find the same combined history,
including future submissions. Original submission emails, answers and notes are
preserved. Contacts with the same name are never automatically merged.
The directory shows one primary address per person; other addresses are listed
separately inside that person's history. **Edit contact** lets an admin correct
the displayed name and choose an existing or new primary email. Future form
submissions keep the admin-edited name. An address owned by a different contact
must be merged first. Changing the primary address preserves all saved responses
and their original addresses.

The same editor lists linked addresses and offers **Remove unused address** with
a confirmation. Addresses tied to submissions, notes or private survey membership
cannot be removed until those records are corrected or removed. This prevents
cleanup from silently discarding history. Unsubmitted profile edits and follow-up
notes survive closing the contact dialog; Cancel discards profile edits explicitly.
Apply `backend/017_contact_profile_editing.sql` after migration 016 before deploying
these profile controls. Identity changes and alias cleanup are recorded in history.
A contact shows the names used, submitted
messages, Inbox comments, response-management activity and officer follow-up notes.
Notes carry the authenticated author and database timestamp. Retrying a saved note
does not create duplicates. This does not read a mailbox or send emails. Private
standalone-survey drafts and unsubmitted answers are not included.

**Delete contact** removes a regular contact from the Active directory only.
Select **Deleted** and **Restore contact** to bring it back; saved submissions and
notes remain available. New submissions do not silently restore a deleted contact.
**Mark as test**, the filled red button, deletes the contact completely in one step.
Its warning lists the submissions, event survey responses, officer comments, website
notes, follow-up notes, attachments and linked email addresses that will be removed,
and requires typing the primary email in any letter case. Confirmation erases all of
them, with the contact history and aliases. If any of those counts changed after the
warning opened, nothing is deleted and the officer is asked to review the contact
again. This cannot be restored. The audit log keeps a receipt with the acting admin and the
counts removed, without the address. Contacts marked as test before this change keep
**Unmark as test** and **Permanently delete test contact**, which uses the same
warning; regular and test contacts cannot be merged unless their test settings are
first reviewed to match. Concurrent changes invalidate a management confirmation and
require a refresh.

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

## Help guidebook

Help has a searchable topic list, a reading pane, and Topics, Archived and Activity
buttons. Officers add topics directly to the guide under Everyday tasks or Office
essentials. Use short paragraphs and numbered lines for readable steps.

Edit topic, Archive, History and Copy topic link sit above the article. History
expands inline with each action's officer and Central Time timestamp. A copied link
opens that exact topic after officer sign-in and survives renaming. Archived links
open the archived topic with Restore and Delete permanently. Deletion removes the
text; Activity keeps its ID, actor and timestamp. A deleted link explains that the
topic is unavailable. Unsaved edits ask before navigation, and stale saves cannot
overwrite another officer's changes. Starter topics are editable too.

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

Only submissions archived in the Inbox can be deleted permanently, from either the
Inbox or Event surveys. In Archived, **Delete permanently** opens a warning with Cancel selected first.
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
