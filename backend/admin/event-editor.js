const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const blank = () => ({
  title: '',
  category: 'Club event',
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
  let rows = [],
    current = null,
    saved = '',
    busy = false,
    generation = 0;
  let images = [],
    types = ['Club event'],
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
        const label = node('label', 'Image ' + (index + 1) + ' description'),
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
  function values() {
    const content = Object.fromEntries(new FormData(form));
    content.registrationOpen = form.elements.registrationOpen.checked;
    content.images = images.map((image) => ({ ...image }));
    return content;
  }
  const dirty = () => current && JSON.stringify(values()) !== saved;
  const canLeave = () =>
    !busy && (!dirty() || confirm('Discard your unsaved event changes?'));
  const state = (row) =>
    !row.published
      ? 'Draft · not visible on the website'
      : row.revision === row.published_revision
        ? 'Published'
        : 'Published · draft changes waiting';
  function list() {
    const search = q('#event-search').value.toLowerCase().trim();
    const matches = rows
      .filter((r) => r.draft.title.toLowerCase().includes(search))
      .sort(
        (a, b) =>
          Number(!b.published || b.revision !== b.published_revision) -
            Number(!a.published || a.revision !== a.published_revision) ||
          (b.draft.date || '').localeCompare(a.draft.date || ''),
      );
    const listItems = [];
    let previousGroup = '';
    for (const row of matches) {
      const isDraft = !row.published || row.revision !== row.published_revision;
      const group = isDraft
        ? 'Drafts & unpublished changes'
        : 'Published events';
      if (group !== previousGroup) {
        listItems.push(node('h3', group, 'event-list-group'));
        previousGroup = group;
      }
      const button = node('button', undefined, 'event-choice');
      button.classList.toggle('has-draft', isDraft);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(row.id === current?.id));
      button.append(
        node('strong', row.draft.title),
        node('span', row.draft.date || 'Date to be decided'),
        node(
          'small',
          isDraft
            ? 'DRAFT · ' +
                (!row.published ? 'Not published' : 'Changes not published')
            : 'Published',
          isDraft ? 'draft-badge' : '',
        ),
      );
      button.onclick = () => {
        if (canLeave()) edit(row);
      };
      listItems.push(button);
    }
    q('#event-list').replaceChildren(...listItems);
    if (!matches.length)
      q('#event-list').append(node('p', 'No matching events.'));
  }
  function edit(row) {
    current = row;
    form.hidden = false;
    q('#event-empty').hidden = true;
    q('#event-preview').hidden = true;
    images = (row.draft.images || []).map((image) => ({ ...image }));
    renderImages();
    typeOptions(row.draft.category);
    for (const [key, value] of Object.entries({ ...blank(), ...row.draft })) {
      const input = form.elements.namedItem(key);
      if (!input || key === 'category') continue;
      if (input.type === 'checkbox') input.checked = value !== false;
      else input.value = Array.isArray(value) ? value.join('\n') : value || '';
    }
    saved = JSON.stringify(values());
    q('#event-heading').textContent =
      row.revision || row.published ? 'Edit event' : 'New event';
    q('#event-state').textContent = state(row);
    q('#event-state').className =
      !row.published || row.revision !== row.published_revision
        ? 'draft-notice'
        : 'published-notice';
    q('#unpublish-event').hidden = !row.published;
    q('#view-event').hidden = !row.published;
    q('#view-event').href =
      'https://dallasai.club/club.html?mode=events&event=' +
      encodeURIComponent(row.id);
    list();
    say();
  }
  function newEvent(content = blank()) {
    edit({
      id: 'event-' + crypto.randomUUID(),
      revision: 0,
      published_revision: 0,
      published: null,
      draft: content,
    });
    form.elements.title.focus();
  }
  async function load() {
    const version = generation;
    say('Loading events…');
    try {
      const data = await api('/api/events?admin=1');
      if (version !== generation) return;
      rows = data.events;
      types = data.types || ['Club event'];
      typeOptions(
        form.elements.category.value || current?.draft.category || 'Club event',
      );
      list();
      say();
    } catch (e) {
      if (version === generation) say(e.message);
    }
  }
  async function preview(event) {
    previewData = {
      ...event,
      images: await Promise.all(
        (event.images || []).map(async (image) => {
          const response = await fetch(
            '/api/events?image=' + encodeURIComponent(image.id),
            { credentials: 'same-origin' },
          );
          if (!response.ok)
            throw Error('Could not load the preview image. Please try again.');
          return { ...image, previewSrc: await dataUrl(await response.blob()) };
        }),
      ),
    };
    frame.src = previewOrigin + '/club.html?mode=events&preview=1';
    dialog.showModal();
  }
  async function save(action) {
    if (busy || !current) return;
    busy = true;
    const version = generation;
    // FormData excludes disabled fields, so collect before locking the form.
    const body = {
      action,
      id: current.id,
      revision: current.revision,
      event: values(),
    };
    const controls = [...form.querySelectorAll('input,textarea,select,button')];
    controls.forEach((input) => {
      input.disabled = true;
    });
    say(action === 'preview' ? 'Preparing preview…' : 'Saving…');
    try {
      const data = await api('/api/events', body);
      if (version !== generation) return;
      if (action === 'preview') {
        await preview(data.event);
        say('Preview only. Your changes have not been saved.');
      } else {
        rows = [data.event, ...rows.filter((r) => r.id !== data.event.id)];
        // Re-enable before computing the saved FormData.
        controls.forEach((input) => {
          input.disabled = false;
        });
        edit(data.event);
        say(
          action === 'publish'
            ? 'Published. The website will show this event on its next refresh.'
            : action === 'unpublish'
              ? 'Unpublished. Your draft and existing RSVPs are kept.'
              : 'Draft saved. The website has not changed.',
        );
      }
    } catch (e) {
      if (version === generation) say(e.message);
    } finally {
      busy = false;
      controls.forEach((input) => {
        input.disabled = false;
      });
    }
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    save(event.submitter?.value || 'draft');
  };
  q('#new-event').onclick = () => {
    if (canLeave()) newEvent();
  };
  q('#duplicate-event').onclick = () => {
    if (!canLeave()) return;
    newEvent({ ...values(), title: values().title + ' (copy)' });
  };
  q('#unpublish-event').onclick = () => {
    if (busy || !current?.published) return;
    if (
      confirm(
        'Remove this event from the public calendar? Existing RSVPs will be kept. Unsaved edits will be discarded.',
      )
    )
      save('unpublish');
  };
  q('#reload-events').onclick = async () => {
    if (!canLeave()) return;
    const id = current?.id;
    await load();
    const updated = rows.find((r) => r.id === id);
    if (updated) edit(updated);
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
    const controls = [...form.querySelectorAll('input,textarea,select,button')];
    controls.forEach((input) => (input.disabled = true));
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
        'Uploaded. Add a description for each image, then save your draft.';
    } catch (error) {
      q('#image-status').textContent = error.message;
    } finally {
      busy = false;
      controls.forEach((input) => (input.disabled = false));
      event.target.value = '';
      if (version === generation) renderImages();
    }
  };
  window.addEventListener('beforeunload', (event) => {
    if (dirty() || busy) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  return {
    show: load,
    canLeave,
    clear() {
      generation++;
      current = null;
      rows = [];
      images = [];
      renderImages();
      if (dialog.open) dialog.close();
      saved = '';
      form.reset();
      form.hidden = true;
      q('#event-empty').hidden = false;
      q('#event-list').replaceChildren();
      q('#event-preview').replaceChildren();
      q('#event-preview').hidden = true;
      say();
    },
  };
}
