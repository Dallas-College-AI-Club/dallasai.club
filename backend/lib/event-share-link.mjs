import { RequestError } from './errors.mjs';
import { eventIdPattern } from './event-content.mjs';
import { createHash } from 'node:crypto';

export const legacyEventShortLink = (link) =>
  typeof link === 'string' && /^https:\/\/[^/]+\/dai-[a-f0-9]{24}$/.test(link);

export function eventShortAlias(event, id) {
  const words =
    (event.title || id)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/^ai\s+club\s+(?:members?\s+)?/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'event';
  const year = /^(\d{4})/.exec(event.date || event.rsvpDeadline || '')?.[1];
  const ending = year && !words.endsWith(year) ? '-' + year : '';
  return 'dai-' + words.slice(0, 26 - ending.length).replace(/-$/, '') + ending;
}

export const eventURL = (id) =>
  'https://dallasai.club/club.html?mode=events&event=' + encodeURIComponent(id);

// Short links belong to the saved event, never to an editable form field.
// The row lock makes concurrent publish/retry requests reuse the same link.
export async function createEventShareLink(
  db,
  id,
  actor,
  createLink,
  replaceLegacy = false,
  requestedAlias,
) {
  if (!eventIdPattern.test(id || ''))
    throw new RequestError(400, 'Check the event.');
  if (
    requestedAlias !== undefined &&
    (typeof requestedAlias !== 'string' ||
      (requestedAlias.trim() &&
        !/^[a-z0-9_-]{5,30}$/i.test(requestedAlias.trim())))
  )
    throw new RequestError(
      400,
      'Use 5–30 letters, numbers, hyphens or underscores for the short-link name, or leave it blank.',
    );
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
    if (
      row.published.shortLink &&
      requestedAlias === undefined &&
      !(replaceLegacy && legacyEventShortLink(row.published.shortLink))
    )
      return row;
    const target = eventURL(id),
      customAlias = requestedAlias?.trim(),
      alias = customAlias || eventShortAlias(row.published, id);
    let link;
    try {
      link = await createLink(target, alias);
    } catch (error) {
      if (error.status !== 409 || customAlias) throw error;
      // A title may already belong to another event. The provider checks the
      // destination; one deterministic retry never repoints the occupied path.
      const suffix = createHash('sha256')
        .update(target)
        .digest('hex')
        .slice(0, 6);
      link = await createLink(
        target,
        alias.slice(0, 23).replace(/-$/, '') + '-' + suffix,
      );
    }
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
