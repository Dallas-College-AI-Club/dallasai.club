-- Preserve existing schema/history; this release uses on-screen confirmations.
BEGIN;
DROP TRIGGER IF EXISTS entry_notification ON club_forms.entries;
ALTER TABLE club_forms.entries ALTER COLUMN state SET DEFAULT 'active';
COMMIT;
