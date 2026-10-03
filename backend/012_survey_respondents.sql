BEGIN;
ALTER TABLE club_forms.custom_surveys ADD COLUMN IF NOT EXISTS roster_revision integer NOT NULL DEFAULT 0;
ALTER TABLE club_forms.custom_survey_responses ADD COLUMN IF NOT EXISTS shared_with text[];
UPDATE club_forms.custom_survey_responses r SET shared_with=ARRAY(
  SELECT m.advisor_id FROM club_forms.custom_survey_members m
  WHERE m.survey_id=r.survey_id AND m.active AND m.advisor_id<>r.advisor_id
) WHERE shared_with IS NULL;
ALTER TABLE club_forms.custom_survey_responses ALTER COLUMN shared_with SET DEFAULT '{}';
ALTER TABLE club_forms.custom_survey_responses ALTER COLUMN shared_with SET NOT NULL;
CREATE TABLE IF NOT EXISTS club_forms.custom_survey_activity (
  id uuid PRIMARY KEY,
  survey_id uuid NOT NULL REFERENCES club_forms.custom_surveys(id),
  advisor_id text NOT NULL,
  action text NOT NULL CHECK(action IN ('respondent_added','respondent_restored','respondent_removed')),
  actor_id text,
  actor_email text NOT NULL,
  respondent_name text NOT NULL,
  respondent_email text NOT NULL,
  revision integer NOT NULL,
  request_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(survey_id,advisor_id) REFERENCES club_forms.custom_survey_members(survey_id,advisor_id)
);
CREATE INDEX IF NOT EXISTS custom_survey_activity_round ON club_forms.custom_survey_activity(survey_id,created_at DESC);
REVOKE ALL ON club_forms.custom_survey_activity FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT SELECT,INSERT ON club_forms.custom_survey_activity TO club_forms_api;
    GRANT UPDATE(roster_revision) ON club_forms.custom_surveys TO club_forms_api;
    GRANT INSERT,UPDATE(active,display_name) ON club_forms.custom_survey_members TO club_forms_api;
  END IF;
END $$;
COMMIT;
