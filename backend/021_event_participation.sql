BEGIN;
-- Attendance is an officer observation, independent of registration and answers.
CREATE TABLE IF NOT EXISTS club_forms.event_attendance (
  event_id text NOT NULL CHECK (event_id ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  email text NOT NULL REFERENCES club_forms.contact_emails(email) ON DELETE CASCADE,
  attendance text NOT NULL CHECK (attendance IN ('not_recorded','attended','did_not_attend')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  PRIMARY KEY(event_id,email),
  CHECK (email=lower(trim(email)))
);
CREATE INDEX IF NOT EXISTS custom_surveys_linked_event
  ON club_forms.custom_surveys((definition->>'eventId'));
-- Every RSVP participates, even if the event had no registration questions.
INSERT INTO club_forms.survey_responses(entry_id,event_id,event_title,event_date,potential,survey_version,questions,answers,created_at)
SELECT id,data->>'eventId',coalesce(data->>'eventTitle',''),coalesce(data->>'eventDate',''),
  coalesce(data->'potential'='true'::jsonb,false),'','[]'::jsonb,'[]'::jsonb,created_at
FROM club_forms.entries
WHERE kind='rsvp' AND data->>'eventId' ~ '^[a-z0-9][a-z0-9-]{0,99}$'
ON CONFLICT(entry_id) DO NOTHING;
REVOKE ALL ON club_forms.event_attendance FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='club_forms_api') THEN
    GRANT SELECT,INSERT,UPDATE ON club_forms.event_attendance TO club_forms_api;
  END IF;
END $$;
COMMIT;
