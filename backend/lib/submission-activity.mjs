import { uuid } from './validation.mjs';
import { RequestError } from './errors.mjs';
export async function submissionActivity(db, id, before = null) {
  if (
    !uuid.test(id || '') ||
    (before !== null &&
      (!/^[1-9]\d{0,18}$/.test(before) ||
        BigInt(before) > 9223372036854775807n))
  )
    throw new RequestError(400, 'Invalid activity request.');
  if (
    !(await db.query('SELECT id FROM club_forms.entries WHERE id=$1', [id]))
      .rows.length
  )
    throw new RequestError(404, 'Submission not found.');
  const rows = (
    await db.query(
      `SELECT a.id::text,a.actor,a.action,a.created_at,c.body AS comment
    FROM club_forms.audit a LEFT JOIN club_forms.entry_comments c ON c.id=a.comment_id AND c.entry_id=a.entry_id
    WHERE a.entry_id=$1 AND ($2::bigint IS NULL OR a.id<$2)
    ORDER BY a.id DESC LIMIT 51`,
      [id, before],
    )
  ).rows;
  return {
    activity: rows.slice(0, 50),
    nextBefore: rows.length > 50 ? rows[49].id : null,
  };
}
export function addSubmissionComment(db, body, actor) {
  return db.transaction((tx) =>
    insertSubmissionComment(
      tx,
      { entryId: body.id, id: body.commentId, body: body.comment },
      actor,
    ),
  );
}
// Runs inside the caller's transaction, so a comment can commit together with
// another change. A retry with the same comment id returns the saved comment.
export async function insertSubmissionComment(
  tx,
  { entryId, id, body },
  actor,
  action = 'comment-added',
) {
  if (
    !uuid.test(entryId || '') ||
    !uuid.test(id || '') ||
    typeof body !== 'string' ||
    !body.trim() ||
    body.trim().length > 5000
  )
    throw new RequestError(
      400,
      'Enter a comment between 1 and 5,000 characters.',
    );
  const text = body.trim();
  if (
    !(
      await tx.query('SELECT id FROM club_forms.entries WHERE id=$1', [entryId])
    ).rows.length
  )
    throw new RequestError(404, 'Submission not found.');
  const inserted = (
    await tx.query(
      `INSERT INTO club_forms.entry_comments(id,entry_id,author_email,body)
      VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING *`,
      [id, entryId, actor, text],
    )
  ).rows[0];
  if (!inserted) {
    const previous = (
      await tx.query('SELECT * FROM club_forms.entry_comments WHERE id=$1', [
        id,
      ])
    ).rows[0];
    if (
      !previous ||
      previous.entry_id !== entryId ||
      previous.author_email !== actor ||
      previous.body !== text
    )
      throw new RequestError(
        409,
        'This comment request has already been used. Please try again.',
      );
    return previous;
  }
  await tx.query(
    'INSERT INTO club_forms.audit(actor,entry_id,action,comment_id) VALUES($1,$2,$3,$4)',
    [actor, entryId, action, id],
  );
  return inserted;
}
const reviewVerbs = {
  'review:closed': 'archived',
  'review:reviewed': 'reviewed',
  'review:new': 'marked new',
};
const centralTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
// Called when a review UPDATE matched nothing: says who changed the status.
export async function staleStatus(tx, id) {
  const entry = (
    await tx.query('SELECT review_status FROM club_forms.entries WHERE id=$1', [
      id,
    ])
  ).rows[0];
  if (!entry) throw new RequestError(404, 'Submission not found.');
  const last = (
    await tx.query(
      "SELECT actor,action,created_at FROM club_forms.audit WHERE entry_id=$1 AND (action LIKE 'review:%' OR action='resubmitted') ORDER BY id DESC LIMIT 1",
      [id],
    )
  ).rows[0];
  // ICU puts a narrow no-break space before AM/PM; keep the message plain.
  const at =
    last && centralTime.format(new Date(last.created_at)).replace(/\s/g, ' ');
  throw new RequestError(
    409,
    !last
      ? 'Someone else changed this submission first. Reload to see its current status.'
      : last.action === 'resubmitted'
        ? `Updated details arrived through the website at ${at}, so this is New again.`
        : `${last.actor} already ${reviewVerbs[last.action] || 'changed'} this at ${at}.`,
    {
      code: 'stale-status',
      current: {
        status: entry.review_status,
        actor: last?.actor ?? null,
        at: last?.created_at ?? null,
      },
    },
  );
}
