const choices = {
  theme: ['studio', 'midnight', 'clay'],
  font: ['geist', 'dm', 'space'],
  layout: ['desk', 'gallery', 'focus'],
};
export function mountPreferences() {
  let saved = {};
  try {
    saved =
      JSON.parse(localStorage.getItem('club-office-appearance') || '{}') || {};
  } catch {}
  for (const [key, options] of Object.entries(choices)) {
    const input = document.getElementById('office-' + key);
    const apply = () => {
      document.documentElement.dataset[key] = input.value;
    };
    input.value = options.includes(saved[key]) ? saved[key] : options[0];
    apply();
    input.onchange = () => {
      apply();
      saved[key] = input.value;
      try {
        localStorage.setItem('club-office-appearance', JSON.stringify(saved));
      } catch {}
    };
  }
}
