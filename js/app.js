import { marked } from "https://cdnjs.cloudflare.com/ajax/libs/marked/18.0.14/lib/marked.esm.js";
import { store } from "./store.js";
import { run, testKey, MODELS } from "./ai.js";
import { ACCEPTED, kindOf, extractText, cvContentBlock } from "./files.js";
import {
  CV_SCHEMA, cvSystemPrompt, askSystemPrompt,
  LETTER_TYPES, LETTER_FIELDS, letterSystemPrompt,
} from "./prompts.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const md = (text) => window.DOMPurify.sanitize(marked.parse(text || ""));

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// ---------------------------------------------------------------- navigation

const VIEWS = ["home", "screen", "ask", "letters", "policies", "settings"];

function show(view) {
  if (!VIEWS.includes(view)) view = "home";
  $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === view));
  $$(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.nav === view));
  if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
  if (view === "home") renderHome();
  if (view === "ask") renderAskNote();
  window.scrollTo(0, 0);
}

document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-nav]");
  if (target) {
    e.preventDefault();
    show(target.dataset.nav);
  }
});
window.addEventListener("hashchange", () => show(location.hash.slice(1)));

function needKey() {
  if (store.getSettings().apiKey) return false;
  toast("Add your Anthropic API key in Settings first.");
  show("settings");
  $("#s-apiKey").focus();
  return true;
}

// ---------------------------------------------------------------- home

function renderHome() {
  const s = store.getSettings();
  const policies = store.getPolicies();
  $("#home-company").textContent = s.companyName ? `, ${s.companyName} HR` : "";
  $("#brand-company").textContent = s.companyName || "AI assistant for HR";
  const steps = [
    { done: !!s.apiKey, text: "Add your Anthropic API key", view: "settings" },
    { done: !!s.companyName, text: "Add your company details", view: "settings" },
    { done: policies.length > 0, text: "Add your HR policies so Ask HR can answer from them", view: "policies" },
  ];
  $("#setup-card").hidden = steps.every((st) => st.done);
  $("#checklist").innerHTML = steps
    .map((st) => `<li class="${st.done ? "done" : ""}"><span class="dot">${st.done ? "✓" : ""}</span>
      <span>${st.done ? esc(st.text) : `<a data-nav="${st.view}">${esc(st.text)}</a>`}</span></li>`)
    .join("");
}

// ---------------------------------------------------------------- settings

const SETTING_FIELDS = ["apiKey", "model", "companyName", "companyAddress", "hrContact", "signatoryName", "signatoryTitle"];

function loadSettingsForm() {
  const s = store.getSettings();
  $("#s-model").innerHTML = MODELS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join("");
  SETTING_FIELDS.forEach((f) => ($("#s-" + f).value = s[f] ?? ""));
}

function readSettingsForm() {
  const s = store.getSettings();
  SETTING_FIELDS.forEach((f) => (s[f] = $("#s-" + f).value.trim()));
  return s;
}

$("#settings-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (store.saveSettings(readSettingsForm())) {
    toast("Settings saved.");
    renderHome();
    fillSignatory();
  }
});

$("#toggle-key").addEventListener("click", () => {
  const input = $("#s-apiKey");
  input.type = input.type === "password" ? "text" : "password";
  $("#toggle-key").textContent = input.type === "password" ? "Show" : "Hide";
});

$("#test-key").addEventListener("click", async () => {
  store.saveSettings(readSettingsForm());
  const status = $("#settings-status");
  status.textContent = "Testing…";
  try {
    await testKey();
    status.textContent = "✓ Connected. Your key works.";
  } catch (err) {
    status.textContent = "✗ " + err.message;
  }
});

$("#clear-all").addEventListener("click", () => {
  if (!confirm("Delete your API key, settings, policies and chat history from this browser?")) return;
  store.clearAll();
  loadSettingsForm();
  renderPolicies();
  chat = [];
  renderChat();
  renderHome();
  toast("All data deleted from this browser.");
});

// ---------------------------------------------------------------- drop zones

function wireDropzone(zone, input, onFiles) {
  input.accept = ACCEPTED;
  input.addEventListener("change", () => {
    onFiles([...input.files]);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", (e) => onFiles([...e.dataTransfer.files]));
}

// ---------------------------------------------------------------- CV screening

let cvs = []; // { id, name, file?, text? }
let results = []; // { id, name, status: "pending"|"done"|"failed", data?, error? }
let screenAbort = null;

function addCvFiles(files) {
  for (const file of files) {
    if (kindOf(file) === "unsupported") {
      toast(`${file.name}: use PDF, DOCX, TXT or MD.`);
      continue;
    }
    if (file.size > 30 * 1024 * 1024) {
      toast(`${file.name} is larger than 30 MB.`);
      continue;
    }
    cvs.push({ id: uid(), name: file.name, file });
  }
  renderCvList();
}

function renderCvList() {
  $("#cv-list").innerHTML = cvs.length
    ? cvs.map((c) => `<li><span>${esc(c.name)}</span><button class="x" data-remove-cv="${c.id}" aria-label="Remove">×</button></li>`).join("")
    : `<li class="empty">No CVs added yet</li>`;
  $("#screen-run").textContent = cvs.length ? `Screen ${cvs.length} CV${cvs.length > 1 ? "s" : ""}` : "Screen CVs";
}

$("#cv-list").addEventListener("click", (e) => {
  const id = e.target.dataset.removeCv;
  if (id) {
    cvs = cvs.filter((c) => c.id !== id);
    renderCvList();
  }
});

wireDropzone($("#cv-drop"), $("#cv-files"), addCvFiles);

$("#cv-paste-add").addEventListener("click", () => {
  const text = $("#cv-paste").value.trim();
  if (!text) return toast("Paste some CV text first.");
  cvs.push({ id: uid(), name: $("#cv-paste-name").value.trim() || `Pasted CV ${cvs.length + 1}`, text });
  $("#cv-paste").value = "";
  $("#cv-paste-name").value = "";
  renderCvList();
});

$("#job-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    $("#job-desc").value = await extractText(file);
    if (!$("#job-title").value) $("#job-title").value = file.name.replace(/\.[^.]+$/, "");
  } catch (err) {
    toast(err.message);
  }
});

async function screenOne(cv, system, signal) {
  const block = cv.file
    ? await cvContentBlock(cv.file)
    : { type: "text", text: `<cv label="${esc(cv.name)}">\n${cv.text}\n</cv>` };
  const { text } = await run({
    system,
    messages: [{ role: "user", content: [block, { type: "text", text: "Screen this CV against the job description." }] }],
    effort: "high",
    schema: CV_SCHEMA,
    signal,
  });
  return JSON.parse(text);
}

$("#screen-run").addEventListener("click", async () => {
  if (needKey()) return;
  const jobTitle = $("#job-title").value.trim();
  const jobDesc = $("#job-desc").value.trim();
  if (jobDesc.length < 40) return toast("Add a job description (at least a few lines).");
  if (!cvs.length) return toast("Add at least one CV.");

  const settings = store.getSettings();
  const system = [{ type: "text", text: cvSystemPrompt(settings, jobTitle, jobDesc), cache_control: { type: "ephemeral" } }];
  results = cvs.map((c) => ({ id: c.id, name: c.name, status: "pending" }));
  renderResults();

  screenAbort = new AbortController();
  const { signal } = screenAbort;
  $("#screen-run").disabled = true;
  $("#screen-stop").hidden = false;

  let done = 0;
  const status = () => ($("#screen-status").textContent = `Screened ${done} of ${cvs.length}…`);
  status();

  const queue = [...cvs];
  const worker = async () => {
    while (queue.length && !signal.aborted) {
      const cv = queue.shift();
      const r = results.find((x) => x.id === cv.id);
      try {
        r.data = await screenOne(cv, system, signal);
        r.status = "done";
      } catch (err) {
        r.status = "failed";
        r.error = err instanceof SyntaxError ? "The AI returned an unreadable result. Try again." : err.message;
      }
      done++;
      status();
      renderResults();
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  $("#screen-run").disabled = false;
  $("#screen-stop").hidden = true;
  const failed = results.filter((r) => r.status === "failed").length;
  $("#screen-status").textContent = signal.aborted
    ? "Stopped."
    : `Done. ${done - failed} screened${failed ? `, ${failed} failed` : ""}.`;
  results.filter((r) => r.status === "pending").forEach((r) => { r.status = "failed"; r.error = "Stopped."; });
  renderResults();
});

$("#screen-stop").addEventListener("click", () => screenAbort?.abort());

const tier = (score) => (score >= 80 ? "good" : score >= 55 ? "mid" : "bad");
const recTier = (rec) => (rec === "Strong match" ? "good" : rec === "Possible match" ? "mid" : "bad");
const list = (items) => (items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="hint">None noted</p>`);

function renderResults() {
  $("#results-head").hidden = !results.length;
  const sorted = [...results].sort((a, b) => {
    const rank = (r) => (r.status === "done" ? r.data.score : r.status === "pending" ? -1 : -2);
    return rank(b) - rank(a);
  });
  $("#results").innerHTML = sorted.map((r) => {
    if (r.status === "pending") {
      return `<div class="card result pending"><div class="result-top"><div class="score">…</div>
        <div class="result-id"><h3>${esc(r.name)}</h3><div class="sub">Reading and assessing…</div></div></div></div>`;
    }
    if (r.status === "failed") {
      return `<div class="card result failed"><div class="result-top"><div class="score bad">!</div>
        <div class="result-id"><h3>${esc(r.name)}</h3><div class="sub">${esc(r.error)}</div></div></div></div>`;
    }
    const d = r.data;
    return `<article class="card result">
      <div class="result-top">
        <div class="score ${tier(d.score)}">${d.score}</div>
        <div class="result-id">
          <h3>${esc(d.candidate_name)}</h3>
          <div class="sub">${esc(d.current_title)} · ${esc(d.years_experience)} yrs · ${esc(r.name)}</div>
        </div>
        <span class="badge ${recTier(d.recommendation)}">${esc(d.recommendation)}</span>
      </div>
      <p class="result-summary">${esc(d.summary)}</p>
      <details>
        <summary>Details and interview questions</summary>
        <div class="result-cols">
          <div><h4>Meets</h4>${list(d.matched_requirements)}</div>
          <div><h4>Missing</h4>${list(d.missing_requirements)}</div>
          <div><h4>Strengths</h4>${list(d.strengths)}</div>
          <div><h4>To probe</h4>${list(d.concerns)}</div>
        </div>
        <h4 class="hint" style="margin:1rem 0 .25rem">INTERVIEW QUESTIONS</h4>
        ${list(d.interview_questions)}
      </details>
      <div class="result-actions">
        <button class="btn ghost small" data-letter="interview" data-rid="${r.id}">Draft interview invitation</button>
        <button class="btn ghost small" data-letter="rejection" data-rid="${r.id}">Draft rejection</button>
      </div>
    </article>`;
  }).join("");
}

$("#results").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-letter]");
  if (!btn) return;
  const r = results.find((x) => x.id === btn.dataset.rid);
  startLetter(btn.dataset.letter, {
    recipient: r.data.candidate_name === "Unknown" ? "" : r.data.candidate_name,
    position: $("#job-title").value.trim(),
  });
});

$("#export-csv").addEventListener("click", () => {
  const rows = [["Rank", "Candidate", "File", "Score", "Recommendation", "Current title", "Years", "Summary", "Meets", "Missing", "To probe"]];
  results
    .filter((r) => r.status === "done")
    .sort((a, b) => b.data.score - a.data.score)
    .forEach((r, i) => {
      const d = r.data;
      rows.push([i + 1, d.candidate_name, r.name, d.score, d.recommendation, d.current_title, d.years_experience, d.summary,
        d.matched_requirements.join("; "), d.missing_requirements.join("; "), d.concerns.join("; ")]);
    });
  const csv = rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const name = ($("#job-title").value.trim() || "cv-screening").replace(/[^\w-]+/g, "-").toLowerCase();
  download(`${name}-shortlist.csv`, "﻿" + csv, "text/csv;charset=utf-8");
});

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- Ask HR

let chat = store.getChat(); // [{ role, content }]
let chatAbort = null;

const SUGGESTIONS = [
  "How many days of annual leave do new employees get?",
  "What is the process for requesting maternity or paternity leave?",
  "How do I report a concern about my manager confidentially?",
];

function renderAskNote() {
  const n = store.getPolicies().length;
  $("#ask-policy-note").innerHTML = n
    ? `Answering from ${n} polic${n === 1 ? "y" : "ies"}. <a data-nav="policies">Manage policies</a>`
    : `No policies added yet, so answers will be general. <a data-nav="policies">Add your policies</a>`;
}

function renderChat() {
  const log = $("#chat-log");
  if (!chat.length) {
    log.innerHTML = `<div class="chat-empty"><p>Ask anything about leave, benefits, payroll, onboarding or workplace procedures.</p>
      <div class="suggestions">${SUGGESTIONS.map((s) => `<button class="btn ghost small" data-suggest="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`;
    return;
  }
  log.innerHTML = chat
    .map((m) => (m.role === "user" ? `<div class="msg user">${esc(m.content)}</div>` : `<div class="msg assistant">${md(m.content)}</div>`))
    .join("");
  log.scrollTop = log.scrollHeight;
}

$("#chat-log").addEventListener("click", (e) => {
  const s = e.target.dataset.suggest;
  if (s) {
    $("#chat-input").value = s;
    $("#chat-form").requestSubmit();
  }
});

$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
});

$("#chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#chat-input");
  const question = input.value.trim();
  if (!question || chatAbort || needKey()) return;

  input.value = "";
  chat.push({ role: "user", content: question });
  renderChat();

  const log = $("#chat-log");
  const bubble = document.createElement("div");
  bubble.className = "msg assistant thinking";
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;

  chatAbort = new AbortController();
  $("#chat-send").disabled = true;
  $("#chat-stop").hidden = false;

  const system = [{ type: "text", text: askSystemPrompt(store.getSettings(), store.getPolicies()), cache_control: { type: "ephemeral" } }];
  try {
    const { text } = await run({
      system,
      messages: chat.map((m) => ({ role: m.role, content: m.content })),
      effort: "medium",
      signal: chatAbort.signal,
      onText: (t) => {
        bubble.classList.toggle("thinking", !t);
        bubble.innerHTML = md(t);
        log.scrollTop = log.scrollHeight;
      },
    });
    chat.push({ role: "assistant", content: text });
    store.saveChat(chat);
    renderChat();
  } catch (err) {
    // Drop the unanswered question so the conversation stays valid, and give it back to the user.
    chat.pop();
    renderChat();
    if (!err.aborted) {
      const errEl = document.createElement("div");
      errEl.className = "msg assistant error";
      errEl.textContent = err.message;
      if (!chat.length) log.innerHTML = "";
      log.appendChild(errEl);
    }
    input.value = question;
  } finally {
    chatAbort = null;
    $("#chat-send").disabled = false;
    $("#chat-stop").hidden = true;
  }
});

$("#chat-stop").addEventListener("click", () => chatAbort?.abort());
$("#chat-clear").addEventListener("click", () => {
  chatAbort?.abort();
  chat = [];
  store.saveChat(chat);
  renderChat();
});

// ---------------------------------------------------------------- Letters

let letterAbort = null;

function renderLetterFields() {
  const type = LETTER_TYPES.find((t) => t.id === $("#letter-type").value);
  const current = Object.fromEntries($$("#letter-fields [data-lf]").map((i) => [i.dataset.lf, i.value]));
  $("#letter-fields").innerHTML = type.fields
    .map((f) => {
      const def = LETTER_FIELDS[f];
      return `<label class="field">${esc(def.label)}
        <input data-lf="${f}" type="${def.type || "text"}" placeholder="${esc(def.placeholder || "")}" value="${esc(current[f] || "")}" /></label>`;
    })
    .join("");
  $("#letter-warning").hidden = !type.sensitive;
}

function fillSignatory() {
  const s = store.getSettings();
  if (!$("#lf-signatory").value && s.signatoryName) {
    $("#lf-signatory").value = [s.signatoryName, s.signatoryTitle].filter(Boolean).join(", ");
  }
}

function startLetter(typeId, values = {}) {
  $("#letter-type").value = typeId;
  renderLetterFields();
  if (values.recipient !== undefined) $("#lf-recipient").value = values.recipient;
  if (values.position !== undefined) {
    const pos = $('#letter-fields [data-lf="position"]');
    if (pos) pos.value = values.position;
  }
  show("letters");
}

function letterRequest() {
  const type = LETTER_TYPES.find((t) => t.id === $("#letter-type").value);
  const lines = [`Letter type: ${type.label}`];
  const recipient = $("#lf-recipient").value.trim();
  lines.push(`Recipient: ${recipient || "[Recipient name]"}`);
  $$("#letter-fields [data-lf]").forEach((i) => {
    if (i.value.trim()) lines.push(`${LETTER_FIELDS[i.dataset.lf].label}: ${i.value.trim()}`);
  });
  const signatory = $("#lf-signatory").value.trim();
  if (signatory) lines.push(`Signed by: ${signatory}`);
  lines.push(`Tone: ${$("#lf-tone").value}`);
  const details = $("#lf-details").value.trim();
  if (details) lines.push(`\nKey details to include:\n${details}`);
  return lines.join("\n");
}

async function streamLetter(messages) {
  if (letterAbort || needKey()) return;
  const out = $("#letter-output");
  const previous = out.value;
  letterAbort = new AbortController();
  $("#letter-run").disabled = true;
  $("#letter-stop").hidden = false;
  out.value = "";
  out.placeholder = "Writing…";
  try {
    const { text } = await run({
      system: letterSystemPrompt(store.getSettings()),
      messages,
      effort: "medium",
      signal: letterAbort.signal,
      onText: (t) => (out.value = t),
    });
    out.value = text.trim();
  } catch (err) {
    if (!err.aborted) toast(err.message);
    if (!out.value) out.value = previous;
  } finally {
    letterAbort = null;
    out.placeholder = "Your letter will appear here. You can edit it directly.";
    $("#letter-run").disabled = false;
    $("#letter-stop").hidden = true;
  }
}

$("#letter-type").innerHTML = LETTER_TYPES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join("");
$("#letter-type").addEventListener("change", renderLetterFields);

$("#letter-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if ($("#letter-type").value === "custom" && !$("#lf-details").value.trim()) {
    return toast("Describe the letter you need in Key details.");
  }
  streamLetter([{ role: "user", content: letterRequest() }]);
});

$("#letter-stop").addEventListener("click", () => letterAbort?.abort());

$("#letter-refine").addEventListener("submit", (e) => {
  e.preventDefault();
  const instruction = $("#refine-input").value.trim();
  const draft = $("#letter-output").value.trim();
  if (!instruction) return;
  if (!draft) return toast("Draft a letter first.");
  $("#refine-input").value = "";
  streamLetter([{
    role: "user",
    content: `Original request:\n${letterRequest()}\n\nCurrent draft:\n<letter>\n${draft}\n</letter>\n\nRevise the draft as follows: ${instruction}\nOutput only the full revised letter.`,
  }]);
});

function letterHtml(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${p.split("\n").map(inline).join("<br>")}</p>`)
    .join("\n");
}

function letterFilename(ext) {
  const type = LETTER_TYPES.find((t) => t.id === $("#letter-type").value).label;
  const who = $("#lf-recipient").value.trim();
  return `${[type, who].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]+/g, "")}.${ext}`;
}

$("#letter-copy").addEventListener("click", async () => {
  const text = $("#letter-output").value;
  if (!text) return toast("Nothing to copy yet.");
  try {
    await navigator.clipboard.writeText(text.replace(/\*\*(.+?)\*\*/g, "$1"));
    toast("Letter copied.");
  } catch {
    toast("Couldn't copy. Select the text and copy it manually.");
  }
});

$("#letter-word").addEventListener("click", () => {
  const text = $("#letter-output").value.trim();
  if (!text) return toast("Draft a letter first.");
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
    <style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4}p{margin:0 0 10pt}</style></head>
    <body>${letterHtml(text)}</body></html>`;
  download(letterFilename("doc"), "﻿" + doc, "application/msword");
});

$("#letter-print").addEventListener("click", () => {
  const text = $("#letter-output").value.trim();
  if (!text) return toast("Draft a letter first.");
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print the letter.");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(letterFilename("pdf").replace(/\.pdf$/, ""))}</title>
    <style>@page{margin:2.5cm}body{font-family:Georgia,serif;font-size:11.5pt;line-height:1.55;color:#111;max-width:17cm;margin:2rem auto}p{margin:0 0 1em}</style>
    </head><body>${letterHtml(text)}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
});

// ---------------------------------------------------------------- Policies

let editingPolicy = null;

function wordCount(text) {
  const n = text.split(/\s+/).filter(Boolean).length;
  return n < 1000 ? `${n} words` : `${(n / 1000).toFixed(1)}k words`;
}

function renderPolicies() {
  const policies = store.getPolicies();
  $("#policy-list").innerHTML = policies.length
    ? policies.map((p) => `<li>
        <div style="min-width:0"><div class="p-title">${esc(p.title)}</div>
        <div class="p-meta">${wordCount(p.content)}</div></div>
        <div class="row"><button class="btn ghost small" data-edit-policy="${p.id}">Edit</button>
        <button class="x" data-delete-policy="${p.id}" aria-label="Delete">×</button></div></li>`).join("")
    : `<li class="empty">No policies yet</li>`;
  renderAskNote();
}

function savePolicy(title, content, id = uid()) {
  const policies = store.getPolicies();
  const existing = policies.findIndex((p) => p.id === id);
  const policy = { id, title, content, updated: new Date().toISOString() };
  if (existing >= 0) policies[existing] = policy;
  else policies.push(policy);
  return store.savePolicies(policies);
}

$("#policy-add").addEventListener("click", () => {
  const title = $("#policy-title").value.trim();
  const content = $("#policy-text").value.trim();
  if (!title || !content) return toast("Add a title and the policy text.");
  if (savePolicy(title, content, editingPolicy || undefined)) {
    editingPolicy = null;
    $("#policy-title").value = "";
    $("#policy-text").value = "";
    $("#policy-add").textContent = "Save policy";
    renderPolicies();
    toast("Policy saved.");
  }
});

$("#policy-list").addEventListener("click", (e) => {
  const del = e.target.dataset.deletePolicy;
  const edit = e.target.dataset.editPolicy;
  if (del) {
    const p = store.getPolicies().find((x) => x.id === del);
    if (!confirm(`Delete "${p.title}"?`)) return;
    store.savePolicies(store.getPolicies().filter((x) => x.id !== del));
    renderPolicies();
  }
  if (edit) {
    const p = store.getPolicies().find((x) => x.id === edit);
    editingPolicy = p.id;
    $("#policy-title").value = p.title;
    $("#policy-text").value = p.content;
    $("#policy-add").textContent = "Update policy";
    $("#policy-title").focus();
  }
});

wireDropzone($("#policy-drop"), $("#policy-files"), async (files) => {
  for (const file of files) {
    try {
      toast(`Reading ${file.name}…`);
      const text = (await extractText(file)).trim();
      if (!text) {
        toast(`${file.name}: no text found. Scanned PDFs need to be pasted as text.`);
        continue;
      }
      savePolicy(file.name.replace(/\.[^.]+$/, ""), text);
      renderPolicies();
      toast(`Added ${file.name}.`);
    } catch (err) {
      toast(err.message);
    }
  }
});

// ---------------------------------------------------------------- start

loadSettingsForm();
renderCvList();
renderLetterFields();
fillSignatory();
renderPolicies();
renderChat();
show(location.hash.slice(1) || "home");
