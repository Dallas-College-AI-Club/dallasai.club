BEGIN;
ALTER TABLE club_forms.entries DROP CONSTRAINT IF EXISTS entries_kind_check;
ALTER TABLE club_forms.entries ADD CONSTRAINT entries_kind_check CHECK (kind IN ('subscribe','join','rsvp','contribution','workshop','question'));
CREATE TABLE IF NOT EXISTS club_forms.event_types (
  name text PRIMARY KEY CHECK (length(name) BETWEEN 1 AND 80),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_types_name_idx ON club_forms.event_types (lower(name));
CREATE TABLE IF NOT EXISTS club_forms.event_images (
  id uuid PRIMARY KEY,
  pathname text NOT NULL UNIQUE,
  width integer NOT NULL,
  height integer NOT NULL,
  size integer NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON club_forms.event_types, club_forms.event_images FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT SELECT,INSERT ON club_forms.event_types, club_forms.event_images TO club_forms_api;
  END IF;
END $$;
COMMIT;
