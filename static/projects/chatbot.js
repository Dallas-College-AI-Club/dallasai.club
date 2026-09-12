import { RECORDINGS, INTRO_SECONDS } from '../content/chatbot-recordings.js';
import { PROJECT_URL } from '../content/club.js';
export { RECORDINGS, INTRO_SECONDS };
export const CHATBOT_URL = PROJECT_URL;
export function replayMarkup() {
  return /* HTML */ `<div
    class="major-recording"
    aria-label="Recorded walkthrough of the real Major chatbot"
  >
    <div class="major-recording-screen">
      <video
        class="major-recording-video"
        muted
        playsinline
        preload="metadata"
        disablepictureinpicture
        disableremoteplayback
        aria-label="Major: choose Playful, plan a semester, select the BAT program, and ask about first-semester classes."
        poster="${RECORDINGS[0].startPoster}"
      ></video
      ><span class="major-recording-language" lang="en">English</span>
    </div>
    <div class="major-recording-languages" aria-label="Choose a conversation language">
      ${RECORDINGS.map((c, i) => /* HTML */ `<button type="button" data-recording="${i}" aria-pressed="${i === 0}" aria-label="${c.english}: ${c.label}" title="${c.english}" lang="${c.lang}">${c.label}</button>`).join('')}
    </div>
    <div class="major-recording-caption">
      <span>Inside the real chatbot</span
      ><a href="${CHATBOT_URL}" target="_blank" rel="noopener noreferrer">Try Major ↗</a>
    </div>
  </div>`;
}
export function mountReplay(root) {
  const stops = [];
  for (const el of root.querySelectorAll('.major-recording')) {
    const video = el.querySelector('video'),
      badge = el.querySelector('.major-recording-language'),
      buttons = [...el.querySelectorAll('[data-recording]')];
    let reduced =
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.body.classList.contains('reduced');
    let selected = 0,
      visible = false,
      started = false,
      disposed = false,
      jump = 0;
    const poster = document.createElement('img');
    poster.className = 'major-recording-poster';
    poster.alt = '';
    poster.setAttribute('aria-hidden', 'true');
    poster.src = video.poster;
    video.before(poster);
    video.muted = true;
    const play = () => {
      if (!disposed && visible && !document.hidden && !reduced) video.play().catch(() => {});
      else video.pause();
    };
    const choose = (i, fromStart = false) => {
      selected = i;
      const c = RECORDINGS[i];
      badge.textContent = c.english;
      buttons.forEach((b, n) => b.setAttribute('aria-pressed', String(n === i)));
      video.style.visibility = 'hidden';
      video.poster = fromStart && !reduced ? c.startPoster : c.poster;
      poster.src = video.poster;
      jump = fromStart ? 0 : INTRO_SECONDS;
      video.src = c.src;
      video.load();
    };
    video.onplaying = () => {
      video.style.visibility = 'visible';
    };
    video.onseeked = () => {
      if (reduced) video.style.visibility = 'visible';
    };
    video.onloadedmetadata = () => {
      video.currentTime = reduced
        ? Math.max(0, video.duration - 0.2)
        : Math.min(jump, video.duration - 0.2);
      play();
    };
    video.onended = () => choose((selected + 1) % RECORDINGS.length);
    for (const b of buttons)
      b.onclick = () => {
        started = true;
        choose(+b.dataset.recording);
      };
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
        if (visible && !started) {
          started = true;
          choose(0, true);
        } else play();
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    document.addEventListener('visibilitychange', play);
    const motion = (event) => {
      reduced = event.detail.reduced;
      play();
    };
    document.addEventListener('club:motion', motion);
    stops.push(() => {
      disposed = true;
      io.disconnect();
      document.removeEventListener('visibilitychange', play);
      document.removeEventListener('club:motion', motion);
      video.pause();
      video.onended = video.onloadedmetadata = video.onplaying = video.onseeked = null;
      video.removeAttribute('src');
      video.load();
    });
  }
  return () => stops.forEach((s) => s());
}
