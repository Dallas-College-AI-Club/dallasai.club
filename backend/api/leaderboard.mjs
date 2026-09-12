import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { neon } from '@neondatabase/serverless';

const games = new Set(['explore', 'ride', 'snake']);
// Anonymous player sessions are available to the website and its local Hugo preview.
const origins = new Set([
  'https://dallasai.club',
  'https://www.dallasai.club',
  'http://127.0.0.1:4174',
  'http://localhost:4174',
]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const digest = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');
const issueToken = (secret) => {
  const value = `v1.${randomUUID()}`;
  return `${value}.${digest(secret, value)}`;
};
function playerIdFromToken(secret, header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer '))
    throw new RequestError(401, 'Your player session is unavailable. Please try saving again.');
  const token = header.slice(7);
  const [version, id, signature, extra] = token.split('.');
  if (
    version !== 'v1' ||
    !uuid.test(id || '') ||
    !/^[a-f0-9]{64}$/.test(signature || '') ||
    extra !== undefined
  )
    throw new RequestError(401, 'Your player session is unavailable. Please try saving again.');
  const expected = digest(secret, `${version}.${id}`);
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex')))
    throw new RequestError(401, 'Your player session is unavailable. Please try saving again.');
  return id;
}
async function bodyOf(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
    throw new RequestError(415, 'Send JSON.');
  if (Number(req.headers['content-length']) > 2048)
    throw new RequestError(413, 'Request too large.');
  let body;
  try {
    body = req.body;
  } catch {
    // Vercel parses JSON lazily when req.body is read.
    throw new RequestError(400, 'Invalid JSON.');
  }
  if (body === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > 2048) throw new RequestError(413, 'Request too large.');
      chunks.push(Buffer.from(chunk));
    }
    body = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > 2048) throw new RequestError(413, 'Request too large.');
    try {
      body = JSON.parse(body);
    } catch {
      throw new RequestError(400, 'Invalid JSON.');
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new RequestError(400, 'Invalid request.');
  if (Buffer.byteLength(JSON.stringify(body)) > 2048)
    throw new RequestError(413, 'Request too large.');
  return body;
}

export default async function leaderboard(req, res) {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(req.method === 'HEAD' || status === 204 ? undefined : JSON.stringify(body));
  };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Origin');
  try {
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) throw new RequestError(403, 'Origin not allowed.');
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '600');
      return send(204);
    }
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD, POST, OPTIONS');
      throw new RequestError(405, 'Method not allowed.');
    }
    if (req.method === 'POST' && !origin) throw new RequestError(403, 'Origin required.');
    const secret = process.env.SESSION_SECRET;
    const connection = process.env.DATABASE_URL;
    if (!secret || secret.length < 32 || !connection)
      throw new RequestError(503, 'Rankings are not configured.');
    const sql = neon(connection, { fetchOptions: { signal: AbortSignal.timeout(10000) } });
    const forwarded = String(
      req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || '',
    )
      .split(',')[0]
      .trim();
    const ip = process.env.VERCEL
      ? isIP(forwarded)
        ? forwarded
        : 'unknown'
      : req.socket?.remoteAddress || 'local';
    const limit = async (scope, key) => {
      const hash = digest(secret, `${scope}:${key}`);
      const [result] = await sql`SELECT leaderboard.consume_request(${hash}, ${scope}) AS allowed`;
      if (!result.allowed) {
        res.setHeader('Retry-After', scope === 'session' ? '3600' : '60');
        throw new RequestError(429, 'Too many requests. Please try again later.');
      }
    };
    if (req.method === 'GET' || req.method === 'HEAD') {
      const query = new URL(req.url, 'https://backend.invalid').searchParams;
      const game = query.get('game') || 'explore';
      const day = query.get('date') || 'all';
      if (!games.has(game)) throw new RequestError(400, 'Unknown game.');
      if (
        day !== 'all' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          !Number.isFinite(Date.parse(day)) ||
          new Date(day).toISOString().slice(0, 10) !== day)
      )
        throw new RequestError(400, 'Invalid date.');
      await limit('read', ip);
      const entries = await sql`SELECT nickname, score, game, date::text AS date, "savedAt"
                  FROM leaderboard.list_scores(${game}, ${day === 'all' ? null : day}::date)`;
      return send(200, { entries });
    }
    const body = await bodyOf(req);
    if (body.action === 'session') {
      await limit('session', ip);
      return send(200, { token: issueToken(secret) });
    }
    if (body.action !== 'score') throw new RequestError(400, 'Unknown action.');
    const id = playerIdFromToken(secret, req.headers.authorization);
    const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
    if (
      !/^[\p{L}\p{N} _.-]{2,20}$/u.test(nickname) ||
      !games.has(body.game) ||
      !Number.isInteger(body.score) ||
      body.score < 1 ||
      body.score > 1000000
    )
      throw new RequestError(400, 'Check your nickname, game and score.');
    await limit('write', ip);
    await limit('player', id);
    const [entry] = await sql`SELECT nickname, score, game, date::text AS date, "savedAt"
                FROM leaderboard.submit_score(${id}::uuid, ${nickname}, ${body.game}, ${body.score})`;
    return send(200, { entry });
  } catch (error) {
    if (error instanceof RequestError) return send(error.status, { error: error.message });
    if (error.code === '42501') return send(403, { error: 'This player cannot submit scores.' });
    if (['22023', '22007', '22008', '23514'].includes(error.code))
      return send(400, { error: 'Invalid score request.' });
    return send(503, { error: 'Rankings are unavailable. Please try again.' });
  }
}
