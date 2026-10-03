BEGIN;
-- One immutable survey snapshot per RSVP. Names/emails remain on the linked entry.
CREATE TABLE IF NOT EXISTS club_forms.survey_responses (
  entry_id uuid PRIMARY KEY REFERENCES club_forms.entries(id) ON DELETE CASCADE,
  event_id text NOT NULL CHECK (event_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  event_title text NOT NULL,
  event_date text NOT NULL DEFAULT '',
  potential boolean NOT NULL DEFAULT false,
  survey_version text NOT NULL,
  questions jsonb NOT NULL CHECK (jsonb_typeof(questions)='array'),
  answers jsonb NOT NULL CHECK (jsonb_typeof(answers)='array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_responses_event_created ON club_forms.survey_responses(event_id,created_at DESC,entry_id);
REVOKE ALL ON club_forms.survey_responses FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    REVOKE UPDATE ON club_forms.survey_responses FROM club_forms_api;
    GRANT SELECT,INSERT,DELETE ON club_forms.survey_responses TO club_forms_api;
  END IF;
END $$;
COMMIT;
