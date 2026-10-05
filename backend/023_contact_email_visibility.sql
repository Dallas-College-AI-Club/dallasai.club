BEGIN;
-- Retain original identity links for saved records when an address is removed.
ALTER TABLE club_forms.contact_emails ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE club_forms.contact_activity DROP CONSTRAINT IF EXISTS contact_activity_action_check;
ALTER TABLE club_forms.contact_activity ADD CONSTRAINT contact_activity_action_check
  CHECK(action IN ('Merged contact','Contact deleted','Contact restored','Marked as test','Unmarked as test','Contact edited','Unused address removed','Address removed'));
COMMIT;
