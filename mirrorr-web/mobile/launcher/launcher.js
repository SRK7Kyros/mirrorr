const STORAGE_KEY = "mirrorr.servers.v1";
const CREDENTIAL_PREFIX = "mirrorr.cred.";

// On a device this is the native store (survives clearing WebView data); in a
// plain browser the same page falls back to localStorage so it stays previewable.
const preferences = window.Capacitor?.Plugins?.Preferences;
// Credentials go to the OS keychain, keyed by the host's origin — the console
// reads the entry for its own origin and signs itself in with it.
const secureStorage = window.Capacitor?.Plugins?.SecureStorage;

const list = document.getElementById("servers");
const form = document.getElementById("add");
const urlInput = document.getElementById("url");
const nameInput = document.getElementById("name");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const errorLine = document.getElementById("error");
const submitButton = document.getElementById("submit");
const cancelButton = document.getElementById("cancel");
const autoLine = document.getElementById("auto");
const autoText = document.getElementById("auto-text");
const autoSkip = document.getElementById("auto-skip");

const readState = async () => {
  const raw = preferences
    ? (await preferences.get({ key: STORAGE_KEY })).value
    : window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return { servers: [], lastUrl: null, autoUrl: null };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.servers))
      return { servers: [], lastUrl: null, autoUrl: null };
    return {
      servers: parsed.servers,
      lastUrl: parsed.lastUrl ?? null,
      autoUrl: parsed.autoUrl ?? null,
    };
  } catch {
    return { servers: [], lastUrl: null, autoUrl: null };
  }
};

const writeState = async (state) => {
  const raw = JSON.stringify(state);
  if (preferences) await preferences.set({ key: STORAGE_KEY, value: raw });
  else window.localStorage.setItem(STORAGE_KEY, raw);
};

const parseServerUrl = (input) => {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Enter a server URL.");
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("That does not look like a server URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http:// and https:// servers are supported.");
  }
  return url.origin;
};

const showError = (message) => {
  errorLine.textContent = message;
  errorLine.hidden = false;
};

// The plugin's typed JS wrapper needs a bundler and this page is build-less, so
// these speak its wire contract directly, as that wrapper does: bridge methods
// taking ONE options object, with the key already prefixed. Passing a bare
// string instead reaches the native side with no key and is rejected outright.
const KEYCHAIN_PREFIX = "capacitor-storage_";
const keychainKey = (url) => `${KEYCHAIN_PREFIX}${CREDENTIAL_PREFIX}${url}`;

const readCredential = async (url) => {
  const key = keychainKey(url);
  try {
    const raw = secureStorage
      ? ((
          await secureStorage.internalGetItem({ prefixedKey: key, sync: false })
        )?.data ?? null)
      : window.localStorage.getItem(key);
    if (typeof raw !== "string" || raw === "") return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.username !== "string" ||
      typeof parsed?.password !== "string"
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCredential = async (url, credential) => {
  const key = keychainKey(url);
  if (credential === null) {
    if (secureStorage)
      await secureStorage.internalRemoveItem({ prefixedKey: key, sync: false });
    else window.localStorage.removeItem(key);
    return;
  }
  const data = JSON.stringify(credential);
  if (secureStorage)
    await secureStorage.internalSetItem({
      prefixedKey: key,
      data,
      sync: false,
    });
  else window.localStorage.setItem(key, data);
};

let state = await readState();
let editingUrl = null;
// url -> username, so a row can show which hosts will sign themselves in.
const savedLogins = new Map();

const render = () => {
  list.replaceChildren();

  if (state.servers.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No servers yet — add one below.";
    list.append(empty);
    return;
  }

  for (const server of state.servers) {
    const row = document.createElement("li");
    row.className = "server";

    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = "connect";
    connect.addEventListener("click", () => void openServer(server));

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = server.name || server.url;
    if (state.lastUrl === server.url) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "last";
      name.append(badge);
    }
    const username = savedLogins.get(server.url);
    if (username !== undefined) {
      const badge = document.createElement("span");
      badge.className = "badge badge-login";
      badge.textContent = username;
      name.append(badge);
    }

    const url = document.createElement("span");
    url.className = "url";
    url.textContent = server.url;

    connect.append(name, url);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "icon-action";
    edit.textContent = "\u270e";
    edit.setAttribute("aria-label", `Edit ${server.name || server.url}`);
    edit.addEventListener("click", () => void startEdit(server));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-action danger";
    remove.textContent = "\u00d7";
    remove.setAttribute("aria-label", `Remove ${server.name || server.url}`);
    remove.addEventListener("click", () => void removeServer(server.url));

    // The shell opens exactly one host, so the choice belongs on the list that
    // knows every host — not inside a console, which only knows itself.
    const auto = document.createElement("button");
    auto.type = "button";
    auto.className = "icon-action auto";
    auto.textContent = "auto";
    auto.setAttribute("aria-pressed", String(state.autoUrl === server.url));
    auto.setAttribute(
      "aria-label",
      `${state.autoUrl === server.url ? "Stop opening" : "Open"} ${server.name || server.url} on launch`,
    );
    auto.addEventListener("click", () => void toggleAuto(server.url));

    row.append(connect, auto, edit, remove);
    list.append(row);
  }
};

/** Which hosts have credentials, so the list reports the feature is on. */
const refreshSavedLogins = async () => {
  const entries = await Promise.all(
    state.servers.map(async (server) => [
      server.url,
      (await readCredential(server.url))?.username ?? null,
    ]),
  );
  savedLogins.clear();
  for (const [url, username] of entries)
    if (username !== null) savedLogins.set(url, username);
  render();
};

const openServer = async (server) => {
  state = { ...state, lastUrl: server.url };
  await writeState(state);
  window.location.assign(server.url);
};

/**
 * Enabling a host moves the shell's launch target to it rather than adding one:
 * exactly one host can be opened on launch, so this is a single choice that the
 * list makes visible on every row.
 */
const toggleAuto = async (target) => {
  state = { ...state, autoUrl: state.autoUrl === target ? null : target };
  await writeState(state);
  render();
};

const removeServer = async (target) => {
  state = {
    servers: state.servers.filter((server) => server.url !== target),
    lastUrl: state.lastUrl === target ? null : state.lastUrl,
    autoUrl: state.autoUrl === target ? null : state.autoUrl,
  };
  await writeState(state);
  // Never leave a secret behind for a host the user removed.
  await writeCredential(target, null);
  if (editingUrl === target) stopEdit();
  await refreshSavedLogins();
};

const startEdit = async (server) => {
  const credential = await readCredential(server.url);
  editingUrl = server.url;
  urlInput.value = server.url;
  nameInput.value = server.name;
  usernameInput.value = credential?.username ?? "";
  passwordInput.value = credential?.password ?? "";
  errorLine.hidden = true;
  submitButton.textContent = "Save changes";
  cancelButton.hidden = false;
  form.scrollIntoView({ block: "nearest" });
  urlInput.focus();
};

const stopEdit = () => {
  editingUrl = null;
  form.reset();
  errorLine.hidden = true;
  submitButton.textContent = "Add server";
  cancelButton.hidden = true;
};

cancelButton.addEventListener("click", stopEdit);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorLine.hidden = true;
  try {
    const url = parseServerUrl(urlInput.value);
    if (
      state.servers.some(
        (server) => server.url === url && server.url !== editingUrl,
      )
    ) {
      throw new Error("That server is already in the list.");
    }
    const name = nameInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    // Both or neither: a username without a password can never sign in, and a
    // password without a username is not a credential. Empty fields clear it.
    const credential =
      username !== "" && password !== "" ? { username, password } : null;

    if (editingUrl === null) {
      state = { ...state, servers: [...state.servers, { name, url }] };
      await writeState(state);
      await writeCredential(url, credential);
    } else {
      const previous = editingUrl;
      state = {
        servers: state.servers.map((server) =>
          server.url === previous ? { name, url } : server,
        ),
        lastUrl: state.lastUrl === previous ? url : state.lastUrl,
        autoUrl: state.autoUrl === previous ? url : state.autoUrl,
      };
      await writeState(state);
      // A re-pointed host takes its credentials with it — never orphan a key.
      if (previous !== url) await writeCredential(previous, null);
      await writeCredential(url, credential);
    }
    stopEdit();
    await refreshSavedLogins();
  } catch (error) {
    showError(
      error instanceof Error ? error.message : "Could not save that server.",
    );
  }
});

// Handing the WebView to a host that is down would strand the app on a blank
// error page with no way back to this list, so an auto-connect asks the host to
// answer first. `no-cors` asks nothing of the host's headers and this page never
// reads the reply — only whether one arrives at all.
const AUTO_CONNECT_TIMEOUT_MS = 4000;

const reachable = async (url) => {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(),
    AUTO_CONNECT_TIMEOUT_MS,
  );
  try {
    await fetch(`${url}/health`, {
      mode: "no-cors",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
};

let autoSkipped = false;

autoSkip.addEventListener("click", () => {
  autoSkipped = true;
  autoLine.hidden = true;
});

const autoConnect = async () => {
  const url = state.autoUrl;
  if (url === null) return;
  const label = state.servers.find((server) => server.url === url)?.name || url;
  autoText.textContent = `Connecting to ${label}…`;
  autoLine.hidden = false;
  if (!(await reachable(url))) {
    if (autoSkipped) return;
    autoSkip.hidden = true;
    autoText.textContent = `Could not reach ${label} — pick a server below.`;
    return;
  }
  if (autoSkipped) return;
  await openServer({ url });
};

// Android's back button is consumed by the App plugin once it is linked, so the
// picker — the app's root, with nothing behind it — has to end the app itself.
const appPlugin = window.Capacitor?.Plugins?.App;
appPlugin?.addListener?.("backButton", () => void appPlugin.exitApp?.());

render();
void refreshSavedLogins();
void autoConnect();
