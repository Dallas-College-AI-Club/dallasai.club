import {
  comparisonMarkup,
  mountComparison,
  instructionMarkup,
  mountInstructions,
  fieldGuideMarkup,
  mountFieldGuide,
  labSourcesMarkup,
} from '../lab/evaluation.js';
import { renderSpace, spaceHeader } from './spaces.js';
import { TinyNetwork, makeData } from '../lab/neural.js';
import { renderPublication } from './review.js';
import { weightedScore } from '../lab/weighted-score.js';
import { renderContribution } from './contribute.js';
const labTabs = (active) =>
  /* HTML */ `<nav class="lab-tabs" aria-label="AI Lab experiments">
    ${[
      ['lab', 'Train a model'],
      ['ethics', 'Check its answers'],
      ['compare', 'Compare AI tools'],
      ['drift', 'Spot AI going off track'],
    ]
      .map(
        ([id, name]) =>
          /* HTML */ `<button data-open="${id}" aria-current="${active === id}">${name}</button>`,
      )
      .join('')}
  </nav>`;
const labDescriptions = {
  lab: 'Train a neural network and inspect its predictions.',
  ethics: 'See how changing the test set affects overall accuracy.',
  compare: 'Compare AI tools for a task and decide what matters most.',
  drift: 'Spot when an AI response drifts from the instructions.',
};
const labHeader = (active) =>
  /* HTML */ `<div class="lab-heading">
    ${spaceHeader('AI Lab', '<span class="editorial-aside">A question is a place to start.</span>')}
    <p class="lead lab-intro">${labDescriptions[active]}</p>
    ${fieldGuideMarkup()} ${labTabs(active)}
  </div>`;
export function renderActivity(root, id, { open, back }) {
  if (['summary', 'projects', 'events', 'subscribe', 'about'].includes(id))
    return renderSpace(root, id, { open, back });
  let stop = () => {};
  const active = id === 'browse' ? 'journal' : id;
  if (active === 'contribute') return renderContribution(root);
  if (active === 'journal' || active === 'article')
    return renderPublication(root, active, root.dataset.article ?? null, { open, back });
  root.innerHTML = '<div id="activity-body"></div>';
  const body = root.querySelector('#activity-body');
  if (active === 'compare' || active === 'drift') {
    body.innerHTML =
      labHeader(active) + (active === 'compare' ? comparisonMarkup() : instructionMarkup());
    stop = active === 'compare' ? mountComparison(body) : mountInstructions(body);
  } else if (active === 'lab') {
    body.innerHTML = `${labHeader('lab')}<div class="lab-layout"><section class="lab-card lab-settings"><h3>01 / Set up</h3><label>Pattern<select id="pattern"><option value="circle">Circle inside a ring</option><option value="xor">Opposite corners</option></select></label><label>Learning rate<select id="learning-rate"><option value=".1">0.1 · Slow</option><option value=".3" selected>0.3 · Steady</option><option value=".7">0.7 · Fast</option></select></label><label>Model size (hidden units): <output id="hidden-count">8</output><input id="hidden-units" type="range" min="1" max="12" value="8"></label></section><section class="lab-card"><h3>02 / Train the network</h3><canvas id="live-network" aria-label="Two inputs, a hidden layer, and one output. Connections show trained weights."></canvas><div class="lab-controls"><button id="train-model">Train</button><button id="reset-model">Reset</button></div><p id="training-state" role="status">Ready · 0 epochs</p></section><section class="lab-card"><h3>03 / Inspect the predictions</h3><canvas id="live-predictions" aria-label="Prediction regions, with held-out test points shown as circles and diamonds"></canvas><p class="legend"><span>● Teal circles</span> &nbsp; <span>◆ Amber diamonds</span><br>Background: prediction · Shapes: held-out test examples</p></section></div><div class="lab-stats"><span>Training loss<strong id="training-loss">—</strong></span><span>Test accuracy<strong id="test-accuracy">—</strong></span><span>Examples<strong>160 train / 80 test</strong></span></div><p id="model-insight" class="lead">Start training, then pause to inspect the boundary. Try one hidden unit and compare it with eight.</p><p class="quiet-note">A real two-layer neural network trains here in your browser on generated teaching data. Scores measure this small example, not performance on real-world tasks.</p>`;
    stop = mountLab(body);
  } else if (active === 'ethics') {
    body.innerHTML = `${labHeader('ethics')}<div class="audit-grid"><section class="audit-controls"><h2>Change the test mix</h2><p>This fictional assistant gets familiar wording right 95% of the time, but unfamiliar wording only 55% of the time.</p><label for="test-mix">Familiar wording: <output id="mix-count">80%</output></label><input id="test-mix" type="range" min="0" max="100" step="5" value="80" aria-describedby="mix-explanation"><p id="mix-explanation"><span id="familiar-count">80</span> familiar · <span id="unfamiliar-count">20</span> unfamiliar questions per 100</p><div class="lab-controls"><button id="even-mix">Try an even mix</button><button id="reset-mix">Reset</button></div></section><section class="audit-result" aria-label="Evaluation results"><span class="eyebrow">OVERALL ACCURACY</span><div class="audit-big" id="overall-score" role="status">87%</div><p id="score-explanation">The average looks strong. Compare the two groups.</p><hr style="border:0;border-top:1px solid #ffffff25;margin:25px 0"><div class="audit-label"><span>Familiar wording</span><b>95%</b></div><div class="audit-bar"><span style="width:95%"></span></div><div class="audit-label"><span>Unfamiliar wording</span><b>55%</b></div><div class="audit-bar orange"><span style="width:55%"></span></div><p><strong>40 percentage points apart.</strong><br>The test mix changes the average. It does not fix the gap.</p></section></div><div class="ethics-result"><strong>What would you do next?</strong><p>Look at the failed answers. Include people whose wording is missing. Report each group’s result alongside the overall score.</p><button data-open="article" id="read-data-note">Read: What our dataset leaves out ↗</button></div><p class="quiet-note">A fictional evaluation exercise, separate from the pattern-training model. Fixed group rates show how a weighted average works; changing the slider does not retrain an AI system.</p>`;
    const input = body.querySelector('#test-mix');
    const update = () => {
      const n = +input.value;
      body.querySelector('#mix-count').textContent = n + '%';
      body.querySelector('#familiar-count').textContent = n;
      body.querySelector('#unfamiliar-count').textContent = 100 - n;
      body.querySelector('#overall-score').textContent = weightedScore(n) + '%';
      body.querySelector('#score-explanation').textContent =
        n === 80
          ? 'The average looks strong. Compare the two groups.'
          : n === 50
            ? '75% with an even mix. The assistant itself has not changed.'
            : 'The average changed because the test mix changed.';
    };
    input.oninput = update;
    body.querySelector('#even-mix').onclick = () => {
      input.value = 50;
      update();
    };
    body.querySelector('#reset-mix').onclick = () => {
      input.value = 80;
      update();
    };
  }
  if (active in labDescriptions) {
    body.insertAdjacentHTML('beforeend', labSourcesMarkup());
    mountFieldGuide(body, open);
  }
  root
    .querySelectorAll('[data-open]')
    .forEach(
      (b) =>
        (b.onclick = () =>
          open(b.dataset.open, b.id === 'read-data-note' ? 'what-the-data-leaves-out' : 0)),
    );
  return stop;
}

function mountLab(root) {
  let network,
    data,
    test,
    running = false,
    disposed = false,
    raf,
    stopAt = 4000;
  const $ = (s) => root.querySelector(s);
  function reset() {
    running = false;
    cancelAnimationFrame(raf);
    stopAt = 4000;
    network = new TinyNetwork(+$('#hidden-units').value);
    const all = makeData($('#pattern').value);
    data = all.slice(0, 160);
    test = all.slice(160);
    $('#hidden-count').textContent = network.units;
    $('#hidden-units').setAttribute('aria-label', 'Hidden units');
    $('#train-model').textContent = 'Train';
    draw();
  }
  function canvas(selector) {
    const c = $(selector),
      r = c.getBoundingClientRect(),
      d = Math.min(devicePixelRatio || 1, 2);
    if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) {
      c.width = r.width * d;
      c.height = r.height * d;
    }
    const g = c.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0);
    return { g, w: r.width, h: r.height };
  }
  function draw() {
    const a = canvas('#live-predictions');
    if (!a.w) return;
    const { g, w, h } = a;
    for (let yy = 0; yy < h; yy += 7)
      for (let xx = 0; xx < w; xx += 7) {
        const p = network.forward((xx / w) * 2 - 1, 1 - (yy / h) * 2).p;
        const c0 = [213, 132, 75],
          c1 = [59, 158, 167];
        g.fillStyle = `rgb(${c0.map((v, i) => Math.round((v * (1 - p) + c1[i] * p) * 0.59)).join(',')})`;
        g.fillRect(xx, yy, 7, 7);
      }
    for (const p of test) {
      const x = ((p.x + 1) * w) / 2,
        y = ((1 - p.y) * h) / 2;
      g.fillStyle = p.label ? '#91e4e1' : '#ffbc83';
      g.strokeStyle = '#0c2130';
      g.lineWidth = 1.3;
      g.beginPath();
      if (p.label) g.arc(x, y, 4.4, 0, Math.PI * 2);
      else {
        g.moveTo(x, y - 5);
        g.lineTo(x + 5, y);
        g.lineTo(x, y + 5);
        g.lineTo(x - 5, y);
        g.closePath();
      }
      g.fill();
      g.stroke();
    }
    const n = canvas('#live-network'),
      ng = n.g;
    ng.clearRect(0, 0, n.w, n.h);
    const xs = [n.w * 0.1, n.w * 0.5, n.w * 0.88],
      inputs = [n.h * 0.35, n.h * 0.65],
      ys = Array.from({ length: network.units }, (_, i) => (n.h * (i + 1)) / (network.units + 1));
    const edge = (x, y, xx, yy, weight) => {
      ng.beginPath();
      ng.moveTo(x, y);
      ng.lineTo(xx, yy);
      ng.strokeStyle = weight > 0 ? '#74bbc288' : '#d8a16d88';
      ng.lineWidth = 0.5 + Math.min(3, Math.abs(weight) * 0.6);
      ng.stroke();
    };
    for (let j = 0; j < network.units; j++) {
      for (let k = 0; k < 2; k++) edge(xs[0], inputs[k], xs[1], ys[j], network.w1[j][k]);
      edge(xs[1], ys[j], xs[2], n.h * 0.5, network.w2[j]);
    }
    for (const [x, positions] of [
      [xs[0], inputs],
      [xs[1], ys],
      [xs[2], [n.h * 0.5]],
    ])
      for (const y of positions) {
        ng.beginPath();
        ng.arc(x, y, 7, 0, Math.PI * 2);
        ng.fillStyle = '#dbc090';
        ng.fill();
        ng.strokeStyle = '#f9edd6';
        ng.stroke();
      }
    const train = network.metrics(data),
      held = network.metrics(test);
    $('#training-loss').textContent = train.loss.toFixed(3);
    $('#test-accuracy').textContent = Math.round(held.accuracy * 100) + '%';
    $('#training-state').textContent =
      (running ? 'Training' : network.epoch ? 'Paused' : 'Ready') +
      ' · ' +
      network.epoch +
      ' epochs';
    $('#model-insight').textContent =
      network.epoch < 20
        ? 'Start training, then pause to inspect the boundary. Try one hidden unit and compare it with eight.'
        : network.units === 1
          ? 'One hidden unit can only make a simple split here. Compare its result with a larger hidden layer on the same pattern.'
          : 'The boundary comes from the current learned weights. Test points were held out of training; their accuracy can differ from the training loss.';
  }
  function tick() {
    if (disposed || !running || document.hidden) return;
    for (let i = 0; i < 8; i++) network.train(data, +$('#learning-rate').value);
    if (network.epoch >= stopAt) {
      running = false;
      $('#train-model').textContent = 'Train more';
    }
    draw();
    if (running) raf = requestAnimationFrame(tick);
  }
  $('#train-model').onclick = () => {
    if (network.epoch >= stopAt) stopAt += 4000;
    running = !running;
    cancelAnimationFrame(raf);
    if (running) raf = requestAnimationFrame(tick);
    $('#train-model').textContent = running ? 'Pause' : 'Resume';
    draw();
  };
  $('#reset-model').onclick = reset;
  $('#pattern').onchange = reset;
  $('#hidden-units').oninput = reset;
  $('#learning-rate').onchange = () => {
    if (!running) draw();
  };
  const resize = new ResizeObserver(() => draw());
  resize.observe($('#live-predictions'));
  reset();
  const visibility = () => {
    cancelAnimationFrame(raf);
    if (!document.hidden && running) raf = requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', visibility);
  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    resize.disconnect();
    document.removeEventListener('visibilitychange', visibility);
  };
}
