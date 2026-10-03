import { mountRespondents } from "./survey-respondents.js";
import { surveyTrial } from "./survey-trial.js";
import { choiceEditor } from "./survey-choices.js";
const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const audienceNames = {
  students: "Dallas College students",
  staff: "Dallas College staff",
  public: "Open to the public",
  officers: "Club officers",
  advisors: "Advisors",
};
const newQuestion = (title = "", type = "text", options = []) => ({
  id: crypto.randomUUID(),
  title,
  description: "",
  type,
  required: false,
  options,
});
const fresh = () => ({
  template: "blank",
  title: "Untitled survey",
  intro: "",
  audience: "advisors",
  permissions: { preview: "link", answer: "invited", results: "admins" },
  durationDays: 30,
  questions: [],
});
export function mountSurveyBuilder(root, api, onDone, id) {
  let definition = fresh(),
    surveyId = id || crypto.randomUUID(),
    revision = 0,
    step = 0,
    busy = false,
    pending,
    previewLink = "",
    saved = true,
    published = false,
    active = true;
  const status = node("p");
  status.setAttribute("role", "status");
  const retry = button("Retry the same save", async () => {
    if (!pending) return;
    const action = pending.body.action;
    if ((await save(action)) && action !== "publish") render();
  });
  retry.hidden = true;
  const steps = ["Template", "Audience", "Questions", "Preview", "Publish"];
  async function initialize() {
    if (id) {
      root.replaceChildren(node("p", "Loading survey draft…"));
      try {
        const { survey } = await api(
          "/api/custom-surveys?action=draft&id=" + id,
        );
        if (!active) return;
        if (survey.status !== "draft")
          throw Error("This survey has already been published.");
        definition = survey.definition;
        revision = survey.edit_revision;
        previewLink = survey.previewLink;
        saved = true;
      } catch (error) {
        if (!active) return;
        root.replaceChildren(node("p", error.message));
        root.append(button("Back to surveys", onDone));
        return;
      }
    }
    render();
  }
  function button(label, fn, cls = "secondary") {
    const b = node("button", label, cls);
    b.type = "button";
    b.onclick = fn;
    return b;
  }
  function field(
    label,
    key,
    { type = "text", max = 160, multiline = false } = {},
  ) {
    const l = node("label", label),
      input = node(multiline ? "textarea" : "input");
    if (!multiline) input.type = type;
    input.maxLength = max;
    input.value = definition[key];
    if (multiline) input.rows = 3;
    input.oninput = () => {
      definition[key] = type === "number" ? Number(input.value) : input.value;
      saved = false;
    };
    l.append(input);
    return l;
  }
  function select(label, value, options, onChange) {
    const l = node("label", label),
      s = node("select");
    s.setAttribute("aria-label", label);
    for (const [v, t] of options) {
      const o = node("option", t);
      o.value = v;
      s.append(o);
    }
    s.value = value;
    s.onchange = () => {
      onChange(s.value);
      saved = false;
    };
    l.append(s);
    return l;
  }
  async function save(action = "save") {
    if (busy || !active) return false;
    const body = {
      id: surveyId,
      action,
      definition,
      expectedRevision: revision,
    };
    const serialized = JSON.stringify(body);
    if (pending && pending.serialized !== serialized) {
      status.textContent = "Retry the previous save before changing the draft.";
      return false;
    }
    pending ||= {
      serialized,
      body: { ...structuredClone(body), requestId: crypto.randomUUID() },
    };
    busy = true;
    root
      .querySelectorAll("button,input,textarea,select")
      .forEach((e) => (e.disabled = true));
    status.textContent = action === "publish" ? "Publishing…" : "Saving draft…";
    try {
      const data = await api(
        "/api/custom-surveys?action=draft-change",
        pending.body,
      );
      if (!active) return false;
      revision = data.revision;
      pending = null;
      saved = true;
      if (action === "publish") {
        published = true;
        await onDone(surveyId);
        return true;
      }
      const result = await api(
        "/api/custom-surveys?action=draft&id=" + surveyId,
      );
      if (!active) return false;
      previewLink = result.survey.previewLink;
      status.textContent = "Draft saved.";
      return true;
    } catch (error) {
      if (!active) return false;
      status.textContent = error.message;
      if (error.status && error.status < 500) pending = null;
      return false;
    } finally {
      busy = false;
      if (active && root.isConnected)
        root
          .querySelectorAll("button,input,textarea,select")
          .forEach((e) => (e.disabled = Boolean(pending)));
      retry.hidden = !pending;
      retry.disabled = false;
    }
  }
  async function go(next) {
    if (busy) return;
    if (await save()) {
      step = next;
      render();
    }
  }
  function render() {
    if (!active) return;
    root.replaceChildren(
      node("h2", "Create a custom survey"),
      node(
        "p",
        "Choose who can preview, answer, and read results. Questions and permissions are fixed once published.",
        "hint",
      ),
    );
    const progress = node("nav", undefined, "builder-steps");
    progress.setAttribute("aria-label", "Survey creation steps");
    steps.forEach((name, i) => {
      const b = button(i + 1 + ". " + name, () => go(i));
      if (i === step) b.setAttribute("aria-current", "step");
      progress.append(b);
    });
    root.append(progress);
    const panel = node("section", undefined, "entry builder-panel");
    panel.append(node("h3", steps[step]));
    root.append(panel);
    if (step === 0) {
      panel.append(
        select(
          "Starting template",
          definition.template,
          [
            ["blank", "Blank survey"],
            ["feedback", "Quick feedback"],
          ],
          (value) => {
            definition.template = value;
            if (!definition.questions.length && value === "feedback")
              definition.questions = [
                newQuestion("How would you rate your experience?", "scale"),
                newQuestion("What worked well?"),
                newQuestion("What would you improve?"),
              ];
            render();
          },
        ),
        node(
          "p",
          "Quick feedback adds three starting questions to an empty survey. You can edit, reorder, add, or remove any question.",
          "hint",
        ),
        field("Survey title", "title"),
        field("Welcome message", "intro", { multiline: true, max: 3000 }),
      );
    } else if (step === 1) {
      panel.append(
        select(
          "Target audience",
          definition.audience,
          Object.entries(audienceNames),
          (value) => {
            definition.audience = value;
            if (value !== "public") definition.permissions.answer = "invited";
            render();
          },
        ),
      );
      panel.append(
        select(
          "Who can preview the questions?",
          definition.permissions.preview,
          [
            ["link", "Anyone with the preview link"],
            ["respondents", "Verified respondents only"],
          ],
          (v) => (definition.permissions.preview = v),
        ),
      );
      panel.append(
        select(
          "Who can answer?",
          definition.permissions.answer,
          definition.audience === "public"
            ? [
                ["invited", "Approved email addresses"],
                ["verified", "Anyone who verifies their email"],
              ]
            : [["invited", "Approved email addresses"]],
          (v) => {
            definition.permissions.answer = v;
            render();
          },
        ),
      );
      panel.append(
        select(
          "Who can read submitted results?",
          definition.permissions.results,
          [
            ["admins", "Club admins only"],
            ["respondents", "Admins and verified respondents"],
          ],
          (v) => (definition.permissions.results = v),
        ),
      );
      panel.append(
        node(
          "p",
          "For college students, staff, officers, and advisors, approve each email below. The audience label alone does not verify someone’s affiliation. Admin access and respondent access are separate.",
          "hint",
        ),
      );
      if (definition.permissions.answer === "verified")
        panel.append(
          node(
            "p",
            "New respondents register after verifying their email. Removing a respondent blocks that email from rejoining.",
            "hint",
          ),
        );
      const members = node("section");
      panel.append(members);
      if (revision)
        mountRespondents(members, surveyId, api, async () => {
          render();
        });
      else
        panel.append(
          button("Save draft to add respondents", async () => {
            if (await save()) render();
          }),
        );
    } else if (step === 2) {
      panel.append(
        node(
          "p",
          "Up to 30 questions. Text answers, single or multiple choice, and ratings from 1 to 5 are supported.",
          "hint",
        ),
      );
      definition.questions.forEach((q, i) => {
        const card = node("fieldset", undefined, "builder-question");
        card.append(node("legend", "Question " + (i + 1)));
        const title = node("label", "Question"),
          input = node("input");
        input.value = q.title;
        input.maxLength = 300;
        input.oninput = () => {
          q.title = input.value;
          saved = false;
        };
        title.append(input);
        card.append(title);
        const help = node("label", "Help text (optional)"),
          textarea = node("textarea");
        textarea.value = q.description;
        textarea.maxLength = 1000;
        textarea.rows = 2;
        textarea.oninput = () => {
          q.description = textarea.value;
          saved = false;
        };
        help.append(textarea);
        card.append(help);
        card.append(
          select(
            "Answer type",
            q.type,
            [
              ["text", "Written answer"],
              ["single", "Choose one"],
              ["multiple", "Choose several"],
              ["scale", "Rating: 1 to 5"],
            ],
            (v) => {
              q.type = v;
              q.options = ["single", "multiple"].includes(v)
                ? q.options.length
                  ? q.options
                  : ["", ""]
                : [];
              render();
            },
          ),
        );
        const required = node("label", undefined, "builder-check"),
          check = node("input");
        check.type = "checkbox";
        check.checked = q.required;
        check.onchange = () => {
          q.required = check.checked;
          saved = false;
        };
        required.append(check, node("span", "Required question"));
        card.append(required);
        if (["single", "multiple"].includes(q.type))
          card.append(
            choiceEditor(q, () => {
              saved = false;
            }),
          );
        const actions = node("div", undefined, "entry-actions");
        if (i)
          actions.append(
            button("Move question " + (i + 1) + " up", () => {
              [definition.questions[i - 1], definition.questions[i]] = [
                q,
                definition.questions[i - 1],
              ];
              saved = false;
              render();
            }),
          );
        if (i < definition.questions.length - 1)
          actions.append(
            button("Move question " + (i + 1) + " down", () => {
              [definition.questions[i], definition.questions[i + 1]] = [
                definition.questions[i + 1],
                q,
              ];
              saved = false;
              render();
            }),
          );
        actions.append(
          button("Remove question " + (i + 1), () => {
            definition.questions.splice(i, 1);
            saved = false;
            render();
          }),
        );
        card.append(actions);
        panel.append(card);
      });
      if (definition.questions.length < 30)
        panel.append(
          button("Add question", () => {
            definition.questions.push(newQuestion());
            saved = false;
            render();
          }),
        );
    } else if (step === 3) {
      panel.append(surveyTrial(definition));
      panel.append(
        node("h4", definition.title),
        node("p", definition.intro),
        node(
          "p",
          `${definition.questions.length} questions · ${audienceNames[definition.audience]}`,
        ),
      );
      for (const q of definition.questions) {
        const card = node("section", undefined, "builder-preview-question");
        card.append(
          node("strong", q.title || "Untitled question"),
          node("p", q.description),
          node(
            "p",
            {
              text: "Written answer",
              single: "Choose one",
              multiple: "Choose several",
              scale: "Rating from 1 to 5",
            }[q.type] + (q.required ? " · Required" : " · Optional"),
          ),
        );
        if (q.options.length) {
          const list = node("ul");
          q.options.forEach((o) => list.append(node("li", o)));
          card.append(list);
        }
        panel.append(card);
      }
      panel.append(
        node(
          "p",
          definition.permissions.preview === "link"
            ? "Share the read-only preview to review questions before publishing."
            : "The shared preview requires an approved respondent to verify their email. The question summary above is always available to admins.",
          "hint",
        ),
      );
      if (previewLink) {
        const link = node("a", "Open styled preview ↗");
        link.href = previewLink;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        panel.append(
          link,
          button("Copy preview link", async () => {
            try {
              await navigator.clipboard.writeText(previewLink);
              status.textContent = "Preview link copied.";
            } catch {
              status.textContent = previewLink;
            }
          }),
        );
      }
    } else {
      panel.append(
        node("h4", definition.title),
        node(
          "p",
          `${definition.questions.length} questions · ${audienceNames[definition.audience]}`,
        ),
        field("Days open after publishing", "durationDays", { type: "number" }),
      );
      panel.querySelector("input").min = "1";
      panel.querySelector("input").max = "90";
      panel.append(
        node(
          "p",
          "Preview: " +
            (definition.permissions.preview === "link"
              ? "anyone with the preview link"
              : "verified respondents"),
        ),
        node(
          "p",
          "Answering: " +
            (definition.permissions.answer === "verified"
              ? "anyone with a verified email"
              : "approved email addresses"),
        ),
        node(
          "p",
          "Results: " +
            (definition.permissions.results === "admins"
              ? "admins only"
              : "admins and verified respondents, including future respondents"),
        ),
      );
      panel.append(
        node(
          "p",
          "Publishing opens the answering link and starts the expiration period. You can manage respondents and close the survey afterward. Changes to questions or permissions require a new survey.",
          "hint",
        ),
      );
      panel.append(
        button(
          "Publish survey",
          async () => {
            if (!saved && !(await save())) return;
            await save("publish");
          },
          "",
        ),
      );
    }
    const actions = node("div", undefined, "entry-actions");
    if (step) actions.append(button("← Back", () => go(step - 1)));
    if (step < 4)
      actions.append(button("Save and continue →", () => go(step + 1), ""));
    actions.append(
      button("Save draft and leave", async () => {
        if (await save()) onDone(surveyId);
      }),
    );
    root.append(actions, status, retry);
  }
  const beforeUnload = (e) => {
    if (active && (busy || pending || (!saved && !published))) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", beforeUnload);
  const originalDone = onDone;
  onDone = async (selected) => {
    if (!active) return;
    dispose();
    await originalDone(selected);
  };
  function dispose() {
    active = false;
    window.removeEventListener("beforeunload", beforeUnload);
    for (const dialog of root.querySelectorAll("dialog[open]")) dialog.close();
  }
  initialize();
  return {
    dispose,
    canLeave() {
      if (!active) return true;
      if (busy || pending) {
        status.textContent = busy
          ? "Please wait for this save to finish before leaving."
          : "Retry the pending save before leaving so you know whether it was saved.";
        status.scrollIntoView({ block: "nearest" });
        return false;
      }
      return (
        saved ||
        published ||
        confirm(
          "Discard your unsaved custom survey changes? Your last saved draft will be kept.",
        )
      );
    },
  };
}
