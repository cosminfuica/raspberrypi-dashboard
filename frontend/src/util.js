// Shared helpers: the thermal palette, preferences, number formatting and tweening, small DOM utilities.
import { createElement } from 'lucide'

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ------------------------------------------------------------------ preferences

const read = (k) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {
    /* storage blocked: the preference lasts for this page only */
  }
}
export const store = { read, write }

const reducedMq = matchMedia('(prefers-reduced-motion: reduce)')
export const prefs = {
  get reduced() {
    return reducedMq.matches
  },
  lowPower: read('pidash.lowpower') === '1',
  setLowPower(on) {
    this.lowPower = on
    write('pidash.lowpower', on ? '1' : null)
  },
  /** Continuous motion (scrolling charts, the 3D sway, spinning blades). Off for reduced motion and in low-power mode. */
  get animate() {
    return !this.reduced && !this.lowPower
  },
}
export const onReducedChange = (fn) => reducedMq.addEventListener('change', fn)

// ------------------------------------------------------------------ palette

/**
 * Heated metal: cool board → dim copper → copper → orange → yellow → white-hot, luminance rising all the way.
 * Temperatures are the only thing drawn with it; health states use the LED colours in style.css.
 */
// stops sit early, so the everyday 40-65 °C band crosses brown, copper and orange: a warm part reads warm
export const RAMP = [
  [0.0, [51, 66, 60]],
  [0.2, [125, 90, 62]],
  [0.38, [193, 122, 66]],
  [0.56, [238, 141, 52]],
  [0.76, [255, 192, 77]],
  [1.0, [255, 244, 220]],
]

export function rampRGB(t) {
  t = clamp(t, 0, 1)
  for (let i = 1; i < RAMP.length; i++) {
    const [t1, c1] = RAMP[i]
    if (t <= t1) {
      const [t0, c0] = RAMP[i - 1]
      const k = (t - t0) / (t1 - t0)
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k))
    }
  }
  return RAMP[RAMP.length - 1][1]
}
export const rampCSS = (t, a = 1) => {
  const [r, g, b] = rampRGB(t)
  return a === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`
}
const LUT = Array.from({ length: 256 }, (_, i) => rampCSS(i / 255))
export const rampAt = (t) => LUT[Math.round(clamp(t, 0, 1) * 255)]
export const rampGradient = (dir = 'to right') =>
  `linear-gradient(${dir}, ${RAMP.map(([t, c]) => `rgb(${c.join(' ')}) ${t * 100}%`).join(', ')})`

/** Dark or light ink for text sitting on the ramp colour at t (WCAG luminance crossover). */
export function inkOn(t) {
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = rampRGB(t)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.18 ? '#15100a' : '#ffffff'
}

/** One fixed temperature scale for every thermal colour on the page (the scale bar in the thermal view shows it). */
export const T_MIN = 30
export const T_MAX = 90
export const heat = (c) => (c == null ? 0 : clamp((c - T_MIN) / (T_MAX - T_MIN), 0, 1))

// ------------------------------------------------------------------ formatting

const NB = '\u00a0' // no-break space between a number and its unit (Archivo has no U+202F)
const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']

export const fmt = {
  temp: (c, d = 1) => (c == null ? '—' : `${c.toFixed(d)}${NB}°C`),
  deg: (c) => (c == null ? '—' : `${c.toFixed(1)}°`),
  pct: (p, d = 1) => (p == null ? '—' : `${p.toFixed(d)}${NB}%`),
  int: (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US')),
  fixed: (n, d) => (n == null ? '—' : n.toFixed(d)),
  bytes(b) {
    if (b == null) return '—'
    let i = 0
    let v = Math.abs(b)
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024
      i++
    }
    const d = i === 0 || v >= 100 ? 0 : 1
    return `${(Math.sign(b) * v).toFixed(d)}${NB}${units[i]}`
  },
  rate: (b) => (b == null ? '—' : `${fmt.bytes(b)}/s`),
  mhz: (m) => (m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(2)}${NB}GHz` : `${Math.round(m)}${NB}MHz`),
  dur(s, withSeconds = false) {
    if (s == null) return '—'
    s = Math.max(0, Math.floor(s))
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (d) return h ? `${d}${NB}d ${h}${NB}h` : `${d}${NB}d`
    if (h) return `${h}${NB}h ${m}${NB}min`
    if (m) return withSeconds ? `${m}${NB}min ${sec}${NB}s` : `${m}${NB}min`
    return `${sec}${NB}s`
  },
  date: (ts) =>
    ts == null
      ? '—'
      : new Date(ts * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  clock: (ts) => (ts == null ? '—' : new Date(ts * 1000).toLocaleTimeString(undefined, { hour12: false })),
}

// ------------------------------------------------------------------ number tweening

const tweening = new Set()

function show(node, s) {
  if (node._s !== s) {
    node._s = s
    node.textContent = s
  }
}

/** Sets a node to a number, easing from the value it shows now. `format` turns the number into text. */
export function tweenText(node, value, format, ms = 650) {
  if (value == null || !Number.isFinite(value)) {
    tweening.delete(node)
    node._shown = null
    show(node, format(null))
    return
  }
  if (prefs.reduced || node._shown == null || node._shown === value) {
    tweening.delete(node)
    node._shown = value
    show(node, format(value))
    return
  }
  node._tw = { from: node._shown, to: value, t0: performance.now(), ms, format }
  tweening.add(node)
}

export function tickTweens(now) {
  for (const node of tweening) {
    const tw = node._tw
    const p = Math.min(1, (now - tw.t0) / tw.ms)
    const e = p === 1 ? 1 : 1 - 2 ** (-10 * p) // exponential ease-out
    node._shown = tw.from + (tw.to - tw.from) * e
    show(node, tw.format(node._shown))
    if (p === 1) tweening.delete(node)
  }
}
export const tweenBusy = () => tweening.size > 0

// ------------------------------------------------------------------ DOM

export function el(markup) {
  const t = document.createElement('template')
  t.innerHTML = markup.trim()
  return t.content.firstElementChild
}

export function refs(root) {
  const r = {}
  for (const n of root.querySelectorAll('[data-ref]')) r[n.dataset.ref] = n
  return r
}

/** textContent that skips no-op writes; null and '' render as the contract's "—". */
export const setText = (node, s) => show(node, s == null || s === '' ? '—' : String(s))

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c])

/** A Lucide icon as markup (decorative, hidden from assistive tech). */
export const ico = (node, cls = '') =>
  createElement(node, { class: `ico ${cls}`.trim(), 'aria-hidden': 'true', width: 16, height: 16, 'stroke-width': 1.75 }).outerHTML

/** Sets a status badge: <span class="badge"><i></i><span></span></span>. */
export function badge(node, tone, label) {
  if (node.dataset.tone !== tone) node.dataset.tone = tone
  setText(node.lastElementChild, label)
}
export const badgeHTML = (ref = '', cls = '') =>
  `<span class="badge ${cls}"${ref ? ` data-ref="${ref}"` : ''}><i aria-hidden="true"></i><span></span></span>`

/** Keyed list rendering: reuses rows by key, keeps DOM order equal to `items`, removes rows that left. */
export function syncList(parent, items, keyOf, create, update) {
  const old = parent._rows || new Map()
  const next = new Map()
  let prev = null
  items.forEach((item, i) => {
    const k = keyOf(item)
    let row = old.get(k)
    if (!row) row = create(item)
    update(row, item, i)
    next.set(k, row)
    const want = prev ? prev.nextSibling : parent.firstChild
    if (row !== want) parent.insertBefore(row, want)
    prev = row
  })
  for (const [k, row] of old) if (!next.has(k)) row.remove()
  parent._rows = next
}

/** Runs `mutate` and animates rows of `parent` from their old to their new position (FLIP). */
export function flip(parent, mutate) {
  if (prefs.reduced) return mutate()
  const before = new Map()
  for (const c of parent.children) before.set(c, c.getBoundingClientRect().top)
  mutate()
  for (const c of parent.children) {
    const top = before.get(c)
    if (top == null) {
      c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' })
      continue
    }
    const dy = top - c.getBoundingClientRect().top
    if (Math.abs(dy) > 1)
      c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
        duration: 460,
        easing: 'cubic-bezier(.2,.75,.1,1)',
      })
  }
}

/** Roving-tabindex radio group. `follow`: arrow keys also select (off where selecting has side effects). */
export function radioGroup(group, onSelect, { follow = true } = {}) {
  const radios = () => [...group.querySelectorAll('[role=radio]')].filter((b) => !b.disabled)
  group.addEventListener('click', (e) => {
    const b = e.target.closest('[role=radio]')
    if (b && !b.disabled && group.contains(b)) onSelect(b.dataset.v, b)
  })
  group.addEventListener('keydown', (e) => {
    const list = radios()
    const i = list.indexOf(document.activeElement)
    if (i < 0) return
    const k = e.key
    let j = null
    if (k === 'ArrowRight' || k === 'ArrowDown') j = (i + 1) % list.length
    else if (k === 'ArrowLeft' || k === 'ArrowUp') j = (i - 1 + list.length) % list.length
    else if (k === 'Home') j = 0
    else if (k === 'End') j = list.length - 1
    if (j == null) return
    e.preventDefault()
    list[j].focus()
    if (follow) onSelect(list[j].dataset.v, list[j])
  })
}
export function setChecked(group, v) {
  for (const b of group.querySelectorAll('[role=radio]')) {
    const on = b.dataset.v === v
    b.setAttribute('aria-checked', String(on))
    b.tabIndex = on ? 0 : -1
  }
}

export async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s)
    return true
  } catch {
    // Clipboard API needs a secure context; plain http://raspberrypi:8787 is not one.
    const ta = document.createElement('textarea')
    ta.value = s
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.append(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}
