import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { RequestError } from './errors.mjs';
import { definition, validateSubmission } from './survey-contract.mjs';
import {
  supportedFormVersion,
  validateFormResponse,
} from './survey-builder.mjs';
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
  if (
    survey.definition
      ? !supportedFormVersion(survey.content_version)
      : survey.content_version !== definition.content_version
  )
    throw new RequestError(503, 'This survey version is not available.');
  return survey;
}
export async function linkedPreview(db, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new RequestError(404, 'This preview link is unavailable.');
  const survey = (
    await db.query(
      "SELECT * FROM club_forms.custom_surveys WHERE preview_digest=$1 AND status IN ('draft','open') AND expires_at>now()",
      [digest(token)],
    )
  ).rows[0];
  if (!survey?.definition || !supportedFormVersion(survey.content_version))
    throw new RequestError(404, 'This preview link is unavailable or expired.');
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
    const current = (
      await tx.query(
        "SELECT * FROM club_forms.custom_surveys WHERE id=$1 AND status IN ('draft','open') AND expires_at>now() FOR UPDATE",
        [survey.id],
      )
    ).rows[0];
    if (!current) throw new RequestError(403, 'This survey has closed.');
    let member = (
      await tx.query(
        'SELECT * FROM club_forms.custom_survey_members WHERE survey_id=$1 AND email=$2 FOR UPDATE',
        [survey.id, user.email.toLowerCase()],
      )
    ).rows[0];
    if (!member && current.definition?.permissions.answer === 'verified') {
      // Other respondents may see this name, so it is never the email address.
      const id = randomUUID(),
        name = (user.name || '').trim().slice(0, 120),
        email = user.email.toLowerCase();
      member = (
        await tx.query(
          'INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email,user_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
          [survey.id, id, name, email, user.id],
        )
      ).rows[0];
      const revision = current.roster_revision + 1;
      await tx.query(
        'UPDATE club_forms.custom_surveys SET roster_revision=$2 WHERE id=$1',
        [survey.id, revision],
      );
      await tx.query(
        "INSERT INTO club_forms.custom_survey_activity(id,survey_id,advisor_id,action,actor_id,actor_email,respondent_name,respondent_email,revision,request_digest) VALUES($1,$2,$3,'respondent_registered',$4,$5,$6,$5,$7,$8)",
        [
          randomUUID(),
          survey.id,
          id,
          user.id,
          email,
          name,
          revision,
          digest('registered:' + user.id),
        ],
      );
    }
    if (!member?.active || (member.user_id && member.user_id !== user.id))
      throw new RequestError(
        403,
        'This account is not an approved respondent for this survey.',
      );
    await tx.query(
      'UPDATE club_forms.custom_survey_members SET user_id=$3 WHERE survey_id=$1 AND advisor_id=$2',
      [survey.id, member.advisor_id, user.id],
    );
    const token = randomBytes(32).toString('base64url');
    await tx.query(
      'INSERT INTO club_forms.custom_survey_devices(token_digest,survey_id,advisor_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5)',
      [
        digest(token),
        survey.id,
        member.advisor_id,
        user.id,
        current.expires_at,
      ],
    );
    return { token, member };
  });
}
export async function currentResponses(
  db,
  surveyId,
  viewerId = null,
  { ownOnly = false } = {},
) {
  return (
    await db.query(
      `SELECT m.advisor_id,m.display_name,m.active,r.revision,r.responses,r.submitted_at,r.response_definition
       FROM club_forms.custom_survey_members m LEFT JOIN club_forms.custom_survey_responses r
       ON r.survey_id=m.survey_id AND r.advisor_id=m.advisor_id
       AND ($2::text IS NULL OR r.advisor_id=$2 OR $2=ANY(r.shared_with))
       WHERE m.survey_id=$1 AND ($2::text IS NULL OR m.active)
         AND (NOT $3::boolean OR m.advisor_id=$2)
       ORDER BY m.active DESC,m.advisor_id DESC`,
      [surveyId, viewerId, ownOnly],
    )
  ).rows;
}
export async function submitSurvey(db, req, link, body) {
  return db.transaction(async (tx) => {
    const survey = await linkedSurvey(tx, link, true);
    let member = await requireDevice(tx, req, survey);
    // Serialize member revocation / identity updates with submission.
    const locked = await tx.query(
      'SELECT * FROM club_forms.custom_survey_members WHERE survey_id=$1 AND advisor_id=$2 AND active FOR UPDATE',
      [survey.id, member.advisor_id],
    );
    if (!locked.rows.length)
      throw new RequestError(403, 'Survey access has been revoked.');
    member = locked.rows[0];
    const members = await surveyMembers(tx, survey.id);
    const responses = survey.definition
      ? validateFormResponse(body, survey, member)
      : validateSubmission(
          body,
          member,
          members.filter((m) => m.advisor_id !== member.advisor_id),
          survey.content_version,
        );
    let submittedName;
    if (
      survey.definition &&
      (body.name !== undefined || !member.display_name.trim())
    ) {
      if (
        typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.trim().length > 120 ||
        /[\x00-\x1f@]/.test(body.name)
      )
        throw new RequestError(
          400,
          'Enter your full name (maximum 120 characters), not an email address.',
        );
      submittedName = body.name.trim();
      if (member.display_name.trim() && member.display_name !== submittedName)
        throw new RequestError(
          409,
          'Your saved name has changed. Reload the survey before submitting.',
        );
    }
    const requestDigest = digest(
      JSON.stringify({
        responses,
        expectedRevision: body.expectedRevision,
        consent: body.consent,
        contentVersion: body.contentVersion,
        ...(submittedName === undefined ? {} : { name: submittedName }),
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
    if (submittedName !== undefined && !member.display_name.trim())
      await tx.query(
        'UPDATE club_forms.custom_survey_members SET display_name=$3 WHERE survey_id=$1 AND advisor_id=$2',
        [survey.id, member.advisor_id, submittedName],
      );
    await tx.query(
      `INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses,shared_with,response_definition) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(survey_id,advisor_id) DO UPDATE SET revision=EXCLUDED.revision,responses=EXCLUDED.responses,shared_with=EXCLUDED.shared_with,response_definition=EXCLUDED.response_definition,submitted_at=now()`,
      [
        survey.id,
        member.advisor_id,
        revision,
        JSON.stringify(responses),
        (survey.definition?.permissions.results === 'admins' ? [] : members)
          .filter((m) => m.advisor_id !== member.advisor_id)
          .map((m) => m.advisor_id),
        survey.definition
          ? JSON.stringify({
              ...survey.definition,
              content_version: survey.content_version,
            })
          : null,
      ],
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
