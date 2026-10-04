import { randomUUID } from 'node:crypto';
import { put, del } from '@vercel/blob';
import { validate } from './validation.mjs';
import { saveSurveyResponse } from './surveys.mjs';
import { RequestError } from './errors.mjs';
import { insertSubmissionComment } from './submission-activity.mjs';

const labels = { name: 'Name', campus: 'Campus', interests: 'Interests' };
// Public forms do not prove who owns an address, so the note and its audit row
// are attributed to the website, never to the email that was typed in.
const WEBSITE = 'website';
// A repeat signup keeps the original entry. The audit table has no details
// column, so different details become a note on that entry ('resubmitted' in
// its activity), and the entry returns to New so an officer sees them.
async function recordResubmission(tx, row, input) {
  const fresh = { name: input.name, ...input.data };
  if (
    Object.entries(fresh).every(
      ([key, value]) =>
        (key === 'name' ? row.name : (row.data[key] ?? '')) === value,
    )
  )
    return;
  const body =
    'Unverified details submitted through the public website:\n' +
    Object.entries(fresh)
      .map(([key, value]) => `${labels[key] || key}: ${value || '(blank)'}`)
      .join('\n');
  // The same new details sent again (or a retry) add nothing new for officers.
  const seen = await tx.query(
    "SELECT 1 FROM club_forms.entry_comments c JOIN club_forms.audit a ON a.comment_id=c.id WHERE a.entry_id=$1 AND a.action='resubmitted' AND c.body=$2",
    [row.id, body],
  );
  if (seen.rows.length) return;
  await insertSubmissionComment(
    tx,
    { entryId: row.id, id: randomUUID(), body },
    WEBSITE,
    'resubmitted',
  );
  await tx.query(
    "UPDATE club_forms.entries SET review_status='new' WHERE id=$1",
    [row.id],
  );
}

// An officer recorded this RSVP as cancelled or this newsletter request as
// withdrawn, and the person has now signed up again: the entry is active and
// New, with a website note saying why. The public reply does not change.
const withdrawnStates = { rsvp: 'cancelled', subscribe: 'unsubscribed' };
async function reactivate(tx, row) {
  if (withdrawnStates[row.kind] !== row.state) return;
  await tx.query(
    "UPDATE club_forms.entries SET state='active',review_status='new' WHERE id=$1",
    [row.id],
  );
  await insertSubmissionComment(
    tx,
    {
      entryId: row.id,
      id: randomUUID(),
      body:
        row.kind === 'rsvp'
          ? 'RSVPed again through the public website (unverified). The RSVP had been recorded as cancelled; it is active again.'
          : 'Signed up again through the public website (unverified). The AI Review subscription had been recorded as withdrawn; it is active again.',
    },
    WEBSITE,
    'resubmitted',
  );
}
export async function submit(db, body, events, storage = { put, del }) {
  const input = validate(body, events);
  const id = randomUUID();
  const stored = [];
  const existing = await db.query(
    'SELECT id FROM club_forms.entries WHERE dedupe_key=$1',
    [input.dedupeKey],
  );
  if (!existing.rows.length && input.files.length) {
    if (!process.env.BLOB_READ_WRITE_TOKEN)
      throw new RequestError(
        503,
        'Attachments are unavailable right now. Your draft has not been submitted. Please try again later.',
      );
    try {
      for (const file of input.files) {
        const fileId = randomUUID();
        const blob = await storage.put(
          `contributions/${id}/${fileId}`,
          file.bytes,
          {
            access: 'private',
            contentType: file.contentType,
            addRandomSuffix: false,
          },
        );
        stored.push({ ...file, id: fileId, pathname: blob.pathname });
      }
    } catch (error) {
      if (stored.length)
        await storage.del(stored.map((x) => x.pathname)).catch(() => {});
      throw error;
    }
  }
  let inserted = false;
  try {
    const entry = await db.transaction(async (tx) => {
      const result = await tx.query(
        `INSERT INTO club_forms.entries(id,kind,email,name,data,dedupe_key,state)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(dedupe_key) DO NOTHING RETURNING *`,
        [
          id,
          input.kind,
          input.email,
          input.name,
          JSON.stringify(input.data),
          input.dedupeKey,
          'active',
        ],
      );
      inserted = result.rows.length > 0;
      const row =
        result.rows[0] ||
        (
          await tx.query(
            'SELECT * FROM club_forms.entries WHERE dedupe_key=$1',
            [input.dedupeKey],
          )
        ).rows[0];
      if (!row) throw new Error('Conflicting record unavailable');
      if (inserted)
        for (const file of stored)
          await tx.query(
            `INSERT INTO club_forms.attachments(id,entry_id,name,pathname,content_type,size) VALUES($1,$2,$3,$4,$5,$6)`,
            [
              file.id,
              row.id,
              file.name,
              file.pathname,
              file.contentType,
              file.bytes.length,
            ],
          );
      if (inserted) await saveSurveyResponse(tx, row, input.survey);
      if (!inserted && ['join', 'subscribe'].includes(input.kind))
        await recordResubmission(tx, row, input);
      if (!inserted) await reactivate(tx, row);
      return { ...row, alreadySubmitted: !inserted };
    });
    if (!inserted && stored.length)
      await storage.del(stored.map((x) => x.pathname)).catch(() => {});
    return entry;
  } catch (error) {
    if (stored.length)
      await storage.del(stored.map((x) => x.pathname)).catch(() => {});
    throw error;
  }
}
