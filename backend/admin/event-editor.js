import { coreEventTypes } from '../lib/event-types.mjs';
import { confirmDialog, lock, node } from './ui.js';
import { eventOverview } from './event-overview.js';
import { mountTextFormatting } from './text-formatting.js';
import { surveyEditor } from './survey-editor.js';
import { mountEventActivity } from './event-activity.js';
import { dateTime, day } from './format.js';
import { drafts, isPaused } from './session.js';
const blank = () => ({
  potential: false,
  checkSharing: true,
  requireEduEmail: false,
  surveyIntro: '',
  rsvpDeadline: '',
  surveyQuestions: [],
  title: '',
  category: 'Workshop',
  date: '',
  startTime: '',
  endDate: '',
  endTime: '',
  location: '',
  meetingUrl: '',
  summary: '',
  agenda: [],
  preparation: [],
  targetAudience: '',
  learningOutcomes: [],
  registrationOpen: true,
  images: [],
});

export function mountEventEditor(api) {
  const q = (s) => document.querySelector(s);
  const form = q('#event-form');
  mountTextFormatting(form);
  const storyButtons = [...form.querySelectorAll('[data-story-section]')];
  function storySection(key, visible) {
    form.querySelector('[data-story-field="' + key + '"]').hidden = !visible;
    form.elements.namedItem(key).closest('.formatting-editor').hidden =
      !visible;
    storyButtons
      .find((button) => button.dataset.storySection === key)
      .setAttribute('aria-pressed', String(visible));
  }
  for (const button of storyButtons)
    button.onclick = async () => {
      if (busy || !editing) return;
      const key = button.dataset.storySection,
        input = form.elements.namedItem(key),
        visible = button.getAttribute('aria-pressed') === 'true';
      if (
        visible &&
        input.value.trim() &&
        !(await confirmDialog({
          title: 'Remove ' + button.textContent.trim() + '?',
          body: 'This clears the text in this section from your unsaved event. Your saved event changes only when you save or publish.',
          confirmLabel: 'Remove section and text',
        }))
      )
        return;
      if (visible) input.value = '';
      storySection(key, !visible);
      if (!visible) input.focus();
    };
  const survey = surveyEditor(
    q('#survey-questions'),
    q('#add-survey-question'),
  );
  const activity = mountEventActivity(api);
  const overview = node('article', undefined, 'event-overview');
  overview.id = 'event-overview';
  overview.hidden = true;
  form.before(overview);
  const activityPanel = q('#event-activity'),
    updatedNote = q('#event-updated');
  const cancel = node('button', 'Cancel editing', 'secondary');
  cancel.type = 'button';
  cancel.id = 'cancel-event-edit';
  form.querySelector('.editor-heading').append(cancel);
  let editing = false;
  cancel.onclick = () => {
    if (!canLeave()) return;
    discardEdits();
  };
  function discardEdits() {
    if (!current || !editing) return;
    if (!current.revision && !current.published) {
      // A discarded new event leaves nothing behind in the hidden form.
      current = null;
      editing = false;
      form.reset();
      survey.set();
      images = [];
      renderImages();
      form.hidden = true;
      overview.hidden = true;
      activity.clear();
      saved = '';
      q('#event-empty').hidden = false;
      list();
      say();
      return;
    }
    edit(current, false);
  }
  let rows = [],
    current = null,
    saved = '',
    busy = false,
    generation = 0,
    loadGeneration = 0,
    showArchived = false;
  let images = [],
    types = [...coreEventTypes],
    previewData = null;
  const frame = q('#site-preview-frame'),
    dialog = q('#site-preview-dialog');
  const previewOrigin = new URL(frame.dataset.siteOrigin).origin;
  window.addEventListener('message', (event) => {
    if (
      event.origin === previewOrigin &&
      event.source === frame.contentWindow &&
      event.data?.type === 'club:preview-ready' &&
      previewData &&
      dialog.open
    )
      frame.contentWindow.postMessage(
        { type: 'club:event-preview', event: previewData },
        previewOrigin,
      );
  });
  q('#close-site-preview').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    if (isPaused()) return;
    frame.removeAttribute('src');
    previewData = null;
  });
  q('#preview-desktop').onclick = () => {
    frame.classList.remove('mobile-preview');
    frame.src = frame.src;
  };
  q('#preview-mobile').onclick = () => {
    frame.classList.add('mobile-preview');
    frame.src = frame.src;
  };
  const dataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  function typeOptions(selected) {
    form.elements.category.replaceChildren(
      ...types.map((type) => new Option(type, type)),
    );
    form.elements.category.value =
      types.find(
        (type) => type.toLowerCase() === (selected || '').toLowerCase(),
      ) || types[0];
  }
  function renderImages() {
    q('#event-images').replaceChildren(
      ...images.map((image, index) => {
        const box = node('div', undefined, 'event-image-item'),
          img = node('img');
        img.src = '/api/events?image=' + encodeURIComponent(image.id);
        img.alt = image.alt || 'Uploaded event image';
        const label = node(
            'label',
            'Image ' + (index + 1) + ' description (optional)',
          ),
          input = node('input');
        input.value = image.alt || '';
        input.maxLength = 300;
        input.placeholder = 'Describe what the image shows';
        input.oninput = () => {
          image.alt = input.value;
          img.alt = input.value;
        };
        label.append(input);
        const remove = node('button', 'Remove image', 'secondary');
        remove.type = 'button';
        remove.onclick = () => {
          images.splice(index, 1);
          renderImages();
        };
        box.append(img, label, remove);
        return box;
      }),
    );
  }
  const say = (message = '') => {
    q('#event-status').textContent = message;
  };
  function showError(message) {
    say(message);
    const status = q('#event-status');
    status.tabIndex = -1;
    status.scrollIntoView({ block: 'center' });
    status.focus({ preventScroll: true });
  }
  function values() {
    const content = Object.fromEntries(new FormData(form));
    content.requireEduEmail = form.elements.requireEduEmail.checked;
    content.potential = form.elements.potential.checked;
    content.checkSharing = form.elements.checkSharing.checked;
    content.surveyQuestions = survey.value();
    content.registrationOpen = form.elements.registrationOpen.checked;
    content.images = images.map((image) => ({ ...image }));
    return content;
  }
  const dirty = () => editing && current && JSON.stringify(values()) !== saved;
  const canLeave = () =>
    !busy && (!dirty() || confirm('Discard your unsaved event changes?'));
  const state = (row) =>
    row.archived_at
      ? 'Archived · hidden from the website. You can edit and save here, or restore as a draft.'
      : !row.published
        ? 'Draft · not visible on the website'
        : row.revision === row.published_revision
          ? 'Published'
          : 'Published · draft changes waiting';
  function list() {
    q('#active-events').setAttribute('aria-pressed', String(!showArchived));
    q('#archived-events').setAttribute('aria-pressed', String(showArchived));
    q('#active-event-count').textContent = rows.filter(
      (r) => !r.archived_at,
    ).length;
    q('#archived-event-count').textContent = rows.filter(
      (r) => r.archived_at,
    ).length;
    const search = q('#event-search').value.toLowerCase().trim();
    const matches = rows
      .filter((r) => Boolean(r.archived_at) === showArchived)
      .filter((r) => r.draft.title.toLowerCase().includes(search))
      .sort(
        (a, b) =>
          Number(Boolean(b.draft.potential)) -
            Number(Boolean(a.draft.potential)) ||
          Number(!b.published || b.revision !== b.published_revision) -
            Number(!a.published || a.revision !== a.published_revision) ||
          (b.draft.date || '').localeCompare(a.draft.date || ''),
      );
    const listItems = [];
    let previousGroup = '';
    for (const row of matches) {
      const isDraft =
        !row.archived_at &&
        (!row.published || row.revision !== row.published_revision);
      const group = row.archived_at
        ? 'Archived events'
        : row.draft.potential
          ? 'Potential events · gather interest'
          : isDraft
            ? 'Drafts & unpublished changes'
            : 'Published events';
      if (group !== previousGroup) {
        listItems.push(node('h3', group, 'event-list-group'));
        previousGroup = group;
      }
      const button = node('button', undefined, 'event-choice');
      button.classList.toggle('has-draft', isDraft);
      button.classList.toggle('potential-choice', Boolean(row.draft.potential));
      button.type = 'button';
      button.setAttribute('aria-pressed', String(row.id === current?.id));
      button.append(
        node('strong', row.draft.title),
        node('span', row.draft.date ? day(row.draft.date) : 'Date TBD'),
        node(
          'small',
          row.archived_at
            ? 'Archived · kept for later'
            : isDraft
              ? 'DRAFT · ' +
                (!row.published ? 'Not published' : 'Changes not published')
              : 'Published',
          row.archived_at ? 'archived-badge' : isDraft ? 'draft-badge' : '',
        ),
      );
      button.onclick = () => {
        if (canLeave()) edit(row);
      };
      if (dateTime(row.updated_at))
        button.append(node('span', 'Updated ' + dateTime(row.updated_at)));
      listItems.push(button);
    }
    q('#event-list').replaceChildren(...listItems);
    if (!matches.length)
      q('#event-list').append(
        node(
          'p',
          search
            ? 'No matching events.'
            : showArchived
              ? 'No archived events yet.'
              : 'No active events yet.',
          'hint',
        ),
      );
  }
  function edit(row, editable = false) {
    current = row;
    editing = editable;
    showArchived = Boolean(row.archived_at);
    form.hidden = !editing;
    overview.hidden = editing;
    if (editing) {
      q('.editor-heading').append(updatedNote);
      q('.editor-heading').after(activityPanel);
    } else {
      activityPanel.remove();
      updatedNote.remove();
      overview.replaceChildren(
        eventOverview(row, state(row), () => {
          if (!busy) {
            edit(current, true);
            q('#event-heading').focus();
          }
        }),
      );
      const legacyShortLink = /^https:\/\/[^/]+\/dai-[a-f0-9]{24}$/.test(
        row.published?.shortLink || '',
      );
      if (row.published && !row.archived_at) {
        const label = node('label', 'Custom short-link name (optional)');
        const alias = node('input');
        alias.id = 'event-short-alias';
        alias.type = 'text';
        alias.maxLength = 30;
        alias.value =
          row.published.shortLink && !legacyShortLink
            ? new URL(row.published.shortLink).pathname.slice(1)
            : '';
        alias.placeholder = 'Leave blank to generate an event name';
        label.htmlFor = alias.id;
        const createLink = node(
          'button',
          legacyShortLink
            ? 'Use readable short link'
            : row.published.shortLink
              ? 'Save short link'
              : 'Create short link',
        );
        createLink.type = 'button';
        createLink.onclick = () =>
          retrySharing(row, legacyShortLink, alias.value);
        overview.append(
          label,
          alias,
          node(
            'p',
            'Edit the last part of the address. Leave blank to use the generated name. Availability is checked when you save.',
            'hint',
          ),
          createLink,
        );
      }
      overview.append(updatedNote, activityPanel);
      const surveys = node('section', undefined, 'event-overview-section');
      const create = node('a', 'Create event feedback survey', 'button-link');
      create.href = '#/surveys/new?event=' + encodeURIComponent(row.id);
      surveys.append(
        node('h4', 'Event feedback surveys'),
        node(
          'p',
          'Separate from registration. Each survey has its own answering link and QR code.',
          'hint',
        ),
        create,
      );
      overview.append(surveys);
      api('/api/custom-surveys?action=catalog')
        .then(({ surveys: catalog }) => {
          if (current !== row || editing) return;
          for (const survey of catalog.filter(
            (item) => item.definition?.eventId === row.id,
          )) {
            const link = node(
              'a',
              survey.title +
                ' · ' +
                (survey.expired ? 'expired' : survey.status),
            );
            link.href = '#/surveys/custom/' + survey.id;
            const p = node('p');
            p.append(link);
            surveys.append(p);
          }
        })
        .catch((error) => {
          if (current === row && !editing)
            surveys.append(node('p', error.message));
        });
    }
    q('#event-empty').hidden = true;
    images = (row.draft.images || []).map((image) => ({ ...image }));
    renderImages();
    survey.set(row.draft.surveyQuestions);
    typeOptions(row.draft.category);
    for (const [key, value] of Object.entries({
      ...blank(),
      ...row.draft,
    })) {
      const input = form.elements.namedItem(key);
      if (!input || key === 'category') continue;
      if (input.type === 'checkbox') input.checked = value !== false;
      else input.value = Array.isArray(value) ? value.join('\n') : value || '';
    }
    if (row.draft.requireEduEmail === undefined)
      form.elements.requireEduEmail.checked =
        row.draft.category?.toLowerCase() === 'social';
    for (const button of storyButtons) {
      const key = button.dataset.storySection;
      storySection(
        key,
        key === 'summary' || Boolean(form.elements.namedItem(key).value.trim()),
      );
    }
    saved = JSON.stringify(values());
    q('#event-heading').textContent = row.archived_at
      ? 'Edit archived event'
      : row.revision || row.published
        ? 'Edit event'
        : 'New event';
    q('#event-state').textContent = state(row);
    activity.show(row);
    q('#event-state').className = row.archived_at
      ? 'archived-notice'
      : !row.published || row.revision !== row.published_revision
        ? 'draft-notice'
        : 'published-notice';
    q('#unpublish-event').hidden = !row.published;
    q('#archive-event').hidden =
      Boolean(row.archived_at) || (!row.revision && !row.published);
    q('#restore-event').hidden = !row.archived_at;
    form.querySelector('[value="publish"]').hidden = Boolean(row.archived_at);
    q('#view-event').hidden = !row.published;
    q('#view-event').href =
      row.published?.shortLink ||
      'https://dallasai.club/club.html?mode=events&event=' +
        encodeURIComponent(row.id);
    list();
    say();
  }
  function newEvent(content = blank()) {
    edit(
      {
        id: 'event-' + crypto.randomUUID(),
        revision: 0,
        published_revision: 0,
        published: null,
        draft: content,
      },
      true,
    );
    form.elements.title.focus();
  }
  async function load() {
    const version = generation,
      request = ++loadGeneration;
    say('Loading events…');
    try {
      const data = await api('/api/events?admin=1');
      if (version !== generation || request !== loadGeneration) return;
      rows = data.events;
      types = data.types;
      typeOptions(
        form.elements.category.value || current?.draft.category || 'Workshop',
      );
      list();
      say();
    } catch (e) {
      if (version === generation && request === loadGeneration) say(e.message);
    }
  }
  async function preview(event) {
    const version = generation;
    const data = {
      ...event,
      images: await Promise.all(
        (event.images || []).map(async (image) => {
          const response = await fetch(
            '/api/events?image=' + encodeURIComponent(image.id),
            { credentials: 'same-origin' },
          );
          if (!response.ok)
            throw Error('Could not load the preview image. Please try again.');
          return {
            ...image,
            previewSrc: await dataUrl(await response.blob()),
          };
        }),
      ),
    };
    if (version !== generation) return;
    previewData = data;
    frame.src = previewOrigin + '/club.html?mode=events&preview=1';
    dialog.showModal();
  }
  function openShareChecks(enabled) {
    if (!enabled) return [];
    // Reserve tabs during the click, before the asynchronous save. Browsers
    // otherwise block them after the response loses its user activation.
    return [0, 1].map(() => {
      const tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
      return tab;
    });
  }
  function finishShareChecks(tabs, row) {
    if (!tabs.length) return;
    if (!row.published?.shortLink) {
      tabs.forEach((tab) => tab?.close());
      return;
    }
    const links = [
      row.published.shortLink,
      '/api/events?qr=' + encodeURIComponent(row.id),
    ];
    let opened = 0;
    tabs.forEach((tab, index) => {
      if (!tab || tab.closed) return;
      tab.location.replace(links[index]);
      opened++;
    });
    overview.append(
      node(
        'p',
        opened === 2
          ? 'Short link and QR opened in separate tabs for checking.'
          : 'Your browser blocked a check tab. Use View published event and Open event QR to open the checks.',
        'hint',
      ),
    );
  }
  async function retrySharing(row, replaceLegacy = false, alias) {
    if (busy || current !== row) return;
    busy = true;
    const version = generation;
    const tabs = openShareChecks(row.draft.checkSharing !== false);
    say('Creating short link…');
    try {
      const data = await api('/api/events', {
        action: 'share-link',
        id: row.id,
        ...(replaceLegacy ? { replaceLegacy: true } : {}),
        ...(alias !== undefined ? { alias } : {}),
      });
      if (version !== generation) {
        tabs.forEach((tab) => tab?.close());
        return;
      }
      rows = [data.event, ...rows.filter((r) => r.id !== data.event.id)];
      edit(data.event);
      finishShareChecks(tabs, data.event);
      say('Short link and QR are ready.');
    } catch (error) {
      tabs.forEach((tab) => tab?.close());
      if (version === generation) say(error.message);
    } finally {
      busy = false;
    }
  }
  async function save(action) {
    if (busy || !current || !editing) return;
    if (['draft', 'preview', 'publish'].includes(action) && !survey.validate())
      return;
    busy = true;
    loadGeneration++;
    const version = generation;
    // FormData excludes disabled fields, so collect before locking the form.
    const body = {
      action,
      id: current.id,
      revision: current.revision,
      event: values(),
    };
    const tabs = openShareChecks(
      action === 'publish' &&
        !current.published?.shortLink &&
        body.event.checkSharing,
    );
    const unlock = lock(form);
    say(action === 'preview' ? 'Preparing preview…' : 'Saving…');
    try {
      const data = await api('/api/events', body);
      if (version !== generation) {
        tabs.forEach((tab) => tab?.close());
        return;
      }
      if (action === 'preview') {
        await preview(data.event);
        say('Preview only. Your changes have not been saved.');
      } else {
        rows = [data.event, ...rows.filter((r) => r.id !== data.event.id)];
        // Re-enable before computing the saved FormData.
        unlock();
        edit(data.event);
        say(
          action === 'publish'
            ? 'Published successfully — live on the website. Editing is complete.'
            : action === 'archive'
              ? 'Archived. Content, images, and RSVPs are kept. You can edit this event here or restore it as a draft.'
              : action === 'restore'
                ? 'Restored as a draft. Review your details, then publish when ready.'
                : action === 'unpublish'
                  ? 'Unpublished. Your draft and existing RSVPs are kept.'
                  : data.event.archived_at
                    ? 'Changes saved. This event is still archived and private.'
                    : 'Draft saved successfully. These saved changes are private until you publish. Editing is complete.',
        );
        const confirmation = node('div', undefined, 'event-save-confirmation');
        confirmation.setAttribute('role', 'status');
        confirmation.tabIndex = -1;
        confirmation.append(
          node('strong', q('#event-status').textContent),
          node(
            'p',
            data.event.draft.title +
              ' · Saved ' +
              dateTime(data.event.updated_at),
          ),
        );
        overview.prepend(confirmation);
        confirmation.scrollIntoView({ block: 'start' });
        confirmation.focus({ preventScroll: true });
        if (data.sharingError)
          overview.append(node('p', data.sharingError, 'hint'));
        finishShareChecks(tabs, data.event);
      }
    } catch (e) {
      tabs.forEach((tab) => tab?.close());
      if (version === generation) showError(e.message);
    } finally {
      busy = false;
      unlock();
    }
  }
  form.elements.category.onchange = () => {
    form.elements.requireEduEmail.checked =
      form.elements.category.value.toLowerCase() === 'social';
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    save(event.submitter?.value || 'draft');
  };
  // Enter in a one-line field, checkbox or radio would submit the form, which
  // saves the draft. Only the buttons save; Enter in the new type name adds
  // the type.
  form.addEventListener('keydown', (event) => {
    if (
      event.key !== 'Enter' ||
      event.isComposing ||
      !event.target.matches(
        'input:not([type=file],[type=button],[type=submit],[type=reset],[type=image],[type=color],[type=range])',
      )
    )
      return;
    event.preventDefault();
    if (event.target.id === 'new-type-name') q('#add-type').click();
  });
  q('#new-event').onclick = () => {
    if (canLeave()) newEvent();
  };
  q('#duplicate-event').onclick = () => {
    if (!canLeave()) return;
    newEvent({
      ...values(),
      title: values().title + ' (copy)',
      checkSharing: true,
    });
  };
  // Both change the public website, so they ask in the shared dialog.
  q('#unpublish-event').onclick = async () => {
    if (busy || !current?.published) return;
    if (
      await confirmDialog({
        title: 'Unpublish “' + current.draft.title + '”?',
        body: 'It leaves the public calendar. Existing RSVPs are kept. Unsaved edits will be discarded.',
        confirmLabel: 'Unpublish event',
      })
    )
      save('unpublish');
  };
  q('#archive-event').onclick = async () => {
    if (busy || !current || current.archived_at) return;
    if (dirty())
      return say(
        'Save your draft before archiving so your latest edits are kept.',
      );
    if (
      await confirmDialog({
        title: 'Archive “' + current.draft.title + '”?',
        body: 'It will be hidden from the website. Its content, images and RSVPs are kept, and you can edit or restore it later.',
        confirmLabel: 'Archive event',
      })
    )
      save('archive');
  };
  q('#restore-event').onclick = () => {
    if (busy || !current?.archived_at) return;
    if (dirty()) return say('Save your changes before restoring this event.');
    save('restore');
  };
  function changeCollection(archived) {
    if (showArchived === archived || !canLeave()) return;
    showArchived = archived;
    current = null;
    editing = false;
    overview.hidden = true;
    activity.clear();
    saved = '';
    form.hidden = true;
    q('#event-empty').hidden = false;
    q('#event-search').value = '';
    list();
    say();
  }
  q('#active-events').onclick = () => changeCollection(false);
  q('#archived-events').onclick = () => changeCollection(true);
  q('#reload-events').onclick = async () => {
    if (!canLeave()) return;
    const id = current?.id;
    await load();
    const updated = rows.find((r) => r.id === id);
    if (updated) edit(updated, editing);
  };
  q('#event-search').oninput = list;
  q('#add-type').onclick = async () => {
    if (busy) return;
    const button = q('#add-type');
    button.disabled = true;
    try {
      const data = await api('/api/events', {
        action: 'add-type',
        name: q('#new-type-name').value,
      });
      types = data.types;
      typeOptions(data.selected);
      form.elements.category.onchange();
      q('#new-type-name').value = '';
      q('#type-status').textContent = 'Type is available to all admins.';
    } catch (error) {
      q('#type-status').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  q('#event-image-upload').onchange = async (event) => {
    if (busy) return;
    const files = [...event.target.files];
    if (
      files.length + images.length > 3 ||
      files.some(
        (file) =>
          file.size > 2097152 ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type),
      )
    ) {
      q('#image-status').textContent =
        'Choose up to three JPG, PNG, or WebP images under 2 MB each.';
      event.target.value = '';
      return;
    }
    busy = true;
    const version = generation;
    const unlock = lock(form);
    q('#image-status').textContent = 'Uploading images…';
    try {
      for (const file of files) {
        const result = await api('/api/events?upload=1', {
          content: (await dataUrl(file)).split(',')[1],
        });
        if (version !== generation) return;
        images.push({ ...result.image, alt: '' });
      }
      q('#image-status').textContent =
        'Uploaded. Save your draft to keep these images. Descriptions are optional.';
    } catch (error) {
      q('#image-status').textContent = error.message;
    } finally {
      busy = false;
      unlock();
      event.target.value = '';
      if (version === generation) renderImages();
    }
  };
  // The form holds the unsaved event; report it to the drafts store.
  drafts.track(() =>
    current && (dirty() || busy)
      ? [
          {
            key:
              'event:' +
              (current.revision || current.published ? current.id : 'new'),
            label:
              'Event “' +
              (form.elements.title.value.trim() || 'Untitled event') +
              '”',
          },
        ]
      : [],
  );
  return {
    // Refreshes the list; with an id (from Home), opens that event too.
    async show(id = '') {
      await load();
      const row = id && rows.find((r) => r.id === id);
      if (row && canLeave()) edit(row);
    },
    canLeave,
    // Ten minutes paused: drop the event list, keep the editor.
    reset() {
      loadGeneration++;
      rows = [];
      q('#event-list').replaceChildren();
    },
    leave() {
      if (!canLeave()) return false;
      discardEdits();
      return true;
    },
    clear() {
      generation++;
      current = null;
      editing = false;
      overview.hidden = true;
      // Preserve activity nodes before clearing private content.
      q('.editor-heading').append(updatedNote);
      q('.editor-heading').after(activityPanel);
      overview.replaceChildren();
      activity.clear();
      showArchived = false;
      rows = [];
      images = [];
      renderImages();
      // A preview closed for re-authentication kept its content; drop it too.
      if (dialog.open) dialog.close();
      frame.removeAttribute('src');
      previewData = null;
      saved = '';
      form.reset();
      survey.set();
      form.hidden = true;
      q('#event-empty').hidden = false;
      q('#event-list').replaceChildren();
      say();
    },
  };
}
