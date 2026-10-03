import { randomUUID } from 'node:crypto';
import { RequestError } from './errors.mjs';
import { digest } from './custom-surveys.mjs';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function surveyId(value) {
  if (!uuid.test(value || '')) throw new RequestError(400, 'Choose a survey.');
  return value;
}
export async function respondentList(db, id) {
  const survey = (
    await db.query(
      'SELECT id,roster_revision FROM club_forms.custom_surveys WHERE id=$1',
      [surveyId(id)],
    )
  ).rows[0];
  if (!survey) throw new RequestError(404, 'Survey not found.');
  const members = (
    await db.query(
      'SELECT advisor_id,display_name,email,active FROM club_forms.custom_survey_members WHERE survey_id=$1 ORDER BY active DESC,display_name',
      [id],
    )
  ).rows;
  const activity = (
    await db.query(
      'SELECT id,action,actor_email,respondent_name,respondent_email,created_at FROM club_forms.custom_survey_activity WHERE survey_id=$1 ORDER BY revision DESC LIMIT 100',
      [id],
    )
  ).rows;
  return { members, activity, revision: survey.roster_revision };
}
export async function changeRespondent(db, actor, body) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (k) =>
        ![
          'surveyId',
          'action',
          'name',
          'email',
          'advisorId',
          'expectedRevision',
          'requestId',
        ].includes(k),
    ) ||
    !['add', 'remove'].includes(body.action) ||
    !uuid.test(body.requestId || '') ||
    !Number.isInteger(body.expectedRevision) ||
    body.expectedRevision < 0
  )
    throw new RequestError(400, 'Check the respondent change.');
  const id = surveyId(body.surveyId);
  let email, name;
  if (body.action === 'add') {
    email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    name = typeof body.name === 'string' ? body.name.trim() : '';
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !name ||
      name.length > 120 ||
      /[\x00-\x1f]/.test(name) ||
      body.advisorId !== undefined
    )
      throw new RequestError(
        400,
        'Enter the respondent’s name and a valid email address.',
      );
  } else if (
    typeof body.advisorId !== 'string' ||
    body.advisorId.length > 100 ||
    body.name !== undefined ||
    body.email !== undefined
  )
    throw new RequestError(400, 'Choose the respondent to remove.');
  const signature = digest(
    JSON.stringify([
      id,
      body.action,
      email,
      name,
      body.advisorId,
      body.expectedRevision,
      actor.email,
    ]),
  );
  return db.transaction(async (tx) => {
    const survey = (
      await tx.query(
        'SELECT roster_revision FROM club_forms.custom_surveys WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0];
    if (!survey) throw new RequestError(404, 'Survey not found.');
    const prior = (
      await tx.query(
        'SELECT request_digest,revision FROM club_forms.custom_survey_activity WHERE id=$1',
        [body.requestId],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_digest !== signature)
        throw new RequestError(
          409,
          'This change reference was already used. Refresh respondents.',
        );
      return { revision: prior.revision };
    }
    if (survey.roster_revision !== body.expectedRevision)
      throw new RequestError(
        409,
        'The respondent list changed. Refresh it and try again.',
      );
    let member, action;
    if (body.action === 'add') {
      member = (
        await tx.query(
          'SELECT * FROM club_forms.custom_survey_members WHERE survey_id=$1 AND email=$2 FOR UPDATE',
          [id, email],
        )
      ).rows[0];
      if (member?.active)
        throw new RequestError(
          409,
          'This email is already an active respondent.',
        );
      if (member) {
        await tx.query(
          'UPDATE club_forms.custom_survey_members SET active=true,display_name=$3 WHERE survey_id=$1 AND advisor_id=$2',
          [id, member.advisor_id, name],
        );
        member = { ...member, display_name: name };
        action = 'respondent_restored';
      } else {
        member = { advisor_id: randomUUID(), display_name: name, email };
        await tx.query(
          'INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email) VALUES($1,$2,$3,$4)',
          [id, member.advisor_id, name, email],
        );
        action = 'respondent_added';
      }
    } else {
      member = (
        await tx.query(
          'SELECT * FROM club_forms.custom_survey_members WHERE survey_id=$1 AND advisor_id=$2 AND active FOR UPDATE',
          [id, body.advisorId],
        )
      ).rows[0];
      if (!member)
        throw new RequestError(
          409,
          'This respondent is already removed. Refresh the list.',
        );
      await tx.query(
        'UPDATE club_forms.custom_survey_members SET active=false WHERE survey_id=$1 AND advisor_id=$2',
        [id, member.advisor_id],
      );
      await tx.query(
        'UPDATE club_forms.custom_survey_devices SET revoked_at=now() WHERE survey_id=$1 AND advisor_id=$2 AND revoked_at IS NULL',
        [id, member.advisor_id],
      );
      action = 'respondent_removed';
    }
    const revision = survey.roster_revision + 1;
    await tx.query(
      'UPDATE club_forms.custom_surveys SET roster_revision=$2 WHERE id=$1',
      [id, revision],
    );
    await tx.query(
      'INSERT INTO club_forms.custom_survey_activity(id,survey_id,advisor_id,action,actor_id,actor_email,respondent_name,respondent_email,revision,request_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        body.requestId,
        id,
        member.advisor_id,
        action,
        actor.id || null,
        actor.email,
        member.display_name,
        member.email,
        revision,
        signature,
      ],
    );
    return { revision };
  });
}
