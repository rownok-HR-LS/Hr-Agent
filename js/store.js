// Everything is stored in this browser only (localStorage). Nothing is sent
// anywhere except the Anthropic API when you run a task.

const KEYS = {
  settings: "hragent.settings",
  policies: "hragent.policies",
  chat: "hragent.chat",
};

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "claude-opus-5-5",
  companyName: "",
  companyAddress: "",
  hrContact: "",
  signatoryName: "",
  signatoryTitle: "",
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(err);
    alert("Could not save to browser storage (it may be full or blocked). Try removing large policy documents.");
    return false;
  }
}

export const store = {
  getSettings: () => ({ ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }),
  saveSettings: (s) => write(KEYS.settings, s),

  getPolicies: () => read(KEYS.policies, []),
  savePolicies: (p) => write(KEYS.policies, p),

  getChat: () => read(KEYS.chat, []),
  saveChat: (c) => write(KEYS.chat, c),

  clearAll() {
    Object.values(KEYS).forEach((k) => {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    });
  },
};
