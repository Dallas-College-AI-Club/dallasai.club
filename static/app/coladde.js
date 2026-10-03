import {
  createDiscoveries,
  DISCOVERY_POINTS,
  DISCOVERY_IDS,
} from '../storage/discoveries.js';
const discoveries = createDiscoveries();
let popup,
  active,
  pinned = false,
  timer,
  ignoreFocus;
export const coladdeMark = (id = 'footer') =>
  `<button type="button" class="coladde-mark ${id === 'footer' ? 'coladde-wordmark' : 'coladde-egg'}" data-coladde="${id}" aria-haspopup="dialog" aria-expanded="false" aria-controls="coladde-reveal">coladde</button>`;
export function closeColadde(returnFocus = false) {
  clearTimeout(timer);
  if (!active) return;
  const previous = active;
  active = null;
  pinned = false;
  previous.setAttribute('aria-expanded', 'false');
  popup.hidePopover?.();
  popup.hidden = true;
  document.dispatchEvent(
    new CustomEvent('club:coladde', { detail: { open: false } }),
  );
  if (
    returnFocus &&
    previous.isConnected &&
    previous !== document.activeElement
  ) {
    ignoreFocus = previous;
    previous.focus({ preventScroll: true });
  }
}
function position() {
  if (!active) return;
  if (!active.isConnected) return closeColadde();
  const anchor = active.getBoundingClientRect(),
    box = popup.getBoundingClientRect();
  popup.style.left =
    Math.max(12, Math.min(innerWidth - box.width - 12, anchor.left)) + 'px';
  const above = anchor.top - box.height - 10;
  popup.style.top =
    Math.max(
      12,
      Math.min(
        innerHeight - box.height - 12,
        above >= 12 ? above : anchor.bottom + 10,
      ),
    ) + 'px';
}
function reveal(button, pin = false) {
  clearTimeout(timer);
  if (active !== button) closeColadde();
  const alreadyOpen = active === button;
  active = button;
  pinned ||= pin;
  button.setAttribute('aria-expanded', 'true');
  const result =
    button.dataset.coladde === 'footer'
      ? discoveries.read()
      : discoveries.claim(button.dataset.coladde);
  const bonus = popup.querySelector('.coladde-bonus');
  bonus.hidden = !result.found.length;
  if (!alreadyOpen)
    bonus.textContent =
      (result.added
        ? `Nice find. +${DISCOVERY_POINTS} discovery points. `
        : '') +
      `${result.found.length} of ${DISCOVERY_IDS.length} hidden marks found · ${result.total} discovery points. ` +
      (result.persistent
        ? 'Saved on this device.'
        : 'For this visit only; browser storage is unavailable.');
  popup.hidden = false;
  if (!alreadyOpen) {
    popup.showPopover?.();
    document.dispatchEvent(new CustomEvent('club:pause-games'));
    document.dispatchEvent(
      new CustomEvent('club:coladde', { detail: { open: true } }),
    );
  }
  position();
  if (pin) popup.querySelector('button').focus({ preventScroll: true });
}
export function installColadde() {
  if (popup) return;
  popup = document.createElement('aside');
  popup.id = 'coladde-reveal';
  popup.className = 'coladde-reveal';
  popup.setAttribute('popover', 'manual');
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-labelledby', 'coladde-meaning');
  popup.hidden = true;
  popup.innerHTML = `<button type="button" class="coladde-close" aria-label="Close coladde meaning">×</button><span class="coladde-label">coladde</span><p id="coladde-meaning"><b>C</b>ommunity <b>O</b>f <b>L</b>earners <b>A</b>dvancing <b>D</b>allas College’s <b>D</b>igital <b>E</b>dge</p><p class="coladde-bonus" role="status" hidden></p>`;
  document.body.append(popup);
  popup.querySelector('button').onclick = () => closeColadde(true);
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const mark = event.target.closest('[data-coladde]');
    if (mark) reveal(mark);
    else if (popup.contains(event.target)) clearTimeout(timer);
  });
  document.addEventListener('pointerout', (event) => {
    if (
      !active ||
      pinned ||
      (!active.contains(event.target) && !popup.contains(event.target))
    )
      return;
    if (
      active.contains(event.relatedTarget) ||
      popup.contains(event.relatedTarget)
    )
      return;
    timer = setTimeout(() => {
      if (
        !pinned &&
        !active?.matches(':focus-visible') &&
        !popup.contains(document.activeElement)
      )
        closeColadde();
    }, 200);
  });
  document.addEventListener('focusin', (event) => {
    const mark = event.target.closest('[data-coladde]');
    if (ignoreFocus && mark === ignoreFocus) {
      ignoreFocus = null;
      return;
    }
    if (mark) reveal(mark);
    else if (!popup.contains(event.target)) closeColadde();
  });
  document.addEventListener('click', (event) => {
    const mark = event.target.closest('[data-coladde]');
    if (mark) {
      event.preventDefault();
      reveal(mark, true);
    } else if (!popup.contains(event.target)) closeColadde();
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && active) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeColadde(true);
      }
    },
    true,
  );
  document.addEventListener(
    'scroll',
    (event) => {
      if (!popup.contains(event.target)) position();
    },
    true,
  );
  window.addEventListener('resize', position);
  window.addEventListener('pagehide', () => closeColadde());
  document.addEventListener('club:search', (event) => {
    if (event.detail?.open) closeColadde();
  });
}
