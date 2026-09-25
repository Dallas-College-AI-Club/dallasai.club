import { RequestError } from './errors.mjs';
export const kinds = ['subscribe', 'join', 'rsvp', 'contribution', 'workshop'];
export const campuses = [
  'Brookhaven',
  'Cedar Valley',
  'Eastfield',
  'El Centro',
  'Mountain View',
  'North Lake',
  'Richland',
  'Other / community',
];
export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function email(value) {
  const result = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (result.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(result))
    throw new RequestError(400, 'Enter a valid email address.');
  return result;
}
function text(value, label, max, required = true) {
  if (value !== undefined && typeof value !== 'string')
    throw new RequestError(400, `Check ${label}.`);
  const result = (value || '').trim();
  if (
    (required && !result) ||
    result.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(result)
  )
    throw new RequestError(400, `Check ${label} (maximum ${max} characters).`);
  return result;
}
export function validate(body, events = [], now = new Date()) {
  if (!kinds.includes(body.kind)) throw new RequestError(400, 'Unknown form.');
  if (!uuid.test(body.requestId || ''))
    throw new RequestError(400, 'Refresh the page and try again.');
  if (body.consent !== true)
    throw new RequestError(400, 'Please agree to the form consent.');
  const result = {
    kind: body.kind,
    email: email(body.email),
    name: '',
    data: {},
    files: [],
  };
  if (body.kind !== 'subscribe')
    result.name = text(body.name, 'your name', 100);
  if (body.kind === 'join') {
    if (!campuses.includes(body.campus))
      throw new RequestError(400, 'Choose your campus.');
    result.data = {
      campus: body.campus,
      interests: text(body.interests, 'your interests', 1500, false),
    };
  }
  if (body.kind === 'rsvp') {
    const event = events.find((e) => e.id === body.eventId);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    if (
      !event ||
      (/^\d{4}-\d{2}-\d{2}$/.test(event.date)
        ? event.date < today
        : new Date(event.end || event.date) <= now)
    )
      throw new RequestError(
        400,
        'Registration for this event is unavailable.',
      );
    result.data = {
      eventId: event.id,
      eventTitle: event.title,
      eventDate: event.date,
      location: event.location || '',
    };
  }
  if (body.kind === 'workshop')
    result.data = {
      topic: text(body.topic, 'the topic', 160),
      details: text(body.details, 'the details', 3000, false),
    };
  if (body.kind === 'contribution') {
    result.data = {
      title: text(body.title, 'the title', 140),
      body: text(body.body, 'your draft', 40000, false),
    };
    result.files = validateFiles(body.files || []);
    if (!result.data.body && !result.files.length)
      throw new RequestError(400, 'Write a draft or attach a file.');
  } else if (body.files?.length)
    throw new RequestError(400, 'This form does not accept attachments.');
  result.dedupeKey = ['subscribe', 'join'].includes(body.kind)
    ? `${body.kind}:${result.email}`
    : body.kind === 'rsvp'
      ? `rsvp:${result.data.eventId}:${result.email}`
      : `${body.kind}:${body.requestId}`;
  return result;
}
export function validateFiles(files) {
  if (!Array.isArray(files) || files.length > 3)
    throw new RequestError(400, 'Attach up to three files.');
  let total = 0;
  return files.map((file) => {
    const name = text(file?.name, 'the file name', 160);
    if (/[\\/\r\n]/.test(name))
      throw new RequestError(
        400,
        'Use a file name without slashes or line breaks.',
      );
    const extension = name.toLowerCase().split('.').pop();
    const types = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      txt: 'text/plain',
      md: 'text/plain',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    if (
      !types[extension] ||
      typeof file.content !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        file.content,
      )
    )
      throw new RequestError(
        400,
        'Use PDF, DOCX, TXT, Markdown, PNG, or JPG files.',
      );
    const bytes = Buffer.from(file.content, 'base64');
    total += bytes.length;
    if (!bytes.length || total > 2097152)
      throw new RequestError(413, 'Keep all attachments under 2 MB in total.');
    const valid =
      extension === 'pdf'
        ? bytes.subarray(0, 5).toString() === '%PDF-'
        : extension === 'png'
          ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
          : ['jpg', 'jpeg'].includes(extension)
            ? bytes.subarray(0, 3).toString('hex') === 'ffd8ff'
            : extension === 'docx'
              ? bytes.subarray(0, 4).toString('hex') === '504b0304'
              : !bytes.includes(0);
    if (!valid)
      throw new RequestError(
        400,
        `The contents of ${name} do not match its file type.`,
      );
    return { name, bytes, contentType: types[extension] };
  });
}
