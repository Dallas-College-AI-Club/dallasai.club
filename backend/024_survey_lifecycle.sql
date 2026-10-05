BEGIN;
ALTER TABLE club_forms.custom_survey_responses ADD COLUMN IF NOT EXISTS response_definition jsonb;
ALTER TABLE club_forms.custom_survey_changes DROP CONSTRAINT IF EXISTS custom_survey_changes_action_check;
ALTER TABLE club_forms.custom_survey_changes ADD CONSTRAINT custom_survey_changes_action_check
  CHECK(action IN ('draft_saved','published','closed','editing','archived','restored','deleted'));
ALTER TABLE club_forms.custom_survey_changes ALTER COLUMN survey_id DROP NOT NULL;
ALTER TABLE club_forms.custom_survey_changes DROP CONSTRAINT IF EXISTS custom_survey_changes_survey_id_fkey;
ALTER TABLE club_forms.custom_survey_changes ADD CONSTRAINT custom_survey_changes_survey_id_fkey
  FOREIGN KEY(survey_id) REFERENCES club_forms.custom_surveys(id) ON DELETE SET NULL;
ALTER TABLE club_forms.custom_survey_activity DROP CONSTRAINT IF EXISTS custom_survey_activity_action_check;
ALTER TABLE club_forms.custom_survey_activity ADD CONSTRAINT custom_survey_activity_action_check
  CHECK(action IN ('respondent_added','respondent_restored','respondent_removed','respondent_registered','response_deleted'));
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT UPDATE(content_version) ON club_forms.custom_surveys TO club_forms_api;
    GRANT UPDATE(response_definition) ON club_forms.custom_survey_responses TO club_forms_api;
    GRANT DELETE ON club_forms.custom_survey_responses,club_forms.custom_survey_receipts,club_forms.custom_survey_devices TO club_forms_api;
    GRANT DELETE ON club_forms.custom_surveys,club_forms.custom_survey_members,club_forms.custom_survey_activity TO club_forms_api;
  END IF;
END $$;
COMMIT;
