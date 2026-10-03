// pidash dashboard: connection, state, and every panel. Contract: docs/API.md.
import './style.css'
import { Wifi, EthernetPort, Waypoints, Network, Container, TriangleAlert, ChevronRight, Copy, Lock, LockOpen, RotateCw, ScrollText, X } from 'lucide'
import { api, auth, login, logout, checkAuth, connect, useDemo, isDemo, ApiError } from './net.js'
import { Chart, clock, drawCharts, chartsBusy, invalidateCharts, setWake } from './charts.js'
import { createStage } from './stage.js'
import { createFan } from './fan.js'
import { createSystem } from './system.js'
import { createConsole } from './console.js'
import { createLogs } from './logs.js'
import {
  prefs, onReducedChange, fmt, tweenText, tickTweens, tweenBusy, el, refs, setText, esc, ico, badge, badgeHTML,
  syncList, flip, radioGroup, setChecked, rampGradient, heat, T_MIN, T_MAX, copyText, clamp,
} from './util.js'

const $ = (s) => document.querySelector(s)
const bind = (k) => $(`[data-bind="${k}"]`)
const section = (id) => {
  const root = document.getElementById(id)
  return { root, r: refs(root) }
}
/** An unpopulated footprint: the board's "DNP" (do not populate) mark, then what is missing and why. */
const dnp = (msg) => `<b aria-hidden="true" title="Do not populate: no data for this part here">DNP</b><span>${esc(msg)}</span>`

// ================================================================== state

const S = {
  info: null,
  profiles: null,
  m: {}, // merged metrics snapshot
  hist: null, // {ts, series, net}
  lastTs: 0,
  offsetS: 0, // server clock − browser clock
  link: 'connecting',
  stale: false,
  last: null, // the last real verdict {worst, headline, ts}, for the offline row
}
const HIST_MAX = 600

function applyHistory(h) {
  S.hist = { ts: h.ts.slice(), series: {}, net: {} }
  for (const [k, a] of Object.entries(h.series)) S.hist.series[k] = a.slice()
  for (const [k, v] of Object.entries(h.net || {})) S.hist.net[k] = { rx: v.rx_bytes_per_s.slice(), tx: v.tx_bytes_per_s.slice() }
  S.lastTs = h.ts[h.ts.length - 1] ?? 0
}

const SERIES = {
  cpu_pct: (m) => m.cpu?.usage_pct,
  cpu_freq_mhz: (m) => m.cpu?.freq_mhz,
  load_1m: (m) => m.cpu?.load_avg?.[0],
  soc_temp_c: (m) => m.temps?.soc_c,
  nvme_temp_c: (m) => m.temps?.nvme_c,
  fan_rpm: (m) => (m.fan?.available ? m.fan.rpm : null),
  fan_pct: (m) => (m.fan?.available ? m.fan.speed_pct : null),
  mem_used_pct: (m) => m.memory?.ram.used_pct,
  swap_used_pct: (m) => m.memory?.swap.used_pct,
  disk_read_bytes_per_s: (m) => m.disks?.total.read_bytes_per_s,
  disk_write_bytes_per_s: (m) => m.disks?.total.write_bytes_per_s,
  net_rx_bytes_per_s: (m) => m.network?.total.rx_bytes_per_s,
  net_tx_bytes_per_s: (m) => m.network?.total.tx_bytes_per_s,
  pmic_w: (m) => (m.power?.available ? m.power.pmic_w : null),
}

function appendHistory(m) {
  const H = S.hist
  if (!H || m.ts <= S.lastTs) return
  S.lastTs = m.ts
  H.ts.push(m.ts)
  for (const [k, f] of Object.entries(SERIES)) (H.series[k] ||= new Array(H.ts.length - 1).fill(null)).push(f(m) ?? null)
  const seen = new Set()
  for (const i of m.network?.interfaces || []) {
    const n = (H.net[i.name] ||= { rx: new Array(H.ts.length - 1).fill(null), tx: new Array(H.ts.length - 1).fill(null) })
    n.rx.push(i.rx_bytes_per_s)
    n.tx.push(i.tx_bytes_per_s)
    seen.add(i.name)
  }
  for (const [k, n] of Object.entries(H.net))
    if (!seen.has(k)) {
      n.rx.push(null)
      n.tx.push(null)
    }
  if (H.ts.length > HIST_MAX) {
    const cut = H.ts.length - HIST_MAX
    H.ts.splice(0, cut)
    for (const a of Object.values(H.series)) a.splice(0, cut)
    for (const n of Object.values(H.net)) {
      n.rx.splice(0, cut)
      n.tx.splice(0, cut)
    }
  }
}
const hts = () => S.hist?.ts
const hs = (k) => () => S.hist?.series[k]

// ================================================================== auth

/** Whether the fan controls can work at all, and why not. Signing in is asked for only when a change is made. */
function canChange() {
  if (!S.info) return { configured: false, waiting: true, why: 'Waiting for the Pi…' }
  if (!S.info.auth_configured) return { configured: false, why: 'Changes are off: set PIDASH_TOKEN on the Pi and restart pidash to turn them on. Reading works as usual.' }
  return { configured: true, why: '' }
}

const dlg = bind('login')
const dlgToken = bind('login-token')
const dlgErr = bind('login-error')
const dlgSubmit = bind('login-submit')
let pending = null

/** Opens a modal dialog and gives focus back to what had it once the dialog closes. */
function showDialog(d, focus) {
  const back = document.activeElement
  d.addEventListener('close', () => back?.isConnected && !document.querySelector('dialog[open]') && back.focus({ preventScroll: true }), { once: true })
  d.showModal()
  focus?.focus()
}

function openLogin(reason) {
  dlgErr.hidden = true
  dlgToken.value = ''
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
    const msg = err.status === 401 ? 'That token isn’t right. Check PIDASH_TOKEN on the Pi and try again.' : err.status === 403 && err.code === 'auth_not_configured' ? 'Changes are turned off on the Pi (no PIDASH_TOKEN set).' : err.message
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
  bind('confirm-body').innerHTML = `<p>${esc(body)}</p>${warn ? `<p class="notice notice-warn">${ico(TriangleAlert)}<span>${esc(warn)}</span></p>` : ''}`
  bind('confirm-ok').textContent = ok
  cfm.returnValue = ''
  showDialog(cfm, bind('confirm-cancel'))
  return new Promise((resolve) => cfm.addEventListener('close', () => resolve(cfm.returnValue === 'ok'), { once: true }))
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
 *  hovered). Returns {set(msg), close()}. */
function toast(tone, msg, { sticky = tone === 'bad', busy = false } = {}) {
  const t = el(`<div class="toast" data-tone="${tone}"${tone === 'bad' ? ' role="alert"' : ''}>${badgeHTML()}<p></p>
    <button class="toast-x" type="button" aria-label="Dismiss">${ico(X)}</button></div>`)
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
  signin.title = on ? 'Changes and the console need the token again after this' : 'Sign in with the token to make changes and use the console'
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
const STALE_S = 20 // s without data before the verdict stops vouching for old data: a pidash restart (about 9 s) stays under it (#6)
const dataAge = () => (S.lastTs ? Date.now() / 1000 + S.offsetS - S.lastTs : performance.now() / 1000)

function setLink(st) {
  S.link = st.state
  linkEl.dataset.state = st.state
  clearInterval(retryTimer)
  retry.hidden = st.state !== 'offline'
  document.body.toggleAttribute('data-stale', st.state !== 'live' && !!S.m.ts)
  const down = st.state === 'offline' || (st.state === 'connecting' && st.attempt > 0)
  linkText.textContent = st.state === 'live' ? 'Live' : down ? 'Offline' : 'Connecting…'
  linkMore.textContent = ''
  if (st.state === 'live') return
  const tick = () => {
    const age = S.lastTs ? dataAge() : null
    if (st.state === 'offline') linkMore.textContent = `${age != null ? `, data ${fmt.dur(age, true)} old` : ''} · retry in ${Math.max(0, Math.ceil((st.retryAt - Date.now()) / 1000))}\u00a0s`
    else if (st.attempt) linkMore.textContent = ' · reconnecting…'
    if (!S.stale && dataAge() >= STALE_S) S.stale = true
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
  bind('markings').innerHTML = rows.map(([k, v]) => `<div${k === 'CPU' ? ' class="wide"' : ''}><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')
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
    if (on && fingers.scrollWidth > fingers.clientWidth) fingers.scrollTo({ left: a.offsetLeft - 24, behavior: prefs.reduced ? 'auto' : 'smooth' })
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
for (const t of ['pointerdown', 'wheel', 'keydown']) addEventListener(t, () => (held = false), { capture: true, passive: true })
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
  if (r && r.top <= line && r.bottom > line) jumped(sec) // back where the jump to it came to rest
  else follow(true)
})
// opened on a link into a section, the page starts there (a reload restores the old scroll position instead)
if (performance.getEntriesByType('navigation')[0]?.type === 'navigate' && sectionOf(location.hash)) jumped(sectionOf(location.hash))
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return
  const t = e.target
  if (t.closest?.('input, textarea, select, [contenteditable], .curve')) return
  if (e.key === '/') {
    e.preventDefault()
    SV.r.q.focus()
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
function renderVerdict() {
  if (S.stale) return renderOffline()
  const m = S.m
  const L = S.info?.limits ?? {}
  if (!m.ts) return
  const checks = []
  // `part`: the board part a reason is about, so the board can carry the verdict too (stage.health, lightPart)
  const add = (tone, text, href, part, next) => checks.push({ tone, text, href, part, next })
  const soc = m.temps?.soc_c
  const th = m.throttling
  if (soc == null) add('warn', 'SoC temperature can’t be read.', '#thermals', 'soc')
  else if (soc >= (L.soc_throttle_hard_c ?? 85)) add('bad', `SoC at ${fmt.temp(soc)}: ARM and GPU are being throttled.`, '#thermals', 'soc', 'Check that the fan spins and the case vents are clear. Max cools fastest.')
  else if (soc >= (L.soc_throttle_c ?? 80)) add('bad', `SoC at ${fmt.temp(soc)}: the ARM cores are being throttled.`, '#thermals', 'soc', 'Check that the fan spins and the case vents are clear. Max cools fastest.')
  else if (soc >= (L.soc_throttle_c ?? 80) - 10) add('warn', `SoC at ${fmt.temp(soc)}, close to the ${L.soc_throttle_c ?? 80}${'\u00a0'}°C throttle point.`, '#thermals', 'soc', 'Performance or Max keeps it cooler.')
  else add('ok', `SoC at ${fmt.temp(soc)}.`, '#thermals', 'soc')
  if (th?.available) {
    if (th.now.under_voltage) add('bad', 'Under-voltage right now: the power supply can’t keep up.', '#thermals', 'pmic', 'Use the official 27 W USB-C supply and a short, thick cable.')
    else if (th.now.throttled || th.now.arm_freq_capped) add('bad', 'The firmware is throttling the CPU right now.', '#thermals', 'soc', `It stops once the SoC is below ${L.soc_throttle_c ?? 80}\u00a0°C and the power holds steady.`)
    else if (th.since_boot.under_voltage) add('warn', 'Under-voltage happened since boot.', '#thermals', 'pmic', 'Use the official 27 W USB-C supply and a short, thick cable.')
    else if (th.since_boot.throttled || th.since_boot.arm_freq_capped || th.since_boot.soft_temp_limit) add('warn', 'The CPU was throttled at some point since boot.', '#thermals', 'soc', 'Nothing to do unless it happens again: the flag clears at the next reboot.')
    else if (![...Object.values(th.now), ...Object.values(th.since_boot)].some(Boolean)) add('ok', 'No under-voltage or throttling since boot.', '#thermals')
  }
  const nv = m.temps?.nvme_c
  if (nv != null && L.nvme_warn_c != null && nv >= L.nvme_warn_c) add('bad', `NVMe at ${fmt.temp(nv)}, above its warning limit.`, '#storage', 'ssd', 'Pause heavy disk writes and check that air reaches the drive.')
  const f = m.fan
  if (f?.available) {
    if (f.mode === 'failsafe') add('bad', 'Fan failsafe: forced to full speed.', '#fan', 'fan', `The Pi is protecting itself: your profile returns below ${L.fan_failsafe_release_c ?? 75}\u00a0°C.`)
    else if (f.pwm > 0 && f.rpm === 0) add('bad', 'The fan is powered but not spinning.', '#fan', 'fan', 'Check that its cable is in the FAN header and nothing blocks the blades.')
  } else if (f && !f.available) add('warn', 'The fan can’t be read.', '#fan', 'fan')
  if (m.services?.available) {
    const n = m.services.summary.failed
    if (n) add('bad', `${n} failed service${n > 1 ? 's' : ''}: ${m.services.units.filter((u) => u.active === 'failed').map((u) => u.name.replace(/\.service$/, '')).slice(0, 3).join(', ')}.`, '#services', undefined, n > 1 ? 'Read their logs in Services, then restart them.' : 'Read its logs in Services, then restart it.')
    else add('ok', 'No failed services.', '#services')
  }
  if (m.docker?.available) {
    const bad = m.docker.containers.filter((c) => c.health === 'unhealthy' || c.state === 'restarting' || c.state === 'dead')
    if (bad.length) add('warn', bad.length > 1 ? `Containers need a look: ${bad.map((c) => `${c.name} (${c.health === 'unhealthy' ? 'unhealthy' : c.state})`).join(', ')}.` : `Container ${bad[0].name} is ${bad[0].health === 'unhealthy' ? 'unhealthy' : bad[0].state}.`, '#containers', undefined, bad.length > 1 ? 'See docker logs <name> on the Pi for each.' : `See docker logs ${bad[0].name} on the Pi.`)
  }
  const ram = m.memory?.ram
  if (ram && ram.used_pct >= 90) add('bad', `Memory ${fmt.pct(ram.used_pct, 0)} used.`, '#memory', 'ram', 'Top processes in Processor, sorted by Memory, shows what uses it.')
  else if (ram && ram.used_pct >= 80) add('warn', `Memory ${fmt.pct(ram.used_pct, 0)} used.`, '#memory', 'ram', 'Top processes in Processor, sorted by Memory, shows what uses it.')
  for (const fs of m.disks?.filesystems || []) if (fs.used_pct >= 90) add(fs.used_pct >= 95 ? 'bad' : 'warn', `${fs.mount} is ${fmt.pct(fs.used_pct, 0)} full.`, '#storage', fs.device?.startsWith('/dev/nvme') ? 'ssd' : undefined, 'Free space on it: old logs, unused Docker images or downloads.')
  const ts = m.tailscale
  if (ts?.available) {
    if (ts.backend_state !== 'Running') add('warn', `Tailscale is ${ts.backend_state}.`, '#tailnet', undefined, 'Run tailscale status on the Pi to see why.')
    const left = ts.self?.key_expiry != null ? ts.self.key_expiry - (m.ts ?? 0) : null
    if (left != null && left < 14 * 86400) add(left < 3 * 86400 ? 'bad' : 'warn', `The Tailscale key expires in ${fmt.dur(Math.max(0, left))}.`, '#tailnet', undefined, 'Renew the key, or turn off key expiry for this machine, in the Tailscale admin console.')
  }
  const rank = { bad: 0, warn: 1, ok: 2 }
  checks.sort((a, b) => rank[a.tone] - rank[b.tone])
  const worst = checks[0]?.tone ?? 'ok'
  verdictBox.dataset.tone = worst
  // the board carries it too: each part with a reason gets its LED on the stage (worst tone first, as sorted)
  const parts = {}
  for (const c of checks) if (c.part && c.tone !== 'ok') (parts[c.part] ??= { tone: c.tone, text: [] }).text.push(c.text)
  stage.health(parts)
  const issues = checks.filter((c) => c.tone !== 'ok').length
  const bad = checks.filter((c) => c.tone === 'bad').length
  // the headline counts what it names: "2 problems" means two red rows, and amber rows are "to check"
  const headline =
    worst === 'ok' ? 'Healthy' : worst === 'warn' ? `${issues} thing${issues > 1 ? 's' : ''} to check` : `${bad} problem${bad > 1 ? 's' : ''}${issues > bad ? `, ${issues - bad} to check` : ''}`
  setText(bind('verdict'), headline)
  // the browser tab carries the verdict too: pidash lives in a tab, and the tab strip is where a glance lands
  const title = (worst === 'ok' ? [S.info?.hostname, 'pidash'] : [headline, S.info?.hostname ?? 'pidash']).filter(Boolean).join(' · ')
  if (document.title !== title) document.title = title
  const icon = worst === 'ok' ? '/favicon.svg' : `/favicon-${worst}.svg`
  if (favicon.getAttribute('href') !== icon) favicon.setAttribute('href', icon)
  S.last = { worst, headline, ts: m.ts }
  // with anything wrong, the list names only what is wrong; the all-clear rows show when there is nothing else.
  // Six rows at most: a seventh and later collapse into one "more" row, so the headline's count always adds up
  const shown = worst === 'ok' ? checks : checks.filter((c) => c.tone !== 'ok')
  const rows = shown.length > 6 ? [...shown.slice(0, 5), { tone: shown[5].tone, text: `${shown.length - 5} more: ${shown.slice(5).map((c) => c.text.replace(/[.:].*$/, '')).join(' · ')}.`, href: shown[5].href }] : shown
  const html = rows
    .map((c) => `<li><a class="check" href="${c.href}" data-tone="${c.tone}"${c.part ? ` data-part="${c.part}"` : ''}>${badgeHTML('', '')}<span class="check-body"><span class="check-text">${esc(c.text)}</span>${c.next && c.tone !== 'ok' ? `<span class="check-next">${esc(c.next)}</span>` : ''}</span>${ico(ChevronRight, 'check-go')}</a></li>`)
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

// No contact for STALE_S: say so instead of vouching for old data (Product Principle 1, issue #6). The numbers stay, dimmed
function renderOffline() {
  verdictBox.dataset.tone = 'off'
  stage.health({}) // nothing on the board is known now
  setText(bind('verdict'), `No contact with the Pi for ${fmt.dur(dataAge(), true)}`)
  const title = `Offline · ${S.info?.hostname ?? 'pidash'}`
  if (document.title !== title) document.title = title
  if (favicon.getAttribute('href') !== offIcon) favicon.setAttribute('href', offIcon)
  const l = S.last
  const when = l && (Date.now() / 1000 + S.offsetS - l.ts > 86400 ? fmt.date(l.ts) : fmt.clock(l.ts))
  const text = !l ? 'No data from the Pi since this page opened.' : l.worst === 'ok' ? `Last seen healthy at ${when}.` : `Last seen at ${when}: ${l.headline}.`
  const sys = sysUI.state() // 'rebooting' | 'off' | null: the System card knows why the Pi is gone
  const next = sys === 'rebooting' ? 'It is restarting: back in about a minute, and this page reconnects by itself.' : sys === 'off' ? 'It was shut down: start it with its power button.' : 'Check that the Pi has power and its network is up. This page keeps retrying by itself.'
  const html = `<li><span class="check" data-tone="off">${badgeHTML('', '')}<span class="check-body"><span class="check-text">${esc(text)}</span><span class="check-next">${esc(next)}</span></span><button class="textbtn" type="button" data-retry>Retry now</button></span></li>`
  if (checksEl._html !== html) {
    checksEl._html = html
    checksEl.innerHTML = html
    checksEl.querySelector('.badge').dataset.tone = 'off'
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
const PART_OF_SECTION = { cpu: 'soc', thermals: 'soc', power: 'pmic', memory: 'ram', storage: 'ssd', network: 'wifi', fan: 'fan' }
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
    const sec = sectionOf({ fan: '#fan', soc: '#cpu', ram: '#memory', rp1: '#thermals', pmic: '#power', wifi: '#network', ssd: '#storage' }[part])
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
for (const [id, part] of Object.entries(PART_OF_SECTION)) {
  const s = document.getElementById(id)
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
const conUI = createConsole({ root: document.getElementById('console'), requireAuth, toast, canChange, info: () => S.info })
const logsUI = createLogs({ dialog: bind('logs'), requireAuth, toast, showDialog })

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
})
onReducedChange(() => {
  stage.refresh()
  invalidateCharts()
  wake()
})

// ================================================================== CPU + processes

const CPU = section('cpu')
{
  const cores = CPU.r.cores
  cores.innerHTML = [0, 1, 2, 3]
    .map((i) => `<div class="core" role="listitem"><div class="core-bar" aria-hidden="true"><i></i></div><span class="core-lab">core ${i}<b>—</b></span></div>`)
    .join('')
}
const TIMES = [
  ['user', 'User', '#e8ece4'],
  ['system', 'System', '#6fc3d1'],
  ['iowait', 'I/O wait', '#d9b35d'],
  ['softirq', 'IRQ', '#8a9a90'],
]
CPU.r.times.innerHTML = TIMES.map(([k, , c]) => `<i data-k="${k}" style="background:${c}"></i>`).join('')
CPU.r['times-legend'].innerHTML = TIMES.map(([k, l, c]) => `<li><i style="background:${c}"></i>${l} <b data-k="${k}">—</b></li>`).join('')
new Chart(CPU.r.chart, {
  ts: hts,
  series: [
    { get: hs('cpu_pct'), color: '#e8ece4', fill: 'rgba(232,236,228,0.16)', label: 'CPU', fmt: (v) => fmt.pct(v) },
  ],
  max: 100,
  ticks: () => [0, 25, 50, 75, 100],
  tickFmt: (v) => `${v}${'\u00a0'}%`,
})
let procKey = 'top_cpu'
radioGroup(CPU.r['proc-sort'], (v) => {
  procKey = v
  setChecked(CPU.r['proc-sort'], v)
  renderProcs(true)
})

function renderCPU() {
  const c = S.m.cpu
  if (!c) return
  tweenText(CPU.r.usage, c.usage_pct, (v) => v.toFixed(1))
  const bars = CPU.r.cores.children
  c.per_core_pct.forEach((p, i) => {
    bars[i].querySelector('i').style.setProperty('--f', clamp(p, 0, 100) / 100)
    setText(bars[i].querySelector('b'), fmt.pct(p, 0))
  })
  CPU.r.cores.setAttribute('aria-label', `Per-core usage: ${c.per_core_pct.map((p, i) => `core ${i} ${Math.round(p)} %`).join(', ')}`)
  setText(CPU.r.freq, fmt.mhz(c.freq_mhz))
  setText(CPU.r.gov, c.governor)
  setText(CPU.r.load, c.load_avg.map((v) => v.toFixed(2)).join(' · '))
  for (const [k] of TIMES) {
    const v = c.times_pct[k] ?? 0
    CPU.r.times.querySelector(`[data-k=${k}]`).style.flexBasis = `${v}%`
    setText(CPU.r['times-legend'].querySelector(`[data-k=${k}]`), fmt.pct(v))
  }
  CPU.r.times.setAttribute('aria-label', `CPU time: ${TIMES.map(([k, l]) => `${l} ${fmt.pct(c.times_pct[k])}`).join(', ')}, idle ${fmt.pct(c.times_pct.idle)}`)
  setText(CPU.r.sum, `${S.info?.cpu.cores ?? 4} × ${S.info?.cpu.model ?? 'Cortex-A76'} · ${fmt.int(S.m.system?.process_count)} processes · ${fmt.int(S.m.system?.thread_count)} threads`)
}

function renderProcs(animate = false) {
  const list = S.m.processes?.[procKey]
  if (!list) return
  const body = CPU.r.procs
  const run = () =>
    syncList(
      body,
      list,
      (p) => p.pid,
      () =>
        el(`<tr><td><span class="nm"></span><span class="cmd"></span></td>
          <td class="num" data-k="cpu"></td>
          <td class="num"><span data-k="mem"></span></td>
          <td class="num hide-sm" data-k="thr"></td><td class="hide-sm" data-k="user"></td></tr>`),
      (row, p) => {
        setText(row.querySelector('.nm'), p.name)
        const cmd = row.querySelector('.cmd')
        setText(cmd, p.command)
        cmd.title = p.command
        setText(row.querySelector('[data-k=cpu]'), fmt.pct(p.cpu_pct))
        setText(row.querySelector('[data-k=mem]'), `${fmt.bytes(p.rss_bytes)}`)
        setText(row.querySelector('[data-k=thr]'), p.threads)
        setText(row.querySelector('[data-k=user]'), p.user)
      },
    )
  flip(body, run) // flip() skips the motion under prefers-reduced-motion
}

// ================================================================== thermals + throttling

const TH = section('thermals')
const GAUGES = [
  { k: 'soc_c', name: 'SoC', sub: 'BCM2712, drives the fan curve', marks: (L) => [[L.soc_throttle_c, `${L.soc_throttle_c}° throttle`], [L.soc_throttle_hard_c, `${L.soc_throttle_hard_c}° hard`]] },
  { k: 'nvme_c', name: 'NVMe', sub: 'WD SN580, composite', marks: (L) => [[L.nvme_warn_c, `${L.nvme_warn_c}° warn`]] },
  { k: 'rp1_c', name: 'RP1', sub: 'I/O controller', marks: () => [] },
  { k: 'pmic_c', name: 'PMIC', sub: 'power IC, updates every 5 s', marks: () => [] },
]
TH.r.gauges.innerHTML = GAUGES.map(
  (g) => `<li class="gauge" data-k="${g.k}">
    <span class="gauge-name">${g.name}<small>${g.sub}</small></span>
    <span class="gauge-val"><span data-v>—</span><small>°C</small></span>
    <span class="strip" role="meter" aria-label="${g.name} temperature" aria-valuemin="${T_MIN}" aria-valuemax="${T_MAX}"></span>
  </li>`,
).join('')
TH.r.gauges.insertAdjacentHTML('afterend', `<p class="gauge-note">Scale ${T_MIN}–${T_MAX}${'\u00a0'}°C, the same heat colours as the board view.</p>`)
new Chart(TH.r.chart, {
  ts: hts,
  series: [
    { get: hs('soc_temp_c'), heat: true, width: 2, label: 'SoC', fmt: (v) => fmt.temp(v) },
    { get: hs('nvme_temp_c'), color: '#6fc3d1', width: 1.4, dash: [4, 3], label: 'NVMe', fmt: (v) => fmt.temp(v) },
  ],
  min: 30,
  max: 90,
  ticks: () => [30, 45, 60, 75, 90],
  tickFmt: (v) => `${v}°`,
  marks: () => {
    const L = S.info?.limits ?? {}
    return [{ y: L.soc_throttle_c ?? 80, label: 'SoC throttles', tone: 'bad' }]
  },
})
const FLAGS = [
  ['under_voltage', 'Under-voltage'],
  ['arm_freq_capped', 'ARM frequency capped'],
  ['throttled', 'Throttled'],
  ['soft_temp_limit', 'Soft temperature limit'],
]
TH.r['flag-rows'].innerHTML = FLAGS.map(([k, l]) => `<tr data-k="${k}"><td>${l}</td><td>${badgeHTML('now')}</td><td>${badgeHTML('boot')}</td></tr>`).join('')

function renderThermals() {
  const t = S.m.temps
  const L = S.info?.limits ?? {}
  if (t) {
    for (const g of GAUGES) {
      const li = TH.r.gauges.querySelector(`[data-k=${g.k}]`)
      const v = t[g.k]
      tweenText(li.querySelector('[data-v]'), v, (x) => (x == null ? '—' : x.toFixed(1)))
      const strip = li.querySelector('.strip')
      strip.style.setProperty('--p', `${(heat(v) * 100).toFixed(1)}%`)
      if (v != null) strip.setAttribute('aria-valuenow', v)
      strip.setAttribute('aria-valuetext', v == null ? 'unknown' : `${v.toFixed(1)} °C`)
      if (!strip._marks && S.info) {
        strip._marks = true
        for (const [y, label] of g.marks(L)) {
          if (y == null) continue
          const mk = document.createElement('i')
          mk.className = 'mark'
          mk.dataset.l = label
          mk.style.left = `${(heat(y) * 100).toFixed(1)}%`
          strip.append(mk)
        }
      }
    }
    const soc = t.soc_c
    setText(TH.r.sum, soc == null ? 'SoC temperature unavailable' : soc >= (L.soc_throttle_c ?? 80) ? 'Throttling' : `${Math.max(0, Math.round((L.soc_throttle_c ?? 80) - soc))}${'\u00a0'}°C below the throttle point`)
  }
  const th = S.m.throttling
  if (!th) return
  if (!th.available) {
    TH.r.flags.hidden = true
    TH.r.raw.textContent = '—'
    TH.r.dnp.hidden = false
    TH.r.dnp.innerHTML = dnp(`Throttle flags unavailable: ${th.error}`)
    TH.r.uv.hidden = true
    return
  }
  TH.r.flags.hidden = false
  TH.r.dnp.hidden = true
  setText(TH.r.raw, th.raw)
  for (const [k] of FLAGS) {
    const row = TH.r['flag-rows'].querySelector(`[data-k=${k}]`)
    const now = th.now[k]
    const boot = th.since_boot[k]
    badge(row.querySelector('[data-ref=now]'), now ? 'bad' : 'ok', now ? 'Yes' : 'No')
    badge(row.querySelector('[data-ref=boot]'), boot ? (k === 'under_voltage' ? 'bad' : 'warn') : 'off', boot ? 'Seen' : 'Never')
  }
  const uv = th.now.under_voltage || th.since_boot.under_voltage
  TH.r.uv.hidden = !uv
  if (uv)
    TH.r.uv.innerHTML = `${ico(TriangleAlert)}<span>${th.now.under_voltage ? 'Under-voltage now.' : 'Under-voltage was detected since boot.'} The power supply can’t always hold 5 V. Use the official 27 W USB-C supply and a short, thick cable.</span>`
}

// ================================================================== power

const PW = section('power')
new Chart(PW.r.chart, {
  ts: hts,
  series: [{ get: hs('pmic_w'), color: '#e8ece4', fill: 'rgba(232,236,228,0.14)', label: 'SoC power', fmt: (v) => (v == null ? '—' : `${v.toFixed(2)} W`) }],
  floor: 2,
  ticks: (lo, hi) => [0, hi / 2, hi],
  tickFmt: (v) => `${+v.toFixed(1)} W`,
})
function renderPower() {
  const p = S.m.power
  if (!p) return
  const box = PW.root
  if (!p.available) {
    box.toggleAttribute('data-dnp', true)
    PW.r.dnp.hidden = false
    PW.r.dnp.innerHTML = dnp(`Power readings unavailable: ${p.error}`)
    return
  }
  box.toggleAttribute('data-dnp', false)
  PW.r.dnp.hidden = true
  tweenText(PW.r.w, p.pmic_w, (v) => v.toFixed(2))
  setText(PW.r.in, p.input_v == null ? null : `${p.input_v.toFixed(3)} V`)
  setText(PW.r.core, `${fmt.fixed(p.core_v, 3)} V · ${fmt.fixed(p.core_a, 2)} A`)
  const max = Math.max(...p.rails.map((r) => r.w), 0.001)
  syncList(
    PW.r.rails,
    p.rails,
    (r) => r.name,
    () => el('<li><span></span><i></i><span></span></li>'),
    (li, r) => {
      setText(li.firstChild, r.name)
      li.children[1].style.setProperty('--p', `${((r.w / max) * 100).toFixed(1)}%`)
      setText(li.lastChild, `${r.w.toFixed(3)} W`)
      li.title = `${r.v.toFixed(3)} V × ${r.a.toFixed(3)} A`
    },
  )
}

// ================================================================== memory

const MEM = section('memory')
const MEMPARTS = [
  ['used', 'Used', '#e8ece4'],
  ['cached', 'Cache', '#6fc3d1'],
  ['buffers', 'Buffers', '#3f7f8a'],
]
MEM.r.bar.innerHTML = MEMPARTS.map(([k, , c]) => `<i data-k="${k}" style="background:${c}"></i>`).join('')
MEM.r.legend.innerHTML = [...MEMPARTS, ['free', 'Free', '#1d3d31']].map(([k, l, c]) => `<li><i style="background:${c}"></i>${l} <b data-k="${k}">—</b></li>`).join('')
new Chart(MEM.r.chart, {
  ts: hts,
  series: [{ get: hs('mem_used_pct'), color: '#e8ece4', fill: 'rgba(232,236,228,0.14)', label: 'RAM used', fmt: (v) => fmt.pct(v) }],
  max: 100,
  ticks: () => [0, 50, 100],
  tickFmt: (v) => `${v}${'\u00a0'}%`,
})
function renderMemory() {
  const mem = S.m.memory
  if (!mem) return
  const r = mem.ram
  tweenText(MEM.r.pct, r.used_pct, (v) => v.toFixed(1))
  // the figures in <b>: silkscreen captions are uppercase, units keep their case (GiB, not GIB)
  const cap = `RAM used · <b>${fmt.bytes(r.used_bytes)}</b> of <b>${fmt.bytes(r.total_bytes)}</b>`
  if (MEM.r.cap._h !== cap) MEM.r.cap.innerHTML = MEM.r.cap._h = cap
  const parts = { used: r.used_bytes, cached: r.cached_bytes, buffers: r.buffers_bytes }
  const free = Math.max(0, r.total_bytes - r.used_bytes - r.cached_bytes - r.buffers_bytes)
  for (const [k] of MEMPARTS) MEM.r.bar.querySelector(`[data-k=${k}]`).style.flexBasis = `${((parts[k] / r.total_bytes) * 100).toFixed(2)}%`
  for (const [k, v] of Object.entries({ ...parts, free })) setText(MEM.r.legend.querySelector(`[data-k=${k}]`), fmt.bytes(v))
  MEM.r.bar.setAttribute('aria-label', `RAM: used ${fmt.bytes(r.used_bytes)}, cache ${fmt.bytes(r.cached_bytes)}, buffers ${fmt.bytes(r.buffers_bytes)}, free ${fmt.bytes(free)}; ${fmt.bytes(r.available_bytes)} available`)
  const s = mem.swap
  // a used swap or mount never draws as an empty track: at least a 3 px sliver
  MEM.r['swap-bar'].style.setProperty('--f', s.used_bytes > 0 ? Math.max(0.012, clamp(s.used_pct, 0, 100) / 100) : 0)
  setText(MEM.r.swap, s.total_bytes ? `${fmt.bytes(s.used_bytes)} of ${fmt.bytes(s.total_bytes)}` : 'none')
}

// ================================================================== storage

const ST = section('storage')
new Chart(ST.r.chart, {
  ts: hts,
  series: [
    { get: hs('disk_read_bytes_per_s'), color: '#6fc3d1', label: 'Read', fmt: fmt.rate },
    { get: hs('disk_write_bytes_per_s'), color: '#e8ece4', fill: 'rgba(232,236,228,0.12)', label: 'Write', fmt: fmt.rate },
  ],
  bytes: true,
  floor: 64 * 1024,
  ticks: (lo, hi) => [0, hi / 2, hi],
  tickFmt: (v) => fmt.rate(v),
})
function renderStorage() {
  const d = S.m.disks
  if (!d) return
  const dev = d.devices[0]
  ST.r.dev.innerHTML = dev ? `${esc(dev.model ?? dev.name)}<small>${esc(dev.name)} · ${fmt.bytes(dev.size_bytes)}${S.m.temps?.nvme_c != null ? ` · ${fmt.temp(S.m.temps.nvme_c)}` : ''}</small>` : 'No disk'
  tweenText(ST.r.read, d.total.read_bytes_per_s, fmt.rate)
  tweenText(ST.r.write, d.total.write_bytes_per_s, fmt.rate)
  setText(ST.r.iops, dev ? `${fmt.int(dev.read_iops)} · ${fmt.int(dev.write_iops)}` : null)
  setText(ST.r.busy, dev ? fmt.pct(dev.busy_pct) : null)
  syncList(
    ST.r.fs,
    d.filesystems,
    (f) => f.mount,
    () => el('<li><span><b></b> <small></small></span><span class="meter-val"></span><span class="meter"><i></i></span></li>'),
    (li, f) => {
      setText(li.querySelector('b'), f.mount)
      setText(li.querySelector('small'), `${f.device} · ${f.fstype}`)
      setText(li.querySelector('.meter-val'), `${fmt.bytes(f.used_bytes)} of ${fmt.bytes(f.total_bytes)} · ${fmt.pct(f.used_pct)}`)
      const bar = li.querySelector('.meter i')
      bar.style.setProperty('--f', Math.max(0.012, f.used_pct / 100))
      bar.style.background = f.used_pct >= 95 ? 'var(--bad)' : f.used_pct >= 90 ? 'var(--warn)' : ''
    },
  )
}

// ================================================================== network

const NET = section('network')
let netSel = 'total'
const netIcon = { wifi: Wifi, ethernet: EthernetPort, vpn: Waypoints, bridge: Container, other: Network }
const netRX = () => (netSel === 'total' ? S.hist?.series.net_rx_bytes_per_s : S.hist?.net[netSel]?.rx)
const netTX = () => (netSel === 'total' ? S.hist?.series.net_tx_bytes_per_s : S.hist?.net[netSel]?.tx)
const netChart = new Chart(NET.r.chart, {
  ts: hts,
  series: [
    { get: netRX, color: '#6fc3d1', fill: 'rgba(111,195,209,0.16)', width: 1.8, label: 'Down', fmt: fmt.rate },
    { get: netTX, color: '#e8ece4', width: 1.5, label: 'Up', fmt: fmt.rate },
  ],
  bytes: true,
  floor: 16 * 1024,
  ticks: (lo, hi) => [0, hi / 2, hi],
  tickFmt: (v) => fmt.rate(v),
})
const sparks = new Map()
radioGroup(NET.r.ifaces, (v) => {
  netSel = v
  setChecked(NET.r.ifaces, v)
  netChart.invalidate(true)
  renderNetCaption()
})
function renderNetCaption() {
  setText(NET.r.cap, netSel === 'total' ? 'Wi-Fi + Ethernet throughput, last 10 minutes' : `${netSel} throughput, last 10 minutes`)
}
function renderNetwork() {
  const n = S.m.network
  if (!n) return
  const rows = [{ name: 'total', kind: 'total', up: true, addresses: [], rx_bytes_per_s: n.total.rx_bytes_per_s, tx_bytes_per_s: n.total.tx_bytes_per_s }, ...n.interfaces]
  syncList(
    NET.r.ifaces,
    rows,
    (i) => i.name,
    (i) => {
      const b = el(`<button type="button" class="iface" role="radio" data-v="${esc(i.name)}">
        ${ico(i.kind === 'total' ? Network : netIcon[i.kind] || Network)}
        <span class="iface-name"><span data-k="name"></span>${badgeHTML('st')}</span>
        <span class="iface-addr" data-k="addr"></span>
        <span class="iface-rates"><span class="rx" data-k="rx"></span><span class="tx" data-k="tx"></span></span>
        <canvas aria-hidden="true"></canvas>
      </button>`)
      const name = i.name
      sparks.set(
        name,
        new Chart(b.querySelector('canvas'), {
          mini: true,
          ts: hts,
          window: () => 120,
          bytes: true,
          floor: 4096,
          series: [
            { get: () => (name === 'total' ? S.hist?.series.net_rx_bytes_per_s : S.hist?.net[name]?.rx), color: '#6fc3d1', fill: 'rgba(111,195,209,0.3)', width: 1 },
            { get: () => (name === 'total' ? S.hist?.series.net_tx_bytes_per_s : S.hist?.net[name]?.tx), color: '#e8ece4', width: 1 },
          ],
        }),
      )
      return b
    },
    (b, i) => {
      setText(b.querySelector('[data-k=name]'), i.name === 'total' ? 'All traffic' : i.name)
      const st = b.querySelector('[data-ref=st]')
      if (i.kind === 'total') {
        st.hidden = true
        setText(b.querySelector('[data-k=addr]'), 'Wi-Fi + Ethernet (Tailscale runs inside them)')
      } else {
        st.hidden = false
        badge(st, i.up ? 'ok' : 'off', i.up ? 'up' : 'down')
        const link = i.wifi_signal_dbm != null ? `${i.wifi_signal_dbm} dBm`.replace('-', '\u2212') : i.speed_mbps ? `${i.speed_mbps} Mb/s` : null
        setText(b.querySelector('[data-k=addr]'), [link, ...i.addresses].filter(Boolean).join(' · ') || (i.up ? 'no address' : 'no link'))
      }
      b.toggleAttribute('data-down', !i.up)
      // the arrows come from style.css (spoken as "down" and "up"), so the button's name is exactly its visible text
      setText(b.querySelector('[data-k=rx]'), fmt.rate(i.rx_bytes_per_s))
      setText(b.querySelector('[data-k=tx]'), fmt.rate(i.tx_bytes_per_s))
    },
  )
  if (!rows.some((r) => r.name === netSel)) netSel = 'total'
  setChecked(NET.r.ifaces, netSel)
  const up = n.interfaces.filter((i) => i.up).length
  setText(NET.r.sum, `${up} of ${n.interfaces.length} interfaces up · ↓ ${fmt.rate(n.total.rx_bytes_per_s)} · ↑ ${fmt.rate(n.total.tx_bytes_per_s)}`)
  for (const c of sparks.values()) c.invalidate()
}
renderNetCaption()

// ================================================================== services

const SV = section('services')
let svcFilter = 'all'
const SVC_FILTERS = [
  ['all', 'All'],
  ['running', 'Running'],
  ['done', 'Done'],
  ['failed', 'Failed'],
  ['inactive', 'Inactive'],
]
SV.r.filter.innerHTML = SVC_FILTERS.map(([k, l]) => `<button type="button" role="radio" data-v="${k}" aria-checked="${k === 'all'}" tabindex="${k === 'all' ? 0 : -1}">${l}<b data-n="${k}"></b></button>`).join('')
radioGroup(SV.r.filter, (v) => {
  svcFilter = v
  setChecked(SV.r.filter, v)
  renderServices()
})
SV.r.q.addEventListener('input', () => renderServices())
SV.r.q.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && SV.r.q.value) {
    SV.r.q.value = ''
    renderServices()
  }
})
const svcSeen = new Map() // unit → last state, to hold a highlight on changes
const svcTone = (u) =>
  u.active === 'failed' ? ['bad', 'Failed'] : u.active === 'active' ? (u.sub === 'running' ? ['ok', 'Running'] : ['info', u.sub === 'exited' ? 'Done' : u.sub]) : u.active === 'activating' || u.active === 'reloading' ? ['warn', u.active] : u.active === 'deactivating' ? ['warn', 'Stopping'] : ['off', 'Inactive']
const hl = (s, q) => {
  if (!q) return esc(s)
  const i = s.toLowerCase().indexOf(q)
  return i < 0 ? esc(s) : `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`
}
// Restart (docs/API.md "System actions"): the names the backend takes, minus the units it always refuses (they power
// off or reboot the Pi, take over its console, or are the update itself). Any other refusal comes back as a message
const RESTARTABLE = /^[A-Za-z0-9][A-Za-z0-9@._:-]*[.]service$/
const REFUSED = /^(systemd-(poweroff|reboot|halt|kexec|soft-reboot|exit)|rescue|emergency|pidash-update)\.service$/
const canRestart = (name) => RESTARTABLE.test(name) && !REFUSED.test(name)
// what a restart takes down with it; `drops`: the connection to this page goes too, so a network error is expected
const RESTART_WARN = [
  [/^pidash\.service$/, 'This dashboard restarts with it: the page loses its connection for a few seconds, then reconnects.', true],
  [/^tailscaled\.service$/, 'You reach the dashboard through Tailscale: the page loses its connection for a few seconds.', true],
  [/^(NetworkManager|wpa_supplicant|networking|dhcpcd|systemd-networkd)\.service$/, 'The Pi’s network restarts: this page, and everything else connected to the Pi, drops for a moment.', true],
  [/^ssh\.service$/, 'If you’re connected over SSH, your session may drop.'],
  [/^docker\.service$/, 'Containers stop with it, unless Docker’s live-restore is on; only those with a restart policy start again.'],
  [/^lightdm\.service$/, 'The desktop session on the Pi closes, with any apps open in it.'],
  [/^user@\d+\.service$/, 'Every user service of that login restarts, and its desktop session may close.'],
]
const restarting = new Set()
async function restartUnit(name) {
  const u = S.m.services?.units?.find((x) => x.name === name)
  if (!u || restarting.has(name)) return
  const short = name.replace(/\.service$/, '')
  const [, warn, drops] = RESTART_WARN.find(([re]) => re.test(name)) ?? []
  const d = u.description?.toLowerCase()
  const what = d && d !== name.toLowerCase() && d !== short.toLowerCase() ? `${short} (${u.description})` : short
  await privileged(
    {
      title: `Restart ${short}?`,
      body: u.active === 'active' || u.active === 'reloading' ? `${what} stops and starts again. Anything using it is interrupted for a moment.` : `${what} isn’t running now, so this starts it.`,
      warn,
      ok: 'Restart',
    },
    async () => {
      restarting.add(name)
      dirty.add('services')
      wake()
      try {
        const row = await api(`/api/services/${encodeURIComponent(name)}/restart`, { method: 'POST', timeout: 45000 })
        // the row as it is now, until the next tick brings the whole list
        const units = S.m.services?.units
        const i = units?.findIndex((x) => x.name === name) ?? -1
        if (i >= 0) units[i] = row
        if (name === 'pidash.service') toast('info', 'pidash is restarting. The page reconnects in a few seconds.')
        else if (row.active === 'failed') toast('bad', `${short} restarted but failed. Its log on the Pi: journalctl -u ${name}`)
        else if (row.active === 'activating') toast('info', `${short} is still starting. The table shows when it’s up.`)
        else if (row.active === 'active') toast('ok', `${short} restarted.`)
        else toast('ok', `${short} ran and is ${row.active} again.`)
      } catch (e) {
        if (!(drops && e.status === 0)) throw e
        toast('info', `${short} is restarting, and the connection dropped with it as expected. The page reconnects by itself.`)
      } finally {
        restarting.delete(name)
        dirty.add('services')
        wake()
      }
    },
    // a refusal names the unit first ("ssh.service: it …"): the toast already does
    (e) => toast('bad', `Couldn’t restart ${short}: ${e.message.startsWith(`${name}: `) ? e.message.slice(name.length + 2) : e.message}`),
  )
}
SV.r.rows.addEventListener('click', (e) => {
  const b = e.target.closest('.rs, .lg')
  if (!b) return
  if (b.classList.contains('rs')) restartUnit(b.dataset.u)
  else {
    const u = S.m.services?.units?.find((x) => x.name === b.dataset.u)
    if (u) logsUI.open(u)
  }
})

function renderServices() {
  const s = S.m.services
  if (!s) return
  if (!s.available) {
    SV.root.toggleAttribute('data-dnp', true)
    SV.r.dnp.hidden = false
    SV.r.dnp.innerHTML = dnp(`Services unavailable: ${s.error}`)
    setText(SV.r.sum, null)
    return
  }
  SV.root.toggleAttribute('data-dnp', false)
  SV.r.dnp.hidden = true
  SV.root.querySelector('.svcs').toggleAttribute('data-norestart', !canChange().configured)
  const q = SV.r.q.value.trim().toLowerCase()
  // "Done" is an active oneshot that ran and exited (API: active "active", sub "exited")
  const counts = { all: s.units.length, running: 0, done: 0, failed: 0, inactive: 0 }
  for (const u of s.units) {
    if (u.sub === 'running') counts.running++
    if (u.active === 'active' && u.sub === 'exited') counts.done++
    if (u.active === 'failed') counts.failed++
    if (u.active === 'inactive') counts.inactive++
  }
  for (const [k, n] of Object.entries(counts)) setText(SV.r.filter.querySelector(`[data-n=${k}]`), n)
  const list = s.units.filter((u) => {
    if (svcFilter === 'running' && u.sub !== 'running') return false
    if (svcFilter === 'done' && !(u.active === 'active' && u.sub === 'exited')) return false
    if (svcFilter === 'failed' && u.active !== 'failed') return false
    if (svcFilter === 'inactive' && u.active !== 'inactive') return false
    return !q || u.name.toLowerCase().includes(q) || (u.description || '').toLowerCase().includes(q)
  })
  setText(SV.r.sum, `${s.summary.running} running · ${s.summary.active} active · ${s.summary.failed} failed · ${s.summary.total} total`)
  const now = S.m.ts ?? Date.now() / 1000
  syncList(
    SV.r.rows,
    list,
    (u) => u.name,
    () => el(`<tr><td>${badgeHTML('st')}</td><td><span class="nm"></span><span class="desc"></span></td><td class="hide-sm" data-k="en"></td><td class="num" data-k="mem"></td><td class="num hide-sm" data-k="up"></td><td class="restart"><button type="button" class="lg">${ico(ScrollText)}</button><button type="button" class="rs">${ico(RotateCw)}</button></td></tr>`),
    (row, u) => {
      const busy = restarting.has(u.name)
      const [tone, label] = busy ? ['warn', 'Restarting'] : svcTone(u)
      badge(row.querySelector('[data-ref=st]'), tone, label)
      const nm = row.querySelector('.nm')
      const html = hl(u.name.replace(/\.service$/, ''), q)
      if (nm._h !== html) nm.innerHTML = nm._h = html
      const desc = row.querySelector('.desc')
      const dh = hl(u.description || '', q)
      if (desc._h !== dh) desc.innerHTML = desc._h = dh
      desc.title = u.description || ''
      setText(row.querySelector('[data-k=en]'), u.enabled)
      setText(row.querySelector('[data-k=mem]'), u.memory_bytes == null ? null : fmt.bytes(u.memory_bytes))
      setText(row.querySelector('[data-k=up]'), u.active_since == null ? null : fmt.dur(now - u.active_since))
      const key = `${u.active}/${u.sub}`
      const prev = svcSeen.get(u.name)
      if (prev && prev !== key) row.dataset.changed = ''
      svcSeen.set(u.name, key)
      const rs = row.querySelector('.rs')
      const lg = row.querySelector('.lg')
      if (rs.dataset.u !== u.name) {
        rs.dataset.u = lg.dataset.u = u.name
        rs.hidden = !canRestart(u.name)
        rs.setAttribute('aria-label', `Restart ${u.name.replace(/\.service$/, '')}`)
        lg.setAttribute('aria-label', `Logs of ${u.name.replace(/\.service$/, '')}`)
      }
      const ltip = auth.signedIn ? 'Logs' : 'Sign in to read the logs'
      if (lg.dataset.tip !== ltip) lg.dataset.tip = ltip
      // aria-disabled, not disabled: the button keeps the keyboard focus while it spins. Written only on a change:
      // this runs for every row on every services tick
      const tip = busy ? 'Restarting…' : auth.signedIn ? 'Restart' : 'Sign in to restart'
      if (rs.dataset.tip !== tip) {
        rs.dataset.tip = tip
        rs.setAttribute('aria-disabled', String(busy))
        rs.toggleAttribute('data-busy', busy)
      }
    },
  )
  SV.r.empty.hidden = list.length > 0
  if (!list.length) SV.r.empty.textContent = q ? `No service matches “${SV.r.q.value.trim()}”.` : svcFilter === 'failed' ? 'No failed services.' : 'Nothing to show.'
}
// a changed row keeps its mark until the user has seen it (hovered or focused)
SV.r.rows.addEventListener('pointerover', (e) => {
  const tr = e.target.closest('tr[data-changed]')
  if (tr) setTimeout(() => delete tr.dataset.changed, 1200)
})

// ================================================================== containers

const DK = section('containers')
const ctrTone = (c) =>
  c.state === 'running'
    ? c.health === 'unhealthy'
      ? ['bad', 'Unhealthy']
      : c.health === 'starting'
        ? ['warn', 'Starting']
        : ['ok', c.health === 'healthy' ? 'Healthy' : 'Running']
    : c.state === 'paused'
      ? ['warn', 'Paused']
      : c.state === 'restarting'
        ? ['warn', 'Restarting']
        : c.state === 'dead'
          ? ['bad', 'Dead']
          : c.state === 'created'
            ? ['off', 'Created']
            : ['off', 'Exited']
function renderDocker() {
  const d = S.m.docker
  if (!d) return
  const nav = document.querySelector('.fingers a[href="#containers"]')
  if (!d.available) {
    DK.root.toggleAttribute('data-dnp', true)
    DK.r.list.hidden = true
    DK.r.empty.hidden = true
    DK.r.dnp.hidden = false
    DK.r.dnp.innerHTML = dnp(`Docker can’t be read here (${d.error}). Nothing else is affected.`)
    setText(DK.r.sum, 'Not available')
    nav?.setAttribute('data-dnp', '')
    return
  }
  nav?.removeAttribute('data-dnp')
  DK.root.toggleAttribute('data-dnp', false)
  DK.r.dnp.hidden = true
  DK.r.list.hidden = d.containers.length === 0
  DK.r.empty.hidden = d.containers.length > 0
  if (!d.containers.length) DK.r.empty.textContent = `Docker ${d.version} is running with no containers. Anything you start with docker run or compose shows up here.`
  setText(DK.r.sum, `${d.summary.running} running · ${d.summary.paused} paused · ${d.summary.stopped} stopped · ${d.summary.images} images · Docker ${d.version}`)
  const total = S.info?.memory_total_bytes ?? 1
  syncList(
    DK.r.list,
    d.containers,
    (c) => c.id,
    () =>
      el(`<li class="ctr"><span class="ctr-name"></span><span class="ctr-state">${badgeHTML('st')}</span><span class="ctr-img"></span>
        <span class="ctr-meta"></span><div class="ctr-bars"><div><span data-k="cpu"></span><span class="meter"><i data-b="cpu"></i></span></div><div><span data-k="mem"></span><span class="meter"><i data-b="mem"></i></span></div></div></li>`),
    (li, c) => {
      setText(li.querySelector('.ctr-name'), c.name)
      const [tone, label] = ctrTone(c)
      badge(li.querySelector('[data-ref=st]'), tone, label)
      setText(li.querySelector('.ctr-img'), c.image)
      li.querySelector('.ctr-img').title = c.image
      li.querySelector('.ctr-meta').innerHTML = `<span><em>Status</em>${esc(c.status)}</span>${c.ports.length ? `<span><em>Ports</em>${esc(c.ports.join(', '))}</span>` : ''}<span><em>ID</em>${esc(c.id)}</span>`
      const bars = li.querySelector('.ctr-bars')
      bars.hidden = c.cpu_pct == null
      if (c.cpu_pct != null) {
        setText(li.querySelector('[data-k=cpu]'), `CPU ${fmt.pct(c.cpu_pct)}`)
        li.querySelector('[data-b=cpu]').style.setProperty('--f', clamp(c.cpu_pct, 0, 100) / 100)
        setText(li.querySelector('[data-k=mem]'), `Memory ${fmt.bytes(c.mem_bytes)}${c.mem_limit_bytes && c.mem_limit_bytes < total ? ` of ${fmt.bytes(c.mem_limit_bytes)}` : ''}`)
        li.querySelector('[data-b=mem]').style.setProperty('--f', clamp(c.mem_pct ?? 0, 0, 100) / 100)
      }
    },
  )
}

// ================================================================== tailnet

const TS = section('tailnet')
const connTone = { direct: ['ok', 'Direct'], relay: ['warn', 'Relayed'], idle: ['info', 'Idle'], offline: ['off', 'Offline'] }
TS.r.body.addEventListener('click', async (e) => {
  const b = e.target.closest('.ip')
  if (!b) return
  const ok = await copyText(b.dataset.ip)
  b.dataset.copied = ''
  const label = b.querySelector('span')
  const old = label.textContent
  label.textContent = ok ? 'Copied' : 'Copy failed'
  setTimeout(() => {
    delete b.dataset.copied
    label.textContent = old
  }, 1200)
})
function renderTailscale() {
  const t = S.m.tailscale
  if (!t) return
  if (!t.available) {
    TS.root.toggleAttribute('data-dnp', true)
    TS.r.dnp.hidden = false
    TS.r.dnp.innerHTML = dnp(`Tailscale status unavailable: ${t.error}`)
    setText(TS.r.sum, null)
    return
  }
  TS.root.toggleAttribute('data-dnp', false)
  TS.r.dnp.hidden = true
  setText(TS.r.sum, `${t.summary.online} of ${t.summary.peers} peers online · v${t.version}`)
  const self = t.self
  const now = S.m.ts ?? Date.now() / 1000
  const left = self.key_expiry == null ? null : self.key_expiry - now
  const html = `
    <div class="ts-name"><b>${esc(self.hostname)}</b>${badgeHTML('st')}</div>
    <div class="ips">${self.ips.map((ip) => `<button type="button" class="ip" data-ip="${esc(ip)}" title="Copy ${esc(ip)}">${ico(Copy)}<span>${esc(ip)}</span></button>`).join('')}</div>
    <dl class="kv">
      <div><dt>MagicDNS</dt><dd title="${esc(self.dns_name)}">${esc(self.dns_name)}</dd></div>
      <div><dt>Key expires</dt><dd>${left == null ? 'Never' : `${fmt.date(self.key_expiry)} (${left > 0 ? `in ${fmt.dur(left)}` : 'expired'})`}</dd></div>
      <div><dt>Home relay</dt><dd>${esc(self.relay ?? '—')}</dd></div>
      <div><dt>State</dt><dd>${esc(t.backend_state)}</dd></div>
    </dl>`
  if (TS.r.self._h !== html) {
    TS.r.self._h = html
    TS.r.self.innerHTML = html
  }
  badge(TS.r.self.querySelector('[data-ref=st]'), t.backend_state === 'Running' && self.online ? 'ok' : 'warn', t.backend_state === 'Running' ? (self.online ? 'Online' : 'Offline') : t.backend_state)
  syncList(
    TS.r.peers,
    t.peers,
    (p) => p.dns_name || p.hostname,
    () => el(`<li><span class="peer-name"></span>${badgeHTML('st')}<span class="peer-meta"></span></li>`),
    (li, p) => {
      setText(li.querySelector('.peer-name'), p.hostname)
      const [tone, label] = connTone[p.connection] || ['off', p.connection]
      badge(li.querySelector('[data-ref=st]'), tone, p.connection === 'relay' ? `Relayed via ${p.relay}` : label)
      const bits = [p.os, p.ips[0]]
      if (p.online) bits.push(`↓ ${fmt.bytes(p.rx_bytes)} · ↑ ${fmt.bytes(p.tx_bytes)}`)
      else if (p.last_seen) bits.push(`last seen ${fmt.dur(now - p.last_seen)} ago`)
      if (p.exit_node) bits.push('exit node')
      setText(li.querySelector('.peer-meta'), bits.filter(Boolean).join(' · '))
    },
  )
}

// ================================================================== render loop

// Two-column masonry (style.css .grid): each section spans as many 4px rows as its height needs,
// so a short section never leaves a hole beside a tall one. Below 1100px the grid is a flex column.
{
  const grid = $('.grid')
  const svcWrap = $('#services .table-wrap')
  const moreHint = () => svcWrap.toggleAttribute('data-more', svcWrap.scrollHeight - svcWrap.scrollTop - svcWrap.clientHeight > 4)
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

let dirty = new Set()
let raf = 0
function wake() {
  if (!raf) raf = requestAnimationFrame(frame)
}
setWake(wake)
const RENDER = {
  header: renderHeader,
  verdict: renderVerdict,
  cpu: renderCPU,
  procs: () => renderProcs(false),
  thermals: renderThermals,
  power: renderPower,
  memory: renderMemory,
  storage: renderStorage,
  network: renderNetwork,
  services: renderServices,
  docker: renderDocker,
  tailscale: renderTailscale,
}
const SECTION_RENDERS = {
  system: ['header'],
  cpu: ['cpu', 'header'],
  memory: ['memory'],
  temps: ['thermals'],
  throttling: ['thermals'],
  fan: [],
  disks: ['storage'],
  network: ['network'],
  processes: ['procs'],
  power: ['power'],
  services: ['services'],
  docker: ['docker'],
  tailscale: ['tailscale'],
}
function frame(now) {
  raf = 0
  for (const k of dirty) RENDER[k]()
  dirty.clear()
  tickTweens(now)
  drawCharts()
  // a render above may have woken the loop already (a chart's invalidate): queueing a second callback would run
  // frame() twice in the next frame, and the extra callbacks would multiply with every tick
  if (!raf && (tweenBusy() || chartsBusy())) raf = requestAnimationFrame(frame)
}

// A collector that crashed sends its section as null (docs/API.md). The sections that can be unavailable say so;
// the others dim with a "No data" mark, rather than keep showing their last reading as if it were live.
const FAILED = { available: false, error: 'collector failed, see journalctl -u pidash' }
const CAN_FAIL = ['throttling', 'power', 'fan', 'services', 'docker', 'tailscale']
const DIM_ON_FAIL = { cpu: 'cpu', memory: 'memory', temps: 'thermals', disks: 'storage', network: 'network' }

function onMetrics(data, full) {
  if (full) S.stale = false
  for (const k of CAN_FAIL) if (k in data && data[k] == null) data[k] = FAILED
  for (const [k, id] of Object.entries(DIM_ON_FAIL)) if (k in data) document.getElementById(id).toggleAttribute('data-nodata', data[k] == null)
  if (full) S.m = {}
  Object.assign(S.m, data)
  clock.set(data.ts)
  if (full) for (const k of Object.keys(RENDER)) dirty.add(k)
  else for (const k of Object.keys(data)) for (const r of SECTION_RENDERS[k] || []) dirty.add(r)
  dirty.add('verdict')
  // a background tab gets no frames, and its title and icon are where the verdict is seen then: render it now
  if (document.hidden) renderVerdict()
  appendHistory(S.m)
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
      for (const c of sparks.values()) c.invalidate()
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
  fetch('/favicon-off.svg').then((r) => (r.ok ? r.blob() : null)).then((b) => b && (offIcon = URL.createObjectURL(b))).catch(() => {})
  conn = connect({ onMessage, onStatus: setLink })
}
boot()
