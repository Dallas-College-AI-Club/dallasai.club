import { eventText } from "./event-format.js";
import {
  identityFields,
  formFooter,
  mountForm,
  escapeHTML as h,
} from "./form-client.js";
export function rsvpDialog(root, { preview = false } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "workshop-dialog rsvp-dialog";
  dialog.setAttribute("aria-labelledby", "rsvp-heading");
  root.append(dialog);
  const mock = document.createElement("dialog");
  mock.className = "workshop-dialog rsvp-answer-preview";
  mock.setAttribute("aria-label", "Sample admin response — not saved");
  root.append(mock);
  function previewResult(event, data, answers) {
    const el = (tag, text) => {
      const n = document.createElement(tag);
      n.textContent = text;
      return n;
    };
    const close = el("button", "Back to preview");
    close.type = "button";
    close.className = "outline-link";
    close.onclick = () => mock.close();
    mock.replaceChildren(
      close,
      el("h2", "Sample admin response"),
      el("p", "PREVIEW ONLY · These answers have not been submitted or saved."),
      el("h3", event.title),
      el("p", "Event date: " + (event.date || "TBD")),
      el("p", data.get("name")),
      el("p", data.get("email")),
    );
    const list = document.createElement("dl");
    for (const question of event.surveyQuestions || []) {
      const answer = answers.find((a) => a.questionId === question.id);
      const values = (
        Array.isArray(answer?.value) ? answer.value : [answer?.value || ""]
      )
        .filter(Boolean)
        .map((value) =>
          value === "__other__" ? "Other: " + answer.other : value,
        );
      list.append(
        el("dt", question.label),
        el("dd", values.length ? values.join("\n") : "No answer"),
      );
    }
    mock.append(list);
    mock.showModal();
  }
  mock.addEventListener("close", () => mock.replaceChildren());
  let stop = () => {},
    eventId = "";
  function close() {
    if (mock.open) mock.close();
    if (dialog.open) dialog.close();
  }
  function open(event) {
    stop();
    eventId = event.id;
    const questions = event.surveyQuestions || [];
    const fields = questions
      .map((question, index) => {
        const name = "answer-" + question.id;
        const description = question.description
          ? '<p id="' + name + '-help">' + h(question.description) + "</p>"
          : "";
        const described = question.description
          ? ' aria-describedby="' + name + '-help"'
          : "";
        const label =
          h(index + 1 + ". " + question.label) +
          (question.required
            ? " <span>(required)</span>"
            : " <span>(optional)</span>");
        if (question.type === "text")
          return (
            '<fieldset class="survey-question"><legend>' +
            label +
            "</legend>" +
            description +
            '<textarea aria-label="' +
            h(question.label) +
            '" name="' +
            name +
            '" maxlength="3000" rows="3"' +
            described +
            (question.required ? " required" : "") +
            "></textarea></fieldset>"
          );
        const options = [
          ...question.options,
          ...(question.allowOther ? ["__other__"] : []),
        ];
        return (
          '<fieldset class="survey-question" data-question="' +
          question.id +
          '"><legend>' +
          label +
          "</legend>" +
          description +
          options
            .map(
              (option) =>
                '<label class="survey-choice"><input type="' +
                (question.type === "multiple" ? "checkbox" : "radio") +
                '" name="' +
                name +
                '" value="' +
                h(option) +
                '"' +
                described +
                (question.type === "single" && question.required
                  ? " required"
                  : "") +
                "><span>" +
                h(option === "__other__" ? "Other" : option) +
                "</span></label>",
            )
            .join("") +
          (question.type === "single" && !question.required
            ? '<button type="button" class="survey-clear outline-link" data-clear="' +
              question.id +
              '">Clear answer</button>'
            : "") +
          (question.allowOther
            ? '<label class="survey-other" hidden>Other answer<textarea name="' +
              name +
              '-other" maxlength="1000" rows="2" disabled></textarea></label>'
            : "") +
          "</fieldset>"
        );
      })
      .join("");
    dialog.innerHTML =
      '<div class="dialog-toolbar"><button type="button" class="dialog-close" aria-label="Close RSVP">×</button></div>' +
      '<span class="tag">' +
      (event.potential
        ? "POTENTIAL EVENT · DATE " +
          (event.date ? h(event.date.slice(0, 10)) : "TBD")
        : "EVENT RSVP") +
      "</span>" +
      '<h2 id="rsvp-heading">' +
      h(event.title) +
      "</h2>" +
      (preview
        ? '<p class="potential-notice">PREVIEW ONLY · Try the form below. Nothing will be submitted or saved.</p>'
        : "") +
      (event.potential
        ? "<p>This records your interest. Final details and seats are not yet confirmed.</p>"
        : "") +
      (event.surveyIntro
        ? '<div class="survey-intro event-richtext">' +
          eventText(event.surveyIntro) +
          "</div>"
        : "") +
      '<form id="event-rsvp" class="club-form">' +
      identityFields(event.requireEduEmail === true) +
      fields +
      (preview
        ? '<button type="submit" class="solid-link">Preview admin result</button>'
        : formFooter(
            "Submit RSVP",
            "I agree that club officers may use my RSVP and answers to plan this event and contact me about it.",
          )) +
      "</form>";
    dialog.querySelector(".dialog-close").onclick = close;
    const form = dialog.querySelector("form");
    function validateChoices() {
      for (const question of questions.filter((q) => q.type !== "text")) {
        const inputs = [
          ...form.querySelectorAll('[name="answer-' + question.id + '"]'),
        ];
        if (question.type === "multiple") {
          const exclusive = inputs.find(
            (input) =>
              input.checked &&
              (input.value === question.options[question.exclusiveOption] ||
                [
                  "any of these",
                  "none of these",
                  "none of these times",
                  "not sure yet",
                  "none of the above",
                  "any of the above",
                ].includes(input.value.trim().toLowerCase())),
          );
          for (const input of inputs) {
            input.disabled = Boolean(exclusive?.checked && input !== exclusive);
            if (input.disabled) input.checked = false;
          }
        }
        const selected = inputs
          .filter((input) => input.checked)
          .map((input) => input.value);
        if (question.type === "multiple")
          inputs[0].setCustomValidity(
            question.required && !selected.length
              ? "Choose at least one answer."
              : "",
          );
        const other = form.elements.namedItem(
          "answer-" + question.id + "-other",
        );
        if (other) {
          other.disabled = !selected.includes("__other__");
          other.required = !other.disabled;
          other.closest("label").hidden = other.disabled;
        }
      }
    }
    form.addEventListener("change", validateChoices);
    form.querySelectorAll("[data-clear]").forEach((button) => {
      button.onclick = () => {
        form
          .querySelectorAll('[name="answer-' + button.dataset.clear + '"]')
          .forEach((input) => (input.checked = false));
        validateChoices();
      };
    });
    validateChoices();
    const serialize = (data) => ({
      answers: questions.map((question) => ({
        questionId: question.id,
        value:
          question.type === "multiple"
            ? data.getAll("answer-" + question.id)
            : data.get("answer-" + question.id) || "",
        other: data.get("answer-" + question.id + "-other") || "",
      })),
    });
    if (preview) {
      form.elements.name.value = "Preview participant";
      form.elements.email.value = "preview@example.edu";
      form.onsubmit = (eventClick) => {
        eventClick.preventDefault();
        validateChoices();
        if (!form.reportValidity()) return;
        const data = new FormData(form);
        previewResult(event, data, serialize(data).answers);
      };
      stop = () => {
        form.onsubmit = null;
      };
    } else
      stop = mountForm(form, {
        kind: "rsvp",
        extra: { eventId, surveyVersion: event.surveyVersion || "" },
        serialize,
      });
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }
  return {
    open,
    update(event) {
      if (!dialog.open) return;
      if (!event || event.id !== eventId || event.registrationOpen === false)
        close();
      // Keep entered answers during feed refresh; the server rejects stale versions.
    },
    destroy() {
      stop();
      close();
      dialog.remove();
      mock.remove();
    },
  };
}
