import { randomUUID } from 'node:crypto';
import { put, del } from '@vercel/blob';
import { validate } from './validation.mjs';
import { RequestError } from './errors.mjs';

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
      return row;
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
