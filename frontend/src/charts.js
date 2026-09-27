// Canvas time-series charts and sparklines. They redraw on new data, hover and resize; a chart whose
// window is short enough for the scroll to be visible (≤ 2 min) also scrolls smoothly between samples.
import { prefs, rampRGB, T_MIN, T_MAX, RAMP, clamp } from './util.js'

const charts = new Set()
const ro = new ResizeObserver((entries) => {
  for (const e of entries) e.target._chart?.resize()
})
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const c = e.target._chart
    if (!c) continue
    c.visible = e.isIntersecting
    if (c.visible) {
      c.dirty = true
      wakeFn()
    }
  }
})

/** Server "now" that advances smoothly between 1 Hz samples. */
export const clock = {
  ts: null,
  at: 0,
  set(ts) {
    this.ts = ts
    this.at = performance.now()
  },
  now() {
    if (this.ts == null) return Date.now() / 1000
    return this.ts + Math.min(1.25, (performance.now() - this.at) / 1000)
  },
}

const INK = {
  grid: 'rgba(237,240,232,0.07)',
  axis: 'rgba(237,240,232,0.22)',
  label: '#8a9a90',
  cross: 'rgba(237,240,232,0.45)',
  bad: 'rgba(255,95,85,0.7)',
  warn: 'rgba(255,185,62,0.6)',
}
const FONT = "600 11px 'Archivo Variable', system-ui, sans-serif"
const CARD = '#0b1712' // the section background, used to knock labels out of the lines behind them
const HEAT_CSS = `linear-gradient(90deg, ${RAMP.map(([t, c]) => `rgb(${c.join(' ')}) ${t * 100}%`).join(', ')})`

// The page's frame loop registers here, so a chart that needs a redraw (hover, new window) can wake it.
let wakeFn = () => {}
export const setWake = (fn) => (wakeFn = fn)

/** A 1-1.5-2-2.5-3-4-5-6-8 ceiling, so the peak fills most of the plot. For byte rates, nice steps within the matching 1024 unit. */
export function niceCeil(v, bytes = false) {
  if (!(v > 0)) return 1
  let unit = 1
  if (bytes) while (v / unit >= 1024) unit *= 1024
  const x = v / unit
  const p = 10 ** Math.floor(Math.log10(x))
  const m = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((k) => k * p >= x - 1e-9)
  return m * p * unit
}

export class Chart {
  /**
   * opts:
   *  series: [{ get: () => number[], color, width, dash, fill, heat, label, fmt }]
   *  ts: () => number[]          sample timestamps aligned with every series
   *  window: () => seconds        visible span, right edge = now
   *  min, max                     fixed y range; omit max for auto-scaling
   *  floor                        minimum auto max
   *  bytes                        auto max snaps to byte units
   *  ticks: (lo, hi) => number[]  y grid values; tickFmt formats them
   *  marks: () => [{ y, label, tone }]
   *  mini                         sparkline: no axes, no hover
   *  timeFmt                      readout time label
   */
  constructor(canvas, opts) {
    if (!opts.mini && !canvas.parentElement.classList.contains('plot')) {
      // the plot box sizes the canvas, so a growing canvas buffer can never feed back into layout
      const box = document.createElement('div')
      box.className = 'plot'
      canvas.replaceWith(box)
      box.append(canvas)
    }
    this.c = canvas
    this.g = canvas.getContext('2d')
    this.o = { window: () => 600, min: 0, ...opts }
    this.w = 0
    this.h = 0
    this.dpr = 1
    this.ymax = null
    this.fade = 1
    this.hx = null
    this.dirty = true
    this.visible = false
    canvas._chart = this
    charts.add(this)
    ro.observe(canvas)
    io.observe(canvas)
    if (!this.o.mini) {
      this.bindHover()
      this.legend()
    }
  }

  /** Multi-series charts name their lines in the caption. */
  legend() {
    const cap = this.c.closest('figure')?.querySelector('figcaption')
    if (!cap || this.o.series.length < 2) return
    const keys = document.createElement('span')
    keys.className = 'keys'
    keys.setAttribute('aria-hidden', 'true')
    keys.innerHTML = this.o.series
      .map((s) => `<span class="key"><i class="${s.dash ? 'dash' : ''}" style="${s.heat ? `background:${HEAT_CSS}` : s.dash ? `color:${s.color}` : `background:${s.color}`}"></i>${s.label}</span>`)
      .join('')
    cap.append(keys)
  }

  resize() {
    const r = this.c.getBoundingClientRect()
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.w = r.width
    this.h = r.height
    this.c.width = Math.max(1, Math.round(r.width * this.dpr))
    this.c.height = Math.max(1, Math.round(r.height * this.dpr))
    this.dirty = true
    if (this.visible) this.draw()
    wakeFn()
  }

  /** New data arrived. `fade` crossfades the lines (used when the chart switches what it shows). */
  invalidate(fade = false) {
    this.dirty = true
    if (fade && !prefs.reduced) this.fade = 0
    wakeFn()
  }

  live() {
    return prefs.animate && this.o.window() <= 120
  }

  bindHover() {
    const fig = this.c.parentElement
    this.readout = document.createElement('div')
    this.readout.className = 'readout'
    this.readout.hidden = true
    fig.append(this.readout)
    const move = (e) => {
      const r = this.c.getBoundingClientRect()
      this.hx = clamp(e.clientX - r.left, 0, r.width)
      this.dirty = true
      wakeFn()
    }
    this.c.addEventListener('pointermove', move)
    this.c.addEventListener('pointerdown', move)
    this.c.addEventListener('pointerleave', () => {
      this.hx = null
      this.readout.hidden = true
      this.dirty = true
      wakeFn()
    })
  }

  draw() {
    const { g, w, h, o } = this
    if (!w || !h) return
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    g.clearRect(0, 0, w, h)

    const ts = o.ts() || []
    const win = o.window()
    const now = this.live() ? clock.now() : ts.length ? ts[ts.length - 1] : clock.now()
    const t0 = now - win
    const pad = o.mini ? { l: 1, r: 1, t: 2, b: 2 } : { l: 0, r: 0, t: 8, b: 18 }
    const ph = h - pad.t - pad.b
    let i0 = lowerBound(ts, t0 - 1)

    // y range, auto max eased toward its target
    const lo = o.min ?? 0
    let hi = o.max
    let settling = false
    if (hi == null) {
      let peak = 0
      for (const s of o.series) {
        const a = s.get() || []
        for (let i = i0; i < a.length; i++) if (a[i] != null && a[i] > peak) peak = a[i]
      }
      const target = Math.max(o.floor ?? 1, niceCeil(peak * 1.12, o.bytes))
      if (this.ymax == null || prefs.reduced) this.ymax = target
      else {
        this.ymax += (target - this.ymax) * 0.18
        if (Math.abs(target - this.ymax) / target > 0.002) settling = true
        else this.ymax = target
      }
      hi = this.ymax
    }
    // tick labels live in a gutter left of the plot, as wide as the widest label seen so far (so it never jitters)
    let ticks = []
    if (!o.mini) {
      g.font = FONT
      ticks = (o.ticks ? o.ticks(lo, o.max ?? niceCeil(hi, o.bytes)) : [lo, (lo + hi) / 2, hi])
        .filter((v) => v <= hi + 1e-9)
        .map((v) => ({ v, text: o.tickFmt ? o.tickFmt(v) : String(v) }))
      for (const k of ticks) this.gut = Math.max(this.gut ?? 0, Math.ceil(g.measureText(k.text).width) + 10)
      pad.l = this.gut ?? 0
    }
    const pw = w - pad.l - pad.r
    const X = (t) => pad.l + ((t - t0) / win) * pw
    const Y = (v) => pad.t + ph - ((v - lo) / (hi - lo || 1)) * ph

    // grid lines and their labels; threshold labels are drawn after the data, knocked out, so a line never strikes them
    const labels = []
    if (!o.mini) {
      g.textBaseline = 'middle'
      g.textAlign = 'right'
      g.fillStyle = INK.label
      for (const { v, text } of ticks) {
        const y = Math.round(Y(v)) + 0.5
        g.strokeStyle = v === lo ? INK.axis : INK.grid
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(pad.l, y)
        g.lineTo(pad.l + pw, y)
        g.stroke()
        g.fillText(text, pad.l - 8, y)
      }
      for (const m of o.marks?.() || []) {
        if (m.y == null || m.y > hi || m.y < lo) continue
        const y = Math.round(Y(m.y)) + 0.5
        g.strokeStyle = INK[m.tone] || INK.axis
        g.setLineDash([3, 3])
        g.beginPath()
        g.moveTo(pad.l, y)
        g.lineTo(pad.l + pw, y)
        g.stroke()
        g.setLineDash([])
        labels.push({ text: m.label, x: pad.l + pw, y, color: m.tone === 'bad' ? '#ff8f87' : '#ffc76b', align: 'right' })
      }
      g.fillStyle = INK.label
      g.textBaseline = 'top'
      const labs = win >= 600 ? ['10 min ago', '5 min ago', 'now'] : win >= 300 ? ['5 min ago', '2½ min ago', 'now'] : [`${win} s ago`, `${win / 2} s ago`, 'now']
      g.textAlign = 'left'
      g.fillText(labs[0], pad.l, h - 13)
      g.textAlign = 'center'
      g.fillText(labs[1], pad.l + pw / 2, h - 13)
      g.textAlign = 'right'
      g.fillText(labs[2], pad.l + pw, h - 13)
      g.textAlign = 'left'
    }

    // clip the plot so smooth scrolling never paints over the axes; the first draw sweeps in from the left
    let reveal = 1
    if (ts.length) {
      this.born ??= performance.now()
      reveal = prefs.animate ? Math.min(1, (performance.now() - this.born) / 900) : 1
      if (reveal < 1) settling = true
    }
    g.save()
    g.beginPath()
    g.rect(pad.l, 0, pw * (1 - (1 - reveal) ** 3), pad.t + ph + 1)
    g.clip()
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + 0.08)
      settling = true
    }
    g.globalAlpha = this.fade
    for (const s of o.series) {
      const a = s.get()
      if (!a || !a.length) continue
      const stroke = s.heat ? heatStroke(g, Y) : s.color
      // area
      if (s.fill) {
        const grad = g.createLinearGradient(0, pad.t, 0, pad.t + ph)
        grad.addColorStop(0, s.fill)
        grad.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = grad
        let open = false
        let lastX = 0
        g.beginPath()
        for (let i = i0; i < a.length; i++) {
          const v = a[i]
          if (v == null) {
            if (open) {
              g.lineTo(lastX, Y(lo))
              open = false
            }
            continue
          }
          const x = X(ts[i])
          if (!open) {
            g.moveTo(x, Y(lo))
            open = true
          }
          g.lineTo(x, Y(Math.min(v, hi)))
          lastX = x
        }
        if (open) g.lineTo(lastX, Y(lo))
        g.fill()
      }
      g.strokeStyle = stroke
      g.lineWidth = s.width ?? 1.6
      g.lineJoin = 'round'
      g.setLineDash(s.dash || [])
      g.beginPath()
      let pen = false
      for (let i = i0; i < a.length; i++) {
        const v = a[i]
        if (v == null) {
          pen = false
          continue
        }
        const x = X(ts[i])
        const y = Y(Math.min(v, hi))
        if (pen) g.lineTo(x, y)
        else g.moveTo(x, y)
        pen = true
      }
      g.stroke()
      g.setLineDash([])
    }
    g.globalAlpha = 1
    g.restore()

    // threshold labels, knocked out of whatever runs behind them
    g.font = FONT
    g.textBaseline = 'middle'
    for (const l of labels) {
      const tw = g.measureText(l.text).width
      const x = l.align === 'right' ? l.x - tw - 4 : l.x + 2
      const y = Math.max(8, l.y - 10)
      g.fillStyle = CARD
      g.fillRect(x - 3, y - 7, tw + 6, 14)
      g.fillStyle = l.color
      g.textAlign = 'left'
      g.fillText(l.text, x, y + 0.5)
    }

    // hover crosshair and readout
    if (this.hx != null && ts.length) {
      const t = t0 + ((this.hx - pad.l) / pw) * win
      let i = lowerBound(ts, t)
      if (i >= ts.length) i = ts.length - 1
      if (i > 0 && Math.abs(ts[i - 1] - t) < Math.abs(ts[i] - t)) i--
      if (ts[i] >= t0) {
        const x = X(ts[i])
        g.strokeStyle = INK.cross
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(Math.round(x) + 0.5, pad.t)
        g.lineTo(Math.round(x) + 0.5, pad.t + ph)
        g.stroke()
        const rows = []
        for (const s of o.series) {
          const v = s.get()?.[i]
          if (v != null) {
            g.fillStyle = s.heat ? rgb(rampRGB((v - T_MIN) / (T_MAX - T_MIN))) : s.color
            g.beginPath()
            g.arc(x, Y(Math.min(v, hi)), 3, 0, Math.PI * 2)
            g.fill()
          }
          rows.push(`<span><i style="background:${s.heat ? HEAT_CSS : s.color}"></i>${s.label}: <b>${s.fmt(v ?? null)}</b></span>`)
        }
        const ago = Math.max(0, Math.round((ts[ts.length - 1] ?? now) - ts[i]))
        this.readout.innerHTML = `<span class="dim">${ago ? `${o.timeFmt ? o.timeFmt(ago) : `${ago} s ago`}` : 'latest'}</span>${rows.join('')}`
        this.readout.hidden = false
        const rw = this.readout.offsetWidth
        this.readout.style.left = `${clamp(x + 12 > w - rw ? x - rw - 12 : x + 12, 0, Math.max(0, w - rw))}px`
      }
    }
    this.dirty = settling || this.hx != null
  }
}

const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`
function heatStroke(g, Y) {
  const y0 = Y(T_MAX)
  const y1 = Y(T_MIN)
  const grad = g.createLinearGradient(0, y1, 0, y0)
  for (const [t, c] of RAMP) grad.addColorStop(t, rgb(c))
  return grad
}

function lowerBound(a, v) {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (a[m] < v) lo = m + 1
    else hi = m
  }
  return lo
}

export function drawCharts() {
  for (const c of charts) if (c.visible && (c.dirty || c.live())) c.draw()
}
export function invalidateCharts() {
  for (const c of charts) c.dirty = true
}
/** True while some visible chart still needs frames (new data, hover, easing or smooth scrolling). */
export function chartsBusy() {
  for (const c of charts) if (c.visible && (c.dirty || c.live())) return true
  return false
}
