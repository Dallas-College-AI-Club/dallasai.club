import { createHash } from 'node:crypto';
import { RequestError } from './errors.mjs';
import { uuid, email, campuses } from './validation.mjs';
import {
  validateSurvey,
  surveyQuestions,
  surveyVersion,
} from './surveys.mjs';

const fields = {
  subscribe: {},
  join: { campus: [100, true], interests: [1500, false] },
  rsvp: {},
  workshop: { topic: [160, true], details: [3000, false] },
  contribution: { title: [140, true], body: [40000, false] },
  question: { subject: [160, true], message: [5000, true] },
};
function text(value, max, required = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim()) ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    throw new RequestError(400, 'Check the response text and length.');
  return value.trim();
}
export async function removeOrphanContact(tx, address) {
  const canonical = (
    await tx.query(
      'SELECT contact_email FROM club_forms.contact_emails WHERE email=$1',
      [address],
    )
  ).rows[0]?.contact_email;
  if (!canonical) return false;
  const aliases = (
    await tx.query(
      'SELECT email FROM club_forms.contact_emails WHERE contact_email=$1',
      [canonical],
    )
  ).rows.map((r) => r.email);
  const linked = (
    await tx.query(
      `SELECT EXISTS(SELECT 1 FROM club_forms.entries WHERE email=ANY($1::text[])) OR EXISTS(SELECT 1 FROM club_forms.contact_notes WHERE email=ANY($1::text[])) AS retained`,
      [aliases],
    )
  ).rows[0].retained;
  if (linked) return false;
  const customExists = (
    await tx.query(
      "SELECT to_regclass('club_forms.custom_survey_members') IS NOT NULL AS present",
    )
  ).rows[0].present;
  if (
    customExists &&
    (
      await tx.query(
        'SELECT 1 FROM club_forms.custom_survey_members WHERE email=ANY($1::text[]) LIMIT 1',
        [aliases],
      )
    ).rows.length
  )
    return false;
  await tx.query(
    'DELETE FROM club_forms.contact_activity WHERE email=ANY($1::text[])',
    [aliases],
  );
  await tx.query(
    'DELETE FROM club_forms.contact_emails WHERE contact_email=$1',
    [canonical],
  );
  await tx.query(
    'DELETE FROM club_forms.contacts WHERE email=ANY($1::text[])',
    [aliases],
  );
  return true;
}
export async function changeSubmission(
  db,
  body,
  actor,
  { surface = 'inbox' } = {},
) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new RequestError(400, 'Check the response change.');
  const deleting = body.action === 'delete-submission';
  const keys = [
    'action',
    'entryId',
    'requestId',
    'expectedRevision',
    ...(deleting ? [] : ['name', 'email', 'data', 'answers']),
  ];
  if (
    !['edit-submission', 'delete-submission'].includes(body.action) ||
    Object.keys(body).some((k) => !keys.includes(k)) ||
    !uuid.test(body.entryId || '') ||
    !uuid.test(body.requestId || '') ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0
  )
    throw new RequestError(400, 'Reload the response before changing it.');
  const signature = createHash('sha256')
    .update(
      JSON.stringify([
        actor,
        surface,
        body.action,
        body.entryId,
        body.expectedRevision,
        body.name,
        body.email,
        body.data,
        body.answers,
      ]),
    )
    .digest('hex');
  return db
    .transaction(async (tx) => {
      // Match contact merge/capture lock order before locking the submission.
      await tx.query(
        'LOCK TABLE club_forms.contacts IN SHARE ROW EXCLUSIVE MODE',
      );
      const receipt = (
        await tx.query(
          'SELECT * FROM club_forms.entry_changes WHERE id=$1',
          [body.requestId],
        )
      ).rows[0];
      if (receipt) {
        if (receipt.request_digest !== signature)
          throw new RequestError(
            409,
            'This change reference was already used. Reload the response.',
          );
        return {
          saved: !deleting,
          deleted: deleting,
          revision: receipt.revision,
        };
      }
      const entry = (
        await tx.query(
          'SELECT * FROM club_forms.entries WHERE id=$1 FOR UPDATE',
          [body.entryId],
        )
      ).rows[0];
      if (!entry) throw new RequestError(404, 'Submission not found.');
      if (entry.edit_revision !== body.expectedRevision)
        throw new RequestError(
          409,
          'Another admin edited this response. Reopen it to see the latest answers.',
        );
      const survey = (
        await tx.query(
          'SELECT * FROM club_forms.survey_responses WHERE entry_id=$1 FOR UPDATE',
          [entry.id],
        )
      ).rows[0];
      if (surface === 'survey' && !survey)
        throw new RequestError(404, 'Survey response not found.');
      let contactRemoved = false;
      if (deleting) {
        const state = (
          await tx.query(
            'SELECT archived_at FROM club_forms.survey_response_state WHERE entry_id=$1 FOR UPDATE',
            [entry.id],
          )
        ).rows[0];
        if (
          surface === 'survey'
            ? !state?.archived_at
            : entry.review_status !== 'closed'
        )
          throw new RequestError(
            409,
            'Archive this response before permanently deleting it.',
          );
        await tx.query(
          'INSERT INTO club_forms.contact_file_deletions(pathname) SELECT pathname FROM club_forms.attachments WHERE entry_id=$1 ON CONFLICT DO NOTHING',
          [entry.id],
        );
        await tx.query('DELETE FROM club_forms.entries WHERE id=$1', [
          entry.id,
        ]);
        contactRemoved = await removeOrphanContact(tx, entry.email);
        await tx.query(
          "INSERT INTO club_forms.audit(actor,action) VALUES($1,'submission-permanently-deleted')",
          [actor],
        );
      } else {
        const name = text(body.name, 100, entry.kind !== 'subscribe'),
          address = email(body.email);
        if (
          !body.data ||
          typeof body.data !== 'object' ||
          Array.isArray(body.data) ||
          Object.keys(body.data).some(
            (k) => !Object.hasOwn(fields[entry.kind], k),
          )
        )
          throw new RequestError(
            400,
            'Only the response fields can be edited.',
          );
        const data = { ...entry.data };
        for (const [key, [max, required]] of Object.entries(
          fields[entry.kind],
        ))
          data[key] = text(body.data[key] ?? '', max, required);
        if (entry.kind === 'join' && !campuses.includes(data.campus))
          throw new RequestError(400, 'Choose a valid campus.');
        if (
          entry.kind === 'contribution' &&
          !data.body &&
          !(
            await tx.query(
              'SELECT id FROM club_forms.attachments WHERE entry_id=$1 LIMIT 1',
              [entry.id],
            )
          ).rows.length
        )
          throw new RequestError(400, 'Keep a draft or an attached file.');
        if (survey) {
          const questions = surveyQuestions(survey.questions);
          const validated = validateSurvey(
            {
              surveyVersion: surveyVersion(questions),
              answers: body.answers,
            },
            { surveyQuestions: questions },
          );
          await tx.query(
            'UPDATE club_forms.survey_responses SET answers=$2 WHERE entry_id=$1',
            [entry.id, JSON.stringify(validated.answers)],
          );
        } else if (body.answers !== null && body.answers !== undefined)
          throw new RequestError(
            400,
            'This submission does not have survey answers.',
          );
        const key = ['subscribe', 'join'].includes(entry.kind)
          ? `${entry.kind}:${address}`
          : entry.kind === 'rsvp'
            ? `rsvp:${entry.data.eventId}:${address}`
            : entry.dedupe_key;
        if (
          (
            await tx.query(
              'SELECT id FROM club_forms.entries WHERE dedupe_key=$1 AND id<>$2',
              [key, entry.id],
            )
          ).rows.length
        )
          throw new RequestError(
            409,
            'That email already has a response for this form or event. Keep the responses separate or manage the contact link.',
          );
        await tx.query(
          'UPDATE club_forms.entries SET name=$2,email_verified=CASE WHEN email=$3 THEN email_verified ELSE false END,email=$3,data=$4,dedupe_key=$5,edit_revision=edit_revision+1,updated_at=now() WHERE id=$1',
          [entry.id, name, address, JSON.stringify(data), key],
        );
        if (address !== entry.email)
          await removeOrphanContact(tx, entry.email);
        await tx.query(
          "INSERT INTO club_forms.audit(actor,entry_id,action) VALUES($1,$2,'submission-edited')",
          [actor, entry.id],
        );
      }
      const revision = entry.edit_revision + 1;
      await tx.query(
        'INSERT INTO club_forms.entry_changes(id,entry_id,action,actor,revision,request_digest) VALUES($1,$2,$3,$4,$5,$6)',
        [
          body.requestId,
          entry.id,
          body.action,
          actor,
          revision,
          signature,
        ],
      );
      return {
        saved: !deleting,
        deleted: deleting,
        revision,
        contactRemoved,
      };
    })
    .catch((error) => {
      if (error.code === '23505')
        throw new RequestError(
          409,
          'That email already has a response for this form or event. Reload before saving.',
        );
      throw error;
    });
}
