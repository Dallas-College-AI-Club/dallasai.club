export function mountBrowserAlerts(button, status) {
  const key = 'club-office-browser-alerts';
  let wanted = false,
    remembered = true;
  try {
    wanted = localStorage.getItem(key) === 'on';
  } catch {
    remembered = false;
  }
  const enabled = () =>
    wanted && 'Notification' in window && Notification.permission === 'granted';
  function render() {
    button.textContent = enabled()
      ? 'Turn off browser alerts'
      : 'Enable browser alerts';
    button.setAttribute('aria-pressed', String(enabled()));
    status.textContent = enabled()
      ? 'Browser alerts are on' +
        (remembered ? ' and remembered on this browser' : ' for this visit') +
        '. Keep the office open and signed in to receive them. No alerts are sent when it is closed. Email alerts are not connected.'
      : wanted &&
          'Notification' in window &&
          Notification.permission !== 'granted'
        ? 'Notifications are blocked in this browser. Allow them in the browser’s site settings, then enable alerts here. New counts still appear in the inbox.'
        : 'Browser alerts are off. New counts still appear here. Email alerts are not connected.';
  }
  function save() {
    try {
      localStorage.setItem(key, wanted ? 'on' : 'off');
      remembered = true;
    } catch {
      remembered = false;
    }
    render();
  }
  button.onclick = async () => {
    if (!('Notification' in window)) {
      status.textContent =
        'This browser does not support alerts. New counts and the inbox still refresh automatically.';
      return;
    }
    button.disabled = true;
    try {
      wanted = enabled()
        ? false
        : (await Notification.requestPermission()) === 'granted';
      save();
      if (!wanted && Notification.permission !== 'granted')
        status.textContent =
          'Browser alerts were not enabled. Allow notifications in your browser’s site settings, then try again. New counts still appear here.';
    } catch {
      wanted = false;
      save();
      status.textContent =
        'Browser alerts are unavailable here. New counts still appear in the inbox.';
    } finally {
      button.disabled = false;
    }
  };
  window.addEventListener('focus', render);
  window.addEventListener('storage', (event) => {
    if (event.key === key) {
      wanted = event.newValue === 'on';
      render();
    }
  });
  render();
  return {
    get enabled() {
      return enabled();
    },
    notify() {
      if (!enabled()) return;
      try {
        new Notification('Dallas AI Club', {
          body: 'New submissions are waiting in the club inbox.',
          tag: 'club-inbox',
        });
      } catch {
        status.textContent =
          'This browser could not display the alert. New submissions are visible in the inbox.';
      }
    },
  };
}
