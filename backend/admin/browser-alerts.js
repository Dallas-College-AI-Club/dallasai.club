// The Browser alerts switch in the account menu. The choice is remembered on
// this browser; pop-ups appear only while a Club Office tab is open.
export function mountBrowserAlerts(toggle, status, onOpen) {
  const key = 'club-office-browser-alerts',
    usual = 'Pop-ups while this tab is open. Email alerts aren’t available.',
    blocked =
      'Your browser blocked alerts. Allow notifications for this site in browser settings.';
  let wanted = false;
  try {
    wanted = localStorage.getItem(key) === 'on';
  } catch {
    // Private windows may refuse storage; alerts then last for this visit.
  }
  const enabled = () =>
    wanted && 'Notification' in window && Notification.permission === 'granted';
  function render() {
    toggle.setAttribute('aria-checked', String(enabled()));
    status.textContent =
      wanted && 'Notification' in window && !enabled() ? blocked : usual;
  }
  function save() {
    try {
      localStorage.setItem(key, wanted ? 'on' : 'off');
    } catch {
      // Kept for this visit only.
    }
    render();
  }
  toggle.onclick = async () => {
    if (!('Notification' in window)) {
      status.textContent = 'This browser can’t show alerts.';
      return;
    }
    if (toggle.getAttribute('aria-disabled') === 'true') return;
    toggle.setAttribute('aria-disabled', 'true');
    try {
      // A refusal is remembered too, so the switch can say alerts are blocked.
      wanted =
        !enabled() && (await Notification.requestPermission()) !== 'default';
      save();
    } catch {
      wanted = false;
      save();
    } finally {
      toggle.removeAttribute('aria-disabled');
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
    // body: '3 new: 2 questions, 1 signup'. One tag, so a newer alert
    // replaces the older one; clicking it opens the Inbox in this tab.
    notify(body) {
      if (!enabled()) return;
      try {
        const alert = new Notification('Club Office', {
          body,
          tag: 'club-office-arrivals',
          renotify: true,
        });
        alert.onclick = () => {
          window.focus();
          onOpen();
          alert.close?.();
        };
      } catch {
        status.textContent = 'This browser couldn’t show the alert.';
      }
    },
  };
}
