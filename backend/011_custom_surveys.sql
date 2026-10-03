BEGIN;
CREATE TABLE IF NOT EXISTS club_forms.custom_surveys (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  content_version text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','archived')),
  link_digest text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS club_forms.custom_survey_members (
  survey_id uuid NOT NULL REFERENCES club_forms.custom_surveys(id),
  advisor_id text NOT NULL,
  display_name text NOT NULL,
  email text NOT NULL CHECK (email=lower(email)),
  user_id text,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (survey_id,advisor_id),
  UNIQUE (survey_id,email),
  UNIQUE (survey_id,user_id)
);
-- One current replacement snapshot: omitted old answers are not retained here.
CREATE TABLE IF NOT EXISTS club_forms.custom_survey_responses (
  survey_id uuid NOT NULL,
  advisor_id text NOT NULL,
  revision integer NOT NULL CHECK (revision>0),
  responses jsonb NOT NULL CHECK (jsonb_typeof(responses)='array'),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (survey_id,advisor_id),
  FOREIGN KEY (survey_id,advisor_id) REFERENCES club_forms.custom_survey_members(survey_id,advisor_id)
);
-- Receipts retain a digest, never a historical copy of withdrawn answers.
CREATE TABLE IF NOT EXISTS club_forms.custom_survey_receipts (
  id uuid PRIMARY KEY,
  survey_id uuid NOT NULL,
  advisor_id text NOT NULL,
  revision integer NOT NULL,
  request_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (survey_id,advisor_id) REFERENCES club_forms.custom_survey_members(survey_id,advisor_id)
);
CREATE TABLE IF NOT EXISTS club_forms.custom_survey_devices (
  token_digest text PRIMARY KEY,
  survey_id uuid NOT NULL,
  advisor_id text NOT NULL,
  user_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (survey_id,advisor_id) REFERENCES club_forms.custom_survey_members(survey_id,advisor_id)
);
REVOKE ALL ON club_forms.custom_survey_devices FROM PUBLIC;
REVOKE ALL ON club_forms.custom_surveys,club_forms.custom_survey_members,club_forms.custom_survey_responses,club_forms.custom_survey_receipts FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT SELECT ON club_forms.custom_surveys TO club_forms_api;
    -- PostgreSQL row locks require UPDATE privilege on at least one column.
    GRANT UPDATE(status) ON club_forms.custom_surveys TO club_forms_api;
    GRANT SELECT,UPDATE(user_id) ON club_forms.custom_survey_members TO club_forms_api;
    GRANT SELECT,INSERT,UPDATE ON club_forms.custom_survey_responses TO club_forms_api;
    GRANT SELECT,INSERT ON club_forms.custom_survey_receipts TO club_forms_api;
    GRANT SELECT,INSERT,UPDATE(revoked_at) ON club_forms.custom_survey_devices TO club_forms_api;
  END IF;
END $$;
COMMIT;
