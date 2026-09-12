const toolbar = document.querySelector('.explore-toolbar'),
  world = document.querySelector('#world-view');
function closePanels(focus = false) {
  for (const panel of world.querySelectorAll('details[open]')) {
    panel.open = false;
    if (focus) panel.querySelector('summary').focus();
  }
}
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.drive-panel')) closePanels();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePanels(true);
});
toolbar.addEventListener('click', (event) => {
  if (event.target.closest('#journey-stops button')) closePanels();
});
new MutationObserver(() => {
  if (document.body.dataset.space !== 'explore') closePanels();
}).observe(document.body, { attributes: true, attributeFilter: ['data-space'] });
