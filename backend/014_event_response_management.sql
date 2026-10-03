BEGIN;
-- Management state is separate from immutable question/answer snapshots.
CREATE TABLE IF NOT EXISTS club_forms.survey_response_state (
  entry_id uuid PRIMARY KEY REFERENCES club_forms.survey_responses(entry_id) ON DELETE CASCADE,
  starred boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);
CREATE TABLE IF NOT EXISTS club_forms.contacts (
  email text PRIMARY KEY CHECK (email = lower(trim(email))),
  name text NOT NULL DEFAULT '',
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL
);
INSERT INTO club_forms.contacts(email,name,first_seen,last_seen)
SELECT email, coalesce((array_agg(name ORDER BY created_at DESC,id) FILTER (WHERE name<>''))[1],''), min(created_at),max(created_at)
FROM club_forms.entries GROUP BY email
ON CONFLICT(email) DO NOTHING;
CREATE OR REPLACE FUNCTION club_forms.capture_contact() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, club_forms AS $$
BEGIN
  INSERT INTO club_forms.contacts(email,name,first_seen,last_seen)
  VALUES (NEW.email,NEW.name,NEW.created_at,NEW.updated_at)
  ON CONFLICT(email) DO UPDATE SET
    name = CASE WHEN EXCLUDED.name<>'' AND EXCLUDED.last_seen>=club_forms.contacts.last_seen THEN EXCLUDED.name ELSE club_forms.contacts.name END,
    first_seen = least(club_forms.contacts.first_seen,EXCLUDED.first_seen),
    last_seen = greatest(club_forms.contacts.last_seen,EXCLUDED.last_seen);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS entry_contact ON club_forms.entries;
CREATE TRIGGER entry_contact AFTER INSERT OR UPDATE OF email,name ON club_forms.entries
FOR EACH ROW EXECUTE FUNCTION club_forms.capture_contact();
CREATE INDEX IF NOT EXISTS entries_contact_idx ON club_forms.entries(email,created_at DESC);
CREATE TABLE IF NOT EXISTS club_forms.contact_notes (
  id uuid PRIMARY KEY,
  email text NOT NULL REFERENCES club_forms.contacts(email),
  author_email text NOT NULL,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_notes_email_idx ON club_forms.contact_notes(email,created_at DESC);
REVOKE ALL ON club_forms.contacts,club_forms.contact_notes,club_forms.survey_response_state FROM PUBLIC;
REVOKE ALL ON FUNCTION club_forms.capture_contact() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT SELECT,INSERT,UPDATE ON club_forms.contacts,club_forms.survey_response_state TO club_forms_api;
    GRANT SELECT,INSERT ON club_forms.contact_notes TO club_forms_api;
    GRANT EXECUTE ON FUNCTION club_forms.capture_contact() TO club_forms_api;
  END IF;
END $$;
COMMIT;
