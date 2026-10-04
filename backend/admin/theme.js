// Runs before the stylesheet so a saved appearance is applied before paint.
(() => {
  const key = 'club-office-appearance',
    media = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    preference = localStorage.getItem(key) || 'system';
  } catch {}
  if (!['light', 'dark', 'system'].includes(preference)) preference = 'system';
  function apply() {
    document.documentElement.dataset.theme =
      preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.querySelectorAll('[data-appearance]').forEach((button) => {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.appearance === preference),
      );
    });
  }
  apply();
  media.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-appearance]').forEach((button) => {
      button.onclick = () => {
        preference = button.dataset.appearance;
        try {
          localStorage.setItem(key, preference);
        } catch {}
        apply();
      };
    });
    apply();
  });
})();
