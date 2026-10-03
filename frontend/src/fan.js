// Fan control: the live fan readout, profile pads and Quiet at night (hero), and the curve editor (#fan).
// The editor draws exactly what the Pi's control loop does (curve.js mirrors docs/API.md "Curve semantics"):
// the curve with its stall guard, the cooling-side curve shifted by the hysteresis, and the failsafe above 80 °C.
import { TriangleAlert, Info, Plus, Trash, RotateCcw, Copy, Lock } from 'lucide'
import { api } from './net.js'
import { DEFAULT_CONSTRAINTS, speedAt, guard, movePoint, insertPoint, removePoint, validateCurve } from './curve.js'
import { el, refs, esc, fmt, tweenText, badge, badgeHTML, rampAt, heat, prefs, clamp, ico } from './util.js'

const X0 = 20
const X1 = 90
// invisible hit area around each handle: 44 px on touch, 28 px with a mouse
const GRAB = matchMedia('(pointer: coarse)').matches ? 22 : 14
const copyCurve = (p) => ({ hysteresis_c: p.hysteresis_c, points: p.points.map((q) => ({ temp_c: q.temp_c, speed_pct: q.speed_pct })) })
const same = (a, b) =>
  a.hysteresis_c === b.hysteresis_c &&
  a.points.length === b.points.length &&
  a.points.every((p, i) => p.temp_c === b.points[i].temp_c && p.speed_pct === b.points[i].speed_pct)

/** Short plain-language summary of a curve, e.g. "Off to 54 °C · full at 75 °C". */
function summary(p, c) {
  const pts = p.points
  if (pts.every((q) => q.speed_pct >= 100)) return 'Full speed, always'
  const lastOff = [...pts].reverse().find((q) => q.speed_pct === 0)
  const start = pts[0].speed_pct > 0 ? `Always on, ${Math.max(pts[0].speed_pct, c.min_running_pct)}${'\u00a0'}% min` : `Off to ${lastOff.temp_c}${'\u00a0'}°C`
  const full = pts.find((q) => q.speed_pct >= 100)
  return `${start} · ${full ? `full at ${full.temp_c}${'\u00a0'}°C` : `tops out at ${pts[pts.length - 1].speed_pct}${'\u00a0'}%`}`
}

/** Where the fan switches on while heating (just above the last 0 % point) and off again while cooling. */
function onOff(p) {
  const pts = p.points
  if (pts[0].speed_pct > 0) return null
  const i = pts.findIndex((q) => q.speed_pct > 0)
  if (i < 0) return null
  const on = pts[i - 1].temp_c
  return { on, off: on - p.hysteresis_c }
}

export function createFan({ hero, editor, requireAuth, canChange, history }) {
  const H = {
    rpm: hero.querySelector('[data-bind=fan-rpm]'),
    pct: hero.querySelector('[data-bind=fan-pct]'),
    pwm: hero.querySelector('[data-bind=fan-pwm]'),
    target: hero.querySelector('[data-bind=fan-target]'),
    temp: hero.querySelector('[data-bind=fan-temp]'),
    mode: hero.querySelector('[data-bind=fan-mode]'),
    notice: hero.querySelector('[data-bind=fan-notice]'),
    reboot: hero.querySelector('[data-bind=reboot]'),
    lock: hero.querySelector('[data-bind=fan-lock]'),
    pads: hero.querySelector('[data-bind=pads]'),
    note: hero.querySelector('[data-bind=pads-note]'),
    night: hero.querySelector('[data-bind=night]'),
    nightSwitch: hero.querySelector('[data-bind=night-switch]'),
    nightEdit: hero.querySelector('[data-bind=night-edit]'),
    nightStatus: hero.querySelector('[data-bind=night-status]'),
    nightForm: hero.querySelector('[data-bind=night-form]'),
    nightProfile: hero.querySelector('[data-bind=night-profile]'),
    nightStart: hero.querySelector('[data-bind=night-start]'),
    nightEnd: hero.querySelector('[data-bind=night-end]'),
    nightClock: hero.querySelector('[data-bind=night-clock]'),
    nightError: hero.querySelector('[data-bind=night-error]'),
    nightCancel: hero.querySelector('[data-bind=night-cancel]'),
  }
  const R = refs(editor)
  const svg = R.svg
  H.reboot.insertAdjacentHTML('afterbegin', ico(TriangleAlert))

  let data = null // fan_profiles payload
  let fan = null // metrics.fan
  let socC = null // metrics.temps.soc_c: the card shows the page's SoC reading; the curve marker uses fan.control_temp_c
  let limits = {}
  let skew = 0 // the Pi's clock minus this browser's, in s (GET /api/info server_time)
  let utcOffset = null // the Pi's offset from UTC in s (utc_offset_s); null from a backend without the night schedule
  let nightBusy = false // a PUT /api/fan/night is in flight
  let nightHTML = '' // what the night status says now
  let tab = null
  let tabPinned = false
  let draft = null // editable copy of the custom curve
  let base = null // the server's custom curve the draft started from
  let busy = null // id of the profile being switched to, or 'save'
  let size = { w: 0, h: 0 }
  let drag = null
  let focusIndex = null
  let tipIndex = null
  let previewKey = '' // what the preview bar says now

  const C = () => data?.constraints ?? DEFAULT_CONSTRAINTS
  const profile = (id) => data?.profiles.find((p) => p.id === id)
  // what the fan follows now: fan.profile (the night schedule can run another profile than the saved `active`), or the
  // saved choice until the first reading (docs/API.md "Field notes": fan.profile)
  const running = () => (fan?.available && fan.profile) || data?.active
  const nameOf = (id) => profile(id)?.name ?? id
  const viewed = () => (tab === 'custom' && draft ? { ...profile('custom'), ...draft } : profile(tab))
  const dirty = () => draft && base && !same(draft, base)
  // Editing the draft is local; only saving asks for the token.
  const editable = () => tab === 'custom' && canChange().configured

  function note(msg, tone = '') {
    H.note.textContent = msg
    H.note.dataset.tone = tone
  }

  // ---------------------------------------------------------------- hero: live readout + pads

  function renderLive() {
    const f = fan
    // under the kernel curve the chosen profile is only saved: its pad shows that, not "driving the fan"
    H.pads.toggleAttribute('data-parked', f?.mode === 'kernel')
    if (!f || !f.available) {
      tweenText(H.rpm, null, fmt.int)
      for (const k of ['pct', 'pwm', 'target', 'temp']) H[k].textContent = '—'
      badge(H.mode, 'off', f ? 'Not available' : 'Waiting')
      H.notice.hidden = !f
      if (f) H.notice.innerHTML = `${ico(Info)}<span>The fan can’t be read: ${f.error ?? 'unknown error'}.</span>`
      H.reboot.hidden = true
      return
    }
    tweenText(H.rpm, f.rpm, fmt.int)
    tweenText(H.pct, f.speed_pct, (v) => fmt.pct(v, 0))
    H.pwm.textContent = `${f.pwm} / 255`
    H.target.textContent = f.target_pct == null ? '—' : fmt.pct(f.target_pct, 0)
    H.temp.textContent = fmt.temp(socC)
    const name = profile(f.profile)?.name ?? f.profile
    if (f.mode === 'failsafe') badge(H.mode, 'bad', 'Failsafe · 100 %')
    else if (f.mode === 'kernel') badge(H.mode, 'info', 'Kernel curve')
    else if (f.schedule === 'night' && data?.night) badge(H.mode, 'ok', `Night · ${name} until ${data.night.end}`)
    else badge(H.mode, 'ok', `Curve · ${name}`)
    let msg = ''
    if (f.mode === 'failsafe')
      msg = `The SoC reached ${limits.fan_failsafe_c ?? 80}${'\u00a0'}°C or can’t be read, so the fan is forced to full speed until it drops below ${limits.fan_failsafe_release_c ?? 75}${'\u00a0'}°C.`
    else if (f.mode === 'kernel')
      // with changes off there is nothing to pick, so only say what runs the fan
      msg = `The dashboard can’t drive the fan here, so the kernel’s config.txt curve does (see Configuration in the README).${canChange().configured ? ' The profile you pick is saved and takes over once the dashboard can.' : ''}`
    else if (f.pwm > 0 && f.rpm === 0) msg = `The fan gets PWM ${f.pwm} but reports 0 rpm. Check that it is plugged in and not blocked.`
    H.notice.hidden = !msg
    if (msg) H.notice.innerHTML = `${ico(f.mode === 'failsafe' || f.rpm === 0 ? TriangleAlert : Info)}<span>${msg}</span>`
    H.notice.className = `notice ${f.mode === 'failsafe' || (f.pwm > 0 && f.rpm === 0) ? 'notice-bad' : ''}`
    H.reboot.hidden = !f.reboot_required
  }

  const miniPath = (p) => {
    const c = C()
    let d = ''
    for (let t = X0; t <= X1; t += 2) {
      const s = t >= 80 ? 100 : guard(speedAt(p.points, t), c.min_running_pct)
      d += `${d ? 'L' : 'M'}${(((t - X0) / (X1 - X0)) * 64).toFixed(1)} ${(26 - (s / 100) * 24 - 1).toFixed(1)}`
    }
    return d
  }

  function renderPads() {
    if (!data) return
    const gate = canChange()
    const have = new Map([...H.pads.children].map((b) => [b.dataset.v, b]))
    data.profiles.forEach((p) => {
      let b = have.get(p.id)
      if (!b) {
        b = el(`<button type="button" data-v="${p.id}"><span class="pad-name"></span><span class="pad-hint"></span><svg class="pad-curve" viewBox="0 0 64 26" aria-hidden="true"><path/></svg></button>`)
        b.addEventListener('click', () => activate(p.id))
        H.pads.append(b)
      }
      const cur = profile(p.id)
      b.querySelector('.pad-name').textContent = cur.name
      // Custom starts as a copy of Balanced: say so, rather than show two pads with the same hint and curve
      const balanced = profile('balanced')
      b.querySelector('.pad-hint').textContent = p.id === 'custom' && balanced && same(cur, balanced) ? 'Same as Balanced until you edit it' : summary(cur, C())
      b.querySelector('path').setAttribute('d', miniPath(cur))
      b.setAttribute('aria-pressed', String(running() === p.id))
      b.disabled = !gate.configured
      if (busy === p.id) b.dataset.busy = ''
      else delete b.dataset.busy
      b.title = gate.configured ? '' : gate.why
    })
    // changes are off: say why above the pads, not after them
    H.lock.hidden = gate.configured || !!gate.waiting
    if (!H.lock.hidden) H.lock.innerHTML = `${ico(Lock)}<span>${gate.why}</span>`
  }

  async function activate(id) {
    if (!data || busy || (id === data.active && id === running())) return
    await requireAuth(async () => {
      busy = id
      renderPads()
      note(`Switching to ${profile(id).name}…`)
      try {
        const res = await api('/api/fan/profile', { method: 'PUT', body: { id } })
        data.active = res.active
        // the badge follows the pick now, not at the next tick (#12); the tick confirms it. A pick during the night
        // window pauses the schedule until its next start (docs/API.md "PUT /api/fan/profile")
        if (fan?.available) fan = { ...fan, profile: res.active, schedule: fan.schedule === 'night' ? 'skipped' : fan.schedule }
        renderLive()
        renderNight()
        const name = profile(res.active)?.name ?? res.active
        // with Quiet at night on, say when it takes the fan back
        const n = data.night
        const after = !n?.enabled
          ? 'The fan follows it within a second.'
          : fan?.schedule === 'skipped'
            ? `Quiet at night resumes at ${n.start}.`
            : `Quiet at night: ${nameOf(n.profile)} from ${n.start}.`
        note(res.applied ? `${name} is active. ${after}` : `${name} is saved. It applies once the dashboard can drive the fan.`, 'ok')
        if (res.reboot_required) H.reboot.hidden = false
        if (!tabPinned) tab = res.active
      } finally {
        busy = null
        renderPads()
        renderEditor()
      }
    }, (err) => note(`Couldn’t switch: ${err.message}`, 'bad'))
  }

  // ---------------------------------------------------------------- hero: Quiet at night (docs/API.md "PUT /api/fan/night")
  // The Pi runs the schedule on its own clock: the card says what fan.schedule reports and keeps no timer of its own.

  function renderNight() {
    const n = data?.night
    H.night.hidden = !n // a backend from before the schedule sends no `night`
    if (!n) return
    const gate = canChange()
    H.nightSwitch.setAttribute('aria-checked', String(n.enabled))
    H.nightSwitch.disabled = !gate.configured
    // aria-disabled, not disabled, while a change is in flight: the switch keeps the focus
    H.nightSwitch.setAttribute('aria-disabled', String(nightBusy))
    H.nightSwitch.title = gate.configured ? '' : gate.why
    H.nightEdit.hidden = !gate.configured
    if (!gate.configured && !H.nightForm.hidden) openNight(false)
    const P = esc(nameOf(n.profile))
    const A = esc(nameOf(data.active))
    const [start, end] = [esc(n.start), esc(n.end)]
    const s = fan?.schedule
    const html = !n.enabled
      ? `Off. When on: ${P} from ${start} to ${end}.`
      : s === 'night'
        ? `${P} now, until ${end}, then ${A}.`
        : s === 'skipped'
          ? `Paused tonight: ${A} runs. ${P} again from ${start}. <button class="textbtn" type="button" data-resume>Resume now</button>`
          : `${P} from ${start} to ${end}, ${A} the rest of the day.`
    // written only on a change: the live region speaks once, and a focused Resume now stays put
    if (html !== nightHTML) H.nightStatus.innerHTML = nightHTML = html
  }

  function openNight(open) {
    H.nightForm.hidden = !open
    H.nightEdit.setAttribute('aria-expanded', String(open))
    H.nightError.hidden = true
    if (!open) return
    const n = data.night
    H.nightProfile.innerHTML = data.profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
    H.nightProfile.value = n.profile
    H.nightStart.value = n.start
    H.nightEnd.value = n.end
    // the Pi's wall clock: the skew-corrected time plus the Pi's offset, so it is printed as UTC on purpose
    H.nightClock.hidden = utcOffset == null
    if (utcOffset != null)
      H.nightClock.textContent = `The Pi’s clock says ${new Date((Date.now() / 1000 + skew + utcOffset) * 1000).toISOString().slice(11, 16)}. The times are the Pi’s.`
  }
  const closeNight = () => {
    openNight(false)
    H.nightEdit.focus()
  }
  function nightError(msg) {
    H.nightError.hidden = false
    H.nightError.innerHTML = `${ico(TriangleAlert)}<span>${esc(msg)}</span>`
  }

  // The reply says what runs now, so the card follows at once rather than at the next tick. `done` runs on success.
  function putNight(body, done) {
    if (nightBusy) return
    requireAuth(async () => {
      nightBusy = true
      renderNight()
      try {
        const res = await api('/api/fan/night', { method: 'PUT', body })
        data.night = res.night
        if (fan?.available) fan = { ...fan, profile: res.profile, schedule: res.schedule }
        if (!tabPinned) tab = running()
        done?.()
        note('') // a pick's note ("Quiet at night resumes at …") is stale once the schedule changes
        renderLive()
        renderPads()
        renderEditor()
      } finally {
        nightBusy = false
        renderNight()
      }
    }, (err) => (H.nightForm.hidden ? note(`Couldn’t change the night schedule: ${err.message}`, 'bad') : nightError(err.message)))
  }

  H.nightSwitch.addEventListener('click', () => data?.night && putNight({ ...data.night, enabled: !data.night.enabled }))
  H.nightStatus.addEventListener('click', (e) => {
    // the same settings again end tonight's pause; the button goes with it, so the focus moves to the switch
    if (e.target.closest('[data-resume]')) putNight({ ...data.night }, () => H.nightSwitch.focus())
  })
  H.nightEdit.addEventListener('click', () => openNight(H.nightForm.hidden))
  H.nightCancel.addEventListener('click', closeNight)
  H.nightForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const body = { enabled: true, profile: H.nightProfile.value, start: H.nightStart.value, end: H.nightEnd.value }
    if (body.start === body.end) return nightError('Pick different start and end times.')
    putNight(body, closeNight)
  })

  // ---------------------------------------------------------------- editor

  const tabs = R.tabs
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[role=tab]')
    if (!b) return
    tab = b.dataset.v
    tabPinned = true
    renderEditor()
  })
  tabs.addEventListener('keydown', (e) => {
    const list = [...tabs.querySelectorAll('[role=tab]')]
    const i = list.indexOf(document.activeElement)
    if (i < 0) return
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key]
    if (j == null) return
    e.preventDefault()
    const b = list[(j + list.length) % list.length]
    b.focus()
    tab = b.dataset.v
    tabPinned = true
    renderEditor()
  })

  function renderTabs() {
    const have = new Map([...tabs.children].map((b) => [b.dataset.v, b]))
    for (const p of data.profiles) {
      let b = have.get(p.id)
      if (!b) {
        b = el(`<button type="button" role="tab" id="fan-tab-${p.id}" data-v="${p.id}" aria-controls="fan-panel"></button>`)
        tabs.append(b)
      }
      b.textContent = p.name
      const on = p.id === tab
      b.setAttribute('aria-selected', String(on))
      b.tabIndex = on ? 0 : -1
      b.classList.toggle('is-active', p.id === running())
      b.classList.toggle('is-parked', p.id === running() && fan?.mode === 'kernel')
      b.classList.toggle('is-dirty', p.id === 'custom' && !!dirty())
    }
    R.wrap.setAttribute('aria-labelledby', `fan-tab-${tab}`)
  }

  // --- geometry: tick labels sit a full hit-area (GRAB) outside the plot, so a handle on an edge never covers them
  const M = { l: 44 + GRAB, r: 18, t: 22, b: 36 + GRAB }
  const X = (t) => M.l + ((t - X0) / (X1 - X0)) * (size.w - M.l - M.r)
  const Y = (s) => M.t + (1 - s / 100) * (size.h - M.t - M.b)
  const toData = (e) => {
    const r = svg.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    return { t: X0 + ((x - M.l) / (size.w - M.l - M.r)) * (X1 - X0), s: (1 - (y - M.t) / (size.h - M.t - M.b)) * 100 }
  }

  new ResizeObserver(() => {
    const r = R.wrap.getBoundingClientRect()
    size = { w: r.width, h: r.height }
    svg.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`)
    renderGraph()
  }).observe(R.wrap)

  // persistent layers: the static drawing is re-rendered, handles are kept so focus survives
  svg.innerHTML = `
    <defs>
      <pattern id="keepout" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(255,95,85,0.22)" stroke-width="1.2"/>
      </pattern>
    </defs>
    <g data-l="static"></g>
    <rect class="hit" data-l="hit" fill="transparent"/>
    <g data-l="trail"></g>
    <g data-l="live"></g>
    <g data-l="handles"></g>
    <text class="tip" data-l="tip" text-anchor="middle"></text>`
  const L = Object.fromEntries([...svg.querySelectorAll('[data-l]')].map((n) => [n.dataset.l, n]))
  // Chromium ignores touch-action on SVG <g> (#8): .curve lets the page pan, and this guard keeps a touch that starts on
  // a point of the editable curve for the drag, so any other touch scrolls the page. On touchmove, not touchstart:
  // cancelling touchstart would also cancel the double-tap that removes a point
  svg.addEventListener('touchmove', (e) => { if (editable() && e.target.closest?.('.handle')) e.preventDefault() }, { passive: false })

  function pathOf(fn, from = X0, to = 80) {
    let d = ''
    for (let t = from; t <= to + 1e-9; t += 0.25) d += `${d ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(fn(t)).toFixed(1)}`
    return d
  }

  function renderGraph() {
    if (!data || !size.w) return
    const p = viewed()
    if (!p) return
    const c = C()
    const h = p.hysteresis_c
    const pts = p.points
    const rise = (t) => guard(speedAt(pts, t), c.min_running_pct)
    const fall = (t) => guard(speedAt(pts, t + h), c.min_running_pct)
    const x80 = X(80)
    const x90 = X(X1)
    let s = ''
    for (let t = X0; t <= X1; t += 10) s += `<line class="grid-line" x1="${X(t)}" x2="${X(t)}" y1="${Y(100)}" y2="${Y(0)}"/><text x="${X(t)}" y="${Y(0) + GRAB + 12}" text-anchor="middle">${t}°</text>`
    for (const v of [0, 25, 50, 75, 100]) s += `<line class="${v ? 'grid-line' : 'axis'}" x1="${X(X0)}" x2="${x90}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${M.l - GRAB - 4}" y="${Y(v) + 4}" text-anchor="end">${v}${'\u00a0'}%</text>`
    s += `<text x="${x90}" y="${Y(0) + GRAB + 28}" text-anchor="end">SoC temperature →</text>`
    // keep-out: the failsafe owns everything from 80 °C
    s += `<rect x="${x80}" y="${Y(100)}" width="${x90 - x80}" height="${Y(0) - Y(100)}" fill="url(#keepout)"/>`
    s += `<line class="keepout-line" x1="${x80}" x2="${x80}" y1="${Y(100) - 6}" y2="${Y(0)}"/>`
    s += `<text class="keepout-label" x="${(x80 + x90) / 2}" y="${Y(50)}" text-anchor="middle">FAILSAFE</text><text class="keepout-label" x="${(x80 + x90) / 2}" y="${Y(50) + 14}" text-anchor="middle">100${'\u00a0'}%</text>`
    // stall guard, labelled at the right so it never sits on the axis labels; it ends where the failsafe takes over
    s += `<line class="stall" x1="${X(X0)}" x2="${x80}" y1="${Y(c.min_running_pct)}" y2="${Y(c.min_running_pct)}"/>`
    s += `<text x="${x80 - 10}" y="${Y(c.min_running_pct) - 6}" text-anchor="end">min. running ${c.min_running_pct}${'\u00a0'}%</text>`
    // hysteresis band between the heating and cooling curves
    if (h > 0) {
      let band = ''
      for (let t = X0; t <= 80 + 1e-9; t += 0.25) band += `${band ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(rise(t)).toFixed(1)}`
      for (let t = 80; t >= X0 - 1e-9; t -= 0.25) band += `L${X(t).toFixed(1)} ${Y(fall(t)).toFixed(1)}`
      s += `<path class="band" d="${band}Z"/><path class="falling" d="${pathOf(fall)}"/>`
    }
    // the user's points joined (thin, only visible where the stall guard lifts the real curve)
    s += `<path class="falling" style="stroke-dasharray:1 3" d="M${pts.map((q) => `${X(q.temp_c)} ${Y(q.speed_pct)}`).join('L')}"/>`
    s += `<path class="line" d="${pathOf(rise)}L${x80} ${Y(100)}L${x90} ${Y(100)}"/>`
    L.static.innerHTML = s
    Object.assign(L.hit.attributes, {})
    L.hit.setAttribute('x', X(X0))
    L.hit.setAttribute('y', Y(100))
    L.hit.setAttribute('width', x80 - X(X0))
    L.hit.setAttribute('height', Y(0) - Y(100))
    renderLiveOverlay()
    renderHandles()
  }

  function renderLiveOverlay() {
    L.trail.innerHTML = ''
    L.live.innerHTML = ''
    const p = viewed()
    if (!p || !fan?.available || fan.control_temp_c == null || !size.w) return
    const c = C()
    const t = fan.control_temp_c
    const isActive = running() === tab && fan.mode !== 'kernel'
    const color = rampAt(heat(t))
    const tx = X(clamp(t, X0, X1))
    let out = `<line class="live-guide" x1="${tx}" x2="${tx}" y1="${Y(100)}" y2="${Y(0)}" stroke="${color}"/>`
    // the label sits on the cool side of the marker, high on the guide, where the curve rarely is
    const lab = (text) => {
      const left = tx > size.w * 0.45
      return `<text class="live-label" x="${tx + (left ? -10 : 10)}" y="${Y(88)}" text-anchor="${left ? 'end' : 'start'}">${esc(text)}</text>`
    }
    if (isActive) {
      // the real fan: the last 90 s of (temperature, speed) as a trail, and where it is now
      const hs = history()
      if (hs?.series && !prefs.lowPower) {
        const temps = hs.series.soc_temp_c
        const speeds = hs.series.fan_pct
        const n = Math.min(90, temps.length)
        let dots = ''
        for (let i = temps.length - n; i < temps.length; i++) {
          if (temps[i] == null || speeds[i] == null) continue
          const k = (i - (temps.length - n)) / n
          dots += `<circle cx="${X(clamp(temps[i], X0, X1)).toFixed(1)}" cy="${Y(speeds[i]).toFixed(1)}" r="2" fill="${rampAt(heat(temps[i]))}" opacity="${(0.1 + 0.5 * k).toFixed(2)}"/>`
        }
        L.trail.innerHTML = dots
      }
      const sp = fan.target_pct ?? fan.speed_pct
      out += `<circle cx="${tx}" cy="${Y(sp)}" r="6" fill="${color}" stroke="#07110d" stroke-width="2"/>`
      out += lab(`Now ${fmt.temp(t)} · ${fmt.pct(sp, 0)}`)
    } else {
      const sp = t >= 80 ? 100 : guard(speedAt(p.points, t), c.min_running_pct)
      out += `<circle cx="${tx}" cy="${Y(sp)}" r="5" fill="none" stroke="${color}" stroke-width="2"/>`
      out += lab(`If ${p.name} were on: ${fmt.pct(sp, 0)} at ${fmt.temp(t)}`)
    }
    L.live.innerHTML = out
    // a preview label ("If Performance were on: …") is wider than the room beside the marker on a narrow phone: it slides
    // along its line to stay on the chart instead of running off the screen or widening the page
    const label = L.live.querySelector('.live-label')
    const w = label.getComputedTextLength()
    const lo = label.getAttribute('text-anchor') === 'end' ? w : 0
    label.setAttribute('x', clamp(Number(label.getAttribute('x')), lo, size.w - w + lo))
  }

  function pointLabel(q, i, n) {
    return `Point ${i + 1} of ${n}: ${q.temp_c} °C, ${q.speed_pct} % fan speed`
  }

  function renderHandles() {
    const p = viewed()
    const pts = p.points
    const edit = editable()
    const g = L.handles
    while (g.children.length > pts.length) g.lastChild.remove()
    while (g.children.length < pts.length) {
      const i = g.children.length
      const h = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      h.setAttribute('class', 'handle')
      h.innerHTML = `<rect class="grab" x="${-GRAB}" y="${-GRAB}" width="${GRAB * 2}" height="${GRAB * 2}"/><rect class="ring" x="-10" y="-10" width="20" height="20" rx="2"/><rect class="knob" x="-5.5" y="-5.5" width="11" height="11" rx="1.5"/>`
      h.dataset.i = i
      bindHandle(h)
      g.append(h)
    }
    pts.forEach((q, i) => {
      const h = g.children[i]
      h.setAttribute('transform', `translate(${X(q.temp_c).toFixed(1)} ${Y(q.speed_pct).toFixed(1)})`)
      h.classList.toggle('drag', drag?.i === i)
      if (edit) {
        h.setAttribute('tabindex', '0')
        h.setAttribute('role', 'button')
        h.setAttribute('aria-roledescription', 'curve point')
        h.setAttribute('aria-label', pointLabel(q, i, pts.length))
        h.setAttribute('aria-describedby', 'curve-help')
        h.style.cursor = ''
      } else {
        h.removeAttribute('tabindex')
        h.setAttribute('role', 'img')
        h.removeAttribute('aria-roledescription')
        h.setAttribute('aria-label', pointLabel(q, i, pts.length))
        h.removeAttribute('aria-describedby')
        h.style.cursor = 'default'
      }
    })
    const ti = drag?.i ?? tipIndex
    if (ti != null && pts[ti]) {
      const q = pts[ti]
      const x = X(q.temp_c)
      const above = Y(q.speed_pct) > M.t + 30
      L.tip.setAttribute('x', clamp(x, M.l + 40, size.w - 50))
      L.tip.setAttribute('y', Y(q.speed_pct) + (above ? -20 : 28))
      L.tip.textContent = `${q.temp_c} °C · ${q.speed_pct} %`
    } else L.tip.textContent = ''
    if (focusIndex != null) {
      g.children[Math.min(focusIndex, pts.length - 1)]?.focus()
      focusIndex = null
    }
  }

  function commit(points) {
    draft.points = points
    renderEditor()
  }

  function bindHandle(h) {
    const idx = () => Number(h.dataset.i)
    h.addEventListener('pointerdown', (e) => {
      if (!editable() || e.button !== 0) return
      e.preventDefault()
      h.setPointerCapture(e.pointerId)
      drag = { i: idx(), id: e.pointerId }
      h.focus({ preventScroll: true })
      renderHandles()
    })
    h.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return
      const { t, s } = toData(e)
      const next = movePoint(draft.points, drag.i, t, s, C())
      if (next[drag.i].temp_c !== draft.points[drag.i].temp_c || next[drag.i].speed_pct !== draft.points[drag.i].speed_pct) commit(next)
    })
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return
      drag = null
      renderEditor()
    }
    h.addEventListener('pointerup', end)
    h.addEventListener('pointercancel', end)
    h.addEventListener('dblclick', () => {
      if (!editable()) return
      const next = removePoint(draft.points, idx(), C())
      if (next) {
        focusIndex = Math.max(0, idx() - 1)
        commit(next)
      }
    })
    h.addEventListener('focus', () => {
      tipIndex = idx()
      renderHandles()
      R.rows.children[idx()]?.classList.add('focus')
    })
    h.addEventListener('blur', () => {
      tipIndex = null
      renderHandles()
      R.rows.children[idx()]?.classList.remove('focus')
    })
    h.addEventListener('keydown', (e) => {
      if (!editable()) return
      const i = idx()
      const q = draft.points[i]
      const k = e.shiftKey ? 5 : 1
      const move = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, k], ArrowDown: [0, -k], PageUp: [0, 10], PageDown: [0, -10] }[e.key]
      if (move) {
        e.preventDefault()
        focusIndex = i
        commit(movePoint(draft.points, i, q.temp_c + move[0], q.speed_pct + move[1], C()))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const next = removePoint(draft.points, i, C())
        if (next) {
          focusIndex = Math.max(0, i - 1)
          commit(next)
        }
      }
    })
  }

  L.hit.addEventListener('click', (e) => {
    if (!editable()) return
    const { t, s } = toData(e)
    const res = insertPoint(draft.points, t, s, C())
    if (!res) {
      R.error.hidden = false
      R.error.innerHTML = `${ico(Info)}<span>${draft.points.length >= C().points_max ? `A curve can have at most ${C().points_max} points.` : 'There is already a point at that temperature.'}</span>`
      return
    }
    focusIndex = res.index
    commit(res.points)
  })

  // --- points table
  function renderTable() {
    const p = viewed()
    const edit = editable()
    const pts = p.points
    const rows = R.rows
    const c = C()
    const want = pts.length
    if (rows.children.length !== want || rows.dataset.edit !== String(edit)) {
      rows.dataset.edit = String(edit)
      rows.innerHTML = pts
        .map(
          (_, i) => `<tr><td>${i + 1}</td>
          <td>${edit ? `<span class="cell-in"><input type="number" inputmode="numeric" data-i="${i}" data-k="temp_c" min="${c.temp_min_c}" max="${c.temp_max_c}" step="1" aria-label="Point ${i + 1} temperature in °C"/><span class="unit">°C</span></span>` : '<span data-k="temp_c"></span>'}</td>
          <td>${edit ? `<span class="cell-in"><input type="number" inputmode="numeric" data-i="${i}" data-k="speed_pct" min="0" max="100" step="1" aria-label="Point ${i + 1} fan speed in %"/><span class="unit">%</span></span>` : '<span data-k="speed_pct"></span>'}</td>
          <td>${edit ? `<button class="rm" type="button" data-rm="${i}" aria-label="Remove point ${i + 1}">${ico(Trash)}</button>` : ''}</td></tr>`,
        )
        .join('')
    }
    pts.forEach((q, i) => {
      const row = rows.children[i]
      for (const k of ['temp_c', 'speed_pct']) {
        const n = row.querySelector(`[data-k=${k}]`)
        if (n.tagName === 'INPUT') {
          if (document.activeElement !== n) n.value = q[k]
        } else n.textContent = k === 'temp_c' ? `${q[k]} °C` : `${q[k]} %`
      }
      const rm = row.querySelector('.rm')
      if (rm) rm.disabled = pts.length <= c.points_min
    })
  }
  R.rows.addEventListener('change', (e) => {
    const n = e.target
    if (!n.matches('input') || !editable()) return
    const i = Number(n.dataset.i)
    const q = draft.points[i]
    const v = Number(n.value)
    if (!Number.isFinite(v)) {
      n.value = q[n.dataset.k]
      return
    }
    const next = movePoint(draft.points, i, n.dataset.k === 'temp_c' ? v : q.temp_c, n.dataset.k === 'speed_pct' ? v : q.speed_pct, C())
    n.value = next[i][n.dataset.k]
    commit(next)
  })
  R.rows.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) e.target.dispatchEvent(new Event('change', { bubbles: true }))
  })
  R.rows.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]')
    if (!b || !editable()) return
    const next = removePoint(draft.points, Number(b.dataset.rm), C())
    if (next) commit(next)
  })

  // --- hysteresis
  const setHyst = (v) => {
    if (!editable()) return
    draft.hysteresis_c = clamp(Math.round(v), 0, C().hysteresis_max_c)
    renderEditor()
  }
  R['hyst-dn'].addEventListener('click', () => setHyst(draft.hysteresis_c - 1))
  R['hyst-up'].addEventListener('click', () => setHyst(draft.hysteresis_c + 1))
  R.hyst.addEventListener('change', () => setHyst(Number(R.hyst.value) || 0))

  // --- actions
  // under the kernel curve the chosen profile is saved but not running
  const drives = () => (fan?.mode === 'kernel' ? 'is saved; the kernel curve drives the fan for now' : 'is driving the fan')

  function button(label, icon, kind, fn, opts = {}) {
    const b = el(`<button class="pad ${kind}" type="button">${icon ? ico(icon) : ''}<span>${label}</span></button>`)
    b.disabled = !!opts.disabled
    if (opts.busy) b.dataset.busy = ''
    if (opts.title) b.title = opts.title
    b.addEventListener('click', fn)
    return b
  }

  // The bar under the tabs (#7): the tab on view either drives the fan (a status line) or is a preview, with the one
  // action that makes it run. A live region, so it is rebuilt only when what it says changes, not at every drag step
  function renderPreview() {
    // it holds still while a point is dragged: a change in its height would move the chart under the finger. The drag's
    // end renders it
    if (drag) return
    const box = R.preview
    const run = profile(running())
    const p = viewed()
    let mode = ''
    let msg = ''
    let pad = null
    if (run && p) {
      const edits = tab === 'custom' && dirty()
      if (tab === running() && !edits) {
        mode = 'running'
        msg = `${p.name} ${drives()}`
      } else {
        mode = 'preview'
        const follows = fan?.mode === 'kernel' ? 'the kernel curve drives the fan' : `the fan follows ${run.name}`
        const runs = tab === running()
        msg = !edits ? `Preview: ${follows}, not ${p.name}.` : runs ? 'Your edits aren’t saved: the fan follows the saved Custom curve.' : `Preview of your edits: ${follows}.`
        if (canChange().configured) {
          const saving = busy === 'save'
          if (!edits) pad = [tab === 'custom' ? 'Use custom' : `Use ${esc(p.name)}`, () => activate(tab), { disabled: !!busy, busy: busy === tab }]
          else pad = [runs ? 'Save and apply' : 'Save and use', () => save(!runs), { disabled: !!validateCurve(draft, C()) || saving, busy: saving }]
        }
      }
    }
    const key = [mode, msg, pad?.[0], pad?.[2].disabled, pad?.[2].busy].join('|')
    if (key === previewKey) return
    previewKey = key
    box.dataset.mode = mode
    box.replaceChildren()
    if (mode === 'running') box.append(el(`<p class="active-note">${badgeHTML('', '')}<span>${esc(msg)}</span></p>`))
    else if (mode) box.append(el(`<p>${esc(msg)}</p>`))
    if (pad) box.append(button(pad[0], null, '', pad[1], pad[2]))
  }

  function renderActions() {
    const box = R.actions
    box.replaceChildren()
    const gate = canChange()
    const p = viewed()
    if (!gate.configured) {
      box.append(el(`<p class="notice">${ico(Lock)}<span>${gate.why}</span></p>`))
      return
    }
    // the aside keeps the secondary actions: the status line, Use and Save and use are the preview bar's (#7)
    if (tab !== 'custom') {
      box.append(
        button('Customise a copy', Copy, 'pad-ghost', () => {
          draft = copyCurve(p)
          tab = 'custom'
          tabPinned = true
          renderEditor()
          R.tabs.querySelector('[data-v=custom]')?.focus()
        }),
      )
      return
    }
    const d = dirty()
    const invalid = validateCurve(draft, C())
    const saving = busy === 'save'
    if (d) {
      if (running() !== 'custom') box.append(button('Save curve', null, 'pad-ghost', () => save(false), { disabled: !!invalid || saving, busy: saving }))
      box.append(button('Revert', RotateCcw, 'pad-ghost', () => {
        draft = copyCurve(base)
        R.error.hidden = true
        renderEditor()
      }))
    } else {
      box.append(
        button('Add point', Plus, 'pad-ghost', addPoint, { disabled: draft.points.length >= C().points_max, title: 'Adds a point in the widest gap' }),
      )
    }
    if (d) box.append(button('Add point', Plus, 'pad-ghost', addPoint, { disabled: draft.points.length >= C().points_max }))
  }

  function addPoint() {
    const pts = draft.points
    let best = null
    const c = C()
    const edges = [{ temp_c: c.temp_min_c - 1, speed_pct: pts[0].speed_pct }, ...pts, { temp_c: c.temp_max_c + 1, speed_pct: pts[pts.length - 1].speed_pct }]
    for (let i = 1; i < edges.length; i++) {
      const gap = edges[i].temp_c - edges[i - 1].temp_c
      if (gap > 1 && (!best || gap > best.gap)) best = { gap, t: (edges[i].temp_c + edges[i - 1].temp_c) / 2 }
    }
    if (!best) return
    const res = insertPoint(pts, best.t, speedAt(pts, best.t), c)
    if (!res) return
    focusIndex = res.index
    commit(res.points)
  }

  async function save(andUse) {
    const body = copyCurve(draft)
    const problem = validateCurve(body, C())
    if (problem) {
      R.error.hidden = false
      R.error.innerHTML = `${ico(TriangleAlert)}<span>${problem}</span>`
      return
    }
    await requireAuth(async () => {
      busy = 'save'
      R.error.hidden = true
      renderPreview()
      renderActions()
      try {
        const res = await api('/api/fan/profiles/custom', { method: 'PUT', body })
        const i = data.profiles.findIndex((p) => p.id === 'custom')
        data.profiles[i] = res.profile
        base = copyCurve(res.profile)
        draft = copyCurve(res.profile)
        data.active = res.active
        note(res.applied ? 'Custom curve saved and applied.' : 'Custom curve saved.', 'ok')
        if (res.reboot_required) H.reboot.hidden = false
      } finally {
        busy = null
      }
      renderPads()
      renderEditor()
      if (andUse) await activate('custom')
    }, (err) => {
      busy = null
      R.error.hidden = false
      R.error.innerHTML = `${ico(TriangleAlert)}<span>${err.code === 'invalid_curve' ? `The Pi rejected the curve: ${err.message}` : `Couldn’t save: ${err.message}`}</span>`
      renderPreview()
      renderActions()
    })
  }

  function renderEditor() {
    if (!data) return
    if (!tab) tab = running()
    const p = viewed()
    if (!p) return
    const c = C()
    renderTabs()
    renderPreview()
    const edit = editable()
    svg.toggleAttribute('data-editable', edit)
    R.desc.textContent = tab === 'custom' && dirty() ? 'Your edits are not saved yet.' : p.description
    const oo = onOff(p)
    // the section header always describes what runs, not the tab on view (#7)
    const run = profile(running())
    R.sum.textContent = run ? `${run.name}: ${summary(run, c)}` : summary(p, c)
    R['hyst-note'].textContent = oo
      ? `Turns on above ${oo.on}${'\u00a0'}°C and off again at ${oo.off}${'\u00a0'}°C.`
      : p.hysteresis_c
        ? `Speeds up at once, slows down ${p.hysteresis_c}${'\u00a0'}°C late.`
        : 'No hysteresis: speed follows the curve both ways.'
    R.hyst.value = p.hysteresis_c
    R.hyst.disabled = !edit
    R['hyst-dn'].disabled = !edit || p.hysteresis_c <= 0
    R['hyst-up'].disabled = !edit || p.hysteresis_c >= c.hysteresis_max_c
    R.help.textContent = edit
      ? `Drag a pad to move a point, click the graph to add one (up to ${c.points_max}), double-click or press Delete to remove one. Arrow keys move the focused point by 1 (Shift: 5). Solid line: speed while heating. Dashed: while cooling.`
      : tab === 'custom'
        ? `${canChange().why} Solid line: speed while heating. Dashed: while cooling.`
        : 'Built-in curves are fixed; “Customise a copy” starts the custom curve from this one. Solid line: speed while heating. Dashed: while cooling.'
    renderGraph()
    renderTable()
    renderActions()
  }

  return {
    setInfo(info) {
      limits = info?.limits ?? {}
      skew = info.server_time - Date.now() / 1000
      utcOffset = info.utc_offset_s ?? null
    },
    setProfiles(next) {
      const hadDirty = dirty()
      data = structuredClone(next)
      const custom = profile('custom')
      if (custom) {
        base = copyCurve(custom)
        if (!hadDirty || !draft) draft = copyCurve(custom)
      }
      if (!tabPinned || !profile(tab)) tab = running()
      renderPads()
      renderNight()
      renderEditor()
    },
    setFan(next, soc = null) {
      const changed = next?.mode !== fan?.mode || next?.profile !== fan?.profile || next?.schedule !== fan?.schedule
      fan = next
      socC = soc
      renderLive()
      // the pads, the tabs and the editor's "active" marks follow who drives the fan and the profile it runs (the night
      // schedule switches it by itself); the rest only needs the live marker
      if (changed) {
        if (!tabPinned) tab = running()
        renderPads()
        renderNight()
        renderEditor()
      } else renderLiveOverlay()
    },
    authChanged() {
      renderPads()
      renderNight()
      renderEditor()
    },
  }
}
