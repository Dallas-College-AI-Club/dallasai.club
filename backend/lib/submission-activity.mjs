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
export async function addSubmissionComment(db, body, actor) {
  if (
    !uuid.test(body.id || '') ||
    !uuid.test(body.commentId || '') ||
    typeof body.comment !== 'string' ||
    !body.comment.trim() ||
    body.comment.trim().length > 5000
  )
    throw new RequestError(
      400,
      'Enter a comment between 1 and 5,000 characters.',
    );
  const text = body.comment.trim();
  return db.transaction(async (tx) => {
    if (
      !(
        await tx.query('SELECT id FROM club_forms.entries WHERE id=$1', [
          body.id,
        ])
      ).rows.length
    )
      throw new RequestError(404, 'Submission not found.');
    const inserted = (
      await tx.query(
        `INSERT INTO club_forms.entry_comments(id,entry_id,author_email,body)
      VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING *`,
        [body.commentId, body.id, actor, text],
      )
    ).rows[0];
    if (!inserted) {
      const previous = (
        await tx.query('SELECT * FROM club_forms.entry_comments WHERE id=$1', [
          body.commentId,
        ])
      ).rows[0];
      if (
        !previous ||
        previous.entry_id !== body.id ||
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
      "INSERT INTO club_forms.audit(actor,entry_id,action,comment_id) VALUES($1,$2,'comment-added',$3)",
      [actor, body.id, body.commentId],
    );
    return inserted;
  });
}
