import { createHmac } from 'node:crypto';
import { RequestError } from './errors.mjs';

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(status === 204 ? undefined : JSON.stringify(body));
}
export function fail(res, error) {
  if (!(error instanceof RequestError))
    console.error('Club forms request failed', {
      code: error.code || 'internal',
    });
  return send(res, error instanceof RequestError ? error.status : 503, {
    error:
      error instanceof RequestError
        ? error.message
        : 'This service is temporarily unavailable. Your information has not been cleared; please try again.',
  });
}
export function cors(req, res) {
  const allowed = new Set([
    'https://dallasai.club',
    'https://www.dallasai.club',
    ...(process.env.FORMS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  ]);
  if (!process.env.VERCEL) {
    allowed.add('http://127.0.0.1:4174');
    allowed.add('http://localhost:4174');
  }
  const origin = req.headers.origin;
  if (!origin || !allowed.has(origin))
    throw new RequestError(403, 'This website is not allowed to submit forms.');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    send(res, 204);
    return false;
  }
  if (req.method !== 'POST') throw new RequestError(405, 'Use POST.');
  return true;
}
export async function rawBody(req, max = 3000000) {
  if (Number(req.headers['content-length']) > max)
    throw new RequestError(413, 'Keep all attachments under 2 MB in total.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > max)
      throw new RequestError(413, 'This submission is too large.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function jsonBody(req, max = 3000000) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
    throw new RequestError(415, 'Send JSON.');
  let value = req.body;
  if (value === undefined) value = await rawBody(req, max);
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  try {
    if (typeof value === 'string') {
      if (Buffer.byteLength(value) > max)
        throw new RequestError(413, 'This submission is too large.');
      value = JSON.parse(value);
    }
    if (!value || Array.isArray(value) || typeof value !== 'object')
      throw new Error();
    if (Buffer.byteLength(JSON.stringify(value)) > max)
      throw new RequestError(413, 'This submission is too large.');
    return value;
  } catch (e) {
    if (e instanceof RequestError) throw e;
    throw new RequestError(400, 'Please check the form and try again.');
  }
}
export async function limit(db, req, scope, maximum = 12, seconds = 3600) {
  const secret = process.env.FORM_TOKEN_SECRET;
  if (!secret || secret.length < 32)
    throw new RequestError(503, 'Forms are not configured yet.');
  const ip = process.env.VERCEL
    ? String(req.headers['x-vercel-forwarded-for'] || 'unknown').split(',')[0]
    : req.socket?.remoteAddress || 'local';
  const key = createHmac('sha256', secret)
    .update(`${scope}:${ip}`)
    .digest('hex');
  const { rows } = await db.query(
    `INSERT INTO club_forms.rate_limits(key,count,expires_at)
    VALUES($1,1,now()+$2 * interval '1 second') ON CONFLICT(key) DO UPDATE SET
    count = CASE WHEN club_forms.rate_limits.expires_at < now() THEN 1 ELSE club_forms.rate_limits.count+1 END,
    expires_at = CASE WHEN club_forms.rate_limits.expires_at < now() THEN EXCLUDED.expires_at ELSE club_forms.rate_limits.expires_at END RETURNING count`,
    [key, seconds],
  );
  if (rows[0].count > maximum)
    throw new RequestError(429, 'Too many requests. Please try again later.');
}
