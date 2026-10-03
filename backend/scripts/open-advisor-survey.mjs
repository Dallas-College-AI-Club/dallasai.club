import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { definition } from '../lib/survey-contract.mjs';
import { privateSurveyToken, digest } from '../lib/custom-surveys.mjs';

// Run only for the approved environment. No mail is sent by this command.
const members = JSON.parse(process.env.SURVEY_ADVISORS || '[]');
if (
  members.length !== 2 ||
  definition.respondents.some(
    (p) =>
      !members.some(
        (m) => m.id === p.id && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email),
      ),
  )
)
  throw Error('Supply the two approved SURVEY_ADVISORS as [{id,email}].');
if (new Set(members.map((m) => m.email.toLowerCase())).size !== 2)
  throw Error('Each advisor needs a different email.');
const slug = process.env.SURVEY_SLUG || 'advisor-studio-2026';
const pool = new pg.Pool({
  connectionString: process.env.SURVEY_ADMIN_DATABASE_URL,
  connectionTimeoutMillis: 10000,
});
if (!process.env.SURVEY_ADMIN_DATABASE_URL)
  throw Error('Set the approved survey administration connection.');
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const existing = (
    await client.query(
      'SELECT id FROM club_forms.custom_surveys WHERE slug=$1',
      [slug],
    )
  ).rows[0];
  if (existing)
    throw Error('This survey round already exists; it was not modified.');
  const id = randomUUID(),
    token = privateSurveyToken(id);
  const survey = (
    await client.query(
      `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,status,link_digest,expires_at) VALUES($1,$2,$3,$4,'open',$5,now()+interval '30 days') RETURNING id,expires_at`,
      [id, slug, 'Advisor Studio', definition.content_version, digest(token)],
    )
  ).rows[0];
  for (const person of definition.respondents)
    await client.query(
      'INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email) VALUES($1,$2,$3,$4)',
      [
        id,
        person.id,
        person.name,
        members
          .find((m) => m.id === person.id)
          .email.trim()
          .toLowerCase(),
      ],
    );
  await client.query('COMMIT');
  console.log(
    JSON.stringify({
      id: survey.id,
      expiresAt: survey.expires_at,
      message:
        'Private survey opened. Copy its link from Surveys → Custom surveys.',
    }),
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
