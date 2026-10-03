BEGIN;
ALTER TABLE club_forms.entries ADD COLUMN IF NOT EXISTS edit_revision integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS club_forms.entry_changes (
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('edit-submission','delete-submission')),
  actor text NOT NULL,
  revision integer NOT NULL,
  request_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Receipts intentionally contain no response content, name, or respondent email.
REVOKE ALL ON club_forms.entry_changes FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT SELECT,INSERT ON club_forms.entry_changes TO club_forms_api;
    GRANT UPDATE(answers) ON club_forms.survey_responses TO club_forms_api;
    GRANT UPDATE(name,email,email_verified,data,dedupe_key,edit_revision,updated_at) ON club_forms.entries TO club_forms_api;
  END IF;
END $$;
COMMIT;
