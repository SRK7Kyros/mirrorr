const STORAGE_KEY = "mirrorr.servers.v1"

// On a device this is the native store (survives clearing WebView data); in a
// plain browser the same page falls back to localStorage so it stays previewable.
const preferences = window.Capacitor?.Plugins?.Preferences

const list = document.getElementById("servers")
const form = document.getElementById("add")
const urlInput = document.getElementById("url")
const nameInput = document.getElementById("name")
const errorLine = document.getElementById("error")

const readState = async () => {
  const raw = preferences
    ? (await preferences.get({ key: STORAGE_KEY })).value
    : window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return { servers: [], lastUrl: null }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.servers)) return { servers: [], lastUrl: null }
    return { servers: parsed.servers, lastUrl: parsed.lastUrl ?? null }
  } catch {
    return { servers: [], lastUrl: null }
  }
}

const writeState = async (state) => {
  const raw = JSON.stringify(state)
  if (preferences) await preferences.set({ key: STORAGE_KEY, value: raw })
  else window.localStorage.setItem(STORAGE_KEY, raw)
}

const parseServerUrl = (input) => {
  const trimmed = input.trim()
  if (!trimmed) throw new Error("Enter a server URL.")
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url
  try {
    url = new URL(candidate)
  } catch {
    throw new Error("That does not look like a server URL.")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http:// and https:// servers are supported.")
  }
  return url.origin
}

const showError = (message) => {
  errorLine.textContent = message
  errorLine.hidden = false
}

let state = await readState()

const render = () => {
  list.replaceChildren()

  if (state.servers.length === 0) {
    const empty = document.createElement("li")
    empty.className = "empty"
    empty.textContent = "No servers yet — add one below."
    list.append(empty)
    return
  }

  for (const server of state.servers) {
    const row = document.createElement("li")
    row.className = "server"

    const connect = document.createElement("button")
    connect.type = "button"
    connect.className = "connect"
    connect.addEventListener("click", () => void openServer(server))

    const name = document.createElement("span")
    name.className = "name"
    name.textContent = server.name || server.url
    if (state.lastUrl === server.url) {
      const badge = document.createElement("span")
      badge.className = "badge"
      badge.textContent = "last"
      name.append(badge)
    }

    const url = document.createElement("span")
    url.className = "url"
    url.textContent = server.url

    connect.append(name, url)

    const remove = document.createElement("button")
    remove.type = "button"
    remove.className = "remove"
    remove.textContent = "\u00d7"
    remove.setAttribute("aria-label", `Remove ${server.name || server.url}`)
    remove.addEventListener("click", () => void removeServer(server.url))

    row.append(connect, remove)
    list.append(row)
  }
}

const openServer = async (server) => {
  state = { ...state, lastUrl: server.url }
  await writeState(state)
  window.location.assign(server.url)
}

const removeServer = async (target) => {
  state = {
    servers: state.servers.filter((server) => server.url !== target),
    lastUrl: state.lastUrl === target ? null : state.lastUrl,
  }
  await writeState(state)
  render()
}

form.addEventListener("submit", async (event) => {
  event.preventDefault()
  errorLine.hidden = true
  try {
    const url = parseServerUrl(urlInput.value)
    if (state.servers.some((server) => server.url === url)) {
      throw new Error("That server is already in the list.")
    }
    state = { ...state, servers: [...state.servers, { name: nameInput.value.trim(), url }] }
    await writeState(state)
    urlInput.value = ""
    nameInput.value = ""
    render()
  } catch (error) {
    showError(error instanceof Error ? error.message : "Could not add that server.")
  }
})

render()
