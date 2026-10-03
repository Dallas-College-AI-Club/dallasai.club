BEGIN;
ALTER TABLE club_forms.contacts ADD COLUMN IF NOT EXISTS name_locked boolean NOT NULL DEFAULT false;
ALTER TABLE club_forms.contact_activity DROP CONSTRAINT IF EXISTS contact_activity_action_check;
ALTER TABLE club_forms.contact_activity ADD CONSTRAINT contact_activity_action_check
  CHECK(action IN ('Merged contact','Contact deleted','Contact restored','Marked as test','Unmarked as test','Contact edited','Unused address removed'));
CREATE OR REPLACE FUNCTION club_forms.capture_contact() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, club_forms AS $$
DECLARE canonical_email text;
BEGIN
  LOCK TABLE club_forms.contacts IN SHARE ROW EXCLUSIVE MODE;
  SELECT contact_email INTO canonical_email FROM club_forms.contact_emails WHERE email=NEW.email;
  IF canonical_email IS NULL THEN
    canonical_email := NEW.email;
    INSERT INTO club_forms.contacts(email,name,first_seen,last_seen)
    VALUES(NEW.email,NEW.name,NEW.created_at,NEW.updated_at) ON CONFLICT(email) DO NOTHING;
    INSERT INTO club_forms.contact_emails(email,contact_email) VALUES(NEW.email,NEW.email) ON CONFLICT(email) DO NOTHING;
  END IF;
  UPDATE club_forms.contacts SET
    name = CASE WHEN NOT name_locked AND NEW.name<>'' AND NEW.updated_at>=last_seen THEN NEW.name ELSE name END,
    first_seen=least(first_seen,NEW.created_at),last_seen=greatest(last_seen,NEW.updated_at),revision=revision+1
  WHERE email=canonical_email;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT UPDATE(email) ON club_forms.contact_activity TO club_forms_api;
  END IF;
END $$;
COMMIT;
