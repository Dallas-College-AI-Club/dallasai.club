const $ = (s) => document.querySelector(s),
  hover = matchMedia('(hover:hover)'),
  arrival = $('#walk-arrival'),
  preview = $('#arrival-preview'),
  enter = $('#enter-place'),
  toggle = $('#preview-toggle'),
  score = $('#score-guide-toggle'),
  guide = $('#score-guide');
const desktopHover = () => hover.matches && innerWidth > 800;
let previewTimer, guideTimer;
function placePreview() {
  preview.style.top = '';
  preview.style.bottom = '';
  if (innerWidth <= 600 && !preview.hidden) {
    const stage = $('#journey-stage').getBoundingClientRect(),
      card = arrival.getBoundingClientRect();
    preview.style.top = Math.max(stage.top + 16 - card.top, -preview.offsetHeight - 12) + 'px';
    preview.style.bottom = 'auto';
  }
}
function showPreview(value) {
  if (value && preview.hidden)
    window.dispatchEvent(new CustomEvent('drive-page-preview', { detail: preview.dataset.page }));
  clearTimeout(previewTimer);
  preview.hidden = !value;
  toggle.setAttribute('aria-expanded', String(value));
  if (value) placePreview();
}
window.addEventListener('resize', placePreview);
function showGuide(value) {
  clearTimeout(guideTimer);
  guide.hidden = !value;
  score.setAttribute('aria-expanded', String(value));
}
enter.addEventListener('pointerenter', () => {
  if (desktopHover()) showPreview(true);
});
enter.addEventListener('focus', () => {
  if (desktopHover()) showPreview(true);
});
preview.addEventListener('pointerenter', () => clearTimeout(previewTimer));
arrival.addEventListener(
  'pointerleave',
  () => (previewTimer = setTimeout(() => showPreview(false), 150)),
);
arrival.addEventListener('focusout', (e) => {
  if (!arrival.contains(e.relatedTarget)) showPreview(false);
});
toggle.onclick = () => showPreview(preview.hidden);
score.addEventListener('pointerenter', () => {
  if (desktopHover()) showGuide(true);
});
score.addEventListener('pointerleave', () => {
  if (desktopHover()) guideTimer = setTimeout(() => showGuide(false), 150);
});
score.addEventListener('focus', () => {
  if (desktopHover()) showGuide(true);
});
score.addEventListener('blur', () => {
  if (desktopHover()) showGuide(false);
});
score.onclick = () => showGuide(guide.hidden);
guide.addEventListener('pointerenter', () => clearTimeout(guideTimer));
guide.addEventListener('pointerleave', () => {
  if (desktopHover()) guideTimer = setTimeout(() => showGuide(false), 150);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    showPreview(false);
    showGuide(false);
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!arrival.contains(e.target)) showPreview(false);
  if (!score.contains(e.target) && !guide.contains(e.target)) showGuide(false);
});
