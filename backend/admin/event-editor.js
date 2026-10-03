import { eventOverview } from "./event-overview.js";
import { mountTextFormatting } from "./text-formatting.js";
import { surveyEditor } from "./survey-editor.js";
import { mountEventActivity, activityTime } from "./event-activity.js";
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const blank = () => ({
  potential: false,
  requireEduEmail: false,
  surveyIntro: "",
  surveyQuestions: [],
  title: "",
  category: "Workshop",
  date: "",
  startTime: "",
  endDate: "",
  endTime: "",
  location: "",
  meetingUrl: "",
  summary: "",
  agenda: [],
  preparation: [],
  targetAudience: "",
  learningOutcomes: [],
  registrationOpen: true,
  images: [],
});

export function mountEventEditor(api) {
  const q = (s) => document.querySelector(s);
  const form = q("#event-form");
  mountTextFormatting(form);
  const survey = surveyEditor(
    q("#survey-questions"),
    q("#add-survey-question"),
  );
  const activity = mountEventActivity(api);
  const overview = node("article", undefined, "event-overview");
  overview.id = "event-overview";
  overview.hidden = true;
  form.before(overview);
  const activityPanel = q("#event-activity"),
    updatedNote = q("#event-updated");
  const cancel = node("button", "Cancel editing", "secondary");
  cancel.type = "button";
  cancel.id = "cancel-event-edit";
  form.querySelector(".editor-heading").append(cancel);
  let editing = false;
  cancel.onclick = () => {
    if (!canLeave()) return;
    discardEdits();
  };
  function discardEdits() {
    if (!current || !editing) return;
    if (!current.revision && !current.published) {
      current = null;
      editing = false;
      form.hidden = true;
      overview.hidden = true;
      activity.clear();
      saved = "";
      q("#event-empty").hidden = false;
      list();
      say();
      return;
    }
    edit(current, false);
  }
  let rows = [],
    current = null,
    saved = "",
    busy = false,
    generation = 0,
    loadGeneration = 0,
    showArchived = false;
  let images = [],
    types = ["Workshop", "Meeting", "Talk", "Hackathon", "Social"],
    previewData = null;
  const frame = q("#site-preview-frame"),
    dialog = q("#site-preview-dialog");
  const previewOrigin = new URL(frame.dataset.siteOrigin).origin;
  window.addEventListener("message", (event) => {
    if (
      event.origin === previewOrigin &&
      event.source === frame.contentWindow &&
      event.data?.type === "club:preview-ready" &&
      previewData &&
      dialog.open
    )
      frame.contentWindow.postMessage(
        { type: "club:event-preview", event: previewData },
        previewOrigin,
      );
  });
  q("#close-site-preview").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    frame.removeAttribute("src");
    previewData = null;
  });
  q("#preview-desktop").onclick = () => {
    frame.classList.remove("mobile-preview");
    frame.src = frame.src;
  };
  q("#preview-mobile").onclick = () => {
    frame.classList.add("mobile-preview");
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
        (type) => type.toLowerCase() === (selected || "").toLowerCase(),
      ) || types[0];
  }
  function renderImages() {
    q("#event-images").replaceChildren(
      ...images.map((image, index) => {
        const box = node("div", undefined, "event-image-item"),
          img = node("img");
        img.src = "/api/events?image=" + encodeURIComponent(image.id);
        img.alt = image.alt || "Uploaded event image";
        const label = node(
            "label",
            "Image " + (index + 1) + " description (optional)",
          ),
          input = node("input");
        input.value = image.alt || "";
        input.maxLength = 300;
        input.placeholder = "Describe what the image shows";
        input.oninput = () => {
          image.alt = input.value;
          img.alt = input.value;
        };
        label.append(input);
        const remove = node("button", "Remove image", "secondary");
        remove.type = "button";
        remove.onclick = () => {
          images.splice(index, 1);
          renderImages();
        };
        box.append(img, label, remove);
        return box;
      }),
    );
  }
  const say = (message = "") => {
    q("#event-status").textContent = message;
  };
  function values() {
    const content = Object.fromEntries(new FormData(form));
    content.requireEduEmail = form.elements.requireEduEmail.checked;
    content.potential = form.elements.potential.checked;
    content.surveyQuestions = survey.value();
    content.registrationOpen = form.elements.registrationOpen.checked;
    content.images = images.map((image) => ({ ...image }));
    return content;
  }
  const dirty = () => editing && current && JSON.stringify(values()) !== saved;
  const canLeave = () =>
    !busy && (!dirty() || confirm("Discard your unsaved event changes?"));
  const state = (row) =>
    row.archived_at
      ? "Archived · hidden from the website. You can edit and save here, or restore as a draft."
      : !row.published
        ? "Draft · not visible on the website"
        : row.revision === row.published_revision
          ? "Published"
          : "Published · draft changes waiting";
  function list() {
    q("#active-events").setAttribute("aria-pressed", String(!showArchived));
    q("#archived-events").setAttribute("aria-pressed", String(showArchived));
    q("#active-event-count").textContent = rows.filter(
      (r) => !r.archived_at,
    ).length;
    q("#archived-event-count").textContent = rows.filter(
      (r) => r.archived_at,
    ).length;
    const search = q("#event-search").value.toLowerCase().trim();
    const matches = rows
      .filter((r) => Boolean(r.archived_at) === showArchived)
      .filter((r) => r.draft.title.toLowerCase().includes(search))
      .sort(
        (a, b) =>
          Number(Boolean(b.draft.potential)) -
            Number(Boolean(a.draft.potential)) ||
          Number(!b.published || b.revision !== b.published_revision) -
            Number(!a.published || a.revision !== a.published_revision) ||
          (b.draft.date || "").localeCompare(a.draft.date || ""),
      );
    const listItems = [];
    let previousGroup = "";
    for (const row of matches) {
      const isDraft =
        !row.archived_at &&
        (!row.published || row.revision !== row.published_revision);
      const group = row.archived_at
        ? "Archived events"
        : row.draft.potential
          ? "Potential events · gather interest"
          : isDraft
            ? "Drafts & unpublished changes"
            : "Published events";
      if (group !== previousGroup) {
        listItems.push(node("h3", group, "event-list-group"));
        previousGroup = group;
      }
      const button = node("button", undefined, "event-choice");
      button.classList.toggle("has-draft", isDraft);
      button.classList.toggle("potential-choice", Boolean(row.draft.potential));
      button.type = "button";
      button.setAttribute("aria-pressed", String(row.id === current?.id));
      button.append(
        node("strong", row.draft.title),
        node("span", row.draft.date || "Date to be decided"),
        node(
          "small",
          row.archived_at
            ? "Archived · kept for later"
            : isDraft
              ? "DRAFT · " +
                (!row.published ? "Not published" : "Changes not published")
              : "Published",
          row.archived_at ? "archived-badge" : isDraft ? "draft-badge" : "",
        ),
      );
      button.onclick = () => {
        if (canLeave()) edit(row);
      };
      if (activityTime(row.updated_at))
        button.append(node("span", "Updated " + activityTime(row.updated_at)));
      listItems.push(button);
    }
    q("#event-list").replaceChildren(...listItems);
    if (!matches.length)
      q("#event-list").append(
        node(
          "p",
          search
            ? "No matching events."
            : showArchived
              ? "No archived events yet."
              : "No active events yet.",
          "hint",
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
      q(".editor-heading").append(updatedNote);
      q(".editor-heading").after(activityPanel);
    } else {
      activityPanel.remove();
      updatedNote.remove();
      overview.replaceChildren(
        eventOverview(row, state(row), () => {
          if (!busy) {
            edit(current, true);
            q("#event-heading").focus();
          }
        }),
      );
      overview.append(updatedNote, activityPanel);
    }
    q("#event-empty").hidden = true;
    q("#event-preview").hidden = true;
    images = (row.draft.images || []).map((image) => ({ ...image }));
    renderImages();
    survey.set(row.draft.surveyQuestions);
    typeOptions(row.draft.category);
    for (const [key, value] of Object.entries({
      ...blank(),
      ...row.draft,
    })) {
      const input = form.elements.namedItem(key);
      if (!input || key === "category") continue;
      if (input.type === "checkbox") input.checked = value !== false;
      else input.value = Array.isArray(value) ? value.join("\n") : value || "";
    }
    if (row.draft.requireEduEmail === undefined)
      form.elements.requireEduEmail.checked =
        row.draft.category?.toLowerCase() === "social";
    saved = JSON.stringify(values());
    q("#event-heading").textContent = row.archived_at
      ? "Edit archived event"
      : row.revision || row.published
        ? "Edit event"
        : "New event";
    q("#event-state").textContent = state(row);
    activity.show(row);
    q("#event-state").className = row.archived_at
      ? "archived-notice"
      : !row.published || row.revision !== row.published_revision
        ? "draft-notice"
        : "published-notice";
    q("#unpublish-event").hidden = !row.published;
    q("#archive-event").hidden =
      Boolean(row.archived_at) || (!row.revision && !row.published);
    q("#restore-event").hidden = !row.archived_at;
    form.querySelector('[value="publish"]').hidden = Boolean(row.archived_at);
    q("#view-event").hidden = !row.published;
    q("#view-event").href =
      "https://dallasai.club/club.html?mode=events&event=" +
      encodeURIComponent(row.id);
    list();
    say();
  }
  function newEvent(content = blank()) {
    edit(
      {
        id: "event-" + crypto.randomUUID(),
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
    say("Loading events…");
    try {
      const data = await api("/api/events?admin=1");
      if (version !== generation || request !== loadGeneration) return;
      rows = data.events;
      types = data.types || [
        "Workshop",
        "Meeting",
        "Talk",
        "Hackathon",
        "Social",
      ];
      typeOptions(
        form.elements.category.value || current?.draft.category || "Workshop",
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
            "/api/events?image=" + encodeURIComponent(image.id),
            { credentials: "same-origin" },
          );
          if (!response.ok)
            throw Error("Could not load the preview image. Please try again.");
          return {
            ...image,
            previewSrc: await dataUrl(await response.blob()),
          };
        }),
      ),
    };
    if (version !== generation) return;
    previewData = data;
    frame.src = previewOrigin + "/club.html?mode=events&preview=1";
    dialog.showModal();
  }
  async function save(action) {
    if (busy || !current || !editing) return;
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
    const controls = [...form.querySelectorAll("input,textarea,select,button")];
    controls.forEach((input) => {
      input.disabled = true;
    });
    say(action === "preview" ? "Preparing preview…" : "Saving…");
    try {
      const data = await api("/api/events", body);
      if (version !== generation) return;
      if (action === "preview") {
        await preview(data.event);
        say("Preview only. Your changes have not been saved.");
      } else {
        rows = [data.event, ...rows.filter((r) => r.id !== data.event.id)];
        // Re-enable before computing the saved FormData.
        controls.forEach((input) => {
          input.disabled = false;
        });
        edit(data.event);
        say(
          action === "publish"
            ? "Published successfully — live on the website. Editing is complete."
            : action === "archive"
              ? "Archived. Content, images, and RSVPs are kept. You can edit this event here or restore it as a draft."
              : action === "restore"
                ? "Restored as a draft. Review your details, then publish when ready."
                : action === "unpublish"
                  ? "Unpublished. Your draft and existing RSVPs are kept."
                  : data.event.archived_at
                    ? "Changes saved. This event is still archived and private."
                    : "Draft saved successfully. These saved changes are private until you publish. Editing is complete.",
        );
        const confirmation = node("div", undefined, "event-save-confirmation");
        confirmation.setAttribute("role", "status");
        confirmation.tabIndex = -1;
        confirmation.append(
          node("strong", q("#event-status").textContent),
          node(
            "p",
            data.event.draft.title +
              " · Saved " +
              activityTime(data.event.updated_at),
          ),
        );
        overview.prepend(confirmation);
        confirmation.scrollIntoView({ block: "start" });
        confirmation.focus({ preventScroll: true });
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
  form.elements.category.onchange = () => {
    form.elements.requireEduEmail.checked =
      form.elements.category.value.toLowerCase() === "social";
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    save(event.submitter?.value || "draft");
  };
  q("#new-event").onclick = () => {
    if (canLeave()) newEvent();
  };
  q("#duplicate-event").onclick = () => {
    if (!canLeave()) return;
    newEvent({ ...values(), title: values().title + " (copy)" });
  };
  q("#unpublish-event").onclick = () => {
    if (busy || !current?.published) return;
    if (
      confirm(
        "Remove this event from the public calendar? Existing RSVPs will be kept. Unsaved edits will be discarded.",
      )
    )
      save("unpublish");
  };
  q("#archive-event").onclick = () => {
    if (busy || !current || current.archived_at) return;
    if (dirty())
      return say(
        "Save your draft before archiving so your latest edits are kept.",
      );
    if (
      confirm(
        "Archive this event? It will be hidden from the website. Its content, images, and RSVPs will be kept, and you can edit or restore it later.",
      )
    )
      save("archive");
  };
  q("#restore-event").onclick = () => {
    if (busy || !current?.archived_at) return;
    if (dirty()) return say("Save your changes before restoring this event.");
    save("restore");
  };
  function changeCollection(archived) {
    if (showArchived === archived || !canLeave()) return;
    showArchived = archived;
    current = null;
    editing = false;
    overview.hidden = true;
    activity.clear();
    saved = "";
    form.hidden = true;
    q("#event-empty").hidden = false;
    q("#event-search").value = "";
    list();
    say();
  }
  q("#active-events").onclick = () => changeCollection(false);
  q("#archived-events").onclick = () => changeCollection(true);
  q("#reload-events").onclick = async () => {
    if (!canLeave()) return;
    const id = current?.id;
    await load();
    const updated = rows.find((r) => r.id === id);
    if (updated) edit(updated, editing);
  };
  q("#event-search").oninput = list;
  q("#add-type").onclick = async () => {
    if (busy) return;
    const button = q("#add-type");
    button.disabled = true;
    try {
      const data = await api("/api/events", {
        action: "add-type",
        name: q("#new-type-name").value,
      });
      types = data.types;
      typeOptions(data.selected);
      form.elements.category.onchange();
      q("#new-type-name").value = "";
      q("#type-status").textContent = "Type is available to all admins.";
    } catch (error) {
      q("#type-status").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  q("#event-image-upload").onchange = async (event) => {
    if (busy) return;
    const files = [...event.target.files];
    if (
      files.length + images.length > 3 ||
      files.some(
        (file) =>
          file.size > 2097152 ||
          !["image/jpeg", "image/png", "image/webp"].includes(file.type),
      )
    ) {
      q("#image-status").textContent =
        "Choose up to three JPG, PNG, or WebP images under 2 MB each.";
      event.target.value = "";
      return;
    }
    busy = true;
    const version = generation;
    const controls = [...form.querySelectorAll("input,textarea,select,button")];
    controls.forEach((input) => (input.disabled = true));
    q("#image-status").textContent = "Uploading images…";
    try {
      for (const file of files) {
        const result = await api("/api/events?upload=1", {
          content: (await dataUrl(file)).split(",")[1],
        });
        if (version !== generation) return;
        images.push({ ...result.image, alt: "" });
      }
      q("#image-status").textContent =
        "Uploaded. Save your draft to keep these images. Descriptions are optional.";
    } catch (error) {
      q("#image-status").textContent = error.message;
    } finally {
      busy = false;
      controls.forEach((input) => (input.disabled = false));
      event.target.value = "";
      if (version === generation) renderImages();
    }
  };
  window.addEventListener("beforeunload", (event) => {
    if (dirty() || busy) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  return {
    show: load,
    canLeave,
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
      q(".editor-heading").append(updatedNote);
      q(".editor-heading").after(activityPanel);
      overview.replaceChildren();
      activity.clear();
      showArchived = false;
      rows = [];
      images = [];
      renderImages();
      if (dialog.open) dialog.close();
      saved = "";
      form.reset();
      survey.set();
      form.hidden = true;
      q("#event-empty").hidden = false;
      q("#event-list").replaceChildren();
      q("#event-preview").replaceChildren();
      q("#event-preview").hidden = true;
      say();
    },
  };
}
