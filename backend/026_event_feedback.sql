BEGIN;
-- Public feedback belongs to its event, independently of RSVP registrations
-- and authenticated custom surveys. Question snapshots survive later edits.
CREATE TABLE IF NOT EXISTS club_forms.event_feedback_responses (
  id uuid PRIMARY KEY,
  event_id text NOT NULL CHECK (event_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  event_title text NOT NULL,
  event_date text NOT NULL,
  email text NOT NULL DEFAULT '',
  request_digest text NOT NULL,
  survey_version text NOT NULL,
  questions jsonb NOT NULL CHECK (jsonb_typeof(questions)='array'),
  answers jsonb NOT NULL CHECK (jsonb_typeof(answers)='array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_feedback_event_created
  ON club_forms.event_feedback_responses(event_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS event_feedback_event_email
  ON club_forms.event_feedback_responses(event_id,email) WHERE email<>'';
REVOKE ALL ON club_forms.event_feedback_responses FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT SELECT,INSERT ON club_forms.event_feedback_responses TO club_forms_api;
  END IF;
END $$;
COMMIT;
