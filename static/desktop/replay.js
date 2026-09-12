import { safeURL } from './views.js';

export function mountReplay(root, recordings, introSeconds, saved) {
  const video = root.querySelector('video');
  if (!video || !recordings.length) return null;
  const stage = root.querySelector('.r95-recording-stage');
  const frame = root.querySelector('.r95-recording-screen');
  const badge = root.querySelector('.r95-recording-language');
  const buttons = [...root.querySelectorAll('[data-recording]')];
  const playback = root.querySelector('[data-playback]');
  const status = root.querySelector('[data-recording-status]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  const listen = (target, type, handler) =>
    target.addEventListener(type, handler, { signal: events.signal });
  let selected = Math.max(
    0,
    recordings.findIndex((r) => r.lang === saved?.lang),
  );
  let paused = saved?.paused ?? (reduced.matches || document.body.classList.contains('reduced'));
  let started = false,
    visible = false,
    seekAt = 0;
  video.muted = true;

  const updateButton = () => {
    const label = video.error ? 'Retry tour' : video.paused ? 'Play tour' : 'Pause tour';
    playback.textContent = label;
    playback.setAttribute('aria-label', label.replace('tour', 'Major language tour'));
  };
  const play = () => {
    if (visible && !document.hidden && !paused && started) video.play().catch(updateButton);
    else video.pause();
    updateButton();
  };
  const select = (index, fromStart = false, time = null) => {
    selected = index;
    started = true;
    const recording = recordings[index];
    badge.textContent = recording.english;
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    video.poster = safeURL(fromStart && !paused ? recording.startPoster : recording.poster);
    seekAt = time ?? (fromStart ? 0 : introSeconds);
    video.src = safeURL(recording.src);
    video.load();
    status.textContent = 'Recorded demo';
  };
  const fit = () => {
    const width = Math.floor(stage.getBoundingClientRect().width);
    if (width <= 4) return;
    const ratio =
      video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
    stage.style.setProperty('--recording-natural-height', (width - 4) / ratio + 4 + 'px');
    const height = Math.floor(stage.getBoundingClientRect().height);
    if (height <= 4) return;
    const contentWidth = Math.min(width - 4, (height - 4) * ratio);
    frame.style.width = contentWidth + 4 + 'px';
    frame.style.height = contentWidth / ratio + 4 + 'px';
  };
  listen(video, 'loadedmetadata', () => {
    const end = Math.max(0, video.duration - 0.2);
    video.currentTime = paused && !saved ? end : Math.min(seekAt, end);
    fit();
    play();
  });
  listen(video, 'ended', () => {
    if (!paused) select((selected + 1) % recordings.length);
  });
  listen(video, 'play', updateButton);
  listen(video, 'pause', updateButton);
  listen(video, 'error', () => {
    status.textContent = 'Recording unavailable';
    updateButton();
  });
  buttons.forEach((button, i) => listen(button, 'click', () => select(i)));
  listen(playback, 'click', () => {
    paused = !video.paused;
    if (!started || video.error) select(selected, !started);
    play();
  });
  listen(document, 'visibilitychange', play);
  listen(document, 'club:motion', (event) => {
    if (event.detail.reduced) paused = true;
    play();
  });
  listen(reduced, 'change', () => {
    if (reduced.matches) paused = true;
    play();
  });
  const visibility = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
      if (visible && !started) select(selected, !saved?.started, saved?.time);
      else play();
    },
    { threshold: 0.1 },
  );
  visibility.observe(root.querySelector('.r95-recording'));
  const sizing = new ResizeObserver(fit);
  sizing.observe(stage);
  fit();
  updateButton();
  return {
    getState: () => ({ lang: recordings[selected].lang, paused, time: video.currentTime, started }),
    destroy() {
      events.abort();
      visibility.disconnect();
      sizing.disconnect();
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}
