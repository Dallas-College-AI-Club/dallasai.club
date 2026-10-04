BEGIN;
ALTER TABLE club_forms.custom_surveys ADD COLUMN IF NOT EXISTS short_link text DEFAULT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT UPDATE(short_link) ON club_forms.custom_surveys TO club_forms_api;
  END IF;
END $$;
COMMIT;
