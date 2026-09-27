// Fan control: the live fan readout and profile pads (hero), and the curve editor (#fan).
// The editor draws exactly what the Pi's control loop does (curve.js mirrors docs/API.md "Curve semantics"):
// the curve with its stall guard, the cooling-side curve shifted by the hysteresis, and the failsafe above 80 °C.
import { TriangleAlert, Info, Plus, Trash, RotateCcw, Copy, Lock } from 'lucide'
import { api } from './net.js'
import { DEFAULT_CONSTRAINTS, speedAt, guard, movePoint, insertPoint, removePoint, validateCurve } from './curve.js'
import { el, refs, fmt, tweenText, badge, badgeHTML, rampAt, heat, prefs, clamp, ico } from './util.js'

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
    pads: hero.querySelector('[data-bind=pads]'),
    note: hero.querySelector('[data-bind=pads-note]'),
  }
  const R = refs(editor)
  const svg = R.svg
  H.reboot.insertAdjacentHTML('afterbegin', ico(TriangleAlert))

  let data = null // fan_profiles payload
  let fan = null // metrics.fan
  let limits = {}
  let tab = null
  let tabPinned = false
  let draft = null // editable copy of the custom curve
  let base = null // the server's custom curve the draft started from
  let busy = null // id of the profile being switched to, or 'save'
  let size = { w: 0, h: 0 }
  let drag = null
  let focusIndex = null
  let tipIndex = null

  const C = () => data?.constraints ?? DEFAULT_CONSTRAINTS
  const profile = (id) => data?.profiles.find((p) => p.id === id)
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
    H.temp.textContent = fmt.temp(f.control_temp_c)
    const name = profile(f.profile)?.name ?? f.profile
    if (f.mode === 'failsafe') badge(H.mode, 'bad', 'Failsafe · 100 %')
    else if (f.mode === 'kernel') badge(H.mode, 'info', 'Kernel curve')
    else badge(H.mode, 'ok', `Curve · ${name}`)
    let msg = ''
    if (f.mode === 'failsafe')
      msg = `The SoC reached ${limits.fan_failsafe_c ?? 80}${'\u00a0'}°C or can’t be read, so the fan is forced to full speed until it drops below ${limits.fan_failsafe_release_c ?? 75}${'\u00a0'}°C.`
    else if (f.mode === 'kernel')
      msg = 'The dashboard isn’t driving the fan (read-only), so the config.txt curve is in charge. Profile choices are saved and apply once fan control is enabled.'
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
      b.querySelector('.pad-hint').textContent = summary(cur, C())
      b.querySelector('path').setAttribute('d', miniPath(cur))
      b.setAttribute('aria-pressed', String(data.active === p.id))
      b.disabled = !gate.configured
      if (busy === p.id) b.dataset.busy = ''
      else delete b.dataset.busy
      b.title = gate.configured ? '' : gate.why
    })
    if (!gate.configured) note(gate.why)
  }

  async function activate(id) {
    if (!data || busy || id === data.active) return
    await requireAuth(async (token) => {
      busy = id
      renderPads()
      note(`Switching to ${profile(id).name}…`)
      try {
        const res = await api('/api/fan/profile', { method: 'PUT', body: { id }, token })
        data.active = res.active
        const name = profile(res.active)?.name ?? res.active
        note(res.applied ? `${name} is active. The fan follows it within a second.` : `${name} is saved. It applies once the dashboard can drive the fan.`, 'ok')
        if (res.reboot_required) H.reboot.hidden = false
        if (!tabPinned) tab = res.active
      } finally {
        busy = null
        renderPads()
        renderEditor()
      }
    }, (err) => note(`Couldn’t switch: ${err.message}`, 'bad'))
  }

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
        b = el(`<button type="button" role="tab" data-v="${p.id}" aria-controls="fan-panel"></button>`)
        tabs.append(b)
      }
      b.textContent = p.name
      const on = p.id === tab
      b.setAttribute('aria-selected', String(on))
      b.tabIndex = on ? 0 : -1
      b.classList.toggle('is-active', p.id === data.active)
      b.classList.toggle('is-dirty', p.id === 'custom' && !!dirty())
    }
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
    for (const v of [0, 25, 50, 75, 100]) s += `<line class="${v ? 'grid-line' : 'axis'}" x1="${X(X0)}" x2="${x90}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${M.l - GRAB - 4}" y="${Y(v) + 4}" text-anchor="end">${v}%</text>`
    s += `<text x="${x90}" y="${Y(0) + GRAB + 28}" text-anchor="end">SoC temperature →</text>`
    // keep-out: the failsafe owns everything from 80 °C
    s += `<rect x="${x80}" y="${Y(100)}" width="${x90 - x80}" height="${Y(0) - Y(100)}" fill="url(#keepout)"/>`
    s += `<line class="keepout-line" x1="${x80}" x2="${x80}" y1="${Y(100) - 6}" y2="${Y(0)}"/>`
    s += `<text class="keepout-label" x="${(x80 + x90) / 2}" y="${Y(50)}" text-anchor="middle">FAILSAFE</text><text class="keepout-label" x="${(x80 + x90) / 2}" y="${Y(50) + 14}" text-anchor="middle">100 %</text>`
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
    const isActive = data.active === tab && fan.mode !== 'kernel'
    const color = rampAt(heat(t))
    const tx = X(clamp(t, X0, X1))
    let out = `<line class="live-guide" x1="${tx}" x2="${tx}" y1="${Y(100)}" y2="${Y(0)}" stroke="${color}"/>`
    // the label sits on the cool side of the marker, high on the guide, where the curve rarely is
    const lab = (text) => {
      const left = tx > size.w * 0.45
      return `<text class="live-label" x="${tx + (left ? -10 : 10)}" y="${Y(88)}" text-anchor="${left ? 'end' : 'start'}">${text}</text>`
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
      out += lab(`At ${fmt.temp(t)}: ${fmt.pct(sp, 0)}`)
    }
    L.live.innerHTML = out
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
      h.innerHTML = `<rect class="grab" x="${-GRAB}" y="${-GRAB}" width="${GRAB * 2}" height="${GRAB * 2}"/><rect class="ring" x="-10" y="-10" width="20" height="20" rx="2"/><rect x="-5.5" y="-5.5" width="11" height="11" rx="1.5"/>`
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
      L.tip.setAttribute('y', Y(q.speed_pct) + (above ? -16 : 26))
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
  function button(label, icon, kind, fn, opts = {}) {
    const b = el(`<button class="pad ${kind}" type="button">${icon ? ico(icon) : ''}<span>${label}</span></button>`)
    b.disabled = !!opts.disabled
    if (opts.busy) b.dataset.busy = ''
    if (opts.title) b.title = opts.title
    b.addEventListener('click', fn)
    return b
  }

  function renderActions() {
    const box = R.actions
    box.replaceChildren()
    const gate = canChange()
    const p = viewed()
    if (!gate.configured) {
      box.append(el(`<p class="fine">${ico(Lock)} ${gate.why}</p>`))
      return
    }
    if (tab !== 'custom') {
      const active = data.active === tab
      // the active profile is a status line, not a dead button beside a live one
      if (active) box.append(el(`<p class="active-note">${badgeHTML('', '')}<span>${p.name} is driving the fan</span></p>`))
      else box.append(button(`Use ${p.name}`, null, '', () => activate(tab), { disabled: !!busy, busy: busy === tab }))
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
      box.append(button(data.active === 'custom' ? 'Save and apply' : 'Save curve', null, '', () => save(false), { disabled: !!invalid || saving, busy: saving }))
      if (data.active !== 'custom') box.append(button('Save and use', null, 'pad-ghost', () => save(true), { disabled: !!invalid || saving }))
      box.append(button('Revert', RotateCcw, 'pad-ghost', () => {
        draft = copyCurve(base)
        R.error.hidden = true
        renderEditor()
      }))
    } else {
      const active = data.active === 'custom'
      if (active) box.append(el(`<p class="active-note">${badgeHTML('', '')}<span>Custom is driving the fan</span></p>`))
      else box.append(button('Use custom', null, '', () => activate('custom'), { disabled: !!busy, busy: busy === 'custom' }))
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
    await requireAuth(async (token) => {
      busy = 'save'
      R.error.hidden = true
      renderActions()
      try {
        const res = await api('/api/fan/profiles/custom', { method: 'PUT', body, token })
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
      renderActions()
    })
  }

  function renderEditor() {
    if (!data) return
    if (!tab) tab = data.active
    const p = viewed()
    if (!p) return
    const c = C()
    renderTabs()
    const edit = editable()
    svg.toggleAttribute('data-editable', edit)
    R.desc.textContent = tab === 'custom' && dirty() ? 'Your edits are not saved yet.' : p.description
    const oo = onOff(p)
    R.sum.textContent = `${summary(p, c)}`
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
    },
    setProfiles(next) {
      const hadDirty = dirty()
      data = structuredClone(next)
      const custom = profile('custom')
      if (custom) {
        base = copyCurve(custom)
        if (!hadDirty || !draft) draft = copyCurve(custom)
      }
      if (!tabPinned || !profile(tab)) tab = data.active
      renderPads()
      renderEditor()
    },
    setFan(next) {
      fan = next
      renderLive()
      renderLiveOverlay()
    },
    authChanged() {
      renderPads()
      renderEditor()
    },
  }
}
