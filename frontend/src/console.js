// The Console card (#console): a shell on the Pi in xterm.js, over the WebSocket /api/console/ws.
// Contract: docs/API.md "Console". xterm.js is bundled (no CDN: the page works with no internet) and loaded only
// on the first Connect, so the dashboard itself stays as light as before.
import { Lock, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide'
import { api, auth, isDemo } from './net.js'
import { refs, badge, ico, fmt, prefs, copyText } from './util.js'

const MONO = "ui-monospace, 'JetBrains Mono', 'Cascadia Mono', 'DejaVu Sans Mono', 'Liberation Mono', Menlo, Consolas, monospace"
// the board's own colours: silkscreen text on the field, a gold cursor, LED colours for the ANSI ones
const THEME = {
  background: '#07110d',
  foreground: '#e3e8e0',
  cursor: '#d9b35d',
  cursorAccent: '#1c1505',
  selectionBackground: '#d9b35d55',
  selectionInactiveBackground: '#d9b35d33',
  scrollbarSliderBackground: '#1d3d3199',
  scrollbarSliderHoverBackground: '#1d3d31',
  scrollbarSliderActiveBackground: '#2a5646',
  black: '#1d3d31',
  red: '#ff5f55',
  green: '#45d983',
  yellow: '#d9b35d',
  blue: '#8fb8c8',
  magenta: '#c99bd0',
  cyan: '#6fc3d1',
  white: '#b3bfb6',
  brightBlack: '#8a9a90',
  brightRed: '#ff8a82',
  brightGreen: '#7fe8a9',
  brightYellow: '#f0cf7e',
  brightBlue: '#b7d4df',
  brightMagenta: '#e0bde4',
  brightCyan: '#a3dde6',
  brightWhite: '#edf0e8',
}
// what a touch keyboard lacks; arrows follow the terminal's cursor-key mode (vim, less, htop switch it)
const KEYS = [
  ['esc', 'Esc', 'Escape'],
  ['tab', 'Tab', 'Tab'],
  ['ctrl', 'Ctrl', 'Control: the next key you type is sent with Ctrl'],
  ['D', ArrowLeft, 'Left'],
  ['A', ArrowUp, 'Up'],
  ['B', ArrowDown, 'Down'],
  ['C', ArrowRight, 'Right'],
]

export function createConsole({ root, requireAuth, toast, canChange, info }) {
  const R = refs(root)
  const coarse = matchMedia('(pointer: coarse)')
  const enc = new TextEncoder()
  let term = null
  let fit = null
  let ws = null
  let state = 'idle' // idle | connecting | open | closed
  let why = '' // what the cover says after a session
  let tone = 'off'
  let ctrl = false

  R.keys.innerHTML = KEYS.map(([k, label, name]) =>
    `<button type="button" class="pad pad-ghost" data-k="${k}" aria-label="${name}"${k === 'ctrl' ? ' aria-pressed="false"' : ''}>${typeof label === 'string' ? label : ico(label)}</button>`,
  ).join('')

  function unavailable() {
    if (isDemo()) return 'The in-browser demo has no shell. Open the dashboard from a Pi running pidash to use the console.'
    const i = info()
    if (!i) return 'Waiting for the Pi…'
    const gate = canChange()
    if (!gate.configured) return gate.why
    if (!i.console_enabled)
      return i.mock
        ? 'The console is off in mock mode: it would be a real shell on this machine. Start pidash with PIDASH_CONSOLE=1 to try it.'
        : 'The console is turned off on this Pi (PIDASH_CONSOLE=0 in /etc/pidash/pidash.env).'
    return ''
  }

  // ---------------------------------------------------------------- terminal

  async function makeTerm() {
    if (term) return
    const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/xterm/css/xterm.css')])
    term = new Terminal({
      fontFamily: MONO,
      fontSize: innerWidth < 520 ? 12 : 13,
      lineHeight: 1.15,
      cursorBlink: prefs.animate,
      cursorInactiveStyle: 'outline',
      scrollback: 3000,
      macOptionIsMeta: true,
      theme: THEME,
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(R.term)
    term.textarea?.setAttribute('aria-label', 'Console: type commands for the Pi')
    term.onData((d) => {
      if (ctrl && d.length === 1) {
        // the latched Ctrl from the key strip: a → \x01 … z → \x1a, [ → Esc
        const c = d.toUpperCase().charCodeAt(0)
        if (c >= 64 && c <= 95) d = String.fromCharCode(c - 64)
        setCtrl(false)
      }
      send(enc.encode(d))
    })
    term.onBinary((d) => send(Uint8Array.from(d, (c) => c.charCodeAt(0))))
    term.onResize(() => {
      resize()
      showSize()
    })
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      // Shift+Tab leaves the terminal, so the keyboard is never trapped in it
      if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey) return false
      // Ctrl+Shift+C copies the selection (Ctrl+C is the shell's interrupt); Ctrl+Shift+V pastes (the browser's own)
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
        e.preventDefault()
        // the fallback copy (plain http has no clipboard API) selects a hidden field: give the focus back after
        if (term.hasSelection()) copyText(term.getSelection()).then(() => term.focus())
        return false
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') return false
      return true
    })
    // fit to the box: on layout changes, and the phone's keyboard or rotation
    new ResizeObserver(() => requestAnimationFrame(refit)).observe(R.box)
  }

  function refit() {
    if (term && R.box.offsetParent) fit.fit()
  }

  function send(bytes) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(bytes)
  }
  function resize() {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
  }
  function showSize() {
    R.size.textContent = term ? `${term.cols}\u00a0×\u00a0${term.rows}` : ''
  }

  // ---------------------------------------------------------------- session

  function connect() {
    if (state === 'connecting' || state === 'open' || unavailable()) return
    return requireAuth(async () => {
      set('connecting')
      try {
        await api('/api/auth') // a refused handshake only shows as 1006: a 401 here asks to sign in first
        await makeTerm()
      } catch (e) {
        set('closed', e.status === 401 ? 'Sign in to connect.' : `Couldn’t connect: ${e.message}`, 'warn')
        throw e
      }
      term.reset()
      open()
    }, (e) => toast('bad', `Couldn’t open the console: ${e.message}`))
  }

  function open() {
    const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/console/ws`)
    sock.binaryType = 'arraybuffer'
    let opened = false
    ws = sock
    sock.onopen = () => {
      opened = true
      set('open')
      refit()
      resize()
      showSize()
      term.focus()
    }
    sock.onmessage = (e) => typeof e.data !== 'string' && term.write(new Uint8Array(e.data))
    sock.onclose = (e) => {
      if (ws !== sock) return // replaced by a newer session
      ws = null
      ended(e, opened)
    }
  }

  async function ended(e, opened) {
    const r = e.reason
    let msg
    let t = 'warn'
    if (e.code === 1000 && r.startsWith('shell ')) {
      msg = `The session ended: ${r.replace(/^shell /, 'the shell ')}.`
      t = 'off'
    } else if (e.code === 4408) {
      const s = Number(/(\d+) s/.exec(r)?.[1])
      msg = `Closed after ${s ? fmt.dur(s) : 'a while'} without input.`
      t = 'off'
    } else if (e.code === 4429) msg = 'Three console sessions are open already, in other tabs or on other devices. Close one of them, then reconnect.'
    else if (e.code === 1012) msg = 'pidash restarted (an update or a service restart), and that ended the session.'
    else if (e.code === 1011) msg = `The shell couldn’t start on the Pi: ${r.replace(/^could not start the shell: /, '')}`
    else if (e.code === 1003) msg = `The Pi closed the session: ${r || 'it got a message it didn’t expect'}.`
    else if (opened) msg = 'The connection dropped: the Pi, pidash or the network went away. The shell on the Pi was closed with it.'
    else msg = await refused()
    set('closed', msg, t)
    if (t !== 'off') toast(t === 'bad' ? 'bad' : 'warn', `Console: ${msg}`)
  }

  /** A refused handshake is HTTP 403, which the browser only sees as 1006: ask the API why. */
  async function refused() {
    try {
      const i = await api('/api/info', { timeout: 5000 })
      if (!i.console_enabled) return 'The console is turned off on this Pi.'
      await api('/api/auth', { timeout: 5000 })
      return 'The Pi refused the connection. If you reach the dashboard through a proxy, it must pass WebSockets on with their Origin.'
    } catch (e) {
      return e.status === 401 ? 'Your sign-in has expired. Sign in again, then reconnect.' : 'Can’t reach the Pi. Check the connection, then reconnect.'
    }
  }

  function disconnect(msg = 'You disconnected. The shell on the Pi was closed.') {
    if (!ws) return
    const sock = ws
    ws = null
    sock.close(1000)
    set('closed', msg, 'off')
  }

  function setCtrl(on) {
    ctrl = on
    R.keys.querySelector('[data-k=ctrl]').setAttribute('aria-pressed', String(on))
  }
  R.keys.addEventListener('mousedown', (e) => e.preventDefault()) // keep the focus, and the phone's keyboard, in the terminal
  R.keys.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k
    if (!k || !term) return
    if (k === 'ctrl') setCtrl(!ctrl)
    else if (k === 'esc') send(enc.encode('\x1b'))
    else if (k === 'tab') send(enc.encode('\t'))
    else send(enc.encode(`\x1b${term.modes.applicationCursorKeysMode ? 'O' : '['}${k}`))
    term.focus()
  })

  // ---------------------------------------------------------------- render

  function set(next, msg = why, t = tone) {
    const inside = root.contains(document.activeElement)
    state = next
    why = msg
    tone = t
    render()
    // the terminal or Disconnect had the focus and went away: Reconnect takes it
    const at = document.activeElement
    if (next === 'closed' && inside && (R.box.contains(at) || !root.contains(at))) R.connect.focus()
  }

  function render() {
    const off = unavailable()
    const open = state === 'open'
    root.dataset.state = state
    R.cover.hidden = open
    R.disconnect.hidden = !open
    R.size.hidden = !open
    R.keys.hidden = !open || !coarse.matches
    const [t, label] = open
      ? ['ok', 'Connected']
      : state === 'connecting'
        ? ['info', 'Connecting…']
        : state === 'closed'
          ? [tone, 'Disconnected']
          : ['off', 'Not connected']
    badge(R.state, t, label)
    R['cover-msg'].textContent = off || (state === 'connecting' ? 'Opening a shell on the Pi…' : state === 'closed' ? why : 'Opens a bash shell on the Pi, as the pidash user, inside the service’s sandbox. It closes when you disconnect or leave the page.')
    const lock = !off && !auth.signedIn
    const html = `${lock ? ico(Lock) : ''}<span>${state === 'closed' ? 'Reconnect' : 'Connect'}</span>`
    if (R.connect._h !== html) R.connect.innerHTML = R.connect._h = html
    R.connect.hidden = !!off
    R.connect.disabled = !!off || state === 'connecting'
    R.connect.toggleAttribute('data-busy', state === 'connecting')
    R.connect.title = lock ? 'Sign in first: the console needs the token' : ''
  }

  R.connect.addEventListener('click', connect)
  R.disconnect.addEventListener('click', () => disconnect())
  coarse.addEventListener('change', render)
  render()

  return {
    setInfo: render,
    authChanged() {
      if (!auth.signedIn && ws) disconnect('You signed out, which closed the session.')
      render()
    },
    disconnect,
  }
}
