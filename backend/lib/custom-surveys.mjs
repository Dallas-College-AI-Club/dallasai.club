import { createHash, createHmac, randomBytes } from 'node:crypto';
import { RequestError } from './errors.mjs';
import { definition, validateSubmission } from './survey-contract.mjs';
export const digest = (value) =>
  createHash('sha256').update(value).digest('hex');
export function privateSurveyToken(id) {
  const secret = process.env.FORM_TOKEN_SECRET;
  if (!secret || secret.length < 32)
    throw new RequestError(503, 'Private survey links are not configured.');
  return createHmac('sha256', secret)
    .update('custom-survey-link:' + id)
    .digest('base64url');
}
export const deviceCookie = (survey) => 'club-survey-' + survey.id;
export function cookieValue(req, name) {
  return (
    (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + '='))
      ?.slice(name.length + 1) || ''
  );
}
export function deviceHeader(survey, token, maxAge) {
  return `${deviceCookie(survey)}=${token}; Path=/api/custom-surveys; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.AUTH_BASE_URL?.startsWith('https:') ? '; Secure' : ''}`;
}
export async function linkedSurvey(db, token, lock = false) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new RequestError(
      404,
      'This private survey link is unavailable. Contact the club for a current link.',
    );
  const survey = (
    await db.query(
      `SELECT * FROM club_forms.custom_surveys WHERE link_digest=$1 AND status='open' AND expires_at>now() ${lock ? 'FOR UPDATE' : ''}`,
      [digest(token)],
    )
  ).rows[0];
  if (!survey)
    throw new RequestError(
      404,
      'This private survey link is unavailable or has expired. Contact the club for a current link.',
    );
  if (survey.content_version !== definition.content_version)
    throw new RequestError(503, 'This survey version is not available.');
  return survey;
}
export async function surveyMembers(db, id) {
  return (
    await db.query(
      'SELECT * FROM club_forms.custom_survey_members WHERE survey_id=$1 AND active ORDER BY advisor_id DESC',
      [id],
    )
  ).rows;
}
export async function requireDevice(db, req, survey) {
  const token = cookieValue(req, deviceCookie(survey));
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new RequestError(401, 'Verify your email to open the questions.');
  const member = (
    await db.query(
      `SELECT m.* FROM club_forms.custom_survey_devices d JOIN club_forms.custom_survey_members m USING(survey_id,advisor_id) WHERE d.token_digest=$1 AND d.survey_id=$2 AND d.revoked_at IS NULL AND d.expires_at>now() AND m.active AND m.user_id=d.user_id`,
      [digest(token), survey.id],
    )
  ).rows[0];
  if (!member)
    throw new RequestError(401, 'Verify your email to open the questions.');
  return member;
}
export async function rememberDevice(db, survey, user) {
  if (!user?.id || !user.email || user.emailVerified !== true)
    throw new RequestError(
      401,
      'Verify the code sent to your approved advisor email.',
    );
  return db.transaction(async (tx) => {
    const member = (
      await tx.query(
        'SELECT * FROM club_forms.custom_survey_members WHERE survey_id=$1 AND email=$2 AND active FOR UPDATE',
        [survey.id, user.email.toLowerCase()],
      )
    ).rows[0];
    if (!member || (member.user_id && member.user_id !== user.id))
      throw new RequestError(
        403,
        'This account is not an advisor for this survey.',
      );
    await tx.query(
      'UPDATE club_forms.custom_survey_members SET user_id=$3 WHERE survey_id=$1 AND advisor_id=$2',
      [survey.id, member.advisor_id, user.id],
    );
    const token = randomBytes(32).toString('base64url');
    await tx.query(
      'INSERT INTO club_forms.custom_survey_devices(token_digest,survey_id,advisor_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5)',
      [digest(token), survey.id, member.advisor_id, user.id, survey.expires_at],
    );
    return { token, member };
  });
}
export async function currentResponses(db, surveyId) {
  return (
    await db.query(
      `SELECT m.advisor_id,m.display_name,r.revision,r.responses,r.submitted_at FROM club_forms.custom_survey_members m LEFT JOIN club_forms.custom_survey_responses r USING(survey_id,advisor_id) WHERE m.survey_id=$1 AND m.active ORDER BY m.advisor_id DESC`,
      [surveyId],
    )
  ).rows;
}
export async function submitSurvey(db, req, link, body) {
  return db.transaction(async (tx) => {
    const survey = await linkedSurvey(tx, link, true);
    const member = await requireDevice(tx, req, survey);
    // Serialize member revocation / identity updates with submission.
    const locked = await tx.query(
      'SELECT advisor_id FROM club_forms.custom_survey_members WHERE survey_id=$1 AND advisor_id=$2 AND active FOR UPDATE',
      [survey.id, member.advisor_id],
    );
    if (!locked.rows.length)
      throw new RequestError(403, 'Survey access has been revoked.');
    const members = await surveyMembers(tx, survey.id);
    const responses = validateSubmission(
      body,
      member,
      members.filter((m) => m.advisor_id !== member.advisor_id),
      survey.content_version,
    );
    const requestDigest = digest(
      JSON.stringify({
        responses,
        expectedRevision: body.expectedRevision,
        consent: body.consent,
        contentVersion: body.contentVersion,
      }),
    );
    const existing = (
      await tx.query(
        'SELECT * FROM club_forms.custom_survey_receipts WHERE id=$1',
        [body.requestId],
      )
    ).rows[0];
    if (existing) {
      if (
        existing.survey_id !== survey.id ||
        existing.advisor_id !== member.advisor_id ||
        existing.request_digest !== requestDigest
      )
        throw new RequestError(
          409,
          'This submission reference was already used. Reload your saved summary before making another submission.',
        );
      return {
        id: existing.id,
        revision: existing.revision,
        submittedAt: existing.created_at,
      };
    }
    const old = (
      await tx.query(
        'SELECT revision FROM club_forms.custom_survey_responses WHERE survey_id=$1 AND advisor_id=$2',
        [survey.id, member.advisor_id],
      )
    ).rows[0];
    if ((old?.revision || 0) !== body.expectedRevision)
      throw new RequestError(
        409,
        'A newer summary was saved on another device. Keep a personal copy, then reload before submitting again.',
      );
    const revision = body.expectedRevision + 1;
    await tx.query(
      `INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses) VALUES($1,$2,$3,$4) ON CONFLICT(survey_id,advisor_id) DO UPDATE SET revision=EXCLUDED.revision,responses=EXCLUDED.responses,submitted_at=now()`,
      [survey.id, member.advisor_id, revision, JSON.stringify(responses)],
    );
    const receipt = (
      await tx.query(
        'INSERT INTO club_forms.custom_survey_receipts(id,survey_id,advisor_id,revision,request_digest) VALUES($1,$2,$3,$4,$5) RETURNING id,revision,created_at',
        [body.requestId, survey.id, member.advisor_id, revision, requestDigest],
      )
    ).rows[0];
    return {
      id: receipt.id,
      revision: receipt.revision,
      submittedAt: receipt.created_at,
    };
  });
}
