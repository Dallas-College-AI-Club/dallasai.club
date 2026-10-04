import { kinds, uuid } from './validation.mjs';
import { RequestError } from './errors.mjs';
export function upcomingEvents(events, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return events
    .filter(
      (e) =>
        (e.potential === true && !e.date) ||
        (e.date &&
          (/^\d{4}-\d{2}-\d{2}$/.test(e.date)
            ? e.date >= today
            : new Date(e.end || e.date) > now)),
    )
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}
// The text an Inbox search looks through.
const searchText = `lower(concat_ws(' ',e.name,e.email,e.data->>'subject',e.data->>'message',e.data->>'title',e.data->>'body',e.data->>'topic',e.data->>'details',e.data->>'campus',e.data->>'interests',e.data->>'eventTitle'))`;
// $1-$5 are kind, status, id, eventId and the upcoming event ids. With
// { search: true } (the list and the CSV), $6 is the search text. Postgres
// lowercases both sides, so they always agree (İ, final sigma).
export function inboxFilter(params, events, { search = false } = {}) {
  const kind = params.get('kind') || '',
    status = params.get('status') === 'all' ? '' : params.get('status') || '',
    id = params.get('id') || '',
    eventId = params.get('eventId') || '',
    q = search ? (params.get('q') || '').trim() : '';
  if (
    (kind &&
      !kinds.includes(kind) &&
      !['rsvp-past', 'rsvp-all'].includes(kind)) ||
    (status && !['new', 'reviewed', 'closed'].includes(status)) ||
    (id && !uuid.test(id)) ||
    (eventId && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(eventId))
  )
    throw new RequestError(400, 'Invalid filter.');
  if (q.length > 200)
    throw new RequestError(400, 'Keep the search under 200 characters.');
  // Postgres refuses NUL in text; no other control character is searchable.
  if (/[\u0000-\u001f\u007f]/.test(q))
    throw new RequestError(400, 'Search for letters, numbers or symbols.');
  return {
    values: [kind, status, id, eventId, events.map((e) => e.id)].concat(
      search ? [q] : [],
    ),
    where:
      `WHERE ($1='' OR e.kind=$1 OR ($1 IN ('rsvp-past','rsvp-all') AND e.kind='rsvp')) AND ($2='' OR e.review_status=$2) AND ($3='' OR e.id::text=$3)
      AND ($4='' OR (e.kind='rsvp' AND e.data->>'eventId'=$4))
      AND ($1 NOT IN ('rsvp','rsvp-past') OR (coalesce(e.data->>'eventId','')=ANY($5::text[]))=($1='rsvp'))` +
      (search ? ` AND ($6='' OR strpos(${searchText},lower($6))>0)` : ''),
  };
}
// Postgres refuses UTC offsets of 16 hours or more.
const isoTime =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-](0\d|1[0-5])(:?[0-5]\d)?)$/;
// An ISO time Postgres accepts too: JavaScript also takes Feb 31 or year 0.
export function validTime(value) {
  if (typeof value !== 'string' || !isoTime.test(value)) return false;
  const [year, month, date] = value.slice(0, 10).split('-').map(Number),
    day = new Date(Date.UTC(year, month - 1, date));
  return (
    year >= 1 &&
    day.getUTCMonth() === month - 1 &&
    day.getUTCDate() === date &&
    Number.isFinite(Date.parse(value))
  );
}
// Order and keyset cursor for the list. `before` is `<created_at>|<id>` of the
// last row already shown, so rows archived or added meanwhile never shift a
// page. Clients should send the response's nextBefore, which has the exact
// microsecond time. The row's own created_at is used while the row exists, so
// a cursor built from a millisecond JSON time works too. If that row has been
// deleted, a time with less than microsecond precision is widened to the end
// of its millisecond (or second, or minute) when newest first: the next page
// may then repeat a row already shown, but never skips one.
// `index` is the number of the first of its two placeholders.
export function inboxPage(params, index) {
  const sort = params.get('sort') || 'newest',
    before = params.get('before') || '',
    [, at, id] = /^([^|]+)\|([^|]+)$/.exec(before) || [];
  if (
    !['newest', 'oldest'].includes(sort) ||
    (before && (!validTime(at) || !uuid.test(id || '')))
  )
    throw new RequestError(400, 'Choose a valid inbox page.');
  let fallback = at;
  if (before && sort === 'newest') {
    const [, seconds, fraction = ''] = /T\d\d:\d\d(:\d\d(?:\.(\d+))?)?/.exec(
      at,
    );
    if (fraction.length < 6)
      fallback = new Date(
        Date.parse(at) +
          (!seconds
            ? 60000
            : fraction.length > 3
              ? 1
              : 1000 / 10 ** fraction.length),
      ).toISOString();
    // Past year 9999 the ISO form changes; keep the time as sent.
    if (!validTime(fallback)) fallback = at;
  }
  const time = `coalesce((SELECT c.created_at FROM club_forms.entries c WHERE c.id=$${index + 1}::uuid),$${index}::timestamptz)`;
  return {
    values: before ? [fallback, id.toLowerCase()] : [null, null],
    where: ` AND ($${index + 1}::uuid IS NULL OR e.created_at${sort === 'oldest' ? '>' : '<'}${time} OR (e.created_at=${time} AND e.id>$${index + 1}::uuid))`,
    order: sort === 'oldest' ? 'e.created_at,e.id' : 'e.created_at DESC,e.id',
  };
}
// summary=1: long text is cut to a preview; the record fetches all of it.
export function summarize(data) {
  const result = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (typeof value !== 'string' || value.length <= 300) {
      result[key] = value;
      continue;
    }
    // Never split a surrogate pair.
    const high =
      value.charCodeAt(299) >= 0xd800 && value.charCodeAt(299) < 0xdc00;
    result[key] = value.slice(0, high ? 299 : 300);
    result._truncated = true;
  }
  return result;
}
const statuses = ['new', 'reviewed', 'closed'];
// Bulk review: each item carries the status the officer saw. One transaction,
// one audit row per changed entry. Up to 500 items, so a whole sweep can be
// undone in one request. Items already at the target status are `unchanged`
// (no audit row); items changed by someone else are skipped and reported with
// their current status and who set it.
export async function reviewMany(db, body, actor) {
  const items = body.items;
  if (
    !Array.isArray(items) ||
    !items.length ||
    items.length > 500 ||
    body.id != null ||
    body.comment != null ||
    !statuses.includes(body.status) ||
    items.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        !uuid.test(item.id || '') ||
        (item.from != null && !statuses.includes(item.from)),
    )
  )
    throw new RequestError(400, 'Invalid update.');
  const ids = items.map((item) => item.id.toLowerCase());
  if (new Set(ids).size !== ids.length)
    throw new RequestError(400, 'Invalid update.');
  return db.transaction(async (tx) => {
    const changed = new Set(
      (
        await tx.query(
          `WITH input AS (SELECT * FROM unnest($1::uuid[],$2::text[]) AS i(id,from_status)),
          updated AS (UPDATE club_forms.entries e SET review_status=$3 FROM input i WHERE e.id=i.id AND (i.from_status IS NULL OR e.review_status=i.from_status) AND e.review_status<>$3 RETURNING e.id),
          logged AS (INSERT INTO club_forms.audit(actor,entry_id,action) SELECT $4,id,$5 FROM updated)
          SELECT id FROM updated`,
          [
            ids,
            items.map((item) => item.from ?? null),
            body.status,
            actor,
            'review:' + body.status,
          ],
        )
      ).rows.map((row) => row.id),
    );
    const others = ids.filter((id) => !changed.has(id));
    const current = others.length
      ? (
          await tx.query(
            `SELECT i.id,e.review_status AS status,a.actor,a.created_at AS at
            FROM unnest($1::uuid[]) WITH ORDINALITY AS i(id,n)
            LEFT JOIN club_forms.entries e ON e.id=i.id
            LEFT JOIN LATERAL (SELECT actor,created_at FROM club_forms.audit WHERE entry_id=i.id AND (action LIKE 'review:%' OR action='resubmitted') ORDER BY id DESC LIMIT 1) a ON true
            ORDER BY i.n`,
            [others],
          )
        ).rows
      : [];
    const from = new Map(ids.map((id, n) => [id, items[n].from ?? null]));
    const same = (row) =>
      row.status === body.status &&
      [null, body.status].includes(from.get(row.id));
    return {
      saved: ids.filter((id) => changed.has(id)),
      unchanged: current.filter(same).map((row) => row.id),
      skipped: current.filter((row) => !same(row)),
    };
  });
}
// The RSVP and newsletter sweep: New to Reviewed only (Undo uses items[]).
// Only these informational kinds qualify, and only entries created at or
// before `before` (the list's asOf, never later than now), so anything that
// arrives meanwhile stays New. At most 500 per call; `more` says whether
// matching entries remain.
export async function reviewKinds(db, body, actor) {
  if (
    !Array.isArray(body.kinds) ||
    !body.kinds.length ||
    body.kinds.some((kind) => !['rsvp', 'subscribe'].includes(kind)) ||
    body.from !== 'new' ||
    body.status !== 'reviewed' ||
    !validTime(body.before)
  )
    throw new RequestError(400, 'Invalid update.');
  const kinds = [...new Set(body.kinds)];
  return db.transaction(async (tx) => {
    const saved = (
      await tx.query(
        `WITH picked AS (SELECT id FROM club_forms.entries WHERE kind=ANY($1::text[]) AND review_status=$2 AND created_at<=least($4::timestamptz,now()) ORDER BY created_at,id LIMIT 500),
        updated AS (UPDATE club_forms.entries e SET review_status=$3 FROM picked p WHERE e.id=p.id AND e.review_status=$2 RETURNING e.id,e.created_at),
        logged AS (INSERT INTO club_forms.audit(actor,entry_id,action) SELECT $5,id,$6 FROM updated)
        SELECT id FROM updated ORDER BY created_at,id`,
        [
          kinds,
          body.from,
          body.status,
          body.before,
          actor,
          'review:' + body.status,
        ],
      )
    ).rows.map((row) => row.id);
    const more = (
      await tx.query(
        'SELECT EXISTS(SELECT 1 FROM club_forms.entries WHERE kind=ANY($1::text[]) AND review_status=$2 AND created_at<=least($3::timestamptz,now())) AS more',
        [kinds, body.from, body.before],
      )
    ).rows[0].more;
    return { saved, more };
  });
}
// An officer records that someone cancelled an RSVP or withdrew a newsletter
// request, or undoes that. `from` is the state the officer saw.
const withdrawn = { rsvp: 'cancelled', subscribe: 'unsubscribed' };
export async function changeState(db, body, actor) {
  const states = ['active', 'cancelled', 'unsubscribed'];
  if (
    !uuid.test(body.id || '') ||
    !states.includes(body.state) ||
    (body.from != null && !states.includes(body.from))
  )
    throw new RequestError(400, 'Invalid update.');
  return db.transaction(async (tx) => {
    const entry = (
      await tx.query(
        'SELECT kind,state FROM club_forms.entries WHERE id=$1 FOR UPDATE',
        [body.id],
      )
    ).rows[0];
    if (!entry) throw new RequestError(404, 'Submission not found.');
    const allowed = ['active', withdrawn[entry.kind]];
    if (
      !withdrawn[entry.kind] ||
      !allowed.includes(body.state) ||
      (body.from != null && !allowed.includes(body.from))
    )
      throw new RequestError(
        400,
        'Only an RSVP can be cancelled, and only an AI Review subscription withdrawn.',
      );
    const item = entry.kind === 'rsvp' ? 'RSVP' : 'AI Review subscription';
    // Legacy 'pending' or 'suppressed' entries are not managed here.
    if (!allowed.includes(entry.state))
      throw new RequestError(
        409,
        `This ${item}'s state can't be changed here.`,
        { code: 'unsupported-state', current: { state: entry.state } },
      );
    if (body.from != null && entry.state !== body.from) {
      const last = (
        await tx.query(
          "SELECT actor,created_at FROM club_forms.audit WHERE entry_id=$1 AND (action LIKE 'state:%' OR action='resubmitted') ORDER BY id DESC LIMIT 1",
          [body.id],
        )
      ).rows[0];
      throw new RequestError(
        409,
        !last
          ? `Someone else already changed this ${item}. Reload to see it.`
          : last.actor === 'website'
            ? `They signed up again through the website, so this ${item} is active again.`
            : `${last.actor} already ${entry.state === 'active' ? 'restored' : entry.kind === 'rsvp' ? 'cancelled' : 'withdrew'} this ${item}.`,
        {
          code: 'stale-state',
          current: {
            state: entry.state,
            actor: last?.actor ?? null,
            at: last?.created_at ?? null,
          },
        },
      );
    }
    // A repeated request changes nothing and adds no second audit row.
    if (entry.state === body.state) return { saved: true, state: body.state };
    await tx.query('UPDATE club_forms.entries SET state=$2 WHERE id=$1', [
      body.id,
      body.state,
    ]);
    await tx.query(
      'INSERT INTO club_forms.audit(actor,entry_id,action) VALUES($1,$2,$3)',
      [actor, body.id, 'state:' + body.state],
    );
    return { saved: true, state: body.state };
  });
}
