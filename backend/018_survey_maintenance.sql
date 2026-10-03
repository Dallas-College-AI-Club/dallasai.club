BEGIN;
-- Match the revision ordering used by the officer history views.
CREATE INDEX IF NOT EXISTS custom_survey_activity_revision
  ON club_forms.custom_survey_activity(survey_id,revision DESC);
CREATE INDEX IF NOT EXISTS custom_survey_changes_revision
  ON club_forms.custom_survey_changes(survey_id,revision DESC);
CREATE INDEX IF NOT EXISTS custom_survey_activity_removed
  ON club_forms.custom_survey_activity(survey_id,advisor_id,created_at DESC)
  WHERE action='respondent_removed';
-- These timestamp-only indexes are superseded by the actual read patterns above.
DROP INDEX IF EXISTS club_forms.custom_survey_activity_round;
DROP INDEX IF EXISTS club_forms.custom_survey_changes_round;
-- Revoke a respondent's active devices without scanning other surveys.
CREATE INDEX IF NOT EXISTS custom_survey_devices_member
  ON club_forms.custom_survey_devices(survey_id,advisor_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS custom_survey_devices_expiry
  ON club_forms.custom_survey_devices(expires_at);
REVOKE ALL ON club_forms.custom_survey_devices FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT DELETE ON club_forms.custom_survey_devices TO club_forms_api;
  END IF;
END $$;
COMMIT;
