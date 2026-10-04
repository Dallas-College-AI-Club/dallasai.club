BEGIN;
ALTER TABLE club_forms.help_entries ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'everyday'
  CHECK (category IN ('everyday','essentials'));
-- No foreign key: receipts survive permanent deletion, without retaining text.
ALTER TABLE club_forms.audit ADD COLUMN IF NOT EXISTS help_topic_id uuid;
CREATE INDEX IF NOT EXISTS audit_help_topic ON club_forms.audit(help_topic_id,id DESC)
  WHERE help_topic_id IS NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT UPDATE(category) ON club_forms.help_entries TO club_forms_api;
  END IF;
END $$;
-- Stable addresses for the built-in guide. Never overwrite officer edits or
-- resurrect a deleted article when this migration is run again.
WITH topics(id,title,category,body) AS (VALUES
('00000000-0000-4000-8000-000000000101'::uuid,'Review the inbox','everyday',$help$New needs review. Reviewed means an officer has seen it. Archived keeps the record for later.

1. Open Inbox and choose a submission.
2. Read the message and any answers.
3. Mark reviewed or archive. Use the email link when a reply is needed.

Reviewing or archiving does not send a reply, unsubscribe anyone, publish an article, or delete a record. You can restore an archived submission to New or Reviewed.$help$),
('00000000-0000-4000-8000-000000000102','Create an event survey','everyday',$help$An event can have registration questions and a separate feedback survey. Both stay linked to the event.

1. In Events, save the event. RSVP questions are answered during registration; their results appear under Surveys → RSVP answers.
2. Choose Create event survey from the saved event, or Create survey in Surveys and select the event.
3. Edit the questions, preview the form, then publish it.
4. Copy its link or download its QR code to share with attendees.

The feedback link is separate from RSVP registration. Results remain available after the event ends or is archived.$help$),
('00000000-0000-4000-8000-000000000103','Reuse a survey','everyday',$help$Duplicate a survey to start a fresh round with the same questions.

1. Open the survey in Surveys and choose Duplicate survey.
2. Review the new draft, title, event link, dates, and access settings.
3. Publish the copy and share its new link or QR code.

The copy has new question IDs and its own address. Existing responses and invitations stay with the original survey.$help$),
('00000000-0000-4000-8000-000000000104','Download answers','everyday',$help$Exports use the filters you can see. Each download is logged.

1. In Inbox, choose a status, submission type, or event, then Export filtered CSV.
2. For detailed RSVP answers, open Surveys → RSVP answers. Choose an event and export the matching responses.
3. For a separate survey, open it in Surveys and use its response export or summary tools.

Inbox exports allow up to 10,000 matching records. Survey CSV headers use the saved question labels; answers remain attached to their original question IDs and versions when questions change.$help$),
('00000000-0000-4000-8000-000000000105','Where submissions arrive','everyday',$help$Website forms save into the shared club database. A successful submission shows a confirmation screen with Close or Done.

Join the club → Signups.
Subscribe to The AI Review → The AI Review.
Contribute an article / Start a draft → Articles after submitting.
Event RSVP → RSVPs, with detailed answers in Surveys → RSVP answers.
Request a workshop → Workshops.
Ask about this event / Ask the club → Questions.

Game scores go to Rankings. Teams opens the club community. A saved writing draft stays on the visitor’s device until submitted. Subscription requests are saved; newsletter broadcasts are not enabled.$help$),
('00000000-0000-4000-8000-000000000106','Sign-in and appearance','essentials',$help$Use your approved officer email to sign in with the emailed code. Your session lasts three days on this browser.

1. Choose Light, Dark, or System in the appearance controls. System follows your device preference.
2. If your session expires while working, sign in again as the same officer to continue with your unsaved work.
3. Sign out when finished on a shared device. This clears the page and signs out other Club Office tabs in this browser.

Unsaved text stays in this tab’s memory only. Saved topics and submissions are shared with other officers.$help$),
('00000000-0000-4000-8000-000000000107','New submissions and alerts','essentials',$help$Club Office checks for new submissions every minute while open and when you return to the tab.

1. Watch the Inbox count for new arrivals.
2. Choose the new submissions button to load them. The list stays in place until you do.
3. Turn on Browser alerts in the account menu for pop-ups while this tab is open.

Email alerts are not enabled.$help$),
('00000000-0000-4000-8000-000000000108','Keep this guide up to date','essentials',$help$Officers can add instructions to this shared guide. Every saved change records who made it and when.

1. Choose Add topic, give it a clear title, and choose a category.
2. Write short paragraphs or numbered steps, then Save topic.
3. Use Edit topic to update instructions, History to see changes, or Copy topic link to share the exact article with another officer.
4. Archive outdated topics. In Archived, restore a topic or delete it permanently.

Permanent deletion removes the topic’s text. Its action receipts remain in Activity. Topic links still require officer sign-in.$help$),
('00000000-0000-4000-8000-000000000109','Privacy and shared records','essentials',$help$Only signed-in officers can see this guide and the club’s private submissions.

1. Keep personal information out of topic titles and instructions unless it is needed for club work.
2. Share topic links with approved officers. Links contain a topic ID, never its text or an email address.
3. Use the contact and submission controls for their intended record-management tasks.

Signing out clears this page. Unsaved notes are held in memory, and page titles and addresses do not include a submitter’s name or email.$help$)
), inserted AS (
  INSERT INTO club_forms.help_entries(id,title,category,body,created_by,updated_by)
  SELECT id,title,category,body,'club-office','club-office' FROM topics t
  WHERE NOT EXISTS (SELECT 1 FROM club_forms.audit a WHERE a.help_topic_id=t.id AND a.action='help-deleted')
  ON CONFLICT(id) DO NOTHING RETURNING id
)
INSERT INTO club_forms.audit(actor,action,help_topic_id)
SELECT 'club-office','help-created',id FROM inserted;
COMMIT;
