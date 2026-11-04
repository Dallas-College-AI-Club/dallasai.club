BEGIN;
ALTER TABLE club_forms.custom_surveys ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE club_forms.custom_survey_changes DROP CONSTRAINT IF EXISTS custom_survey_changes_action_check;
ALTER TABLE club_forms.custom_survey_changes ADD CONSTRAINT custom_survey_changes_action_check
  CHECK(action IN ('draft_saved','published','closed','editing','archived','restored','deleted','expiration_changed'));
COMMIT;
