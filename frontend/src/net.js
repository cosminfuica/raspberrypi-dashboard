// Talks to the pidash backend (docs/API.md): REST calls, the sign-in session and the /api/ws stream.
import { store } from './util.js'

let demo = null

/** Swaps the network for the in-browser demo (src/mock.js). Only used with ?demo. */
export async function useDemo() {
  demo = await import('./mock.js')
  demo.start()
}
export const isDemo = () => demo != null

const listeners = new Set()
/** Whether this browser is signed in. The session cookie is HttpOnly, so the page learns it from GET /api/auth. */
export const auth = {
  signedIn: false,
  set(on) {
    if (on === this.signedIn) return
    this.signedIn = on
    for (const f of listeners) f()
  },
  onChange: (f) => listeners.add(f),
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api(path, { method = 'GET', body, timeout } = {}) {
  // The browser sends the session cookie by itself; the header shows the request comes from this page (API.md "Auth")
  const headers = { 'X-Pidash-CSRF': '1' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: timeout ? AbortSignal.timeout(timeout) : undefined }
  let res
  try {
    res = await (demo ? demo.fetch(path, init) : fetch(path, init))
  } catch {
    throw new ApiError(0, 'network', 'Can’t reach the Pi. Check the connection and try again.')
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (res.status === 401) auth.set(false)
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `http_${res.status}`, data?.message ?? `Request failed (HTTP ${res.status})`)
  return data
}

export async function login(token) {
  await api('/api/auth/login', { method: 'POST', body: { token } })
  auth.set(true)
}

export async function logout() {
  await api('/api/auth/logout', { method: 'POST' })
  auth.set(false)
}

/** Asks the Pi whether this browser is signed in. A token that older versions kept in local storage is traded for a
 *  session once, then forgotten. */
export async function checkAuth() {
  const old = store.read('pidash.token')
  if (old) {
    store.write('pidash.token', null)
    await login(old).catch(() => {})
  }
  try {
    await api('/api/auth')
    auth.set(true)
  } catch (e) {
    if (e.status) auth.set(false) // 401, or 403 with no token configured; a network error tells nothing
  }
}

/**
 * Keeps one WebSocket open to /api/ws. A connection that stays silent for 5 s is treated as stale:
 * it is dropped and reopened with backoff (1 s, 2 s, 4 s … 10 s), as docs/API.md asks.
 * onStatus receives {state: 'connecting' | 'live' | 'offline', retryAt?, attempt}.
 */
export function connect({ onMessage, onStatus }) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`
  let ws = null
  let attempt = 0
  let stale = 0
  let retry = 0
  let last = 0

  function open() {
    clearTimeout(retry)
    onStatus({ state: 'connecting', attempt })
    try {
      ws = demo ? demo.socket() : new WebSocket(url)
    } catch {
      drop()
      return
    }
    ws.onmessage = (ev) => {
      arm()
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'hello') {
        attempt = 0
        onStatus({ state: 'live', attempt })
      }
      onMessage(msg)
    }
    ws.onclose = drop
    ws.onerror = drop
    arm() // also bounds a handshake that never completes
  }

  function arm() {
    clearTimeout(stale)
    last = performance.now()
    stale = setTimeout(check, 5000)
  }

  // A long main-thread stall (e.g. compiling the 3D scene on a slow GPU) delays this timer and the queued
  // messages alike; give queued messages one more turn before declaring the link stale.
  function check() {
    const idle = performance.now() - last
    if (idle < 5000) stale = setTimeout(check, 5000 - idle)
    else stale = setTimeout(() => (performance.now() - last >= 5000 ? drop() : arm()), 150)
  }

  function drop() {
    if (!ws) return
    const w = ws
    ws = null
    w.onopen = w.onmessage = w.onclose = w.onerror = null
    try {
      w.close()
    } catch {
      /* already closed */
    }
    clearTimeout(stale)
    const delay = Math.min(10000, 1000 * 2 ** attempt)
    attempt++
    onStatus({ state: 'offline', retryAt: Date.now() + delay, attempt })
    retry = setTimeout(open, delay)
  }

  open()
  return {
    retryNow() {
      if (!ws) open()
    },
  }
}
