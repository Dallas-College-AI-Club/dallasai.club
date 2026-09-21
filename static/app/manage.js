import { request } from './form-client.js';
const token = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState({}, '', location.pathname);
const button = document.querySelector('#confirm'),
  status = document.querySelector('#status');
let action;
try {
  action = JSON.parse(
    atob(token.split('.')[0].replaceAll('-', '+').replaceAll('_', '/')),
  ).action;
} catch {}
const labels = {
  confirm: 'Confirm my email',
  unsubscribe: 'Unsubscribe',
  cancel: 'Cancel my RSVP',
};
if (!labels[action]) {
  button.hidden = true;
  status.textContent =
    'This link is incomplete. Please open the full link from your email.';
} else {
  button.textContent = labels[action];
  document.querySelector('#heading').textContent = labels[action];
}
button.onclick = async () => {
  button.disabled = true;
  status.textContent = 'Saving…';
  try {
    const result = await request('manage', { token });
    status.textContent = result.message;
    button.hidden = true;
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
};
