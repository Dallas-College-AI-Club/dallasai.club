BEGIN;
-- Draft and live content are separate: saving an edit never changes the calendar.
CREATE TABLE IF NOT EXISTS club_forms.events (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  draft jsonb NOT NULL,
  published jsonb,
  revision integer NOT NULL DEFAULT 0,
  published_revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  published_at timestamptz
);
CREATE TABLE IF NOT EXISTS club_forms.event_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL REFERENCES club_forms.events(id),
  revision integer NOT NULL,
  action text NOT NULL CHECK (action IN ('draft','publish','unpublish')),
  actor text NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, revision)
);
REVOKE ALL ON club_forms.events, club_forms.event_history FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT SELECT,INSERT,UPDATE ON club_forms.events TO club_forms_api;
    GRANT SELECT,INSERT ON club_forms.event_history TO club_forms_api;
    GRANT USAGE,SELECT ON SEQUENCE club_forms.event_history_id_seq TO club_forms_api;
  END IF;
END $$;
COMMIT;
