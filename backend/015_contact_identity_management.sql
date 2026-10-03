BEGIN;
ALTER TABLE club_forms.contacts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE club_forms.contacts ADD COLUMN IF NOT EXISTS deleted_by text;
ALTER TABLE club_forms.contacts ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE club_forms.contacts ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
-- Original email records remain intact; links identify the contact to display.
CREATE TABLE IF NOT EXISTS club_forms.contact_emails (
  email text PRIMARY KEY REFERENCES club_forms.contacts(email),
  contact_email text NOT NULL REFERENCES club_forms.contacts(email)
);
CREATE INDEX IF NOT EXISTS contact_emails_contact_idx ON club_forms.contact_emails(contact_email);
INSERT INTO club_forms.contact_emails(email,contact_email)
SELECT email,email FROM club_forms.contacts ON CONFLICT(email) DO NOTHING;
CREATE TABLE IF NOT EXISTS club_forms.contact_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL REFERENCES club_forms.contacts(email),
  actor text NOT NULL,
  action text NOT NULL CHECK(action IN ('Merged contact','Contact deleted','Contact restored','Marked as test','Unmarked as test')),
  details text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_activity_email_idx ON club_forms.contact_activity(email,created_at DESC);
-- Durable cleanup survives a temporary storage outage after a test contact is erased.
CREATE TABLE IF NOT EXISTS club_forms.contact_file_deletions (
  pathname text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION club_forms.capture_contact() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, club_forms AS $$
DECLARE canonical_email text;
BEGIN
  -- Serialize identity changes and capture so a merge cannot recreate a duplicate.
  LOCK TABLE club_forms.contacts IN SHARE ROW EXCLUSIVE MODE;
  SELECT contact_email INTO canonical_email FROM club_forms.contact_emails WHERE email=NEW.email;
  IF canonical_email IS NULL THEN
    canonical_email := NEW.email;
    INSERT INTO club_forms.contacts(email,name,first_seen,last_seen)
    VALUES(NEW.email,NEW.name,NEW.created_at,NEW.updated_at) ON CONFLICT(email) DO NOTHING;
    INSERT INTO club_forms.contact_emails(email,contact_email) VALUES(NEW.email,NEW.email) ON CONFLICT(email) DO NOTHING;
  END IF;
  UPDATE club_forms.contacts SET
    name = CASE WHEN NEW.name<>'' AND NEW.updated_at>=last_seen THEN NEW.name ELSE name END,
    first_seen=least(first_seen,NEW.created_at),last_seen=greatest(last_seen,NEW.updated_at),revision=revision+1
  WHERE email=canonical_email;
  RETURN NEW;
END;
$$;
REVOKE ALL ON club_forms.contact_emails,club_forms.contact_activity,club_forms.contact_file_deletions FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON club_forms.contact_emails TO club_forms_api;
    GRANT SELECT,INSERT,DELETE ON club_forms.contact_activity,club_forms.contact_file_deletions TO club_forms_api;
    GRANT DELETE ON club_forms.contacts,club_forms.contact_notes,club_forms.audit,club_forms.entries TO club_forms_api;
  END IF;
END $$;
COMMIT;
