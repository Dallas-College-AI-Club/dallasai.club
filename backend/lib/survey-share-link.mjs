import { RequestError } from './errors.mjs';
import { surveyId } from './survey-respondents.mjs';
import { builderLinks } from './survey-builder.mjs';
import { digest } from './custom-surveys.mjs';

function shortLink(value) {
  if (typeof value !== 'string')
    throw new RequestError(
      400,
      'Enter an HTTPS short link, or leave it blank.',
    );
  const link = value.trim();
  if (!link) return null;
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new RequestError(400, 'Enter a valid HTTPS short link.');
  }
  const host = url.hostname,
    labels = host.split('.');
  if (
    link.length > 2048 ||
    url.href.length > 2048 ||
    !/^https:\/\//i.test(link) ||
    /[\x00-\x20\x7f\\]/.test(link) ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    host.length > 253 ||
    labels.length < 2 ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
    ) ||
    !/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/i.test(labels.at(-1)) ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test|example|onion|home|lan)$/i.test(
      host,
    )
  )
    throw new RequestError(
      400,
      'Enter an HTTPS short link with a public hostname and no login details.',
    );
  return url.href;
}

export async function changeSurveyShareLink(db, actor, body) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) => !['id', 'shortLink', 'expectedShortLink'].includes(key),
    )
  )
    throw new RequestError(400, 'Check the survey short link.');
  const id = surveyId(body.id),
    link = shortLink(body.shortLink),
    expected =
      body.expectedShortLink === null
        ? null
        : shortLink(body.expectedShortLink);
  return db.transaction(async (tx) => {
    const survey = (
      await tx.query(
        'SELECT short_link FROM club_forms.custom_surveys WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0];
    if (!survey) throw new RequestError(404, 'Survey not found.');
    if (survey.short_link === link) return { id, short_link: link };
    if (survey.short_link !== expected)
      throw new RequestError(
        409,
        'The short link changed. Refresh surveys and try again.',
      );
    await tx.query(
      'UPDATE club_forms.custom_surveys SET short_link=$2 WHERE id=$1',
      [id, link],
    );
    await tx.query('INSERT INTO club_forms.audit(actor,action) VALUES($1,$2)', [
      actor.email,
      'custom-survey-share-link:' + id,
    ]);
    return { id, short_link: link };
  });
}

async function createShortIo(target, alias, fetchImpl, signal) {
  const token = process.env.SHORT_IO_API_KEY,
    domain = process.env.SHORT_IO_DOMAIN;
  try {
    if (
      !token ||
      !domain ||
      shortLink('https://' + domain + '/') !== 'https://' + domain + '/' ||
      new URL('https://' + domain + '/').hostname !== domain
    )
      throw new Error();
  } catch {
    throw new RequestError(503, 'Short links are not configured yet.');
  }
  const link = 'https://' + domain + '/' + alias,
    headers = {
      Authorization: token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  try {
    let response = await fetchImpl('https://api.short.io/links', {
      method: 'POST',
      headers,
      signal,
      redirect: 'error',
      body: JSON.stringify({
        originalURL: target,
        domain,
        path: alias,
        allowDuplicates: false,
      }),
    });
    // Short.io reuses a matching path and destination. On a conflict, inspect
    // that exact path; never update its destination or choose a random fallback.
    const conflict = response.status === 409;
    if (conflict)
      response = await fetchImpl(
        'https://api.short.io/links/expand?' +
          new URLSearchParams({ domain, path: alias }),
        {
          method: 'GET',
          headers,
          signal,
          redirect: 'error',
        },
      );
    if (response.status !== 200) throw new Error();
    const data = await response.json();
    if (
      conflict &&
      typeof data?.originalURL === 'string' &&
      data.originalURL !== target &&
      data.path === alias &&
      data.secureShortURL === link
    )
      throw new RequestError(409, 'That short-link path is already in use.');
    if (
      data?.originalURL !== target ||
      data.path !== alias ||
      data.secureShortURL !== link ||
      data.success === false ||
      data.hasPassword !== false ||
      data.archived !== false ||
      data.cloaking ||
      data.androidURL ||
      data.iphoneURL ||
      data.splitURL ||
      (data.expiresAt != null &&
        !(new Date(data.expiresAt).getTime() > Date.now()))
    )
      throw new Error();
  } catch (error) {
    if (error instanceof RequestError && error.status === 409) throw error;
    // Provider errors can contain the token or private invitation. Neither is
    // copied into the response, audit, or general request-error logger.
    throw new RequestError(
      503,
      'Could not create the short link. Try again or enter one.',
    );
  }
  return link;
}

async function createTinyUrl(target, alias, fetchImpl, signal) {
  const token = process.env.TINYURL_API_TOKEN;
  if (!token)
    throw new RequestError(503, 'Short links are not configured yet.');
  const link = 'https://tinyurl.com/' + alias,
    headers = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  try {
    let response = await fetchImpl('https://api.tinyurl.com/create', {
      method: 'POST',
      headers,
      signal,
      redirect: 'error',
      body: JSON.stringify({ url: target, domain: 'tinyurl.com', alias }),
    });
    const conflict = response.status === 422;
    if (conflict)
      response = await fetchImpl(
        'https://api.tinyurl.com/alias/tinyurl.com/' + alias,
        {
          method: 'GET',
          headers,
          signal,
          redirect: 'error',
        },
      );
    if (response.status !== 200) throw new Error();
    const payload = await response.json(),
      data = payload?.data;
    if (
      conflict &&
      payload?.code === 0 &&
      typeof data?.url === 'string' &&
      data.url !== target &&
      data.alias === alias &&
      data.domain === 'tinyurl.com' &&
      data.tiny_url === link
    )
      throw new RequestError(409, 'That short-link path is already in use.');
    if (
      payload?.code !== 0 ||
      !Array.isArray(payload.errors) ||
      payload.errors.length ||
      data?.url !== target ||
      data.domain !== 'tinyurl.com' ||
      data.alias !== alias ||
      data.tiny_url !== link ||
      data.deleted !== false ||
      data.archived !== false ||
      (data.expires_at !== null &&
        !(new Date(data.expires_at).getTime() > Date.now()))
    )
      throw new Error();
    return link;
  } catch (error) {
    if (error instanceof RequestError && error.status === 409) throw error;
    throw new RequestError(
      503,
      'Could not create the short link. Try again or enter one.',
    );
  }
}

export async function createShortLink(
  targetUrl,
  alias,
  fetchImpl = fetch,
  domain = '',
) {
  const target = shortLink(targetUrl);
  if (
    !target ||
    typeof alias !== 'string' ||
    !/^(?:[a-z0-9_-]{5,30}|[a-z0-9_-]{5,30}-feedback)$/i.test(alias)
  )
    throw new RequestError(400, 'Check the short-link destination and path.');
  const deadline = AbortSignal.timeout(8000),
    providerSignal = () =>
      AbortSignal.any([deadline, AbortSignal.timeout(4000)]);
  if (domain) {
    if (domain === process.env.SHORT_IO_DOMAIN)
      return createShortIo(target, alias, fetchImpl, providerSignal());
    if (domain === 'tinyurl.com')
      return createTinyUrl(target, alias, fetchImpl, providerSignal());
    throw new RequestError(
      409,
      'The event short-link provider is not configured.',
    );
  }
  try {
    return await createShortIo(target, alias, fetchImpl, providerSignal());
  } catch (primaryError) {
    try {
      return await createTinyUrl(target, alias, fetchImpl, providerSignal());
    } catch (fallbackError) {
      if (primaryError.status === 409 && !process.env.TINYURL_API_TOKEN)
        throw primaryError;
      // An uncertain acknowledgement may have created the original alias.
      // Only report a collision when every configured provider confirmed it.
      if (
        fallbackError.status === 409 &&
        primaryError.status !== 409 &&
        process.env.SHORT_IO_API_KEY &&
        process.env.SHORT_IO_DOMAIN
      )
        throw primaryError;
      throw fallbackError;
    }
  }
}

export async function generateSurveyShareLink(
  db,
  actor,
  body,
  fetchImpl = fetch,
) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== 'id')
  )
    throw new RequestError(400, 'Choose a survey to shorten.');
  const id = surveyId(body.id);
  return db.transaction(async (tx) => {
    const survey = (
      await tx.query(
        'SELECT * FROM club_forms.custom_surveys WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0];
    if (!survey) throw new RequestError(404, 'Survey not found.');
    const invitation = builderLinks(survey).privateLink;
    if (!invitation || new URL(invitation).protocol !== 'https:')
      throw new RequestError(
        409,
        'Publish an available survey before creating its short link.',
      );
    if (survey.short_link) return { id, short_link: survey.short_link };
    const link = await createShortLink(
      invitation,
      'ai-' + digest(invitation).slice(0, 24),
      fetchImpl,
    );
    if (new Date(survey.expires_at) <= new Date())
      throw new RequestError(409, 'This survey has expired.');
    await tx.query(
      'UPDATE club_forms.custom_surveys SET short_link=$2 WHERE id=$1',
      [id, link],
    );
    await tx.query('INSERT INTO club_forms.audit(actor,action) VALUES($1,$2)', [
      actor.email,
      'custom-survey-share-link:' + id,
    ]);
    return { id, short_link: link };
  });
}
