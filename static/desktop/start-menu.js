const EDGE_GAP = 8;
const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

export function mountStartMenu(root) {
  const shell = root.querySelector('.r95-shell');
  const start = root.querySelector('.r95-start');
  const menu = root.querySelector('.r95-start-menu');
  const projectsButton = root.querySelector('.r95-start-projects');
  const projectMenu = root.querySelector('.r95-project-menu');
  const inlineProjects = () =>
    shell.classList.contains('is-flowing') || window.matchMedia('(pointer: coarse)').matches;
  const focusItem = (item) => {
    item.focus();
    item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const reposition = () => {
    if (projectMenu.hidden) return;
    projectMenu.style.setProperty('--submenu-top', '0px');
    const box = projectMenu.getBoundingClientRect();
    const bottom = start.getBoundingClientRect().top - EDGE_GAP;
    const shift = Math.max(EDGE_GAP - box.top, Math.min(0, bottom - box.bottom));
    projectMenu.style.setProperty('--submenu-top', shift + 'px');
  };
  const openProjects = (focus = false) => {
    projectMenu.hidden = false;
    projectsButton.setAttribute('aria-expanded', 'true');
    reposition();
    if (focus) focusItem(projectMenu.querySelector('a'));
  };
  const closeProjects = (focus = false) => {
    projectMenu.hidden = true;
    projectsButton.setAttribute('aria-expanded', 'false');
    if (focus) focusItem(projectsButton);
  };
  const close = (focus = false) => {
    closeProjects();
    menu.hidden = true;
    start.setAttribute('aria-expanded', 'false');
    if (focus) start.focus();
  };
  const click = (event) => {
    if (event.target.closest('.r95-start-projects')) {
      if (projectMenu.hidden || (!inlineProjects() && event.pointerType === 'mouse'))
        openProjects();
      else closeProjects();
      return;
    }
    const link = event.target.closest('a');
    if (link && menu.contains(link)) close();
    if (event.target.closest('.r95-start')) {
      if (!menu.hidden) close();
      else {
        menu.hidden = false;
        start.setAttribute('aria-expanded', 'true');
        focusItem(menu.querySelector('.r95-start-item'));
      }
    }
  };
  const key = (event) => {
    if (menu.hidden) return;
    if (event.key === 'Escape') {
      if (!projectMenu.hidden) closeProjects(true);
      else close(true);
      event.preventDefault();
      return;
    }
    const inProjects = !projectMenu.hidden && projectMenu.contains(event.target);
    if (event.key === 'ArrowRight' && event.target === projectsButton) {
      openProjects(true);
      event.preventDefault();
      return;
    }
    if (
      !projectMenu.hidden &&
      event.key === 'ArrowLeft' &&
      (inProjects || event.target === projectsButton)
    ) {
      closeProjects(true);
      event.preventDefault();
      return;
    }
    if (!menu.contains(event.target) || !NAVIGATION_KEYS.has(event.key)) return;
    const links = [
      ...(inProjects
        ? projectMenu.querySelectorAll('a')
        : menu.querySelectorAll('.r95-start-item')),
    ];
    const current = links.indexOf(document.activeElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? links.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
    if (!inProjects && links[next] !== projectsButton) closeProjects();
    focusItem(links[next]);
    event.preventDefault();
  };
  const focus = (event) => {
    if (menu.hidden) return;
    if (!menu.contains(event.target) && event.target !== start) close();
    else if (!event.target.closest('.r95-start-folder')) closeProjects();
  };
  const hover = (event) => {
    if (menu.hidden || inlineProjects() || event.pointerType !== 'mouse') return;
    const item = event.target.closest('.r95-start-item');
    if (item === projectsButton) openProjects();
    else if (item) closeProjects();
  };
  const outside = (event) => {
    if (!event.target.closest('.r95-start-menu,.r95-start')) close();
  };
  const listeners = { click, keydown: key, focusin: focus, pointerover: hover };
  for (const [type, handler] of Object.entries(listeners)) shell.addEventListener(type, handler);
  document.addEventListener('pointerdown', outside);
  return {
    close,
    reposition,
    destroy() {
      close();
      for (const [type, handler] of Object.entries(listeners))
        shell.removeEventListener(type, handler);
      document.removeEventListener('pointerdown', outside);
    },
  };
}
