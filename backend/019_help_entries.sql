BEGIN;
-- Officers' own Help topics, shown beside the built-in ones. They live only
-- here, never in the public repository. revision guards concurrent edits.
CREATE TABLE IF NOT EXISTS club_forms.help_entries (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  archived boolean NOT NULL DEFAULT false,
  created_by text NOT NULL CHECK (created_by=lower(created_by)),
  updated_by text NOT NULL CHECK (updated_by=lower(updated_by)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0)
);
CREATE INDEX IF NOT EXISTS help_entries_order
  ON club_forms.help_entries(archived,updated_at DESC);
REVOKE ALL ON club_forms.help_entries FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE(title,body,archived,updated_by,updated_at,revision)
      ON club_forms.help_entries TO club_forms_api;
  END IF;
END $$;
COMMIT;
