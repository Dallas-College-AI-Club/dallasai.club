import { RequestError } from './errors.mjs';
import { eventIdPattern } from './event-content.mjs';

export const eventURL = (id) =>
  'https://dallasai.club/club.html?mode=events&event=' + encodeURIComponent(id);

// Short links belong to the saved event, never to an editable form field.
// The row lock makes concurrent publish/retry requests reuse the same link.
export async function createEventShareLink(db, id, actor, createLink) {
  if (!eventIdPattern.test(id || ''))
    throw new RequestError(400, 'Check the event.');
  return db.transaction(async (tx) => {
    const row = (
      await tx.query('SELECT * FROM club_forms.events WHERE id=$1 FOR UPDATE', [
        id,
      ])
    ).rows[0];
    if (!row?.published || row.archived_at)
      throw new RequestError(
        409,
        'Publish the event before creating its short link.',
      );
    if (row.published.shortLink) return row;
    const link = await createLink(eventURL(id));
    const updated = (
      await tx.query(
        `UPDATE club_forms.events SET
         draft=jsonb_set(draft,'{shortLink}',to_jsonb($2::text)),
         published=jsonb_set(published,'{shortLink}',to_jsonb($2::text))
         WHERE id=$1 RETURNING *`,
        [id, link],
      )
    ).rows[0];
    await tx.query('INSERT INTO club_forms.audit(actor,action) VALUES($1,$2)', [
      actor,
      'event-share-link:' + id,
    ]);
    return updated;
  });
}
