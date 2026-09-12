import { PROPOSED_PROJECTS } from '../content/projects.js';
import { marketMarkup, mountMarketStudies } from './market-visuals.js';

export function projectMockups() {
  return /* HTML */ `<div class="concept-lab">
    <article id="project-signal" tabindex="-1" aria-labelledby="project-signal-title">
      <div class="concept-display signal-display">
        <div class="concept-brand">SIGNAL <small>AUDIO × ART</small></div>
        <div class="signal-title">
          Hear it.<br />See it.<small>A sound, a thousand colors.</small>
        </div>
        <canvas aria-label="Animated sound spectrum"></canvas>
        <div class="signal-sub">GENERATIVE STUDY / SYNTHESIZED SOUND</div>
        <div class="signal-actions">
          <button data-signal="0" aria-pressed="true">Drift</button
          ><button data-signal="1" aria-pressed="false">Pulse</button
          ><button data-signal="2" aria-pressed="false">Bloom</button
          ><button class="signal-audio" aria-pressed="false">▶ Listen</button>
        </div>
      </div>
      <div class="concept-copy">
        <h2 id="project-signal-title">Signal</h2>
        <p>An audiovisual instrument that turns the character of a sound into light and motion.</p>
        <small>Interactive concept · Original synthesized audio</small>
      </div>
    </article>
    <article id="project-nature" tabindex="-1" aria-labelledby="project-nature-title">
      <div class="concept-display nature-display">
        <div class="concept-brand">SECOND NATURE <small>DESIGN × CLIMATE</small></div>
        <svg
          viewBox="0 0 420 240"
          role="img"
          aria-label="Imagined campus map showing a direct walking route"
        >
          <defs>
            <pattern id="nature-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M24 0H0V24" fill="none" stroke="#7a8e73" stroke-opacity=".1" />
            </pattern>
            <filter id="nature-shadow">
              <feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity=".08" />
            </filter>
          </defs>
          <rect width="420" height="240" fill="url(#nature-grid)" />
          <path d="M0 75H420M0 170H420M115 0V240M302 0V240" stroke="#fffdf5" stroke-width="17" />
          <g fill="#bcc9b7" stroke="#a8b8a4" filter="url(#nature-shadow)">
            ${[
              [20, 18, 60, 34],
              [143, 20, 122, 34],
              [330, 14, 63, 43],
              [17, 102, 60, 40],
              [156, 103, 43, 38],
              [226, 105, 43, 38],
              [332, 100, 55, 44],
              [28, 194, 55, 28],
              [148, 194, 70, 29],
              [238, 194, 30, 29],
              [333, 195, 57, 31],
            ]
              .map(
                ([x, y, w, h]) =>
                  /* HTML */ `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" />`,
              )
              .join('')}
          </g>
          <g fill="#699478" fill-opacity=".8">
            ${[
              [93, 97],
              [92, 125],
              [92, 152],
              [137, 156],
              [163, 156],
              [189, 155],
              [216, 156],
              [245, 156],
              [273, 156],
              [287, 129],
              [286, 102],
            ]
              .map(([x, y], i) => /* HTML */ `<circle cx="${x}" cy="${y}" r="${8 + (i % 3)}" />`)
              .join('')}
          </g>
          <path
            class="nature-path"
            d="M115 75H302"
            fill="none"
            stroke="#b99764"
            stroke-width="4"
            stroke-linecap="round"
          />
          <g fill="#fff" stroke="#345d50" stroke-width="3">
            <circle cx="115" cy="75" r="6" />
            <circle cx="302" cy="75" r="6" />
          </g>
          <text x="110" y="59" fill="#365d4b" font-family="DM Sans" font-size="9">YOU</text>
          <text x="278" y="59" fill="#365d4b" font-family="DM Sans" font-size="9">LIBRARY</text>
        </svg>
        <div class="nature-controls">
          <div>
            <strong class="nature-time">4 min</strong
            ><small class="nature-shade">Direct route · 18% shade</small>
          </div>
          <button class="nature-toggle" aria-pressed="false">Find a cooler route ↗</button>
        </div>
        <p class="nature-caption">Imagined campus · Illustrative route estimates</p>
      </div>
      <div class="concept-copy">
        <h2 id="project-nature-title">Second Nature</h2>
        <p>
          A campus walking companion that balances time, tree cover, and a little breathing room.
        </p>
        <small>Interactive concept · Simulated campus data</small>
      </div>
    </article>
    ${PROPOSED_PROJECTS.map(
      (project) =>
        /* HTML */ `<article
          class="proposed-project"
          id="project-${project.id}"
          tabindex="-1"
          aria-labelledby="project-${project.id}-title"
        >
          ${marketMarkup(project.id)}
          <div class="concept-copy">
            <h2 id="project-${project.id}-title">${project.title}</h2>
            <p>${project.summary}</p>
            <p><strong>A question to explore:</strong> ${project.question}</p>
            <small
              >${project.id === 'ai-trading' ? 'Interactive study · Simulated prices' : 'Interactive study · Reported market news'}</small
            >
          </div>
        </article>`,
    ).join('')}
  </div>`;
}
export function mountMockups(root) {
  mountMarketStudies(root);
  const canvas = root.querySelector('.signal-display canvas');
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  let mode = 0,
    frame,
    audio = null,
    oscillators = [],
    sound = false,
    visible = true,
    disposed = false,
    time = 0,
    last = 0;
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motionPreference.matches || document.body.classList.contains('reduced');
  const repaint = () => {
    cancelAnimationFrame(frame);
    last = 0;
    frame = requestAnimationFrame(draw);
  };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * 1.5);
    canvas.height = Math.round(r.height * 1.5);
    repaint();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const io = new IntersectionObserver((e) => {
    visible = e[0].isIntersecting;
    repaint();
  });
  io.observe(canvas);
  const frequencies = [
      [110, 164.81, 220],
      [146.83, 220, 293.66],
      [174.61, 261.63, 349.23],
    ],
    colors = [
      ['#8fbdff', '#c1a9f0'],
      ['#e6a38b', '#d9bd89'],
      ['#a1d8bd', '#9dbeec'],
    ];
  const draw = (now) => {
    if (disposed || !visible || document.hidden) return;
    if (last && !reduced && visible) time += (now - last) / 1000;
    last = now;
    if (visible) {
      const w = canvas.width,
        h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (let layer = 0; layer < 32; layer++) {
        ctx.beginPath();
        for (let i = 0; i <= 130; i++) {
          const t = i / 130,
            x = t * w,
            env = Math.sin(t * Math.PI) ** 1.8,
            amplitude = (mode === 1 ? 0.27 : 0.19) * h;
          const y =
            h * 0.66 +
            Math.sin(t * (8 + mode * 3) + time * 0.8 + layer * 0.14) * env * amplitude +
            Math.cos(t * 18 - time * (mode + 1) * 0.6 + layer * 0.08) * env * amplitude * 0.45 +
            (layer - 16) * 1.3;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.strokeStyle = colors[mode][layer % 2];
        ctx.globalAlpha = 0.085 + layer / 900;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (!reduced) frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  const motion = (event) => {
    reduced = event.detail.reduced;
    repaint();
  };
  const preference = () => {
    reduced = motionPreference.matches || document.body.classList.contains('reduced');
    repaint();
  };
  document.addEventListener('club:motion', motion);
  document.addEventListener('visibilitychange', repaint);
  motionPreference.addEventListener('change', preference);
  const tune = () =>
    oscillators.forEach((o, i) =>
      o.frequency.setTargetAtTime(frequencies[mode][i], audio.currentTime, 0.3),
    );
  root.querySelectorAll('[data-signal]').forEach(
    (b) =>
      (b.onclick = () => {
        mode = +b.dataset.signal;
        root
          .querySelectorAll('[data-signal]')
          .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        if (sound) tune();
        repaint();
      }),
  );
  const button = root.querySelector('.signal-audio');
  button.onclick = async () => {
    button.disabled = true;
    try {
      if (sound) {
        await audio.suspend();
        sound = false;
      } else {
        if (!audio) {
          audio = new (window.AudioContext || window.webkitAudioContext)();
          const gain = audio.createGain();
          gain.gain.value = 0.025;
          gain.connect(audio.destination);
          oscillators = frequencies[mode].map((f) => {
            const o = audio.createOscillator();
            o.type = 'sine';
            o.frequency.value = f;
            o.connect(gain);
            o.start();
            return o;
          });
        }
        await audio.resume();
        sound = true;
        tune();
      }
      button.textContent = sound ? 'Ⅱ Mute' : '▶ Listen';
      button.setAttribute('aria-pressed', String(sound));
    } catch {
      button.textContent = 'Audio unavailable';
    } finally {
      button.disabled = false;
    }
  };
  const toggle = root.querySelector('.nature-toggle');
  toggle.onclick = () => {
    const cool = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(cool));
    toggle.textContent = cool ? 'Show direct route ↗' : 'Find a cooler route ↗';
    root.querySelector('.nature-time').textContent = cool ? '6 min' : '4 min';
    root.querySelector('.nature-shade').textContent = cool
      ? 'Garden route · 76% shade'
      : 'Direct route · 18% shade';
    const path = root.querySelector('.nature-path');
    path.setAttribute('d', cool ? 'M115 75V170H302V75' : 'M115 75H302');
    path.setAttribute('stroke', cool ? '#426f5b' : '#b99764');
    root
      .querySelector('.nature-display svg')
      .setAttribute(
        'aria-label',
        cool
          ? 'Imagined campus map with a shaded garden route'
          : 'Imagined campus map with a direct walking route',
      );
  };
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    io.disconnect();
    document.removeEventListener('club:motion', motion);
    document.removeEventListener('visibilitychange', repaint);
    motionPreference.removeEventListener('change', preference);
    audio?.close().catch(() => {});
  };
}
