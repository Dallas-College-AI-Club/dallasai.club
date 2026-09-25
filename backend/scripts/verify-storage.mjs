import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { put, get, del } from '@vercel/blob';
const settings = await fs.readFile(
  path.join(
    process.env.LOCALAPPDATA,
    'dallasai-club-website',
    'secrets.env.forms',
  ),
  'utf8',
);
const token = settings.match(/^BLOB_READ_WRITE_TOKEN=(.+)$/m)?.[1].trim();
if (!token || token === '[SENSITIVE]')
  throw new Error(
    'The private storage token could not be retrieved; connect a local token before testing.',
  );
const pathname = 'connection-checks/' + randomUUID() + '.txt';
let blob;
try {
  blob = await put(pathname, 'Dallas AI Club storage connection check', {
    access: 'private',
    token,
    addRandomSuffix: false,
  });
  const file = await get(blob.pathname, { access: 'private', token });
  if (
    file?.statusCode !== 200 ||
    (await new Response(file.stream).text()) !==
      'Dallas AI Club storage connection check'
  )
    throw new Error('Authenticated download failed.');
  const unauthenticated = await fetch(blob.url, {
    signal: AbortSignal.timeout(10000),
  });
  if (unauthenticated.ok)
    throw new Error('The attachment was readable without authentication.');
  console.log(
    'Private upload and authenticated download passed; unauthenticated access was denied.',
  );
} finally {
  if (blob) {
    await del(blob.pathname, { token });
    console.log('Removed the temporary storage-check file.');
  }
}
