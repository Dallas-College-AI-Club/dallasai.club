import { EVENTS_API_URL } from '../content/events.js';

export function eventSharing(event) {
  const root = document.createElement('section');
  root.className = 'event-sharing';
  root.setAttribute('aria-label', 'Share this event');
  const url =
    event.shortLink ||
    'https://dallasai.club/club.html?mode=events&event=' +
      encodeURIComponent(event.id);
  const qrURL = EVENTS_API_URL + '?qr=' + encodeURIComponent(event.id);
  const image = document.createElement('img');
  image.src = qrURL;
  image.alt = 'QR code for ' + event.title;
  image.width = image.height = 128;
  const controls = document.createElement('div');
  controls.className = 'event-share-controls';
  const title = document.createElement('strong');
  title.textContent = 'Scan or share this event';
  const actions = document.createElement('div');
  actions.className = 'event-share-actions';
  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'outline-link';
  share.textContent = 'Share event';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  share.onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ title: event.title, url });
      else {
        await navigator.clipboard.writeText(url);
        status.textContent = 'Event link copied.';
      }
    } catch (error) {
      if (error.name !== 'AbortError')
        status.textContent = 'Copy this event link: ' + url;
    }
  };
  const download = document.createElement('a');
  download.className = 'outline-link';
  download.textContent = 'Download QR';
  download.href = qrURL + '&download=1';
  download.download = event.id + '-qr.svg';
  actions.append(share, download);
  controls.append(title, actions, status);
  root.append(image, controls);
  if (event.rsvpDeadline) {
    const deadline = document.createElement('p');
    deadline.className = 'event-deadline';
    const date = document.createElement('time');
    date.dateTime = event.rsvpDeadline;
    date.textContent = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(event.rsvpDeadline + 'T12:00:00Z'));
    deadline.append('Please reply by ', date, '.');
    root.append(deadline);
  }
  return root;
}
