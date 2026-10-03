export function eventImageViewer() {
  const dialog = document.createElement('dialog');
  dialog.className = 'event-image-viewer';
  dialog.setAttribute('aria-label', 'Enlarged event image');
  const close = document.createElement('button'),
    image = document.createElement('img');
  close.type = 'button';
  close.textContent = 'Close ×';
  close.className = 'outline-link';
  dialog.append(close, image);
  document.body.append(dialog);
  close.onclick = () => dialog.close();
  dialog.onclick = (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dialog.close();
  };
  dialog.addEventListener('close', () => {
    image.removeAttribute('src');
    image.alt = '';
  });
  return {
    open(source, alt) {
      image.src = source;
      image.alt = alt;
      dialog.showModal();
    },
    destroy() {
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}
