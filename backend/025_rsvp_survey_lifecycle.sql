BEGIN;
-- RSVP registration has its own lifecycle; the public event remains intact.
ALTER TABLE club_forms.events ADD COLUMN IF NOT EXISTS rsvp_survey_status text NOT NULL DEFAULT 'active';
ALTER TABLE club_forms.events DROP CONSTRAINT IF EXISTS events_rsvp_survey_status_check;
ALTER TABLE club_forms.events ADD CONSTRAINT events_rsvp_survey_status_check
  CHECK (rsvp_survey_status IN ('active','archived','deleted'));
ALTER TABLE club_forms.event_history DROP CONSTRAINT IF EXISTS event_history_action_check;
ALTER TABLE club_forms.event_history ADD CONSTRAINT event_history_action_check
  CHECK (action IN ('draft','publish','unpublish','archive','restore',
    'rsvp-survey-archive','rsvp-survey-restore','rsvp-survey-delete'));
-- Lifecycle receipts contain only request metadata, never respondent data.
CREATE UNIQUE INDEX IF NOT EXISTS event_history_rsvp_request
  ON club_forms.event_history((content->>'requestId'))
  WHERE action IN ('rsvp-survey-archive','rsvp-survey-restore','rsvp-survey-delete');
COMMIT;
