BEGIN;
CREATE SCHEMA IF NOT EXISTS club_forms;
REVOKE ALL ON SCHEMA club_forms FROM PUBLIC;

CREATE TABLE IF NOT EXISTS club_forms.entries (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('subscribe','join','rsvp','contribution','workshop')),
  email text NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  name text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}',
  dedupe_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','unsubscribed','cancelled','suppressed')),
  review_status text NOT NULL DEFAULT 'new' CHECK (review_status IN ('new','reviewed','closed')),
  email_verified boolean NOT NULL DEFAULT false,
  consent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entries_created_idx ON club_forms.entries (created_at DESC, id);
CREATE INDEX IF NOT EXISTS entries_review_idx ON club_forms.entries (review_status, kind);
CREATE TABLE IF NOT EXISTS club_forms.attachments (
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES club_forms.entries(id) ON DELETE CASCADE,
  name text NOT NULL,
  pathname text NOT NULL UNIQUE,
  content_type text NOT NULL,
  size integer NOT NULL CHECK (size > 0 AND size <= 2097152)
);
CREATE TABLE IF NOT EXISTS club_forms.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES club_forms.entries(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('notify','receipt','newsletter')),
  dedupe_key text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  lease uuid,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON club_forms.outbox (available_at) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS club_forms.rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS club_forms.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor text NOT NULL,
  entry_id uuid REFERENCES club_forms.entries(id) ON DELETE SET NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS club_forms.webhook_events (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Queue alerts in the same transaction as the record, including administrative imports.
CREATE OR REPLACE FUNCTION club_forms.queue_new_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, club_forms AS $$
BEGIN
  INSERT INTO club_forms.outbox(entry_id,kind,dedupe_key)
  VALUES (NEW.id,'notify','notify:' || NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS entry_notification ON club_forms.entries;
CREATE TRIGGER entry_notification AFTER INSERT ON club_forms.entries
FOR EACH ROW EXECUTE FUNCTION club_forms.queue_new_entry();
REVOKE ALL ON ALL TABLES IN SCHEMA club_forms FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_forms FROM PUBLIC;
COMMIT;
