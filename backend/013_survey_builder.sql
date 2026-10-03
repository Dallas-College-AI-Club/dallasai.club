BEGIN;
ALTER TABLE club_forms.custom_surveys ADD COLUMN IF NOT EXISTS definition jsonb;
ALTER TABLE club_forms.custom_surveys ADD COLUMN IF NOT EXISTS edit_revision integer NOT NULL DEFAULT 0;
ALTER TABLE club_forms.custom_surveys ADD COLUMN IF NOT EXISTS preview_digest text UNIQUE;
ALTER TABLE club_forms.custom_surveys ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE club_forms.custom_survey_activity DROP CONSTRAINT IF EXISTS custom_survey_activity_action_check;
ALTER TABLE club_forms.custom_survey_activity ADD CONSTRAINT custom_survey_activity_action_check CHECK(action IN ('respondent_added','respondent_restored','respondent_removed','respondent_registered'));
CREATE TABLE IF NOT EXISTS club_forms.custom_survey_changes (
  id uuid PRIMARY KEY,
  survey_id uuid NOT NULL REFERENCES club_forms.custom_surveys(id),
  action text NOT NULL CHECK(action IN ('draft_saved','published','closed')),
  actor_email text NOT NULL,
  revision integer NOT NULL,
  request_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_survey_changes_round ON club_forms.custom_survey_changes(survey_id,created_at DESC);
REVOKE ALL ON club_forms.custom_survey_changes FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
  GRANT INSERT,UPDATE(title,definition,edit_revision,expires_at,published_at,preview_digest) ON club_forms.custom_surveys TO club_forms_api;
  GRANT SELECT,INSERT ON club_forms.custom_survey_changes TO club_forms_api;
 END IF;
END $$;
COMMIT;
