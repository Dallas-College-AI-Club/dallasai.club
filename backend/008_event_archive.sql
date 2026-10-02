BEGIN;
ALTER TABLE club_forms.events ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE club_forms.events DROP CONSTRAINT IF EXISTS events_archive_private;
ALTER TABLE club_forms.events ADD CONSTRAINT events_archive_private
  CHECK (archived_at IS NULL OR published IS NULL);
ALTER TABLE club_forms.event_history DROP CONSTRAINT IF EXISTS event_history_action_check;
ALTER TABLE club_forms.event_history ADD CONSTRAINT event_history_action_check
  CHECK (action IN ('draft','publish','unpublish','archive','restore'));
COMMIT;
