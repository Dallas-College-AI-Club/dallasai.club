BEGIN;
CREATE TABLE IF NOT EXISTS club_forms.entry_comments (
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES club_forms.entries(id) ON DELETE CASCADE,
  author_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000)
);
CREATE INDEX IF NOT EXISTS entry_comments_entry_idx ON club_forms.entry_comments(entry_id, created_at DESC);
ALTER TABLE club_forms.audit ADD COLUMN IF NOT EXISTS comment_id uuid REFERENCES club_forms.entry_comments(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS audit_comment_idx ON club_forms.audit(comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_entry_idx ON club_forms.audit(entry_id, id DESC);
REVOKE ALL ON club_forms.entry_comments FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT SELECT,INSERT ON club_forms.entry_comments TO club_forms_api;
  END IF;
END $$;
COMMIT;
