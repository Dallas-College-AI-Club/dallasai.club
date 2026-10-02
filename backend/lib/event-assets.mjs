import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { put, get, del } from '@vercel/blob';
import { RequestError } from './errors.mjs';
import { uuid } from './validation.mjs';
import { originalEvents, liveEvents } from './events.mjs';

export async function eventTypes(db, originals) {
  originals ??= await originalEvents();
  const names = [
    'Club event',
    'Club meeting',
    'Workshop',
    'Conversation',
    ...originals.map((e) => e.category),
    ...(
      await db.query(
        'SELECT name FROM club_forms.event_types ORDER BY created_at',
      )
    ).rows.map((r) => r.name),
    ...(await db.query('SELECT draft FROM club_forms.events')).rows.map(
      (r) => r.draft.category,
    ),
  ];
  const unique = new Map();
  for (const value of names) {
    const name = String(value || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (name && !unique.has(name.toLowerCase()))
      unique.set(name.toLowerCase(), name);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b));
}
export async function addEventType(db, value, actor, originals) {
  if (typeof value !== 'string')
    throw new RequestError(400, 'Enter an event type.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80 || /[\x00-\x1f<>]/.test(name))
    throw new RequestError(400, 'Use a name of up to 80 characters.');
  const existing = (await eventTypes(db, originals)).find(
    (t) => t.toLowerCase() === name.toLowerCase(),
  );
  if (!existing)
    await db.query(
      'INSERT INTO club_forms.event_types(name,created_by) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [name, actor],
    );
  const types = await eventTypes(db, originals);
  return {
    types,
    selected: types.find((t) => t.toLowerCase() === name.toLowerCase()),
  };
}
export async function validateEventAssets(db, event, originals) {
  const types = await eventTypes(db, originals);
  const name = String(event?.category || 'Club event')
    .trim()
    .replace(/\s+/g, ' ');
  const category = types.find((t) => t.toLowerCase() === name.toLowerCase());
  if (!category)
    throw new RequestError(
      400,
      'Choose an existing event type, or add a new group first.',
    );
  if (Array.isArray(event.images))
    for (const image of event.images) {
      if (
        !uuid.test(image.id || '') ||
        !(
          await db.query('SELECT id FROM club_forms.event_images WHERE id=$1', [
            image.id,
          ])
        ).rows.length
      )
        throw new RequestError(400, 'Upload the event image again.');
    }
  return { ...event, category };
}
export async function uploadEventImage(
  db,
  body,
  actor,
  storage = { put, del },
) {
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    throw new RequestError(
      503,
      'Image uploads are unavailable. Please try again later.',
    );
  if (
    typeof body.content !== 'string' ||
    body.content.length > 2800000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(body.content)
  )
    throw new RequestError(400, 'Choose a JPG, PNG, or WebP image under 2 MB.');
  const bytes = Buffer.from(body.content, 'base64');
  if (!bytes.length || bytes.length > 2097152)
    throw new RequestError(413, 'Choose an image under 2 MB.');
  let output;
  try {
    const input = sharp(bytes, { limitInputPixels: 25000000, failOn: 'error' });
    const metadata = await input.metadata();
    if (
      !['jpeg', 'png', 'webp'].includes(metadata.format) ||
      (metadata.pages || 1) > 1
    )
      throw Error();
    output = await input
      .rotate()
      .resize({
        width: 1800,
        height: 1800,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new RequestError(
      400,
      'Use a valid, still JPG, PNG, or WebP image (up to 25 megapixels).',
    );
  }
  const id = randomUUID();
  const blob = await storage.put('event-images/' + id + '.webp', output.data, {
    access: 'private',
    contentType: 'image/webp',
    addRandomSuffix: false,
  });
  try {
    await db.query(
      'INSERT INTO club_forms.event_images(id,pathname,width,height,size,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [
        id,
        blob.pathname,
        output.info.width,
        output.info.height,
        output.data.length,
        actor,
      ],
    );
  } catch (error) {
    await storage.del(blob.pathname).catch(() => {});
    throw error;
  }
  return { id, width: output.info.width, height: output.info.height };
}
export async function serveEventImage(
  req,
  res,
  db,
  id,
  authorize,
  originals,
  storage = { get },
) {
  if (!uuid.test(id || '')) throw new RequestError(404, 'Image not found.');
  const published = (await liveEvents(db, originals)).some((e) =>
    e.images?.some((image) => image.id === id),
  );
  if (!published) await authorize(req);
  const file = (
    await db.query('SELECT pathname FROM club_forms.event_images WHERE id=$1', [
      id,
    ])
  ).rows[0];
  if (!file) throw new RequestError(404, 'Image not found.');
  const blob = await storage.get(file.pathname, {
    access: 'private',
    useCache: false,
  });
  if (!blob || blob.statusCode !== 200)
    throw new RequestError(404, 'Image unavailable.');
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  await new Promise((resolve, reject) => {
    const stream = Readable.fromWeb(blob.stream);
    stream.on('error', reject);
    res.on('finish', resolve);
    stream.pipe(res);
  });
}
