import { mountSurveyResults } from "./survey-results.js";
import { createAuthClient } from "better-auth/client";
import { mountCustomSurveys } from "./custom-surveys.js";
import { mountSurveyArchive } from "./survey-archive.js";
import { emailOTPClient } from "better-auth/client/plugins";
import { mountEventEditor } from "./event-editor.js";
import { mountBrowserAlerts } from "./browser-alerts.js";
import { submissionActivity } from "./submission-activity.js";
import { activityTime } from "./event-activity.js";
const auth = createAuthClient({ plugins: [emailOTPClient()] }),
  q = (s) => document.querySelector(s);
const labels = {
  join: "Club signups",
  subscribe: "The AI Review subscription",
  rsvp: "Event RSVPs (upcoming only)",
  contribution: "AI Review submissions",
  workshop: "Workshop requests",
  question: "Questions",
};
let offset = 0,
  signedIn = false,
  loading = false,
  reloadPending = false,
  sessionGeneration = 0;
let lastNewCount = null,
  lastReceived = 0;
const commentDrafts = new Map();
const alerts = mountBrowserAlerts(
  q("#enable-alerts"),
  q("#notification-status"),
);
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function status(message = "") {
  q("#status").textContent = message;
}
async function api(path = "/api/admin", body) {
  const requestSession = sessionGeneration;
  let response;
  try {
    response = await fetch(path, {
      signal: AbortSignal.timeout(20000),
      credentials: "same-origin",
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch {
    throw new Error(
      "Could not connect to Club Office. Check your connection and try again.",
    );
  }
  const data = await response.json().catch(() => null);
  if (response.status === 401 && requestSession === sessionGeneration) {
    showLogin();
    status("Your session ended. Sign in again to continue.");
  }
  if (!data || typeof data !== "object") {
    const error = new Error(
      response.status === 401
        ? "Your session ended. Sign in again to continue."
        : "Club Office is temporarily unavailable. Please try again; unsaved text has been kept.",
    );
    error.status = response.status >= 400 ? response.status : 503;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data.error || "Please try again.");
    error.status = response.status;
    throw error;
  }
  return data;
}
function showLogin() {
  q("#session-loading").hidden = true;
  sessionGeneration++;
  signedIn = false;
  lastNewCount = null;
  lastReceived = 0;
  q("#inbox-alert").textContent = "";
  document.title = "Club office · Dallas AI Club";
  q("#login").hidden = false;
  q("#office").hidden = true;
  q("#signout").hidden = true;
  q("#entries").replaceChildren();
  commentDrafts.clear();
  emailStep();
  q("#events-pane").hidden = true;
  q("#inbox-pane").hidden = false;
  editor.clear();
  surveys.clear();
  customSurveys.clear();
  surveyArchive.clear();
  q("#surveys-pane").hidden = true;
}
function filters() {
  const params = new URLSearchParams([
    ...new FormData(q("#filters")).entries(),
    ["offset", String(offset)],
  ]);
  const entry = new URLSearchParams(location.hash.slice(1)).get("entry");
  if (entry) {
    params.set("id", entry);
    params.delete("status");
  }
  return params;
}
function renderEntry(entry) {
  const card = node("article", undefined, "entry");
  card.id = "entry-" + entry.id;
  const top = node("div", undefined, "entry-top");
  top.append(
    node(
      "span",
      entry.review_status === "closed" ? "archived" : entry.review_status,
      "badge " + entry.review_status,
    ),
    node("span", labels[entry.kind]),
    node("span", activityTime(entry.created_at)),
  );
  card.append(top, node("h2", entry.name || entry.email));
  const address = node("a", entry.email);
  address.href = "mailto:" + entry.email;
  card.append(
    address,
    node(
      "p",
      entry.state === "active" ? "Received in club inbox" : entry.state,
    ),
  );
  if (entry.kind === "rsvp") {
    card.append(
      node(
        "p",
        entry.data.eventTitle +
          " · " +
          (entry.data.eventDate?.slice(0, 10) || "TBD"),
      ),
    );
    if (entry.data.hasSurvey) {
      const button = node("button", "View survey answers");
      button.onclick = () => {
        if (showPane("surveys", true) === false) return;
        history.replaceState({}, "", "#survey=" + entry.id);
        surveys.show(entry.id);
      };
      card.append(button);
    }
  }
  const details = node("details");
  details.append(node("summary", "Submission details"));
  for (const [key, value] of Object.entries(entry.data)) {
    if (["hasSurvey", "potential"].includes(key)) continue;
    details.append(
      node("strong", key.replace(/([A-Z])/g, " $1")),
      node("pre", key === "eventDate" && !value ? "TBD" : String(value)),
    );
  }
  for (const file of entry.attachments) {
    const p = node("p"),
      a = node("a", `${file.name} (${Math.ceil(file.size / 1024)} KB)`);
    a.href = "/api/admin?attachment=" + encodeURIComponent(file.id);
    p.append(a);
    details.append(p);
  }
  details.append(node("p", "Reference: " + entry.id));
  card.append(details);
  const actions = node("div", undefined, "entry-actions");
  for (const [value, label] of [
    ["reviewed", "Mark reviewed"],
    ["closed", "Archive submission"],
    ["new", "Mark new"],
  ])
    if (value !== entry.review_status) {
      const b = node("button", label);
      b.onclick = async () => {
        b.disabled = true;
        try {
          await api("/api/admin", {
            action: "review",
            id: entry.id,
            status: value,
          });
          await load();
          status(
            value === "closed"
              ? "Submission moved to Archived. Comments and history are kept."
              : "Submission moved to " +
                  (value === "new" ? "New." : "Reviewed."),
          );
        } catch (e) {
          status(e.message);
          b.disabled = false;
        }
      };
      actions.append(b);
    }
  card.append(actions, submissionActivity(entry, api, commentDrafts));
  return card;
}
async function load({ background = false } = {}) {
  if (loading) {
    reloadPending ||= !background;
    return;
  }
  loading = true;
  if (location.hash === "#archived-survey-questions") selectSurveyArchive();
  const generation = sessionGeneration,
    requestedFilters = filters().toString();
  q("#entries").setAttribute("aria-busy", "true");
  q("#refresh").disabled = true;
  try {
    const data = await api("/api/admin?" + requestedFilters);
    if (generation !== sessionGeneration) return;
    if (filters().toString() !== requestedFilters) {
      reloadPending = true;
      return;
    }
    const linkedId = new URLSearchParams(location.hash.slice(1)).get("entry");
    const linkedEntry =
      linkedId && data.entries.find((entry) => entry.id === linkedId);
    if (linkedEntry) selectInboxStatus(linkedEntry.review_status);
    signedIn = true;
    q("#session-loading").hidden = true;
    q("#login").hidden = true;
    q("#office").hidden = false;
    q("#signout").hidden = false;
    q("#identity").textContent = "Signed in as " + data.user;
    const newCount = data.counts.reduce((sum, row) => sum + row.new, 0);
    document.title =
      (newCount ? "(" + newCount + ") " : "") + "Club office · Dallas AI Club";
    const latest = Math.max(
      0,
      ...data.counts.map((row) => Date.parse(row.latest) || 0),
    );
    if (
      lastNewCount !== null &&
      (newCount > lastNewCount || latest > lastReceived)
    ) {
      q("#inbox-alert").textContent =
        "New submissions arrived. Review the inbox below.";
      alerts.notify();
    }
    lastNewCount = newCount;
    lastReceived = latest;
    const eventSelect = q('#filters [name="eventId"]'),
      selectedEvent = eventSelect.value;
    eventSelect.replaceChildren(
      new Option("All upcoming events", ""),
      ...(data.events || []).map(
        (e) =>
          new Option(e.title + " · " + (e.date?.slice(0, 10) || "TBD"), e.id),
      ),
    );
    if (
      [...eventSelect.options].some((option) => option.value === selectedEvent)
    )
      eventSelect.value = selectedEvent;
    if (location.hash === "#events" && q("#events-pane").hidden)
      showPane("events");
    if (
      (location.hash === "#surveys" ||
        location.hash.startsWith("#survey=") ||
        location.hash.startsWith("#custom-survey=")) &&
      q("#surveys-pane").hidden
    )
      showPane("surveys", true);
    q("#counts").replaceChildren(
      ...Object.entries(labels).map(([kind, label]) => {
        const count = data.counts.find((x) => x.kind === kind) || {
            new: 0,
            total: 0,
          },
          box = node("div", undefined, "count");
        box.append(
          node("span", label),
          node("strong", count.new),
          node("small", `new · ${count.total} total`),
        );
        return box;
      }),
    );
    const missing = Object.entries(data.configured)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    q("#configuration").hidden = !missing.length;
    q("#configuration").textContent =
      "Setup still needed: " + missing.join(", ") + ".";
    if (
      !background ||
      (!commentDrafts.size && !q("#entries").contains(document.activeElement))
    ) {
      const expanded = new Map(
        [...q("#entries").children].map((card) => [
          card.id,
          [...card.querySelectorAll("details")].map((panel) => panel.open),
        ]),
      );
      q("#entries").replaceChildren(
        ...(data.entries.length
          ? data.entries.map(renderEntry)
          : [node("p", "No submissions match these filters.")]),
      );
      for (const card of q("#entries").children)
        [...card.querySelectorAll("details")].forEach((panel, index) => {
          panel.open = expanded.get(card.id)?.[index] || false;
        });
    }
    q("#previous").disabled = offset === 0;
    q("#next").disabled = !data.hasMore;
    q("#page").textContent = "Page " + (offset / 50 + 1);
    q("#export").href = "/api/admin?" + filters() + "&export=csv";
    surveyArchive.load(filters(), { background });
    const linked = new URLSearchParams(location.hash.slice(1)).get("entry");
    if (linked) {
      const card = document.getElementById("entry-" + linked);
      if (card) {
        card.querySelector("details").open = true;
        card.scrollIntoView({ block: "center" });
        history.replaceState({}, "", location.pathname);
      }
    }
  } catch (error) {
    if (generation !== sessionGeneration) return;
    if (!signedIn) showLogin();
    status(error.message);
  } finally {
    loading = false;
    q("#refresh").disabled = false;
    q("#entries").setAttribute("aria-busy", "false");
    if (reloadPending) {
      reloadPending = false;
      load();
    }
  }
}
function selectInboxStatus(value) {
  q('#filters [name="status"]').value = value;
  document.querySelectorAll("[data-inbox-status]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.inboxStatus === value),
    );
  });
  q("#inbox-view-note").textContent = {
    new: "New submissions awaiting review.",
    reviewed: "Reviewed submissions. Archive them when follow-up is complete.",
    closed:
      "Archived submissions. Comments and history are kept. Mark an entry new or reviewed to restore it.",
  }[value];
}
for (const button of document.querySelectorAll("[data-inbox-status]")) {
  button.onclick = () => {
    if (button.getAttribute("aria-pressed") === "true") return;
    selectInboxStatus(button.dataset.inboxStatus);
    offset = 0;
    if (location.hash !== "#events")
      history.replaceState({}, "", location.pathname);
    status();
    q("#entries").replaceChildren(node("p", "Loading submissions…"));
    load();
  };
}
let pendingEmail = "",
  resendAt = 0,
  resendTimer = null;
function emailStep() {
  pendingEmail = "";
  resendAt = 0;
  clearTimeout(resendTimer);
  q("#login-form").hidden = false;
  q("#code-form").hidden = true;
  q("#code-form").reset();
  q("#code-instructions").textContent = "";
}
function loginBusy(busy) {
  q("#login")
    .querySelectorAll("button")
    .forEach((button) => {
      button.disabled = busy;
    });
  if (Date.now() < resendAt) q("#resend-code").disabled = true;
}
async function sendCode(email) {
  const result = await auth.emailOtp.sendVerificationOtp({
    email,
    type: "sign-in",
  });
  if (result.error)
    throw new Error(
      result.error.status === 429
        ? "Please wait a few minutes before requesting another code."
        : "The sign-in code could not be sent. Please try again shortly.",
    );
  pendingEmail = email;
  q("#login-form").hidden = true;
  q("#code-form").hidden = false;
  q("#code-form").reset();
  q("#code-instructions").textContent =
    "If this is an approved admin address, a code will arrive at " +
    email +
    ".";
  resendAt = Date.now() + 60000;
  q("#resend-code").textContent = "Send a new code (wait 1 minute)";
  clearTimeout(resendTimer);
  resendTimer = setTimeout(() => {
    q("#resend-code").disabled = false;
    q("#resend-code").textContent = "Send a new code";
  }, 60000);
  q('#code-form [name="otp"]').focus();
}
q("#login-form").onsubmit = async (event) => {
  event.preventDefault();
  const email = new FormData(event.target).get("email").trim().toLowerCase();
  loginBusy(true);
  status();
  try {
    await sendCode(email);
  } catch (error) {
    status(error.message);
  } finally {
    loginBusy(false);
  }
};
q("#code-form").onsubmit = async (event) => {
  event.preventDefault();
  loginBusy(true);
  status();
  try {
    const result = await auth.signIn.emailOtp({
      email: pendingEmail,
      otp: new FormData(event.target).get("otp").trim(),
    });
    if (result.error)
      throw new Error(
        "That code could not be verified. Check the latest email, or request a new code.",
      );
    await load();
    if (signedIn) emailStep();
  } catch (error) {
    status(error.message);
  } finally {
    loginBusy(false);
  }
};
q("#resend-code").onclick = async () => {
  if (Date.now() < resendAt) return;
  loginBusy(true);
  status();
  try {
    await sendCode(pendingEmail);
    status("A new sign-in code was requested. Use the latest email.");
  } catch (error) {
    status(error.message);
  } finally {
    loginBusy(false);
  }
};
q("#change-email").onclick = () => {
  emailStep();
  status();
  q('#login-form [name="email"]').focus();
};
q("#signout").onclick = async () => {
  if (!editor.canLeave() || !customSurveys.canLeave() || !surveys.canLeave())
    return;
  sessionGeneration++;
  try {
    const result = await auth.signOut();
    if (result.error) throw new Error("Could not sign out. Please try again.");
    showLogin();
    q("#login-form").reset();
    status("Signed out.");
  } catch (e) {
    status(e.message);
  }
};
const editor = mountEventEditor(api);
const surveys = mountSurveyResults(api, () => {
  offset = 0;
  commentDrafts.clear();
  load();
});
const customSurveys = mountCustomSurveys(q("#custom-surveys-root"), api);
const surveyArchive = mountSurveyArchive(q("#archived-survey-questions"), api);
function surveyGroup(custom, id = "") {
  const alreadyCustom = !q("#custom-surveys-root").hidden;
  if (
    custom === alreadyCustom &&
    !id &&
    !q("#surveys-pane").hidden &&
    q(custom ? "#custom-surveys-root" : "#survey-results").childNodes.length
  )
    return true;
  if (!custom && !customSurveys.leave()) return false;
  q("#custom-surveys-root").hidden = !custom;
  q("#event-surveys-root").hidden = custom;
  q("#custom-surveys-group").setAttribute("aria-pressed", String(custom));
  q("#event-surveys-group").setAttribute("aria-pressed", String(!custom));
  if (custom) id ? customSurveys.show(id) : customSurveys.load();
  return true;
}
q("#custom-surveys-group").onclick = () => surveyGroup(true);
q("#event-surveys-group").onclick = () => {
  if (!q("#event-surveys-root").hidden) return;
  if (surveyGroup(false) === false) return;
  history.replaceState({}, "", "#surveys");
  surveys.show();
};
function showPane(name, keepHash = false) {
  const currentPane = ["inbox", "events", "surveys"].find(
    (pane) => !q("#" + pane + "-pane").hidden,
  );
  if (name === currentPane && !keepHash) return true;
  if (name !== "events" && !q("#events-pane").hidden && !editor.leave())
    return false;
  if (
    name !== "surveys" &&
    !q("#surveys-pane").hidden &&
    !customSurveys.leave()
  )
    return false;
  for (const pane of ["inbox", "events", "surveys"]) {
    q("#" + pane + "-pane").hidden = name !== pane;
    q("#" + pane + "-tab").setAttribute("aria-pressed", String(name === pane));
  }
  if (!keepHash)
    history.replaceState(
      {},
      "",
      name === "inbox" ? location.pathname : "#" + name,
    );
  if (name === "events") editor.show();
  if (name === "surveys") {
    const customId = new URLSearchParams(location.hash.slice(1)).get(
      "custom-survey",
    );
    if (customId) {
      surveyGroup(true, customId);
      return;
    }
    surveyGroup(false);
    surveys.show(
      new URLSearchParams(location.hash.slice(1)).get("survey") || "",
    );
  }
}
function selectSurveyArchive() {
  selectInboxStatus("closed");
  q('#filters [name="kind"]').value = "question";
  q('#filters [name="eventId"]').value = "";
  q("#event-filter-label").hidden = true;
  history.replaceState({}, "", location.pathname);
}
window.addEventListener("hashchange", () => {
  if (signedIn && (location.hash === "#events" || !location.hash)) {
    if (
      showPane(location.hash === "#events" ? "events" : "inbox", true) === false
    )
      history.replaceState(
        {},
        "",
        q("#events-pane").hidden ? "#surveys" : "#events",
      );
    return;
  }
  if (signedIn && location.hash === "#archived-survey-questions") {
    if (showPane("inbox", true) === false) return;
    offset = 0;
    selectSurveyArchive();
    load();
    return;
  }
  if (
    signedIn &&
    (location.hash === "#surveys" ||
      location.hash.startsWith("#survey=") ||
      location.hash.startsWith("#custom-survey="))
  ) {
    showPane("surveys", true);
    return;
  }
  if (!signedIn || !new URLSearchParams(location.hash.slice(1)).get("entry"))
    return;
  if (showPane("inbox", true) === false) return;
  offset = 0;
  q('#filters [name="kind"]').value = "";
  q('#filters [name="eventId"]').value = "";
  q("#event-filter-label").hidden = true;
  load();
});
q("#surveys-tab").onclick = () => showPane("surveys");
q("#events-tab").onclick = () => showPane("events");
q("#inbox-tab").onclick = () => showPane("inbox");
q("#refresh").onclick = () => {
  status();
  load();
};
q("#filters").onsubmit = (event) => {
  event.preventDefault();
  offset = 0;
  load();
};
q('#filters [name="kind"]').onchange = () => {
  const rsvp = q('#filters [name="kind"]').value === "rsvp";
  q("#event-filter-label").hidden = !rsvp;
  if (!rsvp) q('#filters [name="eventId"]').value = "";
  offset = 0;
  load();
};
q("#previous").onclick = () => {
  offset = Math.max(0, offset - 50);
  load();
};
q("#next").onclick = () => {
  offset += 50;
  load();
};
setInterval(() => {
  if (signedIn && (!document.hidden || alerts.enabled))
    load({ background: true });
}, 60000);
auth
  .getSession()
  .then(({ data, error }) => {
    if (data?.user) load();
    else {
      showLogin();
      if (error) status("Could not verify your sign-in. Please try again.");
    }
  })
  .catch(() => {
    showLogin();
    status("Could not connect. Please try again.");
  });
