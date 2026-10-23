// pidash dashboard: connection, state, and every panel. Contract: docs/API.md.
import './styles/index.css'
import { TriangleAlert, ChevronRight, Lock, LockOpen, X } from 'lucide'
import { auth, login, logout, checkAuth, connect, useDemo, isDemo, ApiError } from './link/net.js'
import { clock, invalidateCharts, setWake } from './ui/charts.js'
import { createStage } from './board/stage.js'
import { createFan } from './sections/fan/fan.js'
import { createSystem } from './sections/system/system.js'
import { createConsole } from './sections/console.js'
import { createLogs } from './sections/services/logs.js'
import { verdict, STALE_S } from './health/verdict.js'
import { RENDERS, derive } from './sections/sections.js'
import { CALLOUTS } from './board/board.js'
import { prefs, onReducedChange } from './ui/prefs.js'
import { fmt } from './ui/format.js'
import { el, setText, esc, ico, badgeHTML } from './ui/dom.js'
import { rampGradient, T_MIN, T_MAX, clamp } from './ui/palette.js'
import { $, bind, section } from './ui/dom.js'
import { S, applyHistory, appendHistory, dataAge } from './shell/state.js'
import { dirty, wake, RENDER } from './shell/loop.js'
import { createCpu } from './sections/cpu.js'
import { createThermals } from './sections/thermals.js'
import { createPower } from './sections/power.js'
import { createMemory } from './sections/memory.js'
import { createStorage } from './sections/storage.js'
import { createNetwork } from './sections/network.js'
import { createServices, canRestart } from './sections/services/services.js'
import { createContainers } from './sections/containers.js'
import { createTailnet } from './sections/tailnet.js'

// ================================================================== auth

/** Whether the fan controls can work at all, and why not. Signing in is asked for only when a change is made. */
function canChange() {
  if (!S.info) return { configured: false, waiting: true, why: 'Waiting for the Pi…' }
  if (!S.info.auth_configured)
    return {
      configured: false,
      why: 'Changes are off: set PIDASH_TOKEN on the Pi and restart pidash to turn them on. Reading works as usual.',
    }
  return { configured: true, why: '' }
}

const dlg = bind('login')
const dlgToken = bind('login-token')
const dlgErr = bind('login-error')
const dlgSubmit = bind('login-submit')
const dlgReveal = bind('login-reveal')
let pending = null

/** The token typed on a phone keyboard can be read back before it is sent (#12). */
function revealToken(on) {
  dlgToken.type = on ? 'text' : 'password'
  dlgReveal.textContent = on ? 'Hide token' : 'Show token'
  dlgReveal.setAttribute('aria-pressed', String(on))
}
dlgReveal.addEventListener('click', () => {
  revealToken(dlgToken.type === 'password')
  dlgToken.focus()
})

/** Opens a modal dialog and gives focus back to what had it once the dialog closes. */
function showDialog(d, focus) {
  const back = document.activeElement
  d.addEventListener(
    'close',
    () => back?.isConnected && !document.querySelector('dialog[open]') && back.focus({ preventScroll: true }),
    { once: true },
  )
  d.showModal()
  focus?.focus()
}

function openLogin(reason) {
  dlgErr.hidden = true
  dlgToken.value = ''
  revealToken(false)
  if (reason) {
    dlgErr.hidden = false
    dlgErr.innerHTML = `${ico(TriangleAlert)}<span>${esc(reason)}</span>`
  }
  if (isDemo()) bind('login-why').textContent = 'Demo mode: the token is “demo”. Reading needs no sign-in; changes do.'
  showDialog(dlg, dlgToken)
}

bind('login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const token = dlgToken.value.trim()
  if (!token) return
  // hidden again once sent, so a refusal's "Check it with Show token" names the button as it then reads
  revealToken(false)
  dlgSubmit.dataset.busy = ''
  dlgSubmit.disabled = true
  try {
    await login(token)
    dlg.close()
    const p = pending
    pending = null
    p?.resolve()
  } catch (err) {
    dlgErr.hidden = false
    const msg =
      err.status === 401
        ? 'That token isn’t right. Check it with Show token, or ask whoever set up the Pi. On the Pi, sudo grep TOKEN /etc/pidash/pidash.env shows it.'
        : err.status === 403 && err.code === 'auth_not_configured'
          ? 'Changes are turned off on the Pi (no PIDASH_TOKEN set).'
          : err.message
    dlgErr.innerHTML = `${ico(TriangleAlert)}<span>${esc(msg)}</span>`
    dlgToken.select()
  } finally {
    delete dlgSubmit.dataset.busy
    dlgSubmit.disabled = false
  }
})
bind('login-cancel').addEventListener('click', () => dlg.close())
dlg.addEventListener('close', () => {
  if (pending) {
    pending.reject(null)
    pending = null
  }
})

/** Runs `fn()` signed in, asking for the token first when needed. A 401 (the session expired, or the token changed on
 *  the Pi) asks again and retries once. */
async function requireAuth(fn, onError) {
  const signIn = (reason) =>
    new Promise((resolve, reject) => {
      pending = { resolve, reject }
      openLogin(reason)
    })
  try {
    if (!auth.signedIn) await signIn()
  } catch {
    return
  }
  try {
    await fn()
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) return onError?.(err)
    try {
      await signIn('Your sign-in has expired or the token changed. Sign in again to finish.')
      await fn()
    } catch (err2) {
      if (err2) onError?.(err2)
    }
  }
}

// ------------------------------------------------------------------ confirm dialog, toasts

const cfm = bind('confirm')
/** Asks before a destructive action: {title, body, warn?, ok}. Resolves true when confirmed. Cancel has the focus, so
 *  Enter or Escape right away never confirms. */
function ask({ title, body, warn, ok }) {
  bind('confirm-h').textContent = title
  bind('confirm-body').innerHTML =
    `<p>${esc(body)}</p>${warn ? `<p class="notice notice-warn">${ico(TriangleAlert)}<span>${esc(warn)}</span></p>` : ''}`
  bind('confirm-ok').textContent = ok
  cfm.returnValue = ''
  showDialog(cfm, bind('confirm-cancel'))
  return new Promise((resolve) =>
    cfm.addEventListener('close', () => resolve(cfm.returnValue === 'ok'), { once: true }),
  )
}

/** Signs in if needed, asks `q` (a confirm, or null), then runs `fn()`. A retry after signing in again doesn't ask twice. */
function privileged(q, fn, onError) {
  return requireAuth(async () => {
    if (q && !(await ask(q))) return
    q = null
    await fn()
  }, onError)
}

const toasts = bind('toasts')
/** A message in the corner: tone ok | info | warn | bad. Errors stay until dismissed, the rest go after 6 s (not while
 *  hovered). `action`: {label, fn}, the next step the outcome offers, as a text button under the sentence; using it
 *  closes the toast. Returns {set(msg), close()}. */
function toast(tone, msg, { sticky = tone === 'bad', busy = false, action = null } = {}) {
  const t = el(`<div class="toast" data-tone="${tone}"${tone === 'bad' ? ' role="alert"' : ''}>${badgeHTML()}<p></p>
    <button class="toast-x" type="button" aria-label="Dismiss">${ico(X)}</button></div>`)
  if (action) {
    const b = el(`<button class="textbtn toast-act" type="button">${esc(action.label)}</button>`)
    b.addEventListener('click', () => {
      close()
      action.fn()
    })
    t.append(b)
  }
  t.querySelector('.badge').dataset.tone = tone
  t.toggleAttribute('data-busy', busy)
  const text = t.querySelector('p')
  text.textContent = msg
  let timer = 0
  const close = () => {
    clearTimeout(timer)
    t.remove()
  }
  const arm = (ms) => {
    clearTimeout(timer)
    if (!sticky) timer = setTimeout(close, ms)
  }
  t.querySelector('.toast-x').addEventListener('click', close)
  t.addEventListener('pointerenter', () => clearTimeout(timer))
  t.addEventListener('pointerleave', () => arm(3000))
  while (toasts.children.length >= 4) toasts.firstElementChild.remove()
  toasts.append(t)
  arm(6000)
  return {
    set: (m) => text.textContent !== m && (text.textContent = m),
    close,
  }
}

const signin = bind('signin')
const lockState = bind('lock-state')
lockState.innerHTML = `${ico(LockOpen)}<span>Unlocked</span>`
function renderAuth() {
  const on = auth.signedIn
  const configured = S.info ? S.info.auth_configured : true
  // on a small phone the pad is its padlock alone (style.css): closed and gold to sign in, open and ghost to sign out
  signin.innerHTML = on ? `${ico(LockOpen, 'only-xs')}<span>Sign out</span>` : `${ico(Lock)}<span>Sign in</span>`
  signin.classList.toggle('pad-ghost', on)
  signin.hidden = !configured
  signin.title = on
    ? 'Changes and the console need the token again after this'
    : 'Sign in with the token to make changes and use the console'
  lockState.hidden = !on || !configured
  lockState.title = 'Signed in: this browser can make changes and open the console'
  fanUI.authChanged()
  sysUI.authChanged()
  conUI.authChanged()
  if (S.m.services) dirty.add('services')
  wake()
}
signin.addEventListener('click', async () => {
  if (!auth.signedIn) return requireAuth(async () => {})
  try {
    await logout()
    conUI.disconnect('You signed out, which closed the session.')
  } catch (e) {
    toast('bad', `Couldn’t sign out: ${e.message}`)
  }
})
auth.onChange(renderAuth)

// ================================================================== header, nav, markings

const linkEl = $('.link-state')
const linkText = bind('link')
const linkMore = bind('link-more')
const retry = bind('retry')
let conn = null
let retryTimer = 0
// No contact follows the age of the newest data, on every message and every second offline, never the link alone: a
// reconnect replays the server's last snapshot, which can be older than STALE_S (plan GAP-2). The dimming keeps
// following the link
function updateStale() {
  document.body.toggleAttribute('data-stale', S.link !== 'live' && !!S.m.ts)
  const stale = dataAge() >= STALE_S
  if (stale === S.stale) return
  S.stale = stale
  fanUI.setStale(stale)
}

function setLink(st) {
  S.link = st.state
  linkEl.dataset.state = st.state
  clearInterval(retryTimer)
  retry.hidden = st.state !== 'offline'
  updateStale()
  const down = st.state === 'offline' || (st.state === 'connecting' && st.attempt > 0)
  linkText.textContent = st.state === 'live' ? 'Live' : down ? 'Offline' : 'Connecting…'
  linkMore.textContent = ''
  if (st.state === 'live') return
  const tick = () => {
    const age = S.lastTs ? dataAge() : null
    if (st.state === 'offline')
      linkMore.textContent = `${age != null ? `, data ${fmt.dur(age, true)} old` : ''} · retry in ${Math.max(0, Math.ceil((st.retryAt - Date.now()) / 1000))}\u00a0s`
    else if (st.attempt) linkMore.textContent = ' · reconnecting…'
    updateStale()
    // directly, not through a frame: a background tab gets no frames, and its title and icon are where this shows
    if (S.stale) renderVerdict()
  }
  tick()
  retryTimer = setInterval(tick, 1000)
}
retry.addEventListener('click', () => conn?.retryNow())

function renderHeader() {
  const i = S.info
  const m = S.m
  if (i) {
    setText(bind('hostname'), i.hostname)
    setText(bind('model'), i.model)
  }
  setText(bind('uptime'), fmt.dur(m.system?.uptime_s))
  setText(bind('load'), m.cpu ? m.cpu.load_avg.map((v) => v.toFixed(2)).join(' · ') : null)
}

function renderMarkings() {
  const i = S.info
  if (!i) return
  const rows = [
    ['Model', i.model],
    ['CPU', `${i.cpu.cores} × ${i.cpu.model}, ${fmt.mhz(i.cpu.min_mhz)}–${fmt.mhz(i.cpu.max_mhz)}`],
    ['Memory', fmt.bytes(i.memory_total_bytes)],
    ['OS', i.os],
    ['Kernel', `${i.kernel} (${i.arch})`],
    ['Booted', fmt.date(i.boot_time)],
    ['pidash', `app ${i.app_version} · API v${i.api_version}${i.mock ? ' · mock data' : ''}`],
  ]
  bind('markings').innerHTML = rows
    .map(([k, v]) => `<div${k === 'CPU' ? ' class="wide"' : ''}><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
    .join('')
}

// section nav: scroll spy + number keys.
// The lit tab is the section whose top last crossed a line 40 % down the viewport, and it changes only when that
// pick does. Cards side by side in the grid cross together: the first in nav order wins. At the very end of the page
// the last section wins, as the last row may never reach the line.
// A jump (a link to a section, a number key, a part picked on the board) lights its target and holds it until the
// user's next press, key or wheel turn: a smooth jump passes other sections on its way, and where a jump comes to
// rest the line can be on the card beside the target, or below a target in the last row.
// ponytail: any press ends the hold, even one that doesn't scroll; if a later layout shift then moves a section across
// the line, the light follows it. Upgrade: end the hold only on a scroll soon after the user's input.
const navLinks = [...document.querySelectorAll('.fingers a')]
const fingers = $('.fingers')
const navSections = navLinks.map((a) => document.querySelector(a.hash)).filter(Boolean)
const sectionOf = (hash) => navSections.find((s) => `#${s.id}` === hash)
let line = innerHeight * 0.4 // px from the top of the viewport, where the spy's root ends
let atEnd = false // the page's last line is on screen
let current = null
let pick = null
let held = false
function setCurrent(sec) {
  if (sec === current) return
  current = sec
  for (const a of navLinks) {
    const on = sec != null && a.hash === `#${sec.id}`
    a.setAttribute('aria-current', String(on))
    // on a narrow screen the strip scrolls sideways: keep the current section's tab in view
    if (on && fingers.scrollWidth > fingers.clientWidth)
      fingers.scrollTo({ left: a.offsetLeft - 24, behavior: prefs.reduced ? 'auto' : 'smooth' })
  }
}
function follow(force = false) {
  let next = navSections[navSections.length - 1]
  if (!atEnd || scrollY <= 0) {
    const tops = navSections.map((s) => s.getBoundingClientRect().top)
    const top = Math.max(...tops.filter((t) => t <= line))
    next = navSections.find((s, i) => tops[i] <= line && tops[i] >= top - 1) ?? null // null: above the first section
  }
  if (next === pick && !force) return
  pick = next
  if (!held) setCurrent(next)
}
function jumped(sec) {
  setCurrent(sec)
  held = true
}
// The user's own input ends a hold, in the capture phase: before the click or key that makes the next jump. The page
// scrolling by itself, as a jump glides or live readings change height, doesn't
for (const t of ['pointerdown', 'wheel', 'keydown'])
  addEventListener(t, () => (held = false), { capture: true, passive: true })
// the spy's root is the top 40 % of the viewport: a section enters or leaves it as its top crosses the line
const spy = new IntersectionObserver(
  (entries) => {
    line = entries[0].rootBounds?.bottom ?? line
    follow()
  },
  { rootMargin: '0px 0px -60% 0px' },
)
for (const s of navSections) spy.observe(s)
new IntersectionObserver((entries) => {
  atEnd = entries[entries.length - 1].isIntersecting
  follow()
}).observe($('.markings .fine'))
document.addEventListener('click', (e) => {
  const sec = sectionOf(e.target.closest?.('a[href^="#"]')?.hash)
  if (sec && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) jumped(sec)
})
// back and forward restore an older scroll position with no input the page can see
addEventListener('hashchange', () => {
  const sec = sectionOf(location.hash)
  if (held && sec === current) return // this page's own jump
  held = false
  const r = sec?.getBoundingClientRect()
  if (r && r.top <= line && r.bottom > line)
    jumped(sec) // back where the jump to it came to rest
  else follow(true)
})
// opened on a link into a section, the page starts there (a reload restores the old scroll position instead)
if (performance.getEntriesByType('navigation')[0]?.type === 'navigate' && sectionOf(location.hash))
  jumped(sectionOf(location.hash))
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return
  const t = e.target
  if (t.closest?.('input, textarea, select, [contenteditable], .curve')) return
  if (e.key === '/') {
    e.preventDefault()
    services.focusSearch()
    return
  }
  // F: the fan profile pads, the fastest way to change the fan (arrow keys then move between them)
  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault()
    fanUI.focusPads()
    return
  }
  // the keycaps follow the keyboard's number row: 1–0, then - and =
  const i = '1234567890-='.indexOf(e.key)
  if (i < 0 || !navLinks[i]) return
  const target = document.querySelector(navLinks[i].hash)
  if (!target) return
  e.preventDefault()
  jumped(target)
  target.scrollIntoView({ behavior: prefs.reduced ? 'auto' : 'smooth', block: 'start' })
  const h = target.querySelector('h2')
  if (h) {
    h.tabIndex = -1
    h.focus({ preventScroll: true })
  }
  history.replaceState(null, '', navLinks[i].hash)
})

// ================================================================== health verdict

const verdictBox = $('.verdict')
const checksEl = bind('checks')
const favicon = bind('favicon')
let offIcon = '/favicon-off.svg'
// The rules live in verdict.js (GLOSSARY "Health"); this paints them. No contact comes from the data age, not the link
// state: a reconnect replays the server's last snapshot, which may be old (plan GAP-2)
function renderVerdict() {
  const v = verdict({
    m: S.m,
    limits: S.info?.limits ?? {},
    hostname: S.info?.hostname,
    now: Date.now() / 1000 + S.offsetS,
    ageS: dataAge(),
    last: S.last,
    pi: sysUI.state(), // 'rebooting' | 'off' | null: the System card knows why the Pi is gone
  })
  if (!v) return
  verdictBox.dataset.tone = v.level
  stage.health(v.parts) // under No contact, none: nothing on the board is known now
  if (v.level === 'off') fanUI.setStale(true) // nor the fan: its LED goes out with the board's
  setText(bind('verdict'), v.headline)
  // the browser tab carries the verdict too: pidash lives in a tab, and the tab strip is where a glance lands
  if (document.title !== v.title) document.title = v.title
  const icon = v.level === 'off' ? offIcon : v.level === 'ok' ? '/favicon.svg' : `/favicon-${v.level}.svg`
  if (favicon.getAttribute('href') !== icon) favicon.setAttribute('href', icon)
  S.last = v.last ?? S.last
  const html = v.rows
    .map((c) =>
      c.retry
        ? `<li><span class="check" data-tone="${c.level}">${badgeHTML('', '')}<span class="check-body"><span class="check-text">${esc(c.text)}</span><span class="check-next">${esc(c.next)}</span></span><button class="textbtn" type="button" data-retry>Retry now</button></span></li>`
        : `<li><a class="check" href="${c.href}" data-tone="${c.level}"${c.part ? ` data-part="${[].concat(c.part)[0]}"` : ''}>${badgeHTML('', '')}<span class="check-body"><span class="check-text">${esc(c.text)}</span>${c.next && c.level !== 'ok' ? `<span class="check-next">${esc(c.next)}</span>` : ''}</span>${ico(ChevronRight, 'check-go')}</a></li>`,
    )
    .join('')
  const list = checksEl
  if (list._html !== html) {
    list._html = html
    list.innerHTML = html
    for (const a of list.querySelectorAll('.check')) {
      a.querySelector('.badge').dataset.tone = a.dataset.tone
      a.toggleAttribute('data-lit', !!hoverPart && a.dataset.part === hoverPart)
    }
  }
}
checksEl.addEventListener('click', (e) => e.target.closest('[data-retry]') && conn?.retryNow())

// ================================================================== stage (3D board) and fan

const stageRoot = bind('stage')
const lp = bind('lowpower')
let hoverPart = null
const partSections = new Map()
for (const s of document.querySelectorAll('[data-part]')) {
  if (s.tagName !== 'SECTION') continue
  const list = partSections.get(s.dataset.part) || []
  list.push(s)
  partSections.set(s.dataset.part, list)
}
function lightPart(part) {
  if (part === hoverPart) return
  hoverPart = part
  stage.light(part)
  for (const [p, list] of partSections) for (const s of list) s.toggleAttribute('data-lit', p === part)
  for (const a of checksEl.querySelectorAll('.check')) a.toggleAttribute('data-lit', !!part && a.dataset.part === part)
}
const stage = createStage(stageRoot, {
  onHover: lightPart,
  onPick(part) {
    const sec = sectionOf(CALLOUTS.find((c) => c.part === part)?.href)
    if (!sec) return
    jumped(sec)
    sec.scrollIntoView({ behavior: prefs.reduced ? 'auto' : 'smooth', block: 'start' })
  },
  onNoWebGL() {
    // no WebGL here: the 2D drawing stays, and the switch says so
    lp.setAttribute('aria-checked', 'true')
    lp.disabled = true
    lp.title = 'This browser can’t show the 3D view, so the 2D drawing is used'
  },
})
// sections light their part on the board while hovered: the net in focus burns brightest
// A verdict reason lights its part as well (board, callout, section), and a lit part underlines its reasons
const reasonPart = (e) => lightPart(e.target.closest('.check')?.dataset.part ?? null)
checksEl.addEventListener('pointerover', reasonPart)
checksEl.addEventListener('focusin', reasonPart)
checksEl.addEventListener('pointerleave', () => lightPart(null))
checksEl.addEventListener('focusout', () => lightPart(null))
// index.html data-part names each section's part; the fan controls (no id) are not a hover target
for (const s of document.querySelectorAll('section[id][data-part]')) {
  const part = s.dataset.part
  s.addEventListener('pointerenter', () => lightPart(part))
  s.addEventListener('pointerleave', () => lightPart(null))
}
bind('scale-min').textContent = `${T_MIN}\u00a0°C`
bind('scale-max').textContent = `${T_MAX}\u00a0°C`
$('.scale-bar').style.background = rampGradient()

const fanUI = createFan({
  hero: $('.fanctl'),
  editor: document.getElementById('fan'),
  requireAuth,
  canChange,
  history: () => S.hist,
})
const sysUI = createSystem({
  root: document.getElementById('system'),
  privileged,
  toast,
  canChange,
  info: () => S.info,
  // mock mode only pretends to reboot: nothing goes away, so there is nothing to wait for
  pretendReboot: () => isDemo() || !!S.info?.mock,
  // back after a reboot: reconnect now instead of at the next backoff step; the replay reloads every panel
  onBack: () => conn?.retryNow(),
})
const conUI = createConsole({
  root: document.getElementById('console'),
  requireAuth,
  toast,
  canChange,
  info: () => S.info,
})
const logsUI = createLogs({
  dialog: bind('logs'),
  requireAuth,
  toast,
  showDialog,
  canRestart: (name) => canRestart(name) && canChange().configured,
  restart: (name) => services.restartUnit(name),
})

// low power / 3D toggle
function applyMotion() {
  lp.setAttribute('aria-checked', String(prefs.lowPower))
  document.documentElement.toggleAttribute('data-lowpower', prefs.lowPower)
  stage.setMode(prefs.lowPower ? '2d' : '3d')
  invalidateCharts()
}
lp.addEventListener('click', () => {
  prefs.setLowPower(!prefs.lowPower)
  applyMotion()
  wake()
  // the switch's reason lives in its title, which a touch screen never shows: say it once it is on
  if (prefs.lowPower)
    toast(
      'info',
      '2D board: the board is drawn flat and nothing moves, so the page is lighter on this device. The Pi is unaffected.',
    )
})
onReducedChange(() => {
  stage.refresh()
  invalidateCharts()
  wake()
})

const cpu = createCpu()
const thermals = createThermals()
const power = createPower()
const memory = createMemory()
const storage = createStorage()
const network = createNetwork()

const services = createServices({ privileged, toast, logsUI, canChange })

const containers = createContainers()
const tailnet = createTailnet()

// ================================================================== render loop

// Two-column masonry (style.css .grid): each section spans as many 4px rows as its height needs,
// so a short section never leaves a hole beside a tall one. Below 1100px the grid is a flex column.
{
  const grid = $('.grid')
  const svcWrap = $('#services .table-wrap')
  const moreHint = () =>
    svcWrap.toggleAttribute('data-more', svcWrap.scrollHeight - svcWrap.scrollTop - svcWrap.clientHeight > 4)
  svcWrap.addEventListener('scroll', moreHint, { passive: true })
  const fit = () => {
    const flat = getComputedStyle(grid).display !== 'grid'
    const gap = parseFloat(getComputedStyle(grid).getPropertyValue('--vgap')) || 52
    for (const s of grid.children) {
      const span = flat ? '' : `span ${Math.ceil((s.getBoundingClientRect().height + gap) / 4)}`
      if (s.style.gridRowEnd !== span) s.style.gridRowEnd = span
    }
    // balance the columns: the services list takes the room the right column leaves below the left one
    if (flat) svcWrap.style.maxHeight = ''
    else {
      const bottom = (sel) => Math.max(...[...grid.querySelectorAll(sel)].map((s) => s.offsetTop + s.offsetHeight))
      const cur = parseFloat(svcWrap.style.maxHeight) || 560
      const next = clamp(cur + bottom('.col-r') - bottom('.col-l'), 560, 1600)
      if (Math.abs(next - cur) > 8) svcWrap.style.maxHeight = `${Math.round(next)}px`
    }
    moreHint()
  }
  const ro = new ResizeObserver(() => requestAnimationFrame(fit))
  for (const s of grid.children) ro.observe(s)
  ro.observe(grid)
}

setWake(wake)
Object.assign(RENDER, {
  header: renderHeader,
  verdict: renderVerdict,
  cpu: cpu.renderCPU,
  procs: () => cpu.renderProcs(false),
  thermals: thermals.renderThermals,
  power: power.renderPower,
  memory: memory.renderMemory,
  storage: storage.renderStorage,
  network: network.renderNetwork,
  services: services.renderServices,
  docker: containers.renderDocker,
  tailscale: tailnet.renderTailscale,
})
// a sections.js row without its renderer fails here at load, not on the first full snapshot
for (const r of RENDERS) if (!RENDER[r.render]) throw new Error(`no renderer ${r.render}`)
// sections.js is the one table; the renderers of a key run in any order inside a frame (they paint disjoint elements)
const { sectionRenders: SECTION_RENDERS, dimOnFail: DIM_ON_FAIL } = derive(RENDERS)

// A collector that crashed sends its section as null (docs/API.md). The sections that can be unavailable say so;
// the others dim with a "No data" mark, rather than keep showing their last reading as if it were live.
const FAILED = { available: false, error: 'collector failed, see journalctl -u pidash' }
const CAN_FAIL = ['throttling', 'power', 'fan', 'services', 'docker', 'tailscale']

function onMetrics(data, full) {
  for (const k of CAN_FAIL) if (k in data && data[k] == null) data[k] = FAILED
  for (const [k, id] of Object.entries(DIM_ON_FAIL))
    if (k in data) document.getElementById(id).toggleAttribute('data-nodata', data[k] == null)
  if (full) S.m = {}
  Object.assign(S.m, data)
  clock.set(data.ts)
  if (full) for (const k of Object.keys(RENDER)) dirty.add(k)
  else for (const k of Object.keys(data)) for (const r of SECTION_RENDERS[k] || []) dirty.add(r)
  dirty.add('verdict')
  appendHistory(S.m)
  updateStale()
  // a background tab gets no frames, and its title and icon are where the verdict is seen then: render it now, after
  // appendHistory, as the verdict reads the data age
  if (document.hidden) renderVerdict()
  invalidateCharts()
  // the fan card's SoC reading is the same sample as everywhere else on the page (the curve marker keeps the fan's own)
  if (data.fan) fanUI.setFan(data.fan, S.m.temps?.soc_c)
  stage.update(S.m, S.profiles)
  wake()
}

// Reload once when the backend was upgraded under us, so the page matches its API.
function onHello(info) {
  const prev = S.info
  if (prev && prev.app_version !== info.app_version) {
    location.reload()
    return
  }
  S.info = info
  S.offsetS = info.server_time - Date.now() / 1000
  bind('demo').hidden = !info.mock && !isDemo()
  fanUI.setInfo(info)
  sysUI.setInfo(info)
  conUI.setInfo(info)
  renderMarkings()
  renderAuth()
  checkAuth() // on every (re)connect: a reboot keeps the session, a new PIDASH_TOKEN ends it
}

let gotFull = false
function onMessage(msg) {
  switch (msg.type) {
    case 'hello':
      gotFull = false
      onHello(msg.data)
      break
    case 'fan_profiles':
      S.profiles = msg.data
      fanUI.setProfiles(msg.data)
      break
    case 'history':
      applyHistory(msg.data)
      for (const c of network.sparks.values()) c.invalidate()
      break
    case 'metrics':
      onMetrics(msg.data, !gotFull)
      gotFull = true
      break
  }
}

// ================================================================== boot

async function boot() {
  const params = new URLSearchParams(location.search)
  if (params.has('demo')) await useDemo()
  applyMotion()
  renderAuth()
  // fetched now, while the Pi answers; with the Pi gone the path wouldn't load
  fetch('/favicon-off.svg')
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => b && (offIcon = URL.createObjectURL(b)))
    .catch(() => {})
  conn = connect({ onMessage, onStatus: setLink })
}
boot()
