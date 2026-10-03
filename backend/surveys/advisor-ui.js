import { makeDocx } from './personal-copy.js';
export function mountAdvisor(bootstrap, transport) {
  let submitting = false;
  const BANK = bootstrap.definition;
  const Q = Object.fromEntries(BANK.questions.map((q) => [q.id, q]));
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let ui = { plain: false, motion: !reduce.matches };
  const fresh = () => ({
    advisorId: bootstrap.advisorId,
    step: 0,
    answers: {},
    custom: {},
    notes: {},
    review: {},
    approved: false,
  });

  let state = fresh(),
    drag = null,
    clickSuppressed = false;
  let fileStatusTimer = null;
  function fileStatus(message) {
    const node = $('file-status');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(fileStatusTimer);
    fileStatusTimer = setTimeout(() => {
      node.hidden = true;
    }, 9000);
    announce(message);
  }
  const announce = (s) => {
    $('announcer').textContent = s;
  };
  const opts = (q) => [...(q.options || []), ...(state.custom[q.id] || [])];
  const label = (id, oid) =>
    opts(Q[id]).find((o) => o.id === oid)?.label || oid;
  const rankAnswer = (id) => state.answers[id] || { groups: [], mode: 'rank' };
  function invalidate() {
    state.approved = false;
    reviewFields();
    $('submit-status')?.replaceChildren();
    const c = $('approve-playbook');
    if (c) c.checked = false;
    document
      .querySelectorAll('[data-submit-control]')
      .forEach((b) => (b.disabled = true));
  }
  function changed(id, v) {
    state.answers[id] = v;
    syncUsualRoute(id);
    if (id === 'weekly' && !hasWeeklyRange()) delete state.answers.priority;
    invalidate();
  }
  function hasWeeklyRange() {
    const a = state.answers.weekly;
    return a?.mode === 'range' && !weeklyError(a) && a.max > 0;
  }
  function isVisible(q) {
    return q.id !== 'priority' || hasWeeklyRange();
  }
  function updateWeeklyPriority() {
    if (state.step !== 1) return;
    const existing = $('question-priority');
    if (hasWeeklyRange() && !existing) {
      $('question-weekly')?.insertAdjacentHTML(
        'afterend',
        questionHTML(Q.priority),
      );
      assignFocusIDs();
    } else if (!hasWeeklyRange() && existing) existing.remove();
  }
  function reusableRoute() {
    return (state.answers.busy_route?.values || []).filter((v) => v !== 'me');
  }
  function syncUsualRoute(id) {
    if (id !== 'busy_route' || reusableRoute().length) return;
    const a = state.answers.event_contact;
    if (a?.values?.includes('usual')) {
      a.values = a.values.filter((v) => v !== 'usual');
      if (!a.values.length) delete state.answers.event_contact;
    }
  }

  // Keep the complete tie group containing the third concern; never pick a tied
  // concern arbitrarily. Reordering the same concerns does not erase their answers.
  function focusIDs() {
    const a = state.answers.concerns;
    if (a?.mode !== 'rank') return [];
    const out = [];
    for (const g of a.groups) {
      if (out.length >= 3) break;
      out.push(...g);
    }
    return out;
  }
  function syncFocus() {
    const a = state.answers.concern_focus;
    if (!a) return;
    const active = new Set(focusIDs());
    a.items = Object.fromEntries(
      Object.entries(a.items).filter(([id]) => active.has(id)),
    );
    if (!Object.keys(a.items).length) delete state.answers.concern_focus;
  }
  function fieldChanged(id, a) {
    changed(id, a);
    if (id === 'concerns') syncFocus();
  }
  function dialTopic(id) {
    return id.startsWith('concern_focus--') ? id.slice(15) : null;
  }
  function dialQuestion(id) {
    const topic = dialTopic(id);
    return topic
      ? {
          ...Q.concern_focus,
          id,
          type: 'slider',
          depends_on: null,
          title: label('concerns', topic),
        }
      : Q[id];
  }
  function getDial(id) {
    const topic = dialTopic(id);
    return topic
      ? state.answers.concern_focus?.items[topic]
      : state.answers[id];
  }
  function writeDial(id, a) {
    const topic = dialTopic(id);
    if (topic) {
      const items = { ...(state.answers.concern_focus?.items || {}) };
      if (a) items[topic] = a;
      else delete items[topic];
      if (Object.keys(items).length) changed('concern_focus', { items });
      else {
        delete state.answers.concern_focus;
        invalidate();
      }
    } else if (a) changed(id, a);
    else {
      delete state.answers[id];
      invalidate();
    }
  }
  function clearAnswer(id) {
    if (dialTopic(id)) writeDial(id, null);
    else {
      delete state.answers[id];
      if (id === 'weekly') delete state.answers.priority;
      syncUsualRoute(id);
      invalidate();
      if (id === 'concerns') syncFocus();
    }
  }
  function selectMarkup(id, items, value, attrs = '') {
    return `<select id="${id}" ${attrs}><option value="">Choose…</option>${items.map((o) => `<option value="${esc(o.id)}" ${o.id === value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  }
  function assignFocusIDs() {
    document
      .querySelectorAll(
        '#main button,#main input,#main select,#main textarea,#main summary',
      )
      .forEach((el, i) => {
        if (!el.id)
          el.id =
            el.tagName === 'SUMMARY'
              ? 'summary-' + el.parentElement.id
              : 'control-' +
                Object.entries(el.dataset)
                  .map(([k, v]) => k + '-' + v)
                  .join('-') +
                (Object.keys(el.dataset).length ? '' : '-' + i);
      });
  }
  function setStep(n) {
    if (drag) finishDrag(false);
    state.step = n;
    render();
    $('main').scrollIntoView({ behavior: 'instant', block: 'start' });
    $('title')?.focus({ preventScroll: true });
  }
  function render() {
    const active = document.activeElement?.id;
    const open = [...document.querySelectorAll('details[open]')].map(
      (d) => d.id,
    );
    document.body.classList.toggle('plain', ui.plain);
    document.body.classList.toggle('still', !ui.motion || reduce.matches);
    $('mode').textContent = ui.plain ? 'Animated cards' : 'Plain mode';
    $('motion').textContent =
      ui.motion && !reduce.matches ? 'Motion on' : 'Motion off';
    $('motion').setAttribute(
      'aria-pressed',
      String(ui.motion && !reduce.matches),
    );
    $('mode').setAttribute('aria-pressed', String(ui.plain));

    $('who').textContent =
      BANK.respondents.find((r) => r.id === state.advisorId)?.name || '';
    $('nav').innerHTML =
      '<button class="navitem" data-nav="-1">Welcome</button>' +
      BANK.chapters
        .map(
          (c, i) =>
            `<button class="navitem ${state.step === i ? 'active' : ''}" data-nav="${i}" ${state.advisorId ? '' : 'disabled'} ${state.step === i ? 'aria-current="step"' : ''}><span class="node">${i + 1}</span><span>${esc(c.title)}</span></button>`,
        )
        .join('');
    $('progress').innerHTML =
      `<div class="progress"><div style="width:${(Math.max(0, state.step + 1) / 5) * 100}%"></div></div><span class="micro">${state.step < 0 ? 'Welcome' : state.step < 4 ? `Page ${state.step + 1} of 5` : 'Review your answers'}</span>`;
    if (state.step < 0) {
      welcome();
      assignFocusIDs();
      if (active && $(active)) $(active).focus({ preventScroll: true });
      return;
    }
    const c = BANK.chapters[state.step];
    const noteText = state.notes[c.id] || '';
    const body =
      state.step === 4
        ? reviewHTML()
        : c.core
            .filter((id) => isVisible(Q[id]))
            .map((id) => questionHTML(Q[id]))
            .join('') +
          (c.optional.length
            ? `<details class="detail ${c.id === 'spark' ? 'reward-highlight' : ''}" id="details-${c.id}"><summary>${esc(c.optional_title)} <span class="fine">· Optional</span></summary><div>${c.optional.map((id) => questionHTML(Q[id])).join('')}</div></details>`
            : '') +
          `<details class="detail comment-detail" id="comments-${c.id}"><summary>${esc(c.note)} <span class="fine">· ${noteText.trim() ? 'Comment added' : 'Optional'}</span></summary><div class="page-note"><label class="sr-only" for="note-${c.id}">${esc(c.note)}</label><p class="fine">${esc(c.note_help)}</p><textarea id="note-${c.id}" data-note="${c.id}" maxlength="700" placeholder="Your thoughts, ideas, or a different approach…">${esc(noteText)}</textarea></div></details>`;
    $('main').innerHTML =
      `<section class="intro"><div class="eyebrow">${esc(c.kicker)}</div><h1 id="title" tabindex="-1">${esc(c.title)}</h1><div class="scene"><p>${esc(c.intro)}</p></div></section>${body}<div class="footer"><button id="back">← Back</button>${state.step < 4 ? '<button id="next" class="primary">' + (state.step === 3 ? 'Review my playbook' : 'Continue') + ' →</button>' : ''}</div>`;
    assignFocusIDs();
    for (const id of open) if ($(id)) $(id).open = true;
    if (active && $(active)) $(active).focus({ preventScroll: true });
  }
  function welcome() {
    $('main').innerHTML =
      '<section class="welcome"><h1 id="title" tabindex="-1">What makes advising worth your time?</h1><p>Shape an advising role you look forward to.</p><p>Signed in as ' +
      esc(advisorName()) +
      '.</p>' +
      runtimeNotice() +
      '<button id="begin" class="primary">Continue my playbook →</button></section>';
  }
  function addCustomHTML(q) {
    return `<div class="addown"><input id="custom-${q.id}" maxlength="160" placeholder="Add your own ${q.type === 'rank' ? 'priority' : q.type === 'resources' ? 'resource or connection' : 'answer'}…" aria-label="Add your own answer for ${esc(q.title)}"><button data-add="${q.id}">+ Add my own</button></div><div class="error-inline" id="error-${q.id}" role="status"></div>`;
  }
  function questionHTML(q) {
    const a = state.answers[q.id];
    let html = '';
    if (q.type === 'rank') html = rankHTML(q, a);
    else if (q.type === 'slider') html = sliderHTML(q, a);
    else if (q.type === 'focus_group') html = focusHTML(q, a);
    else if (q.type === 'choice') html = choiceHTML(q, a);
    else if (q.type === 'multi_choice') html = multiChoiceHTML(q, a);
    else if (q.type === 'resources') html = resourcesHTML(q, a);
    else if (q.type === 'weekly') html = weeklyHTML(q, a);
    else if (q.type === 'text')
      html = `<textarea id="text-${q.id}" data-text="${q.id}" maxlength="${q.max_length || 700}" aria-labelledby="heading-${q.id}" placeholder="Your thoughts…">${esc(a?.text || '')}</textarea>`;
    return `<section class="question" id="question-${q.id}" aria-labelledby="heading-${q.id}"><h2 id="heading-${q.id}">${esc(q.title)}</h2>${q.prompt ? `<p class="prompt">${esc(q.prompt)}</p>` : ''}${html}</section>`;
  }
  function rankHTML(q, a = { groups: [], mode: 'rank' }) {
    const ids = a.groups.flat();
    const unranked = opts(q).filter((o) => !ids.includes(o.id));
    const statuses = [
      { id: 'rank', label: 'Rank the priorities that matter' },
      { id: 'no_order', label: 'No meaningful order / equally important' },
      ...(q.id === 'reward'
        ? [
            { id: 'none', label: 'No additional benefit needed' },
            { id: 'private', label: 'Prefer not to answer' },
          ]
        : [
            {
              id: 'not_now',
              label:
                q.id === 'concerns'
                  ? 'None of these is a priority for me right now'
                  : 'Not something to focus on this term',
            },
          ]),
    ];
    return `<div class="question-meta"><span>Drag anywhere on a card to reorder</span>${selectMarkup('rankmode-' + q.id, statuses, a.mode, 'data-rankmode="' + q.id + '" aria-label="Ranking approach for ' + esc(q.title) + '"')}</div><div class="rankboard" data-rankboard="${q.id}"><div class="rankzone priority" data-zone="priority" data-q="${q.id}"><div class="zonetitle"><span>Your priorities</span><span>Highest first</span></div>${
      ids.length
        ? ids
            .map((id) =>
              rankCard(
                q,
                opts(q).find((o) => o.id === id),
                a,
              ),
            )
            .join('')
        : '<div class="emptydrop">Drop a card here<br>or tap “Prioritize”.</div>'
    }</div><div class="rankzone" data-zone="tray" data-q="${q.id}"><div class="zonetitle"><span>Not ranked</span><span>Choose what matters</span></div>${unranked.map((o) => rankCard(q, o, a)).join('') || '<div class="emptydrop">All cards are in your priorities.</div>'}</div></div>${addCustomHTML(q)}${q.context ? contextHTML(q.context) : ''}<p class="rankhint">Use “Tie above” for equal priorities.<span class="touchhint"> Swipe outside the cards to scroll.</span></p>`;
  }
  function rankCard(q, o, a) {
    const gi = a.groups.findIndex((g) => g.includes(o.id)),
      rank = gi < 0 ? null : gi + 1,
      custom = o.id.startsWith('custom_');
    return `<div class="rankcard" data-card="${o.id}" data-q="${q.id}" data-ranked="${gi >= 0}"><div><button class="draghandle" id="handle-${q.id}-${o.id}" data-handle="${q.id}" data-item="${o.id}" aria-label="Drag ${esc(o.label)}. You can also use the move buttons." title="Drag anywhere on the card; Escape cancels">⠿</button><div class="badge" aria-label="${rank ? 'Priority ' + rank : 'Not ranked'}">${rank || '—'}</div></div><div class="cardlabel">${esc(o.label)}${custom ? '<span class="customnote">Your answer</span>' : ''}${o.description ? `<span class="carddescription">${esc(o.description)}</span>` : ''}${o.link ? `<a class="activity-link" href="${esc(o.link.url)}" target="_blank" rel="noopener noreferrer">${esc(o.link.label)} ↗</a>` : ''}</div><div class="cardtools">${gi < 0 ? `<button data-rankaction="add" data-q="${q.id}" data-item="${o.id}" aria-label="Prioritize ${esc(o.label)}">+ Prioritize</button>` : `<button data-rankaction="up" data-q="${q.id}" data-item="${o.id}" ${gi === 0 ? 'disabled' : ''} aria-label="Move ${esc(o.label)} up">↑</button><button data-rankaction="down" data-q="${q.id}" data-item="${o.id}" ${gi === a.groups.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(o.label)} down">↓</button>${gi > 0 ? `<button data-rankaction="tie" data-q="${q.id}" data-item="${o.id}" aria-label="Tie ${esc(o.label)} with the priority above">Tie above</button>` : ''}${a.groups[gi].length > 1 ? `<button data-rankaction="untie" data-q="${q.id}" data-item="${o.id}">Separate</button>` : ''}<button data-rankaction="remove" data-q="${q.id}" data-item="${o.id}" aria-label="Unrank ${esc(o.label)}">Unrank</button>`}${custom ? `<button data-editcustom="${q.id}" data-item="${o.id}" aria-label="Edit ${esc(o.label)}">Edit</button><button data-deletecustom="${q.id}" data-item="${o.id}" aria-label="Delete ${esc(o.label)}">Delete</button>` : ''}</div></div>`;
  }
  function readDial(q, a) {
    if (!a) return 'Not answered';
    if (a.mode !== 'value')
      return {
        depends: 'Depends on the situation',
        custom: 'My own arrangement',
        not_now: 'Not this term',
      }[a.mode];
    if (a.value === 50) return q.midpoint;
    if (a.value === 0) return q.left;
    if (a.value === 100) return q.right;
    const strength =
      Math.abs(a.value - 50) <= 15
        ? 'Slightly favoring: '
        : Math.abs(a.value - 50) <= 35
          ? 'More emphasis on: '
          : 'Strongly favoring: ';
    return strength + (a.value < 50 ? q.left : q.right);
  }
  function sliderHTML(q, a) {
    return `<div class="sliderbox ${a?.mode === 'value' ? '' : 'untouched'}"><div class="dial-labels"><span>${esc(q.left)}</span><span>${esc(q.right)}</span></div><input id="dial-${q.id}" data-dial="${q.id}" type="range" min="0" max="100" step="5" value="${a?.mode === 'value' ? a.value : 50}" aria-labelledby="heading-${q.id}" aria-valuetext="${esc(readDial(q, a))}"><div class="slidervalue" id="dialvalue-${q.id}" aria-live="polite">${esc(readDial(q, a))}</div><div class="dialtools"><button data-dialstep="-5" data-q="${q.id}" aria-label="Move toward ${esc(q.left)}">←</button><button data-dialmiddle="${q.id}">Use the middle</button><button data-dialstep="5" data-q="${q.id}" aria-label="Move toward ${esc(q.right)}">→</button>${q.special.map((mode) => `<button data-dialmode="${mode}" data-q="${q.id}" aria-pressed="${a?.mode === mode}">${{ depends: 'It depends', custom: 'My own arrangement', not_now: 'Not this term' }[mode]}</button>`).join('')}<button data-clear="${q.id}">Clear</button></div>${a && ['custom', 'depends'].includes(a.mode) ? `<label class="fine" for="dialtext-${q.id}">${a.mode === 'custom' ? 'Describe your own answer.' : 'What does it depend on?'}</label><textarea class="customarrangement" id="dialtext-${q.id}" data-dialtext="${q.id}" maxlength="700">${esc(a.text || '')}</textarea>` : ''}</div>`;
  }
  function focusHTML(q, a) {
    const ids = focusIDs();
    if (!ids.length)
      return '<p class="helper">Prioritize the concerns you want to explore above; their contribution dials will appear here.</p>';
    return ids
      .map((id) => {
        const d = dialQuestion('concern_focus--' + id);
        return `<div class="focus-item"><h3 id="heading-${d.id}">${esc(label('concerns', id))}</h3>${sliderHTML(d, a?.items[id])}</div>`;
      })
      .join('');
  }
  function choiceHTML(q, a) {
    const customTools = opts(q)
      .filter((o) => o.id.startsWith('custom_'))
      .map(
        (o) =>
          `<div class="custom-manage"><span>${esc(o.label)}</span><button class="small ghost" data-editcustom="${q.id}" data-item="${o.id}">Edit</button><button class="small ghost" data-deletecustom="${q.id}" data-item="${o.id}">Delete</button></div>`,
      )
      .join('');
    if (q.compact)
      return (
        selectMarkup(
          'choice-' + q.id,
          opts(q),
          a?.value,
          'data-compactchoice="' +
            q.id +
            '" aria-labelledby="heading-' +
            q.id +
            '"',
        ) +
        `<details class="custom-choice" id="own-${q.id}"><summary>Add a different answer</summary>${addCustomHTML(q)}${customTools}</details>`
      );
    return `<div class="choices">${opts(q)
      .map(
        (o) =>
          `<div><button class="choice" data-choice="${q.id}" data-value="${o.id}" aria-pressed="${a?.value === o.id}" ${q.id === 'event_contact' && o.id === 'usual' && !state.answers.busy_route ? 'disabled' : ''}>${esc(o.label)}${o.id.startsWith('custom_') ? '<span class="customnote">Your answer</span>' : ''}</button>${o.id.startsWith('custom_') ? `<button class="small ghost" data-editcustom="${q.id}" data-item="${o.id}">Edit</button> <button class="small ghost" data-deletecustom="${q.id}" data-item="${o.id}">Delete</button>` : ''}</div>`,
      )
      .join(
        '',
      )}</div>${addCustomHTML(q)}<button class="small ghost" data-clear="${q.id}" style="margin-top:10px">Clear answer</button>`;
  }
  function multiChoiceHTML(q, a = { values: [] }) {
    const selected = new Set(a.values);
    return `<div class="multi-choices" role="group" aria-labelledby="heading-${q.id}">${opts(
      q,
    )
      .map((o) => {
        const disabled =
          q.id === 'event_contact' &&
          o.id === 'usual' &&
          !reusableRoute().length;
        return `<div><label class="multi-option ${selected.has(o.id) ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}"><input id="multi-${q.id}-${o.id}" type="checkbox" data-multi="${q.id}" data-value="${o.id}" ${selected.has(o.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${esc(o.label)}${o.id.startsWith('custom_') ? '<span class="customnote">Your answer</span>' : ''}</span></label>${o.id.startsWith('custom_') ? `<div class="custom-actions"><button class="small ghost" data-editcustom="${q.id}" data-item="${o.id}">Edit</button> <button class="small ghost" data-deletecustom="${q.id}" data-item="${o.id}">Delete</button></div>` : ''}</div>`;
      })
      .join(
        '',
      )}</div>${addCustomHTML(q)}<button class="small ghost" data-clear="${q.id}" style="margin-top:10px">Clear answer</button>`;
  }
  function toggleMulti(id, value, selected) {
    const q = Q[id],
      exclusive = new Set(q.exclusive_options || []);
    let values = [...(state.answers[id]?.values || [])];
    if (selected) {
      values = exclusive.has(value)
        ? [value]
        : [...values.filter((v) => !exclusive.has(v)), value];
    } else values = values.filter((v) => v !== value);
    // Store in display order; checkbox click order is not a ranking.
    values = opts(q)
      .map((o) => o.id)
      .filter((v) => values.includes(v));
    if (values.length) changed(id, { values });
    else clearAnswer(id);
  }
  function resourcesHTML(q, a = { items: {}, mode: 'select' }) {
    return `<div class="resources">${opts(q)
      .map(
        (o) =>
          `<div class="resource-row"><label class="check"><input type="checkbox" data-resource="${o.id}" data-q="${q.id}" ${Object.hasOwn(a.items, o.id) ? 'checked' : ''}><span>${esc(o.label)}${o.id.startsWith('custom_') ? '<span class="customnote">Your answer</span>' : ''}</span></label>${Object.hasOwn(a.items, o.id) ? selectMarkup('offer-' + o.id, [...q.statuses, { id: 'custom', label: 'My own conditions / arrangement' }], a.items[o.id], 'data-offer="' + o.id + '" aria-label="How could you offer ' + esc(o.label) + '?"') : ''}${a.items[o.id] === 'custom' ? `<label class="fine" for="offerdetail-${o.id}">Your conditions or preferred arrangement</label><textarea id="offerdetail-${o.id}" data-offerdetail="${o.id}" maxlength="700">${esc(a.details?.[o.id] || '')}</textarea>` : ''}${o.id.startsWith('custom_') ? `<div class="chiprow"><button data-editcustom="${q.id}" data-item="${o.id}">Edit</button><button data-deletecustom="${q.id}" data-item="${o.id}">Delete</button></div>` : ''}</div>`,
      )
      .join(
        '',
      )}</div>${addCustomHTML(q)}<div class="chiprow"><button data-resnone="not_now" aria-pressed="${a.mode === 'not_now'}">Nothing to offer this term</button><button data-resnone="discuss" aria-pressed="${a.mode === 'discuss'}">Discuss possibilities with me</button><button data-clear="resources">Clear</button></div>`;
  }
  function weeklyError(a) {
    if (!a || a.mode !== 'range') return '';
    if (a.min === null || a.max === null)
      return 'Enter both ends of the range, or choose a different arrangement.';
    if (
      ![a.min, a.max].every(
        (n) =>
          Number.isFinite(n) &&
          n >= 0 &&
          n <= 168 &&
          Math.round(n * 4) === n * 4,
      )
    )
      return 'Use hours from 0 to 168 in quarter-hour steps.';
    if (a.min > a.max) return 'The minimum cannot be greater than the maximum.';
    return '';
  }
  function weeklyHTML(q, a) {
    const choices = [
      ['none', 'No recurring weekly time'],
      ['case', 'Discuss each invitation'],
      ['custom', 'My own arrangement'],
    ];
    return `<div class="hours-grid"><label for="hours-min">Minimum hours / week<input id="hours-min" data-hours="min" type="number" min="0" max="168" step="0.25" inputmode="decimal" placeholder="e.g., 0.5" value="${a?.mode === 'range' && a.min !== null ? a.min : ''}" aria-describedby="hours-error"></label><div class="hours-to" aria-hidden="true">to</div><label for="hours-max">Maximum hours / week<input id="hours-max" data-hours="max" type="number" min="0" max="168" step="0.25" inputmode="decimal" placeholder="e.g., 1" value="${a?.mode === 'range' && a.max !== null ? a.max : ''}" aria-describedby="hours-error"></label></div><p class="fine">0.25 hour = 15 minutes. A small, sustainable contribution is welcome; zero is also an answer.</p><div id="hours-error" class="error-inline" role="status">${esc(weeklyError(a))}</div><div class="chiprow">${choices.map(([id, l]) => `<button data-weekmode="${id}" aria-pressed="${a?.mode === id}">${l}</button>`).join('')}<button data-clear="weekly">Clear</button></div><p id="weekly-status" class="selection-status" role="status">${a && a.mode !== 'range' ? 'Selected: ' + choices.find(([id]) => id === a.mode)?.[1] : ''}</p>${a?.mode === 'custom' ? `<label for="weekly-own" class="fine">Describe the time or arrangement you would prefer.</label><textarea id="weekly-own" data-weektext maxlength="700">${esc(a.text || '')}</textarea>` : ''}`;
  }
  // A single ranking engine is used for core and optional rankings, including custom cards.
  function rankOp(qid, item, action, target = null, after = false) {
    const a = structuredClone(rankAnswer(qid)),
      gi = a.groups.findIndex((g) => g.includes(item));
    a.mode = 'rank';
    if (action === 'add' && gi < 0) a.groups.push([item]);
    else if (action === 'tie' && gi > 0) {
      a.groups[gi] = a.groups[gi].filter((x) => x !== item);
      a.groups[gi - 1].push(item);
    } else if (action === 'untie' && gi >= 0 && a.groups[gi].length > 1) {
      a.groups[gi] = a.groups[gi].filter((x) => x !== item);
      a.groups.splice(gi + 1, 0, [item]);
    } else if (action === 'up' && gi > 0) {
      a.groups[gi] = a.groups[gi].filter((x) => x !== item);
      a.groups.splice(gi - 1, 0, [item]);
    } else if (action === 'down' && gi >= 0 && gi < a.groups.length - 1) {
      a.groups[gi] = a.groups[gi].filter((x) => x !== item);
      a.groups.splice(gi + 2, 0, [item]);
    } else if (action === 'remove')
      a.groups = a.groups.map((g) => g.filter((x) => x !== item));
    else if (action === 'drop') {
      if (target === item) return;
      a.groups = a.groups
        .map((g) => g.filter((x) => x !== item))
        .filter((g) => g.length);
      const ti = target ? a.groups.findIndex((g) => g.includes(target)) : -1;
      a.groups.splice(ti < 0 ? a.groups.length : ti + (after ? 1 : 0), 0, [
        item,
      ]);
    }
    a.groups = a.groups.filter((g) => g.length);
    fieldChanged(qid, a);
    render();
    const r = a.groups.findIndex((g) => g.includes(item));
    announce(
      `${label(qid, item)} ${r >= 0 ? 'is priority ' + (r + 1) : 'is not ranked'}.`,
    );
    const h = $('handle-' + qid + '-' + item);
    h?.focus({ preventScroll: true });
    if (h && ui.motion && !ui.plain && !reduce.matches)
      h.closest('.rankcard').animate(
        [{ transform: 'scale(.98)' }, { transform: 'scale(1)' }],
        { duration: 160, easing: 'ease-out' },
      );
  }
  function addCustom(id, text) {
    const q = Q[id];
    text = text.trim();
    if (!text || text.length > 160)
      throw Error('Enter a short answer, up to 160 characters.');
    if (
      opts(q).some(
        (o) => o.label.toLocaleLowerCase() === text.toLocaleLowerCase(),
      )
    )
      throw Error('That answer is already available.');
    if ((state.custom[id] || []).length >= 5)
      throw Error(
        'Up to five custom answers per question. You can edit an existing answer.',
      );
    const oid = 'custom_' + Math.random().toString(36).slice(2, 11);
    state.custom[id] ??= [];
    state.custom[id].push({ id: oid, label: text });
    invalidate();
    if (q.type === 'choice') changed(id, { value: oid });
    if (q.type === 'multi_choice') toggleMulti(id, oid, true);
    if (q.type === 'resources') {
      const a = structuredClone(
        state.answers[id] || { items: {}, mode: 'select' },
      );
      a.mode = 'select';
      a.items[oid] = '';
      changed(id, a);
    }
    render();
    announce(
      'Your answer was added' +
        (q.type === 'rank' ? '. Drag it into your priorities.' : '.'),
    );
    return oid;
  }
  function removeCustom(id, item) {
    state.custom[id] = (state.custom[id] || []).filter((o) => o.id !== item);
    const a = state.answers[id];
    if (a) {
      if (Q[id].type === 'rank')
        a.groups = a.groups
          .map((g) => g.filter((x) => x !== item))
          .filter((g) => g.length);
      else if (Q[id].type === 'choice' && a.value === item)
        delete state.answers[id];
      else if (Q[id].type === 'multi_choice') {
        a.values = a.values.filter((v) => v !== item);
        if (!a.values.length) delete state.answers[id];
        syncUsualRoute(id);
      } else if (Q[id].type === 'resources') {
        delete a.items[item];
        if (a.details) delete a.details[item];
      }
    }
    invalidate();
    if (id === 'concerns') syncFocus();
    render();
    announce('Custom answer removed.');
  }
  // Full-card pointer drag for mouse, touch and pen. Interactive controls retain native actions.
  // On touch, gestures starting outside cards keep native page scrolling.
  function clearDrop() {
    document
      .querySelectorAll('.dropbefore,.dropafter,.dropzone')
      .forEach((e) =>
        e.classList.remove('dropbefore', 'dropafter', 'dropzone'),
      );
  }
  function targetAt(x, y) {
    const el = document.elementFromPoint(x, y),
      zone = el?.closest('[data-zone]');
    if (!zone || zone.dataset.q !== drag.q) return null;
    clearDrop();
    const card = el.closest('[data-card]');
    if (zone.dataset.zone === 'tray') {
      zone.classList.add('dropzone');
      return { zone: 'tray' };
    }
    if (card && card.dataset.card !== drag.item) {
      const after =
        y >
        card.getBoundingClientRect().top +
          card.getBoundingClientRect().height / 2;
      card.classList.add(after ? 'dropafter' : 'dropbefore');
      return { zone: 'priority', item: card.dataset.card, after };
    }
    if (card && card.dataset.card === drag.item) return null;
    const cards = [...zone.querySelectorAll('[data-card]')].filter(
      (c) => c.dataset.card !== drag.item,
    );
    let target = cards.find(
      (c) =>
        y <
        c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2,
    );
    if (target) {
      target.classList.add('dropbefore');
      return { zone: 'priority', item: target.dataset.card, after: false };
    }
    zone.classList.add('dropzone');
    return {
      zone: 'priority',
      item: cards.at(-1)?.dataset.card || null,
      after: true,
    };
  }
  function dragTick() {
    if (!drag || !drag.active) return;
    const margin = 70,
      speed = drag.y < margin ? -12 : drag.y > innerHeight - margin ? 12 : 0;
    if (speed) {
      window.scrollBy(0, speed);
      drag.target = targetAt(drag.x, drag.y);
    }
    drag.frame = requestAnimationFrame(dragTick);
  }
  function startDrag(e) {
    if (e.button !== 0 || !e.isPrimary) return;
    const card = e.target.closest('[data-card]');
    if (!card) return;
    const control = e.target.closest(
      'button,input,select,textarea,a,label,[contenteditable="true"]',
    );
    if (control && !control.matches('[data-handle]')) return;
    const h = card.querySelector('[data-handle]'),
      box = card.getBoundingClientRect();
    drag = {
      q: card.dataset.q,
      item: card.dataset.card,
      handle: h,
      capture: card,
      origin: card,
      pid: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - box.left,
      offsetY: e.clientY - box.top,
      active: false,
      target: null,
      box,
    };
    card.setPointerCapture(e.pointerId);
  }
  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (
      !drag.active &&
      Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6
    ) {
      drag.active = true;
      drag.ghost = drag.origin.cloneNode(true);
      drag.ghost.removeAttribute('id');
      drag.ghost
        .querySelectorAll('[id]')
        .forEach((x) => x.removeAttribute('id'));
      drag.ghost.classList.add('dragghost');
      drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.style.width = drag.box.width + 'px';
      document.body.append(drag.ghost);
      drag.origin.classList.add('dragorigin');
      document.body.classList.add('dragging');
      announce('Picked up ' + label(drag.q, drag.item) + '. Escape cancels.');
      dragTick();
    }
    if (drag.active) {
      e.preventDefault();
      drag.ghost.style.left = e.clientX - drag.offsetX + 'px';
      drag.ghost.style.top = e.clientY - drag.offsetY + 'px';
      drag.target = targetAt(e.clientX, e.clientY);
    }
  }
  function finishDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.frame);
    d.ghost?.remove();
    d.origin.classList.remove('dragorigin');
    document.body.classList.remove('dragging');
    clearDrop();
    try {
      d.capture.releasePointerCapture(d.pid);
    } catch {}
    if (d.active) {
      clickSuppressed = true;
      setTimeout(() => (clickSuppressed = false), 80);
      if (commit && d.target) {
        rankOp(
          d.q,
          d.item,
          d.target.zone === 'tray' ? 'remove' : 'drop',
          d.target.item,
          d.target.after,
        );
      } else {
        announce('Move canceled. Ranking unchanged.');
        d.handle.focus({ preventScroll: true });
      }
    }
  }
  // Resolve touch taps on buttons at pointer-up; some mobile browsers suppress a
  // compatibility click after a captured drag. Deduplicate the subsequent native click.
  // Movement/cancel still permits ordinary page scrolling; keyboard clicks stay native.
  let touchTap = null,
    lastTouchAction = null;
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button');
    if (
      e.pointerType === 'touch' &&
      b &&
      !b.matches('[data-handle]') &&
      !b.disabled
    )
      touchTap = {
        node: b,
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: false,
      };
  });
  document.addEventListener(
    'pointermove',
    (e) => {
      if (
        touchTap?.id === e.pointerId &&
        Math.hypot(e.clientX - touchTap.x, e.clientY - touchTap.y) > 10
      )
        touchTap.moved = true;
    },
    { passive: true },
  );
  document.addEventListener('pointercancel', () => {
    touchTap = null;
  });
  document.addEventListener('pointerup', (e) => {
    if (touchTap?.id !== e.pointerId) return;
    const t = touchTap;
    touchTap = null;
    if (!t.moved && e.target.closest('button') === t.node && !t.node.disabled) {
      lastTouchAction = { id: t.node.id, at: performance.now() };
      t.node.click();
    }
  });
  document.addEventListener(
    'click',
    (e) => {
      if (
        e.isTrusted &&
        e.pointerType === 'touch' &&
        lastTouchAction &&
        performance.now() - lastTouchAction.at < 500 &&
        e.target.closest('button')?.id === lastTouchAction.id
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  document.addEventListener('pointerdown', startDrag);
  document.addEventListener('pointermove', moveDrag, { passive: false });
  document.addEventListener('pointerup', (e) => {
    if (drag?.pid === e.pointerId) finishDrag(true);
  });
  document.addEventListener('pointercancel', () => finishDrag(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      finishDrag(false);
    }
    const h = e.target.closest('[data-handle]');
    if (h && e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      rankOp(
        h.dataset.handle,
        h.dataset.item,
        e.key === 'ArrowUp' ? 'up' : 'down',
      );
    }
  });
  window.addEventListener('blur', () => finishDrag(false));
  function setDial(id, value) {
    writeDial(id, { mode: 'value', value: Math.min(100, Math.max(0, value)) });
  }
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.hours) {
      const old = state.answers.weekly;
      const a =
        old?.mode === 'range'
          ? { ...old }
          : { mode: 'range', min: null, max: null };
      a[t.dataset.hours] = t.value === '' ? null : Number(t.value);
      if (a.min === null && a.max === null) {
        delete state.answers.weekly;
        delete state.answers.priority;
        invalidate();
      } else changed('weekly', a);
      $('hours-error').textContent = weeklyError(state.answers.weekly);
      document
        .querySelectorAll('[data-weekmode]')
        .forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('weekly-own')?.remove();
      $('weekly-status').textContent =
        a.min === null && a.max === null
          ? ''
          : 'Using the hours entered above.';
      updateWeeklyPriority();
    }
    if (t.hasAttribute('data-weektext'))
      changed('weekly', { mode: 'custom', text: t.value });
    if (t.dataset.text) {
      if (t.value.trim()) changed(t.dataset.text, { text: t.value });
      else {
        delete state.answers[t.dataset.text];
        invalidate();
      }
    }
    if (t.dataset.dial) {
      const id = t.dataset.dial;
      setDial(id, Number(t.value));
      $('dialvalue-' + id).textContent = readDial(
        dialQuestion(id),
        getDial(id),
      );
      t.setAttribute('aria-valuetext', readDial(dialQuestion(id), getDial(id)));
      t.closest('.sliderbox').classList.remove('untouched');
    }
    if (t.dataset.dialtext) {
      const a = getDial(t.dataset.dialtext);
      writeDial(t.dataset.dialtext, { ...a, text: t.value });
    }
    if (t.dataset.offerdetail) {
      const a = structuredClone(state.answers.resources);
      a.details ??= {};
      a.details[t.dataset.offerdetail] = t.value;
      changed('resources', a);
    }
    if (t.dataset.note) {
      state.notes[t.dataset.note] = t.value;
      invalidate();
    }
    if (t.dataset.summarytext) {
      const id = t.dataset.summarytext,
        r = state.review[id];
      r.text = t.value;
      r.manual = id !== 'q-ideal_responsibilities';
      r.reviewed = false;
      r.included = false;
      if (id === 'q-ideal_responsibilities') {
        if (t.value.trim())
          state.answers.ideal_responsibilities = { text: t.value };
        else delete state.answers.ideal_responsibilities;
      }
      invalidate();
      refreshReviewControls(id);
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.dial) {
      render();
      return;
    }
    if (t.dataset.rankmode) {
      const id = t.dataset.rankmode;
      if (!t.value) {
        clearAnswer(id);
      } else fieldChanged(id, { groups: [], mode: t.value });
      render();
      announce('Ranking approach changed; active ranks cleared.');
    }
    if (t.dataset.multi) {
      toggleMulti(t.dataset.multi, t.dataset.value, t.checked);
      render();
    }
    if (t.dataset.resource) {
      const a = structuredClone(
        state.answers.resources || { items: {}, mode: 'select' },
      );
      a.mode = 'select';
      if (t.checked) a.items[t.dataset.resource] = '';
      else {
        delete a.items[t.dataset.resource];
        if (a.details) delete a.details[t.dataset.resource];
      }
      changed('resources', a);
      render();
    }
    if (t.dataset.offer) {
      const a = structuredClone(state.answers.resources);
      a.items[t.dataset.offer] = t.value;
      if (a.details && t.value !== 'custom') delete a.details[t.dataset.offer];
      changed('resources', a);
      render();
    }
    if (t.dataset.compactchoice) {
      if (t.value) changed(t.dataset.compactchoice, { value: t.value });
      else clearAnswer(t.dataset.compactchoice);
      render();
    }
    if (t.dataset.answerreview) {
      reviewFields();
      const r = state.review[t.dataset.answerreview];
      r.reviewed = t.checked;
      state.approved = false;
      render();
    }
    if (t.dataset.answerinclude) {
      reviewFields();
      const r = state.review[t.dataset.answerinclude];
      r.included = t.checked;
      state.approved = false;
      render();
    }
    if (t.id === 'approve-playbook') {
      state.approved = t.checked;
      render();
    }
  });
  document.addEventListener('click', (e) => {
    if (
      clickSuppressed &&
      e.target.closest('[data-card]') &&
      !e.target.closest('.cardtools')
    )
      return;
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.id === 'begin') setStep(0);
    if (t.id === 'next') setStep(Math.min(4, state.step + 1));
    if (t.id === 'back') setStep(state.step - 1);
    if (t.dataset.nav !== undefined) setStep(Number(t.dataset.nav));
    if (t.id === 'mode') {
      ui.plain = !ui.plain;
      render();
    }
    if (t.id === 'motion') {
      ui.motion = !ui.motion;
      render();
    }
    if (t.id === 'restart') {
      if (confirm('Discard all answers in this tab and start over?')) {
        state = fresh();
        render();
      }
    }
    if (t.dataset.rankaction)
      rankOp(t.dataset.q, t.dataset.item, t.dataset.rankaction);
    if (t.dataset.add) {
      const id = t.dataset.add;
      try {
        addCustom(id, $('custom-' + id).value);
      } catch (err) {
        $('error-' + id).textContent = err.message;
      }
    }
    if (t.dataset.editcustom) {
      const id = t.dataset.editcustom,
        item = t.dataset.item,
        o = state.custom[id].find((x) => x.id === item);
      const text = prompt('Edit your answer (up to 160 characters).', o.label);
      if (text === null) return;
      const clean = text.trim();
      if (
        !clean ||
        clean.length > 160 ||
        opts(Q[id]).some(
          (x) => x.id !== item && x.label.toLowerCase() === clean.toLowerCase(),
        )
      ) {
        alert('Use a unique, nonempty answer of up to 160 characters.');
        return;
      }
      o.label = clean;
      invalidate();
      if (id === 'concerns' && state.answers.concern_focus?.items[item]) {
        delete state.answers.concern_focus.items[item];
        syncFocus();
      }
      render();
    }
    if (t.dataset.deletecustom)
      removeCustom(t.dataset.deletecustom, t.dataset.item);
    if (t.dataset.clear) {
      clearAnswer(t.dataset.clear);
      render();
    }
    if (t.dataset.dialmiddle) {
      setDial(t.dataset.dialmiddle, 50);
      render();
    }
    if (t.dataset.dialstep) {
      const id = t.dataset.q,
        a = getDial(id);
      setDial(
        id,
        (a?.mode === 'value' ? a.value : 50) + Number(t.dataset.dialstep),
      );
      render();
    }
    if (t.dataset.dialmode) {
      writeDial(t.dataset.q, { mode: t.dataset.dialmode, text: '' });
      render();
      if (['custom', 'depends'].includes(t.dataset.dialmode))
        $('dialtext-' + t.dataset.q)?.focus({ preventScroll: true });
    }
    if (t.dataset.weekmode) {
      changed('weekly', {
        mode: t.dataset.weekmode,
        ...(t.dataset.weekmode === 'custom' ? { text: '' } : {}),
      });
      render();
      $('weekly-own')?.focus({ preventScroll: true });
    }
    if (t.dataset.choice) {
      changed(t.dataset.choice, { value: t.dataset.value });
      render();
    }
    if (t.dataset.resnone) {
      changed('resources', { items: {}, mode: t.dataset.resnone });
      render();
    }
    if (t.dataset.editresponse) {
      editResponse(t.dataset.editresponse);
    }
    if (t.dataset.resetwording) {
      const id = t.dataset.resetwording;
      delete state.review[id];
      invalidate();
      render();
    }
    if (t.dataset.keepwording) {
      const r = state.review[t.dataset.keepwording];
      r.stale = false;
      r.reviewed = false;
      r.included = false;
      invalidate();
      render();
    }
    if (t.id === 'exportFullWord') saveFullWord();
    if (t.id === 'exportFullMarkdown') saveFullMarkdown();
    if (t.id === 'submitPlaybook') submitSharedSummary();
    if (t.id === 'copyEmail' || t.id === 'copyEmailMobile')
      copyEmail(t.id === 'copyEmailMobile');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id.startsWith('custom-')) {
      e.preventDefault();
      const id = e.target.id.slice(7);
      try {
        addCustom(id, e.target.value);
      } catch (err) {
        $('error-' + id).textContent = err.message;
      }
    }
  });
  function answerText(id) {
    const a = state.answers[id],
      q = Q[id];
    if (!a || !q || !isVisible(q)) return null;
    if (q.type === 'rank') {
      if (a.mode !== 'rank')
        return {
          no_order: 'No meaningful ordering was expressed.',
          none: 'No additional personal or professional benefit is needed.',
          private: 'Prefers not to answer.',
          not_now:
            q.id === 'concerns'
              ? 'None of these is a priority for me right now.'
              : 'Not a focus this term.',
        }[a.mode];
      return a.groups.length
        ? a.groups
            .map(
              (g, i) =>
                `${i + 1}. ${g.map((x) => label(id, x)).join(' / ')}${g.length > 1 ? ' (tied)' : ''}`,
            )
            .join('\n')
        : null;
    }
    if (q.type === 'slider')
      return readDial(q, a) + (a.text?.trim() ? '\n' + a.text.trim() : '');
    if (q.type === 'focus_group')
      return (
        focusIDs()
          .filter((oid) => a.items[oid])
          .map((oid) => {
            const v = a.items[oid];
            return (
              label('concerns', oid) +
              ' — ' +
              readDial(q, v) +
              (v.text?.trim() ? '\n' + v.text.trim() : '')
            );
          })
          .join('\n\n') || null
      );
    if (q.type === 'text') return a.text?.trim() || null;
    if (q.type === 'weekly') {
      if (a.mode === 'range')
        return weeklyError(a)
          ? 'Weekly hours: needs clarification.'
          : `${a.min}–${a.max} hours per ordinary week, including routine meetings, preparation, messages, and review. Extra event time is discussed separately.`;
      return {
        none: 'No recurring weekly time.',
        case: 'Discuss time for each invitation.',
        custom: a.text?.trim() || 'A custom arrangement; details to discuss.',
      }[a.mode];
    }
    if (q.type === 'multi_choice') {
      return (
        a.values
          .map((v) =>
            v === 'usual' && id === 'event_contact'
              ? 'Use my availability-check route from the second page (refer to that response if shared; otherwise confirm with me).'
              : label(id, v),
          )
          .join('\n') || null
      );
    }
    if (q.type === 'choice') {
      if (id === 'event_contact' && a.value === 'usual')
        return 'Use my availability-check route from the second page (refer to that response if shared; otherwise confirm with me).';
      return label(id, a.value);
    }
    if (q.type === 'resources') {
      if (a.mode !== 'select')
        return a.mode === 'not_now'
          ? 'Nothing to offer this term.'
          : 'Discuss possibilities first.';
      return (
        Object.entries(a.items)
          .map(
            ([oid, s]) =>
              `${label(id, oid)} — ${s === 'custom' ? a.details?.[oid]?.trim() || 'My own conditions; discuss details.' : q.statuses.find((x) => x.id === s)?.label || 'offering conditions not specified yet'}`,
          )
          .join('\n') || null
      );
    }
    return null;
  }
  // Per-response sharing. Never serialize full state or infer consent from another response.
  function otherAdvisor() {
    return BANK.respondents.find((p) => p.id !== state.advisorId);
  }
  function advisorName() {
    return BANK.respondents.find((p) => p.id === state.advisorId)?.name || '';
  }
  function consentWording() {
    return `I am ready to submit the shared summary to club officers and ${otherAdvisor()?.name || 'the other advisor'}.`;
  }
  function runtimeNotice() {
    return '<p>Only responses you individually review and include are saved when you submit. Unshared responses stay in this browser session. Download your full personal copy before closing or refreshing.</p>';
  }
  function contextHTML(c) {
    return `<details class="activity-context"><summary>${esc(c.title)}</summary>${(
      c.paragraphs || [c.body]
    )
      .filter(Boolean)
      .map((p) => `<p>${esc(p)}</p>`)
      .join(
        '',
      )}${c.link ? `<p><a href="${esc(c.link.url)}" target="_blank" rel="noopener noreferrer">${esc(c.link.label)} ↗</a></p>` : ''}</details>`;
  }
  function usedOptionIDs(id) {
    const a = state.answers[id],
      q = Q[id];
    if (!a) return [];
    if (q.type === 'rank') return a.mode === 'rank' ? a.groups.flat() : [];
    if (q.type === 'choice') return [a.value];
    if (q.type === 'multi_choice') return a.values || [];
    if (q.type === 'resources')
      return a.mode === 'select' ? Object.keys(a.items) : [];
    return [];
  }
  function usedCustomOptions(id) {
    const selected = new Set(usedOptionIDs(id));
    return (state.custom[id] || [])
      .filter((o) => selected.has(o.id))
      .map((o) => ({ id: o.id, label: o.label }));
  }
  function optionCustom(id, oid) {
    return (state.custom[id] || [])
      .filter((o) => o.id === oid)
      .map((o) => ({ id: o.id, label: o.label }));
  }
  function responseDescriptors() {
    const out = [];
    for (let step = 0; step < 4; step++) {
      const c = BANK.chapters[step];
      for (const id of [...c.core, ...c.optional]) {
        const q = Q[id],
          a = state.answers[id];
        if (q.type === 'focus_group') {
          for (const oid of focusIDs()) {
            const v = a?.items[oid];
            if (!v) continue;
            const text =
              readDial(q, v) + (v.text?.trim() ? '\n' + v.text.trim() : '');
            out.push({
              id: 'focus-' + oid,
              kind: 'concern',
              questionId: id,
              optionId: oid,
              step,
              title: 'How I would like to help — ' + label('concerns', oid),
              text,
              answer: v,
              customOptions: optionCustom('concerns', oid),
            });
          }
        } else if (q.type === 'resources' && a?.mode === 'select') {
          for (const [oid, offer] of Object.entries(a.items)) {
            const text =
              offer === 'custom'
                ? a.details?.[oid]?.trim() ||
                  'My own conditions; details to discuss.'
                : q.statuses.find((s) => s.id === offer)?.label ||
                  'Offering conditions not specified yet.';
            const answer = {
              status: offer || 'unspecified',
              ...(offer === 'custom' ? { text: a.details?.[oid] || '' } : {}),
            };
            out.push({
              id: 'resource-' + oid,
              kind: 'resource',
              questionId: id,
              optionId: oid,
              step,
              title: 'Possible resource — ' + label(id, oid),
              text,
              answer,
              customOptions: optionCustom(id, oid),
            });
          }
        } else {
          out.push({
            id: 'q-' + id,
            kind: 'question',
            questionId: id,
            step,
            title: q.title,
            text: isVisible(q) ? answerText(id) || '' : '',
            answer: isVisible(q) ? a : undefined,
            customOptions: usedCustomOptions(id),
          });
        }
      }
      out.push({
        id: 'note-' + c.id,
        kind: 'comment',
        pageId: c.id,
        step,
        title: 'My thoughts — ' + c.title,
        text: state.notes[c.id]?.trim() || '',
      });
    }
    out.unshift({
      id: 'q-ideal_responsibilities',
      kind: 'question',
      questionId: 'ideal_responsibilities',
      step: 4,
      title: Q.ideal_responsibilities.title,
      text: answerText('ideal_responsibilities') || '',
      answer: state.answers.ideal_responsibilities,
      customOptions: [],
    });
    return out;
  }
  function sourceSignature(f) {
    // Deliberately excludes other responses. Parent rank position is not this concern's consent.
    return JSON.stringify([f.title, f.text, f.answer, f.customOptions]);
  }
  function reviewFields() {
    const descriptors = responseDescriptors(),
      active = new Set(descriptors.map((d) => d.id));
    for (const [id, r] of Object.entries(state.review))
      if (!active.has(id)) {
        r.reviewed = false;
        r.included = false;
        r.archived = true;
      }
    return descriptors
      .map((f) => {
        const signature = sourceSignature(f);
        let r = state.review[f.id];
        if (!r) {
          r = {
            text: f.text,
            manual: false,
            signature,
            stale: false,
            reviewed: false,
            included: false,
            title: f.title,
            archived: false,
          };
          state.review[f.id] = r;
        } else if (r.signature !== signature || r.archived) {
          if (r.manual && r.text !== f.text) r.stale = true;
          else {
            r.text = f.text;
            r.manual = false;
            r.stale = false;
          }
          r.signature = signature;
          r.reviewed = false;
          r.included = false;
          r.title = f.title;
          r.archived = false;
          state.approved = false;
        }
        return {
          ...f,
          ...r,
          source: f.text,
          mode:
            r.text === f.text && f.kind !== 'comment'
              ? 'structured'
              : 'narrative',
        };
      })
      .filter(
        (f) =>
          f.id === 'q-ideal_responsibilities' ||
          f.source.trim() ||
          f.text.trim(),
      );
  }
  function sharingIssues(fields = reviewFields()) {
    if (!state.advisorId) return ['Verify your email.'];
    const selected = fields.filter((f) => f.included);
    if (!selected.length)
      return ['Choose at least one response to include in the shared summary.'];
    const issues = [];
    for (const f of selected) {
      if (!f.text.trim())
        issues.push(`${f.title}: add wording or leave this response out.`);
      if (!f.reviewed)
        issues.push(`${f.title}: review this wording before submitting.`);
      if (f.stale)
        issues.push(`${f.title}: resolve the changed-answer notice.`);
      if (
        f.questionId === 'weekly' &&
        f.mode === 'structured' &&
        weeklyError(f.answer)
      )
        issues.push(weeklyError(f.answer));
    }
    return issues;
  }
  function canShare() {
    return !!state.approved && !sharingIssues().length;
  }
  function hasFullResponses() {
    return (
      !!state.advisorId &&
      (BANK.questions.some((q) => state.answers[q.id] !== undefined) ||
        Object.values(state.notes).some((t) => t.trim()) ||
        Object.values(state.custom).some((a) => a.length) ||
        Object.values(state.review).some((r) => r.text.trim()))
    );
  }
  function fieldHint(f) {
    if (f.stale)
      return 'Your source answer changed. Choose the wording to keep, then review it again.';
    if (f.mode === 'narrative' && f.kind !== 'comment')
      return 'Edited wording only: your original answer will not be attached or used for numeric analytics.';
    if (f.kind === 'comment')
      return 'This comment has its own review and sharing choices.';
    return f.text.trim()
      ? 'Review this answer as written, edit the wording, or change the original answer.'
      : 'Describe your ideal role in your own words.';
  }
  function refreshReviewControls(id) {
    const fields = reviewFields(),
      f = fields.find((x) => x.id === id);
    if (!f) return;
    const card = $('review-card-' + id);
    if (card) {
      card.classList.toggle('is-included', !!f.included);
      card.querySelector('.response-mode').textContent = fieldHint(f);
      const reset = card.querySelector('[data-resetwording]');
      if (reset)
        reset.hidden =
          f.mode !== 'narrative' ||
          f.kind === 'comment' ||
          f.id === 'q-ideal_responsibilities';
    }
    for (const [key, flag] of [
      ['reviewed', 'reviewed'],
      ['included', 'included'],
    ]) {
      const box = $(key + '-' + id);
      if (box) {
        box.checked = !!f[flag];
        box.disabled = !f.text.trim() || f.stale;
      }
    }
    refreshFinalControls(fields);
  }
  function refreshFinalControls(fields = reviewFields()) {
    const count = fields.filter((x) => x.included).length,
      issues = sharingIssues(fields);
    if ($('selection-summary'))
      $('selection-summary').textContent =
        `${count} ${count === 1 ? 'response' : 'responses'} selected for sharing.`;
    if ($('sharing-issues'))
      $('sharing-issues').textContent = count ? issues.join(' ') : '';
    if ($('approve-playbook'))
      $('approve-playbook').disabled = issues.length > 0;
    document
      .querySelectorAll('[data-personal-export]')
      .forEach((b) => (b.disabled = !hasFullResponses()));
  }
  function summaryCard(f) {
    const ideal = f.id === 'q-ideal_responsibilities';
    return `<section class="reviewfield ${f.included ? 'is-included' : ''}" id="review-card-${f.id}" aria-labelledby="summary-heading-${f.id}"><div class="review-heading-row"><h3 id="summary-heading-${f.id}">${esc(f.title)}</h3>${ideal ? '' : `<button class="small ghost" data-editresponse="${f.id}">${f.kind === 'comment' ? 'Edit comment' : 'Edit answer'}</button>`}</div>${ideal ? `<p class="fine">${esc(Q.ideal_responsibilities.prompt)}</p>` : ''}<p class="response-mode">${esc(fieldHint(f))}</p>${f.stale ? `<div class="stale-note">Your original answer changed after you edited its wording.<details><summary>See updated answer</summary><pre>${esc(f.source)}</pre></details><div class="chiprow"><button class="small" data-resetwording="${f.id}">Use updated answer</button><button class="small" data-keepwording="${f.id}">Keep my wording</button></div></div>` : ''}<textarea id="summary-${f.id}" class="summary-editor" data-summarytext="${f.id}" maxlength="${ideal ? 2000 : f.kind === 'comment' ? 700 : 12000}" aria-labelledby="summary-heading-${f.id}" placeholder="${ideal ? 'The role I would love to play…' : 'Write the answer you would like to share…'}">${esc(f.text)}</textarea>${!ideal && !f.stale ? `<button class="small ghost" data-resetwording="${f.id}" ${f.mode !== 'narrative' || f.kind === 'comment' ? 'hidden' : ''}>Restore generated wording</button>` : ''}<div class="reviewcontrols"><label for="reviewed-${f.id}"><input type="checkbox" id="reviewed-${f.id}" data-answerreview="${f.id}" ${f.reviewed ? 'checked' : ''} ${!f.text.trim() || f.stale ? 'disabled' : ''}>I reviewed this wording.</label><label for="included-${f.id}"><input type="checkbox" id="included-${f.id}" data-answerinclude="${f.id}" ${f.included ? 'checked' : ''} ${!f.text.trim() || f.stale ? 'disabled' : ''}>Include in shared summary.</label></div></section>`;
  }
  function reviewHTML() {
    const fields = reviewFields(),
      issues = sharingIssues(fields),
      valid = !!state.approved && !issues.length,
      count = fields.filter((f) => f.included).length;
    const ideal = fields.find((f) => f.id === 'q-ideal_responsibilities');
    const grouped = BANK.chapters
      .slice(0, 4)
      .map((c, step) => {
        const items = fields.filter((f) => f.step === step);
        return items.length
          ? `<section class="review-group" aria-labelledby="review-group-${c.id}"><h2 id="review-group-${c.id}" class="review-group-title">${esc(c.title)}</h2>${items.map(summaryCard).join('')}</section>`
          : '';
      })
      .join('');
    return `<div class="playbook-person"><span class="eyebrow">Your advising playbook</span><h2>${esc(advisorName())}</h2></div><p class="share-guide">Each response has two separate choices: approve its wording and decide whether to share it. Only responses marked for inclusion and reviewed will be submitted. Questions you skipped stay out.</p>${summaryCard(ideal)}${grouped}<section class="send-panel"><h2>Share your playbook</h2><p>Submitting replaces your previously shared summary with this selection. Responses you leave out are removed from the current shared results.</p><p id="selection-summary" class="selection-summary">${count} ${count === 1 ? 'response' : 'responses'} selected for sharing.</p><p class="fine" id="sharing-issues" role="status">${count ? esc(issues.join(' ')) : ''}</p><label class="check final-approval"><input id="approve-playbook" type="checkbox" ${state.approved ? 'checked' : ''} ${issues.length ? 'disabled' : ''}><span>${esc(consentWording())}</span></label><div class="chiprow"><button id="submitPlaybook" class="primary" data-submit-control ${valid ? '' : 'disabled'}>Submit shared summary</button></div><div id="submit-status" role="status" aria-live="polite" class="submit-status"></div><div class="personal-copy"><h3>Keep a full copy for yourself</h3><p>These files contain all your responses, comments, and edited wording, including answers you do not include in the shared summary. Downloading does not submit anything.</p><div class="chiprow"><button id="exportFullWord" class="ghost" data-personal-export ${hasFullResponses() ? '' : 'disabled'}>Download full responses (.docx)</button><button id="exportFullMarkdown" class="ghost" data-personal-export ${hasFullResponses() ? '' : 'disabled'}>Download full responses (.md)</button></div></div></section>`;
  }
  function editResponse(id) {
    const f = reviewFields().find((x) => x.id === id);
    if (!f) return;
    setStep(f.step);
    const target =
      f.kind === 'comment'
        ? $('comments-' + f.pageId)
        : $('question-' + f.questionId);
    if (f.kind === 'comment' && target) target.open = true;
    if (target) {
      const details = target.closest('details');
      if (details) details.open = true;
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      const focus = target.querySelector('h2,textarea');
      if (focus) {
        focus.tabIndex = -1;
        focus.focus({ preventScroll: true });
      }
    }
  }
  function sharedData() {
    if (!canShare())
      throw Error(
        'Review and include at least one response, resolve any included errors, and confirm the audience.',
      );
    const responses = reviewFields()
      .filter((f) => f.included && f.reviewed && !f.stale && f.text.trim())
      .map((f) => {
        const item = {
          id: f.id,
          kind: f.kind,
          ...(f.questionId ? { questionId: f.questionId } : {}),
          ...(f.optionId ? { optionId: f.optionId } : {}),
          ...(f.pageId ? { pageId: f.pageId } : {}),
          mode: f.mode,
          text: f.text.trim(),
          wordingReviewed: true,
          included: true,
        };
        if (f.mode === 'structured') {
          item.answer = structuredClone(f.answer);
          item.customOptions = structuredClone(f.customOptions || []);
        }
        // Narrative edits intentionally omit original answers, custom labels, signatures and notes.
        return item;
      })
      .sort((a, b) => a.id.localeCompare(b.id)); // Do not leak a withheld parent ranking through item order.
    return {
      format: 'advisor-studio-shared/9',
      contentVersion: BANK.content_version,
      advisorId: state.advisorId,
      consent: {
        reviewed: true,
        audience: ['club_officers', otherAdvisor().id],
      },
      responses,
    };
  }
  async function submitSharedSummary() {
    const button = $('submitPlaybook'),
      status = $('submit-status');
    if (submitting) return;
    try {
      const data = sharedData();
      submitting = true;
      button.disabled = true;
      status.textContent = 'Saving selected responses…';
      const receipt = await transport.submit(data);
      status.textContent =
        'Shared summary saved. Revision ' +
        receipt.revision +
        '. Reference: ' +
        receipt.id;
      state.approved = false;
      const approval = $('approve-playbook');
      if (approval) approval.checked = false;
      announce('Shared summary saved.');
    } catch (error) {
      status.textContent = error.message;
      button.disabled = !canShare();
    } finally {
      submitting = false;
    }
  }
  function completeAnswerText(id) {
    const a = state.answers[id],
      q = Q[id];
    let text;
    if (q.type === 'weekly' && a?.mode === 'range' && weeklyError(a))
      text = `Minimum entered: ${a.min === null ? 'Not entered' : a.min + ' hours/week'}\nMaximum entered: ${a.max === null ? 'Not entered' : a.max + ' hours/week'}\nNeeds clarification: ${weeklyError(a)}`;
    else text = answerText(id) || 'Not answered.';
    if (q.type === 'slider' && a?.mode === 'value')
      text += `\nDial position: ${a.value} of 100 (interface position, not a percentage of time).`;
    if (q.type === 'focus_group' && a?.items) {
      const levels = Object.entries(a.items)
        .filter(([, d]) => d.mode === 'value')
        .map(
          ([oid, d]) =>
            `${label('concerns', oid)}: dial position ${d.value} of 100`,
        );
      if (levels.length) text += '\n' + levels.join('\n');
    }
    const custom = state.custom[id] || [];
    if (custom.length) {
      const selected = new Set(usedOptionIDs(id));
      text +=
        '\n\nYour added options:\n' +
        custom
          .map(
            (o) =>
              `${o.label} — ${selected.has(o.id) ? 'selected / ranked' : 'not selected / unranked'}`,
          )
          .join('\n');
    }
    return text;
  }
  function fullResponseData() {
    if (!hasFullResponses())
      throw Error('Add a response before downloading your full copy.');
    const fields = reviewFields(),
      output = [];
    for (const c of BANK.chapters.slice(0, 4)) {
      const ids = [...c.core, ...c.optional].filter(
        (id) =>
          state.answers[id] !== undefined || (state.custom[id] || []).length,
      );
      let text = ids
        .map((id) => Q[id].title + '\n' + completeAnswerText(id))
        .join('\n\n');
      if (state.notes[c.id]?.trim())
        text +=
          (text ? '\n\n' : '') + 'My comments\n' + state.notes[c.id].trim();
      if (text) output.push({ id: c.id, title: c.title, text });
    }
    if (answerText('ideal_responsibilities'))
      output.unshift({
        id: 'role',
        title: 'My ideal responsibilities',
        text: completeAnswerText('ideal_responsibilities'),
      });
    const statuses = fields
      .filter((f) => f.text.trim())
      .map(
        (f) =>
          `${f.title}\nWording reviewed: ${f.reviewed ? 'Yes' : 'No'}; included in shared summary: ${f.included ? 'Yes' : 'No'}${f.stale ? ' — source changed; review needed' : ''}`,
      );
    if (statuses.length)
      output.push({
        id: 'sharing_choices',
        title: 'My review and sharing choices',
        text: statuses.join('\n\n'),
      });
    for (const [id, r] of Object.entries(state.review)) {
      const f = fields.find((x) => x.id === id);
      if (!r.text.trim() || !(r.manual || r.archived)) continue;
      output.push({
        id: 'summary_' + id,
        title: 'My edited wording — ' + r.title,
        text: `${r.archived ? 'This source response is no longer active; not included in submission.\n' : r.stale ? 'Source answer changed; wording needs review.\n' : ''}${r.text.trim()}`,
      });
    }
    return {
      kind: 'personal-full-copy',
      advisorName: advisorName(),
      sections: output,
    };
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function markdownLiteral(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/([\\`*_{}\[\]#])/g, '\\$1');
  }
  function fullMarkdown() {
    const data = fullResponseData();
    return (
      '# My full Advisor Studio responses\n\nDallas College AI Club\n\n**Advisor:** ' +
      data.advisorName +
      '\n\nPersonal copy — includes responses not selected for sharing. This download is not a submission. Unanswered questions are omitted.\n\n' +
      data.sections
        .map((s) => '## ' + s.title + '\n\n' + markdownLiteral(s.text) + '\n')
        .join('\n')
    );
  }
  function saveFullMarkdown() {
    try {
      download(
        `advisor-full-responses-${state.advisorId}.md`,
        fullMarkdown(),
        'text/markdown;charset=utf-8',
      );
      fileStatus(
        'Full Markdown download started. It includes responses you did not select for sharing.',
      );
    } catch (e) {
      fileStatus('Download failed: ' + e.message);
    }
  }
  function saveFullWord() {
    try {
      const bytes = makeDocx(fullResponseData(), BANK.questions);
      download(
        `advisor-full-responses-${state.advisorId}.docx`,
        bytes,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      fileStatus(
        'Full Word download started. It includes responses you did not select for sharing.',
      );
    } catch (e) {
      fileStatus('Word download failed: ' + e.message);
    }
  }

  async function copyEmail(mobile = false) {
    const address = $(mobile ? 'club-email-mobile' : 'club-email'),
      status = $(mobile ? 'copy-status-mobile' : 'copy-status');
    try {
      await navigator.clipboard.writeText(BANK.sharing.destination);
      status.textContent = 'Address copied.';
      announce('Email address copied.');
    } catch {
      if (!address) return;
      const range = document.createRange();
      range.selectNodeContents(address);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Address selected. Use Copy.';
      announce('Address selected. Use your device copy command.');
    }
  }

  window.addEventListener('beforeunload', (e) => {
    if (
      state.advisorId &&
      (Object.keys(state.answers).length ||
        Object.keys(state.notes).length ||
        Object.values(state.review).some((r) => r.manual))
    ) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  reduce.addEventListener('change', () => render());
  render();
  return {
    discard() {
      state = fresh();
    },
  };
}
