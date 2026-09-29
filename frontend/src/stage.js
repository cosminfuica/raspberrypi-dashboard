// The hero stage: the 3D board (or its 2D assembly drawing in low-power mode), with live callouts whose
// leader lines route to their parts at 0°/45°/90°, like traces.
import { BOARD, HOLES, HOLE_R, PARTS, FAN, SSD, CALLOUTS } from './board.js'
import { prefs, rampAt, heat, fmt, clamp, el, tweenText } from './util.js'

const P = PARTS
const FAN2D_Y = -50 // where the 2D drawing places the blower (mm, screen y), above the board
const SSD2D_Y = 48 // and the SSD, below it, clear of the port names under the board's edge
const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
/** A byte rate in at most three digits ("64 KiB/s", "1.2 MiB/s"): two of them fit a callout's one line. */
const rate = (b) => {
  let i = 0
  while (b >= 999.5 && i < UNITS.length - 1) {
    b /= 1024
    i++
  }
  return `${b >= 10 || i === 0 ? Math.round(b) : b.toFixed(1)}\u00a0${UNITS[i]}/s`
}

/** Top-down assembly drawing: blower above, board in the middle, NVMe base below. Three line weights, as on a
 *  drawing: the board edge 0.5, courtyards 0.22, detail 0.12. The port names outside the board's edge are the
 *  drawing's annotations, not the board's own silkscreen. */
function createDrawing(container, hooks) {
  const vb = { x: -54, y: -70, w: 108, h: 134 }
  const r = (p, fill, extra = '') => `<rect x="${p.x - p.w / 2}" y="${p.z - p.d / 2}" width="${p.w}" height="${p.d}" fill="${fill}" ${extra}/>`
  // a port: its shell, and the shell's lip inset by 0.8
  const port = (p, rx = 0) => `${r(p, '#b9bec0')}<rect class="lip" x="${p.x - p.w / 2 + 0.8}" y="${p.z - p.d / 2 + 0.8}" width="${p.w - 1.6}" height="${p.d - 1.6}" rx="${rx}"/>`
  // the tongue in a USB port's mouth (the board's +x edge), as in the 3D view: blue for USB 3, black for USB 2
  const tongue = (p, fill) => `<rect x="${p.x + p.w / 2 - 2.2}" y="${p.z - p.d / 2 + 2}" width="1" height="${p.d - 4}" fill="${fill}"/>`
  // pin 1: a silkscreen dot just outside the courtyard's top-left corner
  const pin1 = (p) => `<circle cx="${p.x - p.w / 2 - 1.6}" cy="${p.z - p.d / 2 - 0.3}" r="0.5"/>`
  const note = (x, y, text, anchor = 'middle', cls = '') => `<text class="note ${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`
  // the stacked ports are named on their shells: the right-hand leaders jog in the field beside them
  const shell = (p, text) => note(p.x - 1, p.z + 0.55, text, 'middle', 'on-shell')
  const below = BOARD.d / 2 + 3.2 // the name row under the board's bottom edge, clear of the HDMI and USB-C mouths
  const pins = []
  for (let i = 0; i < 20; i++) for (const dz of [-1.27, 1.27]) pins.push(`<rect x="${P.gpio.x - 24.13 + i * 2.54 - 0.32}" y="${P.gpio.z + dz - 0.32}" width="0.64" height="0.64"/>`)
  const blades = []
  for (let i = 0; i < 23; i++) {
    const a = (i / 23) * Math.PI * 2
    blades.push(`<path d="M${Math.cos(a) * 7} ${Math.sin(a) * 7}L${Math.cos(a + 0.5) * 13.8} ${Math.sin(a + 0.5) * 13.8}"/>`)
  }
  const holes = HOLES.map(([x, z]) => `<circle cx="${x}" cy="${z}" r="3.1" fill="#d7b463"/><circle cx="${x}" cy="${z}" r="${HOLE_R}" fill="#07110d"/>`).join('')
  const lit = (part, x, y, w, h) => `<rect class="lit-box" data-lit="${part}" x="${x - 1.2}" y="${y - 1.2}" width="${w + 2.4}" height="${h + 2.4}"/>`
  // the fan cable: two wires from the blower's side to its header, routed at 90° and 45° like everything drawn here.
  // `o` offsets a wire from the centre line; t keeps the offset wires parallel through the 45° corners
  const t = Math.SQRT2 - 1
  const hdrTop = P.fanHdr.z - P.fanHdr.d / 2
  const wire = (o) => `M${FAN.x + 16.5} ${FAN2D_Y + 10 + o}H${P.fanHdr.x - 8 - t * o}L${P.fanHdr.x - o} ${hdrTop - 6 + t * o}V${P.fanHdr.z}`
  // the PCIe FFC, from the board's connector round the board's edge to the one on the M.2 base: copper-orange
  // polyimide with its conductors, drawn as stacked strokes along one centre line
  const baseY = SSD2D_Y + P.pcie.z
  const ffc = `M${P.pcie.x - P.pcie.w / 2} ${P.pcie.z}H-46L-49 ${P.pcie.z + 3}V${baseY - 3}L-46 ${baseY}H-41.7`
  const ribbon = [[6, '#b98a45'], [4.4, '#8c6a43'], [4, '#b98a45'], [2, '#8c6a43'], [1.6, '#b98a45']].map(([w, c]) => `<path d="${ffc}" stroke="${c}" stroke-width="${w}"/>`).join('')

  const svg = el(`
<svg viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" class="drawing">
  <style>
    .drawing{font-family:'Archivo Variable',Arial,sans-serif;font-weight:700}
    .drawing .edge{fill:none;stroke:rgba(233,238,229,.7);stroke-width:.5}
    .drawing .silk{fill:none;stroke:#e9eee5;stroke-width:.22}
    .drawing .lip{fill:none;stroke:#7d8386;stroke-width:.12}
    .drawing .asm{fill:none;stroke:rgba(237,240,232,.35);stroke-width:.3;stroke-dasharray:1.2 1}
    .drawing .wire{fill:none;stroke:rgba(233,238,229,.7);stroke-width:.25}
    .drawing .lbl{fill:#e9eee5;font-size:1.7px;text-anchor:middle}
    .drawing .note{fill:#e9eee5;opacity:.6;font-size:1.5px;font-weight:600;font-stretch:78%;letter-spacing:.07em}
    .drawing .on-shell{fill:#07110d;opacity:.75}
    .drawing.small .note{display:none}
    .drawing .lit-box{fill:none;stroke:#f0cf7e;stroke-width:.45;opacity:0;transition:opacity .2s}
    .drawing .lit-box.on{opacity:1}
    .drawing [data-part]{cursor:pointer}
  </style>
  <path class="asm" d="M${FAN.x} ${FAN2D_Y + 17}V${P.soc.z - 8}"/>
  <g data-part="fan" transform="translate(${FAN.x} ${FAN2D_Y})">
    <rect x="-16.5" y="-16.5" width="33" height="33" rx="4" fill="#1a1e1c" stroke="rgba(237,240,232,.25)" stroke-width=".25"/>
    <circle r="14.6" fill="#0e110f"/>
    <g stroke="#3a423e" stroke-width=".9" stroke-linecap="round">${blades.join('')}</g>
    <circle r="${FAN.hub}" fill="#202523"/>
    <circle r="${FAN.hub * 0.72}" fill="none" stroke="#d9b35d" stroke-width=".5"/>
  </g>
  ${lit('fan', FAN.x - 16.5, FAN2D_Y - 16.5, 33, 33)}
  <g>
    <rect x="${-BOARD.w / 2}" y="${-BOARD.d / 2}" width="${BOARD.w}" height="${BOARD.d}" rx="3" fill="#1f5a3b"/>
    <rect class="edge" x="${-BOARD.w / 2}" y="${-BOARD.d / 2}" width="${BOARD.w}" height="${BOARD.d}" rx="3"/>
    ${holes}
    <g class="silk">
      ${['soc', 'ram', 'rp1', 'pmic', 'wifi', 'cam0', 'cam1', 'pcie'].map((k) => `<rect x="${P[k].x - P[k].w / 2 - 0.7}" y="${P[k].z - P[k].d / 2 - 0.7}" width="${P[k].w + 1.4}" height="${P[k].d + 1.4}"/>`).join('')}
    </g>
    <g fill="#e9eee5">${['soc', 'ram', 'rp1', 'pmic'].map((k) => pin1(P[k])).join('')}</g>
    ${r(P.gpio, '#121413', 'stroke="#7d8386" stroke-width=".12"')}
    <g fill="#e2bd62">${pins.join('')}</g>
    ${port(P.usb2)}${port(P.usb3)}${port(P.eth)}${tongue(P.usb2, '#121413')}${tongue(P.usb3, '#2f6fe0')}
    ${port(P.hdmi0)}${port(P.hdmi1)}${port(P.usbc, 1.4)}
    ${r(P.cam0, '#1b1d1c')}${r(P.cam1, '#1b1d1c')}${r(P.pcie, '#1b1d1c')}
    ${r(P.fanHdr, '#e9e3d2')}${r(P.uart, '#e9e3d2')}${r(P.bat, '#e9e3d2')}
    <g data-part="wifi">${r(P.wifi, '#aeb4b6')}<rect class="lip" x="${P.wifi.x - P.wifi.w / 2 + 0.8}" y="${P.wifi.z - P.wifi.d / 2 + 0.8}" width="${P.wifi.w - 1.6}" height="${P.wifi.d - 1.6}"/></g>
    <g data-part="ram">${r(P.ram, '#161817')}<text class="lbl" x="${P.ram.x}" y="${P.ram.z + 0.6}">LPDDR4X</text></g>
    <g data-part="soc">${r(P.soc, '#555', 'data-heat="soc"')}<text class="lbl" x="${P.soc.x}" y="${P.soc.z + 0.6}" data-ink="soc">BCM2712</text></g>
    <g data-part="rp1">${r(P.rp1, '#555', 'data-heat="rp1"')}<text class="lbl" x="${P.rp1.x}" y="${P.rp1.z + 0.6}" data-ink="rp1">RP1</text></g>
    <g data-part="pmic">${r(P.pmic, '#555', 'data-heat="pmic"')}</g>
    <text class="lbl" x="-29" y="-3.4" style="font-size:2.1px">Raspberry Pi 5</text>
    ${['soc', 'ram', 'rp1', 'pmic', 'wifi'].map((k) => lit(k, P[k].x - P[k].w / 2, P[k].z - P[k].d / 2, P[k].w, P[k].d)).join('')}
  </g>
  <g fill="none" stroke-linejoin="miter">${ribbon}</g>
  <g class="wire">${[-0.4, 0.4].map((o) => `<path d="${wire(o)}"/>`).join('')}</g>
  <g>
    ${shell(P.usb2, 'USB 2')}${shell(P.usb3, 'USB 3')}${shell(P.eth, 'ETH')}
    ${note(P.usbc.x, below, 'PWR')}${note(P.bat.x, below, 'BAT')}${note(P.hdmi0.x, below, 'HDMI 0')}${note(P.uart.x, below, 'UART')}${note(P.hdmi1.x, below, 'HDMI 1')}
    ${note(P.cam1.x + 2, below, 'CAM/DISP 1', 'end')}${note(P.cam0.x - 2, below, 'CAM/DISP 0', 'start')}
    ${note(P.fanHdr.x + 1.8, -BOARD.d / 2 - 0.9, 'FAN', 'start')}${note(-BOARD.w / 2 - 0.8, P.pcie.z - 5.2, 'PCIe', 'end')}
  </g>
  <g data-part="ssd" transform="translate(0 ${SSD2D_Y})">
    <rect x="-42" y="-15" width="84" height="30" rx="2" fill="#0f1311" stroke="rgba(237,240,232,.25)" stroke-width=".25"/>
    <rect x="-41.7" y="${P.pcie.z - P.pcie.d / 2}" width="${P.pcie.w}" height="${P.pcie.d}" fill="#1b1d1c"/>
    <rect x="${SSD.x - SSD.w / 2}" y="${-SSD.d / 2}" width="${SSD.w}" height="${SSD.d}" rx="1" fill="#111413"/>
    <rect x="${SSD.x - SSD.w / 2}" y="${-SSD.d / 2 + 1.5}" width="3.2" height="${SSD.d - 3}" fill="#e2bd62"/>
    <rect x="${SSD.x - SSD.w / 2 - 0.1}" y="4.8" width="3.1" height="1.4" fill="#0f1311"/>
    <rect x="${SSD.x + SSD.ctrl.x - 4}" y="-4" width="8" height="8" fill="#555" data-heat="ssd"/>
    <rect x="${SSD.x - 10}" y="-9.5" width="46" height="19" fill="#16191a"/>
    <rect x="${SSD.x - 10}" y="-9.5" width="1" height="19" fill="#3c6fd8"/>
    <text class="lbl" x="${SSD.x + 13}" y="0.2" style="font-size:3.4px">SN580</text>
    <text class="lbl" x="${SSD.x + 13}" y="4" style="font-size:1.7px;fill:rgba(233,238,229,.6)">NVMe · 1 TB</text>
    <circle cx="${SSD.x + SSD.w / 2 - 2.5}" cy="0" r="2.2" fill="#e2bd62"/>
    <path d="M${SSD.x + SSD.w / 2 - 3.5} 0h2M${SSD.x + SSD.w / 2 - 2.5} -1v2" stroke="#8a6a2a" stroke-width=".35"/>
  </g>
  ${lit('ssd', SSD.x - SSD.w / 2, SSD2D_Y - SSD.d / 2, SSD.w, SSD.d)}
</svg>`)
  container.append(svg)
  const heatEls = [...svg.querySelectorAll('[data-heat]')]
  const inkEls = [...svg.querySelectorAll('[data-ink]')]
  const litEls = [...svg.querySelectorAll('[data-lit]')]
  svg.addEventListener('click', (e) => {
    const g = e.target.closest('[data-part]')
    if (g) hooks.onPick?.(g.dataset.part)
  })
  svg.addEventListener('pointerover', (e) => hooks.onHover?.(e.target.closest('[data-part]')?.dataset.part ?? null))
  svg.addEventListener('pointerleave', () => hooks.onHover?.(null))

  // pads on each part's bare corner, off its printed label, facing the part's callout column (same rule as the 3D view).
  // Left-side leaders come in level with their pad, so those pads sit in clear lanes: the SoC's below its marking,
  // clear of the PMIC; the Wi-Fi module's above the PCIe connector.
  const at = {
    fan: [FAN.x - 13, FAN2D_Y + 13],
    soc: [P.soc.x - P.soc.w / 2 + 1.6, P.soc.z + 2],
    ram: [P.ram.x + P.ram.w / 2 - 2, P.ram.z - P.ram.d / 2 + 2],
    rp1: [P.rp1.x + P.rp1.w / 2 - 1.6, -10.05], // in the lane between the two USB stacks, so its leader crosses no port
    pmic: [P.pmic.x - P.pmic.w / 2 + 1.2, P.pmic.z + P.pmic.d / 2 - 1.2],
    wifi: [P.wifi.x - P.wifi.w / 2 + 2, P.wifi.z + 2.2],
    ssd: [SSD.x + SSD.w / 2 - 2.5, SSD2D_Y],
  }
  const ro = new ResizeObserver(() => {
    // the port names would print under 7px at this size: leave them out
    svg.classList.toggle('small', Math.min(container.clientWidth / vb.w, container.clientHeight / vb.h) < 4.5)
    hooks.onFrame?.()
  })
  ro.observe(container)
  return {
    mode: '2d',
    update(v) {
      const temps = { soc: v.soc, rp1: v.rp1, pmic: v.pmic, ssd: v.nvme }
      for (const n of heatEls) n.setAttribute('fill', temps[n.dataset.heat] == null ? '#3a423e' : rampAt(heat(temps[n.dataset.heat])))
      for (const n of inkEls) n.style.fill = heat(temps[n.dataset.ink]) > 0.62 ? '#15100a' : '#e9eee5'
      hooks.onFrame?.()
    },
    anchors() {
      // in the stage's coordinates: the view is inset between the callout columns (style.css)
      const W = container.clientWidth
      const H = container.clientHeight
      const s = Math.min(W / vb.w, H / vb.h)
      const ox = container.offsetLeft + (W - vb.w * s) / 2
      const oy = container.offsetTop + (H - vb.h * s) / 2
      const out = {}
      for (const [k, [x, y]] of Object.entries(at)) out[k] = { x: ox + (x - vb.x) * s, y: oy + (y - vb.y) * s, visible: true }
      return out
    },
    light(part) {
      for (const n of litEls) n.classList.toggle('on', n.dataset.lit === part)
    },
    refresh() {
      hooks.onFrame?.()
    },
    dispose() {
      ro.disconnect()
      svg.remove()
    },
  }
}

/**
 * Leader from a callout's inner edge (cx, cy) to its part (ax, ay), drawn like a PCB trace: horizontal runs
 * and exactly 45° diagonals. The jog happens right beside the callout, in the empty field, so the only stretch
 * over the model is one straight run in at the part's own height.
 */
function route(cx, cy, ax, ay, s) {
  const dx = (ax - cx) * s
  const ady = Math.abs(ay - cy)
  const sy = Math.sign(ay - cy)
  if (ady < 0.5) return `M${cx} ${cy}H${ax}`
  if (dx >= ady + 16) {
    const x1 = cx + s * 8
    return `M${cx} ${cy}H${x1}L${x1 + s * ady} ${ay}H${ax}`
  }
  // too little room for the jog: 45° across the whole run, then vertical into the pad
  const x1 = cx + s * 6
  const run = Math.max(0, (ax - x1) * s)
  return `M${cx} ${cy}H${x1}L${ax} ${cy + sy * run}V${ay}`
}

export function createStage(root, hooks = {}) {
  const viewEl = root.querySelector('[data-bind=view]')
  const leaders = root.querySelector('[data-bind=leaders]')
  const list = root.querySelector('[data-bind=callouts]')
  const hint = root.querySelector('[data-bind=stage-hint]')
  let impl = null
  let lit = null
  let token = 0
  let staticList = false
  let entered = false
  let v = {}

  const items = CALLOUTS.map((c, i) => {
    const li = el(`
      <li class="callout" data-part="${c.part}" style="--i:${i}">
        <a href="${c.href}">
          <span class="callout-name">${c.name}</span>
          <span class="callout-val"><i class="chip" hidden></i><span>—</span></span>
          <span class="callout-sub">—</span>
        </a>
      </li>`)
    list.append(li)
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.innerHTML = '<path class="halo"/><path/><circle r="3"/>'
    leaders.append(g)
    li.addEventListener('pointerenter', () => hooks.onHover?.(c.part))
    li.addEventListener('pointerleave', () => hooks.onHover?.(null))
    li.addEventListener('focusin', () => hooks.onHover?.(c.part))
    li.addEventListener('focusout', () => hooks.onHover?.(null))
    return { ...c, li, g, halo: g.firstChild, path: g.children[1], pad: g.lastChild, chip: li.querySelector('.chip'), val: li.querySelector('.callout-val span'), sub: li.querySelector('.callout-sub'), x: null, y: null, h: 64 }
  })

  function measure() {
    staticList = getComputedStyle(items[0].li).position === 'static'
    for (const it of items) it.h = it.li.offsetHeight || 64
    // read once per resize, never per frame: a read after the frame's writes would force a synchronous layout
    box = { w: root.clientWidth, h: root.clientHeight, cw: items[0].li.offsetWidth || 168 }
  }
  let box = { w: 0, h: 0, cw: 168 }
  const ro = new ResizeObserver(() => {
    measure()
    layout(true)
    impl?.refresh() // the 3D view re-fits the model between the callout columns
  })
  ro.observe(root)
  for (const it of items) ro.observe(it.li) // a reading that wraps to two lines changes the box height

  /** `more`: the 3D view calls again on its next frame, so the glide needs no frames of its own. */
  function layout(snap = false, more = false) {
    if (!impl || staticList || !box.w) return
    const { w: W, h: H, cw } = box
    const A = impl.anchors()
    const m = W < 820 ? 10 : 18
    const top = 16
    const bottom = 44
    let moving = false
    // side is fixed per part (board.js CALLOUTS): a part that drifts across the middle while the board sways
    // would otherwise hop columns and land on top of a neighbour
    for (const side of ['left', 'right']) {
      // stack in the parts' on-screen order; two parts within a few pixels of each other keep their last order, so a
      // pair that sways across the same height doesn't make their boxes trade places back and forth
      const group = items
        .filter((it) => it.side === side && A[it.part])
        .sort((a, b) => {
          const d = A[a.part].y - A[b.part].y
          return Math.abs(d) < 6 && a.rank != null && b.rank != null ? a.rank - b.rank : d
        })
      group.forEach((it, i) => (it.rank = i))
      // each box sits so its value line is level with its part: the leader runs straight in, and only a
      // box pushed aside by a neighbour needs a jog
      const ys = group.map((it) => clamp(A[it.part].y - Math.min(26, it.h / 2), top, H - bottom - it.h))
      for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + group[i - 1].h + 12)
      for (let i = ys.length - 1; i >= 0; i--) {
        const limit = i === ys.length - 1 ? H - bottom - group[i].h : ys[i + 1] - group[i].h - 12
        ys[i] = Math.max(top, Math.min(ys[i], limit))
      }
      // easing each box toward its slot keeps a correctly ordered stack spaced (every step is a blend of two spaced
      // stacks). Two parts that trade places (the fan rising past the Wi-Fi module as the stack explodes, or a drag)
      // would slide their boxes through each other, so that side re-stacks at once and the moved boxes fade in.
      const swapped = group.some((it, i) => i > 0 && it.y != null && group[i - 1].y != null && it.y < group[i - 1].y)
      group.forEach((it, i) => {
        const x = side === 'left' ? m : W - m - cw
        const jump = swapped && !snap && !prefs.reduced && Math.abs(ys[i] - it.y) > 4
        const k = snap || swapped || prefs.reduced || it.x == null ? 1 : 0.22
        it.x = it.x == null ? x : it.x + (x - it.x) * k
        it.y = it.y == null ? ys[i] : it.y + (ys[i] - it.y) * k
        if (Math.abs(ys[i] - it.y) > 0.5) moving = true
        else it.y = ys[i]
        const a = A[it.part]
        const s = side === 'left' ? 1 : -1
        const cx = side === 'left' ? it.x + cw : it.x
        const d = route(cx, it.y + Math.min(26, it.h / 2), a.x, a.y, s)
        const tf = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px)`
        // unchanged frames write nothing, so a still board costs no style or layout work
        if (it.tf !== tf) it.li.style.transform = it.tf = tf
        if (it.d !== d) {
          it.d = d
          it.path.setAttribute('d', d)
          it.halo.setAttribute('d', d)
          it.pad.setAttribute('cx', a.x.toFixed(1))
          it.pad.setAttribute('cy', a.y.toFixed(1))
        }
        // a part that turns behind the board, or behind its own column, hides its leader rather than point through
        const op = a.visible && (a.x - cx) * s > 12 ? '' : '0'
        if (it.g.style.opacity !== op) it.g.style.opacity = op
        if (jump) {
          it.li.animate({ opacity: [0, 1] }, 260)
          if (!op) it.g.animate({ opacity: [0, 1] }, 260)
        }
      })
    }
    // one layout per frame: the 3D view drives it while it runs, the glide finishes on its own frames otherwise
    cancelAnimationFrame(glide)
    glide = moving && !more ? requestAnimationFrame(() => layout()) : 0
  }
  let glide = 0

  function enter() {
    if (entered) return
    entered = true
    if (!prefs.reduced) {
      items.forEach((it, i) => {
        for (const p of [it.path, it.halo]) {
          p.style.setProperty('--len', '1400')
          p.style.setProperty('--d', `${0.5 + i * 0.08}s`)
        }
      })
      leaders.dataset.draw = ''
      list.dataset.enter = ''
      setTimeout(() => {
        delete leaders.dataset.draw
        delete list.dataset.enter
      }, 2600)
    }
  }

  async function setMode(want) {
    const my = ++token
    impl?.dispose()
    impl = null
    // the callouts stay hidden until the new view has placed them (style.css), or they would sit in one pile meanwhile
    delete root.dataset.placed
    hint.textContent = 'Loading the board…'
    const onFrame = (more) => layout(false, more)
    // the width each callout column takes from the view (none on a phone, where the callouts sit below it)
    const inset = () => (staticList || !box.w ? 0 : box.cw + (box.w < 820 ? 10 : 18) + 14)
    const common = { onFrame, inset, onHover: hooks.onHover, onPick: hooks.onPick }
    if (want === '3d') {
      root.dataset.mode = '3d'
      try {
        const { createScene3D } = await import('./scene3d.js')
        if (my !== token) return
        const scene = await createScene3D(viewEl, common)
        if (my !== token) return scene.dispose()
        impl = scene
      } catch (err) {
        console.warn('3D view unavailable, using the 2D drawing', err)
        if (my !== token) return
        want = '2d'
        hooks.onNoWebGL?.()
      }
    }
    if (want === '2d') {
      root.dataset.mode = '2d'
      impl = createDrawing(viewEl, common)
    }
    impl.light(lit)
    impl.update(v)
    measure()
    layout(true)
    root.dataset.placed = ''
    if (want === '3d') hint.textContent = 'Drag to turn the board'
    enter()
  }

  return {
    setMode,
    light(part) {
      lit = part
      impl?.light(part)
      for (const it of items) {
        it.li.classList.toggle('lit', it.part === part)
        it.g.classList.toggle('lit', it.part === part)
      }
    },
    /** Pushes the latest metrics into the scene and the callouts. */
    update(m, profiles) {
      const t = m.temps || {}
      const fan = m.fan?.available ? m.fan : null
      const wifi = m.network?.interfaces?.find((i) => i.kind === 'wifi')
      const eth = m.network?.interfaces?.find((i) => i.kind === 'ethernet')
      const disk = m.disks?.total
      v = {
        soc: t.soc_c ?? null,
        rp1: t.rp1_c ?? null,
        pmic: t.pmic_c ?? null,
        nvme: t.nvme_c ?? null,
        rpm: fan?.rpm ?? 0,
        cpu: m.cpu?.usage_pct ?? 0,
        wifi: wifi ? wifi.rx_bytes_per_s + wifi.tx_bytes_per_s : 0,
        disk: disk ? disk.read_bytes_per_s + disk.write_bytes_per_s : 0,
        eth: !!eth?.up,
        ethAct: eth ? eth.rx_bytes_per_s + eth.tx_bytes_per_s : 0,
      }
      impl?.update(v)

      const profName = profiles?.profiles?.find((p) => p.id === fan?.profile)?.name ?? fan?.profile
      // numbers ease like every other reading on the page; `num` null renders "—"
      const set = (part, num, format, sub, temp) => {
        const it = items.find((i) => i.part === part)
        tweenText(it.val, num, (x) => (x == null ? '—' : format(x)))
        if (it.sub._s !== sub) it.sub.textContent = it.sub._s = sub
        it.chip.hidden = temp == null
        if (temp != null) it.chip.style.setProperty('--c', rampAt(heat(temp)))
      }
      const deg = (x) => fmt.temp(x)
      set(
        'fan',
        fan ? fan.rpm : null,
        (x) => `${fmt.int(x)} rpm`,
        fan ? (fan.mode === 'failsafe' ? `${fmt.pct(fan.speed_pct, 0)} · failsafe` : fan.mode === 'kernel' ? `${fmt.pct(fan.speed_pct, 0)} · kernel curve` : `${fmt.pct(fan.speed_pct, 0)} · ${profName}`) : m.fan?.error ? 'not available' : '—',
      )
      set('soc', t.soc_c, deg, m.cpu ? `${fmt.pct(m.cpu.usage_pct, 0)} load · ${fmt.mhz(m.cpu.freq_mhz)}` : '—', t.soc_c)
      set('wifi', wifi?.wifi_signal_dbm ?? null, (x) => `${Math.round(x)} dBm`.replace('-', '\u2212'), wifi ? `↓ ${rate(wifi.rx_bytes_per_s)} · ↑ ${rate(wifi.tx_bytes_per_s)}` : '—')
      // the heat swatch sits beside a temperature only: next to watts it would read as the colour of the power
      if (m.power?.available) set('pmic', m.power.pmic_w, (x) => `${x.toFixed(2)} W`, `${fmt.fixed(m.power.input_v, 2)} V in · ${fmt.temp(t.pmic_c)}`)
      else set('pmic', t.pmic_c, deg, 'power readings unavailable', t.pmic_c)
      const ram = m.memory?.ram
      set('ram', ram ? ram.used_pct : null, (x) => fmt.pct(x), ram ? `${fmt.bytes(ram.used_bytes)} of ${fmt.bytes(ram.total_bytes)}` : '—')
      set('rp1', t.rp1_c, deg, 'USB, Ethernet and GPIO', t.rp1_c)
      set('ssd', t.nvme_c, deg, disk ? `R ${rate(disk.read_bytes_per_s)} · W ${rate(disk.write_bytes_per_s)}` : '—', t.nvme_c)
    },
    refresh: () => impl?.refresh(),
  }
}
