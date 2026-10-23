// pidash dashboard: connection, state, and every panel. Contract: docs/API.md.
import './styles/index.css'
import { Lock, LockOpen } from 'lucide'
import { auth, logout, checkAuth, connect, useDemo, isDemo } from './link/net.js'
import { clock, invalidateCharts, setWake } from './ui/charts.js'
import { createFan } from './sections/fan/fan.js'
import { createSystem } from './sections/system/system.js'
import { createConsole } from './sections/console.js'
import { createLogs } from './sections/services/logs.js'
import { STALE_S } from './health/verdict.js'
import { RENDERS, derive } from './sections/sections.js'
import { prefs, onReducedChange } from './ui/prefs.js'
import { fmt } from './ui/format.js'
import { ico } from './ui/dom.js'
import { $, bind } from './ui/dom.js'
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
import { canChange, createSignin } from './shell/signin.js'
import { createFeedback } from './shell/feedback.js'
import { renderHeader, renderMarkings } from './shell/header.js'
import { createNav } from './shell/nav.js'
import { createVerdictView } from './health/verdict-view.js'
import { createGrid } from './shell/grid.js'

// ================================================================== auth

const { requireAuth, showDialog } = createSignin()
const { privileged, toast } = createFeedback({ requireAuth, showDialog })

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

const nav = createNav({ focusSearch: () => services.focusSearch(), focusPads: () => fanUI.focusPads() })

// ================================================================== health verdict

const { renderVerdict, stage, lp, setOffIcon } = createVerdictView({
  sectionOf: nav.sectionOf,
  jumped: nav.jumped,
  retry: () => conn?.retryNow(),
  piState: () => sysUI.state(),
  fanStale: () => fanUI.setStale(true),
})

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

createGrid()

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
    .then((b) => b && setOffIcon(URL.createObjectURL(b)))
    .catch(() => {})
  conn = connect({ onMessage, onStatus: setLink })
}
boot()
