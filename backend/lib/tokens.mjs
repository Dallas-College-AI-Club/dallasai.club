import { createHmac, timingSafeEqual } from 'node:crypto';
import { RequestError } from './errors.mjs';
export function signToken(id, action, seconds = 172800, now = Date.now()) {
  const secret = process.env.FORM_TOKEN_SECRET;
  if (!secret || secret.length < 32)
    throw new RequestError(503, 'Confirmation links are not configured.');
  const value = Buffer.from(
    JSON.stringify({
      id,
      action,
      iat: now,
      exp: Math.floor(now / 1000) + seconds,
    }),
  ).toString('base64url');
  return (
    value + '.' + createHmac('sha256', secret).update(value).digest('base64url')
  );
}
export function verifyToken(token, now = Date.now()) {
  if (
    typeof token !== 'string' ||
    token.length > 1000 ||
    !process.env.FORM_TOKEN_SECRET
  )
    throw new RequestError(
      400,
      'This link is invalid or has expired. Please submit the form again.',
    );
  const [value, signature, extra] = token.split('.');
  const expected = createHmac('sha256', process.env.FORM_TOKEN_SECRET)
    .update(value || '')
    .digest('base64url');
  if (
    extra ||
    !signature ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new RequestError(
      400,
      'This link is invalid or has expired. Please submit the form again.',
    );
  let payload;
  try {
    payload = JSON.parse(Buffer.from(value, 'base64url'));
  } catch {
    throw new RequestError(400, 'Invalid link.');
  }
  if (
    !/^[a-f0-9-]{36}$/.test(payload.id) ||
    !['confirm', 'unsubscribe', 'cancel'].includes(payload.action) ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= now / 1000
  )
    throw new RequestError(
      400,
      'This link has expired. Please submit the form again.',
    );
  return payload;
}
