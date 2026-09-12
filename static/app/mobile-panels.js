const q = (s) => document.querySelector(s);
function closeButton(parent, label, close) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'panel-close';
  b.setAttribute('aria-label', label);
  b.textContent = '×';
  b.onclick = (e) => {
    e.stopPropagation();
    close();
  };
  parent.prepend(b);
  return b;
}
for (const panel of document.querySelectorAll('.drive-panel')) {
  closeButton(
    panel.querySelector('.drive-panel-body'),
    'Close ' + panel.querySelector('summary').textContent.trim(),
    () => {
      panel.open = false;
      panel.querySelector('summary').focus({ preventScroll: true });
    },
  );
}
closeButton(q('#score-guide'), 'Close points guide', () => {
  q('#score-guide').hidden = true;
  q('#score-guide-toggle').setAttribute('aria-expanded', 'false');
});
closeButton(q('#arrival-preview'), 'Close page preview', () => {
  q('#arrival-preview').hidden = true;
  q('#preview-toggle').setAttribute('aria-expanded', 'false');
});
const exit = document.createElement('a');
exit.className = 'drive-immersive-exit';
exit.href = 'club.html?mode=play';
exit.textContent = '← All games';
q('#journey-stage').append(exit);
