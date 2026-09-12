import { WORLD_MARKET_EVENTS, WORLD_MARKET_SCOPE } from '../content/projects.js';

const TRAINING_POINTS = 20;
const MARKET_CASES = {
  steady: {
    label: 'Steady',
    note: 'The earlier trend continues into unseen data.',
    values: Array.from({ length: 30 }, (_, i) => 100 + i * 0.6 + Math.sin(i * 1.8) * 1.2),
  },
  shift: {
    label: 'Shift',
    note: 'A new direction breaks the earlier pattern.',
    values: Array.from(
      { length: 30 },
      (_, i) => 100 + i * 0.6 + Math.sin(i * 1.8) * 1.2 - Math.max(0, i - 19) * 1.7,
    ),
  },
  noise: {
    label: 'Noise',
    note: 'Short-term swings make the fitted trend less useful.',
    values: Array.from(
      { length: 30 },
      (_, i) => 104 + Math.sin(i * 2.3) * 4 + Math.cos(i * 0.9) * 3 + i * 0.15,
    ),
  },
};

const REGION_POINTS = {
  China: [172, 63],
  Washington: [91, 66],
  Texas: [79, 73],
};
const WORLD_SCALE =
  Math.max(
    1,
    Math.ceil(Math.max(...WORLD_MARKET_EVENTS.map((event) => Math.abs(event.change))) / 10),
  ) * 10;
const WORLD_CASES = Object.fromEntries(
  WORLD_MARKET_EVENTS.map((event) => [
    event.id,
    { ...event, point: REGION_POINTS[event.region] || [112, 90] },
  ]),
);

function linePath(values, x, y) {
  return values
    .map((value, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(value).toFixed(1)}`)
    .join(' ');
}

export function marketStudy(id) {
  const study = MARKET_CASES[id] || MARKET_CASES.steady;
  const training = study.values.slice(0, TRAINING_POINTS);
  const meanX = (TRAINING_POINTS - 1) / 2;
  const meanY = training.reduce((sum, value) => sum + value, 0) / TRAINING_POINTS;
  const slope =
    training.reduce((sum, value, i) => sum + (i - meanX) * (value - meanY), 0) /
    training.reduce((sum, _, i) => sum + (i - meanX) ** 2, 0);
  const forecast = study.values.map((_, i) => meanY + slope * (i - meanX));
  const error =
    study.values
      .slice(TRAINING_POINTS)
      .reduce((sum, value, i) => sum + Math.abs(value - forecast[i + TRAINING_POINTS]), 0) /
    (study.values.length - TRAINING_POINTS);
  return { ...study, forecast, error };
}

function studyControls(cases, attribute, label) {
  return /* HTML */ `<div class="study-controls" aria-label="${label}">
    ${Object.entries(cases)
      .map(
        ([id, entry], i) =>
          /* HTML */ `<button type="button" ${attribute}="${id}" aria-pressed="${i === 0}">
            ${entry.label}
          </button>`,
      )
      .join('')}
  </div>`;
}

function tradingMarkup() {
  return /* HTML */ `<div class="concept-display market-display">
    <div class="concept-brand">AI TRADING <small>PATTERNS × PREDICTIONS</small></div>
    <div class="market-heading">
      <h3>Test the<br /><em>signal.</em></h3>
      <span>30 samples<br />20 to learn · 10 to test</span>
    </div>
    <div class="market-chart" data-market-chart></div>
    <div class="market-reading" aria-live="polite">
      <div><span>TEST ERROR</span><strong data-market-error></strong></div>
      <p data-market-note></p>
    </div>
    ${studyControls(MARKET_CASES, 'data-market-case', 'Choose a simulated price pattern')}
    <p class="study-disclaimer">Simulated prices · A simple trend model</p>
  </div>`;
}

function worldMarkup() {
  return /* HTML */ `<div class="concept-display world-display">
    <div class="concept-brand">WORLD SIGNALS <small>NEWS × MARKETS</small></div>
    <h3>One news event.<br /><em>One trading day.</em></h3>
    <div class="world-scene">
      <svg
        viewBox="0 0 225 180"
        class="world-globe"
        role="img"
        aria-label="Illustrated globe showing regions connected to the selected market news"
      >
        <defs>
          <radialGradient id="world-sphere" cx="32%" cy="28%" r="75%">
            <stop offset="0" stop-color="#faf5ed" />
            <stop offset=".6" stop-color="#ddd6de" />
            <stop offset="1" stop-color="#b3a5b8" />
          </radialGradient>
          <clipPath id="world-circle"><circle cx="112" cy="90" r="76" /></clipPath>
        </defs>
        <ellipse cx="115" cy="173" rx="65" ry="4" fill="#604861" opacity=".08" />
        <circle
          cx="112"
          cy="90"
          r="76"
          fill="url(#world-sphere)"
          stroke="#9f8a9e"
          stroke-opacity=".5"
        />
        <g clip-path="url(#world-circle)">
          <g fill="none" stroke="#8b778e" stroke-width=".7" opacity=".38">
            <ellipse cx="112" cy="90" rx="52" ry="76" />
            <ellipse cx="112" cy="90" rx="25" ry="76" />
            <ellipse cx="112" cy="90" rx="76" ry="25" />
            <ellipse cx="112" cy="90" rx="76" ry="52" />
            <path d="M36 90H188M112 14V166" />
          </g>
          <g
            fill="#90758c"
            fill-opacity=".34"
            stroke="#82647d"
            stroke-opacity=".3"
            stroke-width=".8"
          >
            <path d="M52 48L65 35L87 32L101 43L94 55L101 66L85 79L80 95L66 89L63 74L46 66Z" />
            <path d="M82 94L97 97L111 117L102 139L88 156L84 137L75 117Z" />
            <path
              d="M120 39L136 30L157 41L176 43L187 67L171 79L154 74L146 86L127 76L132 59L119 55Z"
            />
            <path d="M126 77L148 82L151 108L134 128L123 109L117 94Z" />
            <path d="M161 121L178 116L192 127L182 140L163 139Z" />
          </g>
        </g>
        <ellipse
          cx="112"
          cy="90"
          rx="103"
          ry="38"
          fill="none"
          stroke="#af8b70"
          stroke-width="1"
          stroke-dasharray="3 6"
          transform="rotate(-28 112 90)"
          opacity=".7"
        />
        <path
          class="world-connection"
          data-world-connection
          fill="none"
          stroke="#8b5469"
          stroke-width="1.4"
          stroke-dasharray="3 4"
        />
        ${Object.entries(WORLD_CASES)
          .map(
            ([id, event]) =>
              /* HTML */ `<g data-world-pin="${id}" class="world-pin"
                ><circle
                  cx="${event.point[0]}"
                  cy="${event.point[1]}"
                  r="9"
                  class="world-pin-halo" /><circle
                  cx="${event.point[0]}"
                  cy="${event.point[1]}"
                  r="3.5"
              /></g>`,
          )
          .join('')}
      </svg>
      <div class="world-story" aria-live="polite">
        <time data-world-date></time><strong data-world-title></strong>
        <p data-world-detail></p>
        <a class="world-source" data-world-source target="_blank" rel="noreferrer"></a>
      </div>
    </div>
    <div class="world-reaction">
      <div><span data-world-asset></span><strong data-world-change></strong></div>
      <div data-world-chart></div>
    </div>
    ${studyControls(WORLD_CASES, 'data-world-case', 'Explore selected major market moves')}
    <p class="study-disclaimer">${WORLD_MARKET_SCOPE} · Prices have many drivers</p>
  </div>`;
}

export function marketMarkup(id) {
  return id === 'ai-trading' ? tradingMarkup() : id === 'world-events-stocks' ? worldMarkup() : '';
}

function drawMarket(root, id) {
  const study = marketStudy(id);
  const min = Math.floor(Math.min(...study.values, ...study.forecast) / 5) * 5 - 2;
  const max = Math.ceil(Math.max(...study.values, ...study.forecast) / 5) * 5 + 2;
  const x = (i) => 18 + (i / 29) * 356;
  const y = (value) => 139 - ((value - min) / (max - min)) * 109;
  const split = (x(TRAINING_POINTS - 1) + x(TRAINING_POINTS)) / 2;
  root.querySelector('[data-market-chart]').innerHTML = /* HTML */ `<svg
    viewBox="0 0 392 172"
    role="img"
    aria-label="${study.label} simulated prices. A trend fitted to the first 20 samples is tested on the last 10. Average absolute test error: ${study.error.toFixed(1)} index points."
  >
    <defs>
      <linearGradient id="market-area" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#99e3d6" stop-opacity=".18" />
        <stop offset="1" stop-color="#99e3d6" stop-opacity="0" />
      </linearGradient>
    </defs>
    <rect
      x="${split}"
      y="20"
      width="${374 - split}"
      height="128"
      fill="#8de0d0"
      opacity=".045"
      rx="3"
    />
    ${[0, 1, 2]
      .map((i) => {
        const value = min + ((max - min) * i) / 2;
        return /* HTML */ `<path
            d="M18 ${y(value)}H374"
            stroke="#a4c4c5"
            stroke-opacity=".13"
          /><text x="18" y="${y(value) - 5}" class="market-axis">${Math.round(value)}</text>`;
      })
      .join('')}
    <text x="18" y="12" class="market-phase">LEARN</text>
    <text x="${split + 9}" y="12" class="market-phase market-phase-test">TEST</text>
    <path d="M${split} 20V148" stroke="#a9c5bf" stroke-opacity=".36" stroke-dasharray="3 5" />
    <path d="${linePath(study.values, x, y)}L374 149H18Z" fill="url(#market-area)" />
    <path
      d="${linePath(study.forecast, x, y)}"
      fill="none"
      stroke="#e8be84"
      stroke-width="1.5"
      stroke-dasharray="4 5"
      opacity=".85"
    />
    <path
      class="market-price-line"
      d="${linePath(study.values, x, y)}"
      fill="none"
      stroke="#a1e7dc"
      stroke-width="2.2"
      stroke-linejoin="round"
      stroke-linecap="round"
      pathLength="1"
    />
    <circle cx="374" cy="${y(study.values.at(-1))}" r="3.5" fill="#b6f4e5" />
    <path d="M18 163H31" stroke="#a1e7dc" stroke-width="2" />
    <text x="36" y="166" class="market-legend">Observed</text>
    <path d="M121 163H134" stroke="#e8be84" stroke-dasharray="3 3" />
    <text x="139" y="166" class="market-legend">Fitted trend</text>
  </svg>`;
  root.querySelector('[data-market-error]').textContent = study.error.toFixed(1) + ' pts';
  root.querySelector('[data-market-note]').textContent = study.note;
  root.querySelectorAll('[data-market-case]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.marketCase === id));
  });
}

function drawWorld(root, id) {
  const event = WORLD_CASES[id];
  const { change } = event;
  const comparison =
    event.period === 'Session close'
      ? "from the previous session's close"
      : event.period.toLowerCase();
  const [px, py] = event.point;
  const date = root.querySelector('[data-world-date]');
  date.dateTime = event.date;
  date.textContent = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(event.date));
  root.querySelector('[data-world-title]').textContent = event.title;
  root.querySelector('[data-world-detail]').textContent = event.summary;
  const source = root.querySelector('[data-world-source]');
  source.href = event.source;
  source.textContent = 'Read ' + event.sourceName + ' ↗';
  root.querySelector('[data-world-asset]').textContent = event.asset;
  root.querySelector('[data-world-change]').textContent =
    (change > 0 ? '+' : '−') + Math.abs(change) + '%';
  const width = (Math.abs(change) / WORLD_SCALE) * 50;
  root.querySelector('[data-world-chart]').innerHTML = /* HTML */ `<div class="world-movement">
    <span class="world-period"
      >${event.period === 'Session close' ? 'One-day change' : event.period}</span
    >
    <div
      class="world-move-track"
      role="img"
      aria-label="${event.asset}: ${change > 0 ? 'up' : 'down'} ${event.approximate ? 'approximately ' : ''}${Math.abs(change)} percent ${comparison}, ${date.textContent}. All examples use a shared scale from minus ${WORLD_SCALE} to plus ${WORLD_SCALE} percent."
    >
      <i style="left:${change >= 0 ? 50 : 50 - width}%;width:${width}%"></i>
    </div>
    <div class="world-move-scale" aria-hidden="true">
      <span>−${WORLD_SCALE}%</span><span>0</span><span>+${WORLD_SCALE}%</span>
    </div>
  </div>`;
  root.querySelector('[data-world-connection]').setAttribute('d', `M${px} ${py}Q170 8 210 84`);
  root.querySelectorAll('[data-world-pin]').forEach((pin) => {
    pin.classList.toggle('is-selected', pin.dataset.worldPin === id);
  });
  root.querySelectorAll('[data-world-case]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.worldCase === id));
  });
}

export function mountMarketStudies(root) {
  const market = root.querySelector('.market-display');
  const world = root.querySelector('.world-display');
  if (market) {
    drawMarket(market, 'steady');
    market.querySelectorAll('[data-market-case]').forEach((button) => {
      button.onclick = () => drawMarket(market, button.dataset.marketCase);
    });
  }
  if (world) {
    drawWorld(world, WORLD_MARKET_EVENTS[0].id);
    world.querySelectorAll('[data-world-case]').forEach((button) => {
      button.onclick = () => drawWorld(world, button.dataset.worldCase);
    });
  }
}
