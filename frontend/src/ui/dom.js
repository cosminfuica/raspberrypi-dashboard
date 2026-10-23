// DOM helpers and number tweening: markup, data-ref lookup, text writes, badges, keyed lists, FLIP, radio groups.
import { createElement } from 'lucide'
import { prefs } from './prefs.js'

// ------------------------------------------------------------------ number tweening

const tweening = new Set()

function show(node, s) {
  if (node._s !== s) {
    node._s = s
    node.textContent = s
  }
}

/** Sets a node to a number, easing from the value it shows now (snapping in low-power mode and for reduced motion). */
export function tweenText(node, value, format, ms = 650) {
  if (value == null || !Number.isFinite(value)) {
    tweening.delete(node)
    node._shown = null
    show(node, format(null))
    return
  }
  if (!prefs.animate || node._shown == null || node._shown === value) {
    tweening.delete(node)
    node._shown = value
    show(node, format(value))
    return
  }
  // already easing to this value: a restart would slow it, and two places showing one reading would disagree (the
  // board's callouts are set on every message, the cards only when their section changes)
  if (tweening.has(node) && node._tw.to === value) return
  // t0 is the first frame's time, shared by every tween started in one task: a millisecond apart, two places easing to
  // the same reading would print different numbers on the steep start of the curve
  node._tw = { from: node._shown, to: value, t0: null, ms, format }
  tweening.add(node)
}

export function tickTweens(now) {
  for (const node of tweening) {
    const tw = node._tw
    tw.t0 ??= now
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
  createElement(node, {
    class: `ico ${cls}`.trim(),
    'aria-hidden': 'true',
    width: 16,
    height: 16,
    'stroke-width': 1.75,
  }).outerHTML

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

/** Runs `mutate` and animates rows of `parent` from their old to their new position (FLIP). Off in low power too. */
export function flip(parent, mutate) {
  if (!prefs.animate) return mutate()
  const before = new Map()
  for (const c of parent.children) before.set(c, c.getBoundingClientRect().top)
  mutate()
  for (const c of parent.children) {
    const top = before.get(c)
    if (top == null) {
      // a new row flashes its background instead of fading in: its text never passes through low contrast
      c.animate([{ backgroundColor: 'rgb(237 240 232 / 0.06)' }, { backgroundColor: 'rgb(237 240 232 / 0)' }], {
        duration: 900,
        easing: 'ease-out',
      })
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
