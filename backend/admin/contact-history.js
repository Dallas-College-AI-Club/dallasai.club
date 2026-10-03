import { activityTime } from "./event-activity.js";
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
const labels = {
  join: "Club signup",
  subscribe: "Newsletter subscription",
  rsvp: "Event RSVP",
  question: "Question",
  workshop: "Workshop request",
  contribution: "AI Review submission",
};
export function contactHistory(api, onChange = () => {}) {
  const drafts = new Map();
  const dialog = node("dialog", undefined, "contact-dialog");
  dialog.setAttribute("aria-labelledby", "contact-heading");
  const close = node("button", "Close", "secondary"),
    heading = node("h2", "Contacts"),
    intro = node(
      "p",
      "Link a person’s school email addresses to see their website submissions and officer notes together. Notes record follow-up; this page does not send or read emails.",
      "hint",
    );
  heading.id = "contact-heading";
  const toolbar = node("div", undefined, "heading contact-dialog-heading");
  toolbar.append(heading, close);
  const searchForm = node("form", undefined, "survey-tools"),
    label = node("label", "Find a contact by name or email"),
    search = node("input"),
    find = node("button", "Search contacts"),
    viewLabel = node("label", "Show contacts"),
    view = node("select");
  search.type = "search";
  search.maxLength = 200;
  label.append(search);
  view.append(
    new Option("Active", "active"),
    new Option("Deleted", "deleted"),
    new Option("All contacts", "all"),
  );
  view.setAttribute("aria-label", "Show contacts");
  viewLabel.append(view);
  searchForm.append(label, viewLabel, find);
  const status = node("p");
  status.setAttribute("role", "status");
  const content = node("div"),
    paging = node("div", undefined, "pagination"),
    prev = node("button", "Previous", "secondary"),
    next = node("button", "Next", "secondary"),
    retry = node("button", "Try loading contacts again", "secondary");
  retry.hidden = true;
  retry.onclick = () => load();
  paging.append(prev, next);
  dialog.append(toolbar, intro, searchForm, status, retry, content, paging);
  document.body.append(dialog);
  let generation = 0,
    email = "",
    offset = 0;
  close.onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    generation++;
    content.replaceChildren();
    search.value = "";
    status.textContent = "";
  });
  async function load() {
    const version = ++generation;
    retry.hidden = true;
    status.textContent = "Loading contacts…";
    content.replaceChildren();
    prev.disabled = next.disabled = true;
    try {
      const params = new URLSearchParams(
        email
          ? { contact: email, offset }
          : { contacts: "1", search: search.value, offset, view: view.value },
      );
      const data = await api("/api/surveys?" + params);
      if (version !== generation || !dialog.open) return;
      if (!email) {
        heading.textContent = "Contacts";
        for (const c of data.contacts) {
          const button = node("button", undefined, "contact-choice secondary");
          button.append(
            node("strong", c.name || c.email),
            node("span", c.email),
            node("small", c.submissions + " website submissions"),
          );
          if (c.emails.length > 1)
            button.append(
              node(
                "small",
                new Set(c.emails).size -
                  1 +
                  " additional linked email address(es)",
              ),
            );
          if (c.is_test)
            button.append(node("span", "Test contact", "contact-badge"));
          if (c.deleted_at)
            button.append(node("span", "Deleted", "contact-badge"));
          button.onclick = () => {
            email = c.email;
            offset = 0;
            load();
          };
          content.append(button);
        }
        status.textContent = data.contacts.length
          ? "Select a contact to see their history."
          : "No matching contacts.";
      } else {
        email = data.contact.email;
        heading.textContent = data.contact.name || email;
        const back = node("button", "← All contacts", "secondary");
        back.onclick = () => {
          email = "";
          offset = 0;
          load();
        };
        content.append(
          back,
          node("p", "Primary email: " + email, "contact-note-text"),
          node(
            "p",
            "Other linked emails: " +
              ([...new Set(data.contact.emails)]
                .filter((address) => address !== email)
                .join(" · ") || "None"),
            "contact-note-text",
          ),
          node(
            "p",
            "Names used: " + (data.contact.names || []).join(" · "),
            "hint",
          ),
        );
        content.append(management(data.contact, version));
        const form = node("form", undefined, "contact-note-form"),
          noteLabel = node("label", "Record a follow-up note"),
          note = node("textarea"),
          save = node("button", "Save note"),
          noteStatus = node("p");
        note.rows = 3;
        note.maxLength = 5000;
        note.required = true;
        const address = data.contact.email;
        const previous = drafts.get(address);
        note.value = previous?.text || "";
        noteLabel.append(note);
        noteStatus.setAttribute("role", "status");
        form.append(noteLabel, save, noteStatus);
        if (!data.contact.deleted_at) content.append(form);
        let noteId = previous?.id || crypto.randomUUID();
        if (previous)
          noteStatus.textContent =
            "Unsaved note restored. Select Save note to add it to the contact history.";
        note.oninput = () => {
          noteId = crypto.randomUUID();
          if (note.value) drafts.set(address, { text: note.value, id: noteId });
          else drafts.delete(address);
        };
        form.onsubmit = async (event) => {
          event.preventDefault();
          if (save.disabled) return;
          const submittedId = noteId;
          save.disabled = true;
          note.disabled = true;
          noteStatus.textContent = "Saving note…";
          try {
            await api("/api/surveys", {
              action: "contact-note",
              email: address,
              noteId: submittedId,
              note: note.value,
            });
            if (drafts.get(address)?.id === submittedId) drafts.delete(address);
            if (version !== generation) return;
            offset = 0;
            await load();
            status.textContent = "Follow-up note saved.";
          } catch (error) {
            if (version === generation) {
              noteStatus.textContent = error.message;
              save.disabled = false;
              note.disabled = false;
            }
          }
        };
        for (const item of data.history) {
          const card = node("article", undefined, "contact-entry");
          card.append(
            node(
              "h3",
              item.type === "submission"
                ? labels[item.label] || item.label
                : item.type === "comment"
                  ? "Officer comment"
                  : item.label,
            ),
            node(
              "p",
              activityTime(item.created_at) + " · " + item.actor,
              "hint",
            ),
          );
          if (item.body) card.append(node("p", item.body, "contact-note-text"));
          if (item.source_email)
            card.append(node("p", item.source_email, "hint contact-note-text"));
          for (const key of [
            "eventTitle",
            "eventDate",
            "topic",
            "subject",
            "question",
            "message",
            "body",
            "details",
            "title",
            "summary",
          ])
            if (typeof item.details?.[key] === "string" && item.details[key])
              card.append(node("p", item.details[key], "contact-note-text"));
          if (item.entry_id) {
            const link = node("a", "Open submission");
            link.href = "#entry=" + encodeURIComponent(item.entry_id);
            link.onclick = () => dialog.close();
            card.append(link);
          }
          content.append(card);
        }
        status.textContent =
          (data.contact.deleted_at ? "Deleted contact · " : "") +
          (data.contact.is_test ? "Test contact · " : "") +
          "History · page " +
          (offset / 50 + 1);
      }
      prev.disabled = offset === 0;
      next.disabled = !data.hasMore;
    } catch (error) {
      if (version === generation) {
        status.textContent = error.message;
        retry.hidden = false;
      }
    }
  }
  function management(contact, version) {
    const panel = node("section", undefined, "contact-management"),
      actions = node("div", undefined, "survey-response-actions"),
      test = node(
        "button",
        contact.is_test ? "Unmark as test" : "Mark as test",
        "secondary",
      ),
      remove = node(
        "button",
        contact.is_test ? "Permanently delete test contact" : "Delete contact",
        "secondary danger",
      ),
      restore = node("button", "Restore contact", "secondary"),
      merge = node("button", "Merge with another contact", "secondary"),
      details = node("div", undefined, "contact-confirmation");
    const actionButton = (text, fn, cls = "secondary") => {
      const el = node("button", text, cls);
      el.type = "button";
      el.onclick = fn;
      return el;
    };
    const fresh = () => version === generation && dialog.open;
    async function save(body, message) {
      if (!fresh()) return;
      const controls = [...panel.querySelectorAll("button, input")];
      controls.forEach((el) => (el.disabled = true));
      status.textContent = "Saving contact changes…";
      try {
        const result = await api("/api/surveys", {
          email: contact.email,
          revision: contact.revision,
          ...body,
        });
        if (!fresh()) return;
        if (result.purged || result.deleted) email = "";
        else email = result.email;
        if (result.purged)
          for (const address of contact.emails) drafts.delete(address);
        if (result.merged) {
          const combined = [
            drafts.get(result.email),
            ...contact.emails.map((address) => drafts.get(address)),
          ].filter(Boolean);
          for (const address of contact.emails) drafts.delete(address);
          if (combined.length)
            drafts.set(result.email, {
              text: [...new Set(combined.map((draft) => draft.text))].join(
                "\n\n",
              ),
              id: crypto.randomUUID(),
            });
        }
        offset = 0;
        await load();
        if (dialog.open)
          status.textContent =
            result.purged && !result.filesDeleted
              ? "Test contact and saved records permanently deleted. Attachment cleanup is pending and will retry automatically."
              : message;
        onChange(result);
      } catch (error) {
        if (fresh()) {
          status.textContent = error.message;
          controls.forEach((el) => (el.disabled = false));
        }
      }
    }
    function confirm(
      title,
      description,
      label,
      body,
      message,
      requireEmail = false,
    ) {
      const heading = node("h3", title),
        row = node("div", undefined, "survey-response-actions");
      heading.tabIndex = -1;
      details.replaceChildren(heading, node("p", description));
      let input;
      const accept = actionButton(
        label,
        () => {
          if (requireEmail && input.value.trim() !== contact.email) return;
          save(
            {
              ...body,
              ...(requireEmail ? { confirmEmail: input.value.trim() } : {}),
            },
            message,
          );
        },
        "danger",
      );
      if (requireEmail) {
        const label = node("label", "Type the primary email to confirm");
        input = node("input");
        input.type = "email";
        input.autocomplete = "off";
        label.append(input);
        details.append(label);
        accept.disabled = true;
        input.oninput = () =>
          (accept.disabled = input.value.trim() !== contact.email);
      }
      row.append(
        accept,
        actionButton("Cancel", () => {
          details.replaceChildren();
          merge.focus();
        }),
      );
      details.append(row);
      heading.focus();
    }
    test.onclick = () =>
      confirm(
        contact.is_test
          ? "Remove test flag?"
          : "Mark this person as a test contact?",
        contact.is_test
          ? "Deleting this contact will keep their submissions and allow restoration."
          : "This applies to every linked email. Deleting a test contact permanently erases its submissions, survey answers, comments, attachments and follow-up notes. Marking it does not delete anything yet.",
        contact.is_test ? "Confirm unmark as test" : "Confirm mark as test",
        { action: "contact-test", value: !contact.is_test },
        contact.is_test
          ? "Test flag removed."
          : "Contact marked as test. No records were deleted.",
      );
    restore.onclick = () =>
      save({ action: "contact-restore" }, "Contact restored to Active.");
    remove.onclick = () =>
      confirm(
        contact.is_test
          ? "Permanently delete this test contact?"
          : "Delete this contact from the directory?",
        contact.is_test
          ? `${contact.name || contact.email}: ${contact.emails.length} linked email address(es), ${contact.submissions} website submission(s), ${contact.notes} follow-up note(s) and ${contact.attachments} attachment(s). Their survey answers and comments will also be deleted. This cannot be undone.`
          : "Their submissions, survey answers and notes will stay saved. Find this person under Deleted to restore them.",
        contact.is_test
          ? "Delete test contact permanently"
          : "Confirm delete contact",
        { action: contact.is_test ? "contact-purge" : "contact-delete" },
        contact.is_test
          ? "Test contact and all linked records permanently deleted."
          : "Contact deleted from the directory. Submissions and notes are preserved.",
        contact.is_test,
      );
    merge.onclick = () => {
      const form = node("form", undefined, "contact-merge-search"),
        label = node("label", "Find the contact to keep"),
        input = node("input"),
        find = node("button", "Find merge candidates"),
        results = node("div"),
        hint = node(
          "p",
          "Choose the same person’s other contact. Its primary email and name will be kept; both histories remain unchanged.",
          "hint",
        );
      input.type = "search";
      input.maxLength = 200;
      input.required = true;
      label.append(input);
      form.append(label, find);
      details.replaceChildren(
        node("h3", "Merge contacts"),
        hint,
        form,
        results,
      );
      input.focus();
      let searchVersion = 0;
      form.onsubmit = async (event) => {
        event.preventDefault();
        const attempt = ++searchVersion;
        results.textContent = "Finding contacts…";
        find.disabled = true;
        try {
          const data = await api(
            "/api/surveys?" +
              new URLSearchParams({
                contacts: "1",
                search: input.value.trim(),
              }),
          );
          if (!fresh() || attempt !== searchVersion || !form.isConnected)
            return;
          const candidates = data.contacts.filter(
            (c) => c.email !== contact.email,
          );
          results.replaceChildren();
          for (const candidate of candidates) {
            const choose = actionButton(
              "",
              () =>
                confirm(
                  "Confirm these contacts are the same person",
                  `Keep ${candidate.name || candidate.email} (${candidate.email}) and link ${contact.emails.join(", ")}. ${candidate.submissions + contact.submissions} website submission(s) will appear together. No original answers, emails or notes will be rewritten.`,
                  "Confirm merge",
                  {
                    action: "contact-merge",
                    targetEmail: candidate.email,
                    targetRevision: candidate.revision,
                  },
                  "Contacts merged. Both email addresses now open the same history.",
                ),
              "contact-choice secondary",
            );
            choose.append(
              node("strong", candidate.name || candidate.email),
              node("span", candidate.emails.join(" · ")),
              node(
                "small",
                candidate.is_test ? "Test contact" : "Regular contact",
              ),
            );
            results.append(choose);
          }
          if (!candidates.length)
            results.textContent =
              "No other active contacts match. Try their other email address.";
          if (data.hasMore)
            results.append(
              node(
                "p",
                "More contacts match. Narrow your search to find the person.",
              ),
            );
        } catch (error) {
          if (fresh()) results.textContent = error.message;
        } finally {
          find.disabled = false;
        }
      };
    };
    actions.append(test);
    if (!contact.deleted_at) actions.append(merge);
    if (contact.deleted_at) actions.append(restore);
    if (!contact.deleted_at || contact.is_test) actions.append(remove);
    panel.append(actions, details);
    return panel;
  }
  searchForm.onsubmit = (event) => {
    event.preventDefault();
    email = "";
    offset = 0;
    load();
  };
  view.onchange = () => {
    email = "";
    offset = 0;
    load();
  };
  prev.onclick = () => {
    offset = Math.max(0, offset - 50);
    load();
  };
  next.onclick = () => {
    offset += 50;
    load();
  };
  window.addEventListener("beforeunload", (event) => {
    if (drafts.size) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  return {
    canLeave() {
      return (
        !drafts.size ||
        confirm("Discard your unsaved contact notes and sign out?")
      );
    },
    open(address = "") {
      email = address;
      view.value = "active";
      offset = 0;
      if (!dialog.open) dialog.showModal();
      load();
    },
    clear() {
      generation++;
      drafts.clear();
      if (dialog.open) dialog.close();
      content.replaceChildren();
      search.value = "";
      status.textContent = "";
      email = "";
      offset = 0;
    },
  };
}
