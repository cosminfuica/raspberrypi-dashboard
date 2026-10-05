// Shared by tiles.mjs and clip.mjs: the captures capture.mjs made, and HTML pages drawn as a pure function of time.
import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const { chromium } = createRequire(process.cwd() + '/')('playwright') // from the directory it is run in, as readme.mjs does
export const HERE = fileURLToPath(new URL('.', import.meta.url))
export const ROOT = resolve(HERE, '../../../..')
export const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
export const ARCHIVO = 'file://' + join(ROOT, 'frontend/node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2')
export const MONO = 'file://' + join(HERE, 'fonts/jetbrains-mono-latin-wght.woff2')

export const THEMES = {
  dark: { field: '#07110d', mask: '#0b1712', ink: '#edf0e8', dim: '#b3bfb6', faint: '#8a9a90', line: 'rgb(237 240 232 / 0.16)', line2: 'rgb(237 240 232 / 0.3)', gold: '#d9b35d', ok: '#45d983', win: '#07110d' },
  light: { field: '#edf0e8', mask: '#e3e8df', ink: '#0b1712', dim: '#3d4a44', faint: '#5c6b63', line: 'rgb(11 23 18 / 0.22)', line2: 'rgb(11 23 18 / 0.4)', gold: '#b18a3e', ok: '#45d983', win: '#07110d' },
}
export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
export const CURSOR = `<svg viewBox="0 0 20 20"><path d="M2 1v16l4.4-4.1 3 6.2 2.7-1.3-3-6.1H15z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>`

/** A capture: its frames, events and element rectangles (CSS px of the capture's viewport). */
export function capture(framesDir, name) {
  const dir = join(framesDir, name)
  const meta = JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8'))
  const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
  const cursor = meta.events.filter((e) => e.type === 'cursor')
  const clicks = meta.events.filter((e) => e.type === 'down')
  const idx = (t) => Math.max(0, Math.min(files.length - 1, Math.round(t * meta.fps)))
  return {
    name, dir, meta, files, scale: meta.scale, fps: meta.fps, duration: files.length / meta.fps,
    frameAt: (t) => 'file://' + join(dir, files[idx(t)]),
    cursorAt: (t) => cursor[idx(t)],
    clickAt: (t) => clicks.find((c) => t >= c.t && t < c.t + 0.45),
    rect: (sel) => meta.rects[sel],
  }
}

/** The base page: fonts, the colours, and a `show(state)` the renderer calls per frame. */
export function base(theme, w, h, body, css = '') {
  const T = THEMES[theme]
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:A;src:url(${ARCHIVO});font-weight:100 900;font-stretch:62% 125%}
@font-face{font-family:M;src:url(${MONO});font-weight:400 800}
html,body{margin:0;background:transparent}
body{width:${w}px;height:${h}px;overflow:hidden;position:relative;font-family:A,system-ui,sans-serif;color:${T.ink};font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.lbl{font-weight:600;font-stretch:78%;letter-spacing:.07em;text-transform:uppercase;font-size:13px;color:${T.faint}}
.title{font-weight:700;font-stretch:116%;letter-spacing:-.01em;font-size:25px;line-height:1.12;color:${T.ink}}
.line{font-weight:400;font-size:15px;line-height:1.35;color:${T.dim}}
.win{position:absolute;overflow:hidden;background:${T.win}}
.win img{position:absolute;left:0;top:0;transform-origin:0 0}
.cur{position:absolute;left:0;top:0;width:24px;height:24px;pointer-events:none;transform:translate(-99px,-99px)}
.rip{position:absolute;width:28px;height:28px;border-radius:50%;border:2px solid ${T.gold};transform:translate(-50%,-50%) scale(.3);opacity:0;pointer-events:none}
${css}</style><body>${body}
<script>
const $ = (s) => document.querySelector(s)
window.show = async (st) => {
  for (const [id, s] of Object.entries(st.imgs || {})) { const i = $('#' + id); if (!i) continue; if (s.src && i.dataset.src !== s.src) { i.src = s.src; i.dataset.src = s.src; await i.decode().catch(() => {}) } if (s.k != null) i.style.transform = 'translate(' + s.x + 'px,' + s.y + 'px) scale(' + s.k + ')'; if (s.o != null) i.style.opacity = s.o }
  for (const [id, s] of Object.entries(st.els || {})) { const e = $('#' + id); if (!e) continue; if (s.text != null && e.textContent !== s.text) e.textContent = s.text; if (s.html != null && e.innerHTML !== s.html) e.innerHTML = s.html; if (s.style) Object.assign(e.style, s.style) }
  for (const [id, s] of Object.entries(st.cur || {})) { const e = $('#' + id); if (!e) continue; e.style.transform = s ? 'translate(' + (s.x - 2) + 'px,' + (s.y - 1) + 'px) scale(' + (s.k || 1) + ')' : 'translate(-99px,-99px)' }
  for (const [id, s] of Object.entries(st.rip || {})) { const e = $('#' + id); if (!e) continue; if (!s) { e.style.opacity = 0; continue } e.style.left = s.x + 'px'; e.style.top = s.y + 'px'; e.style.transform = 'translate(-50%,-50%) scale(' + (0.3 + 1.4 * s.k) + ')'; e.style.opacity = 1 - s.k }
}
</script>`
}

/** A window onto a capture: `crop` in the capture's CSS px, shown at (x, y) with width w (height follows). */
export function window_(id, x, y, w, crop, h) {
  h ??= (w * crop.h) / crop.w
  return { id, html: `<div class="win" id="${id}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"><img id="${id}i"><div class="rip" id="${id}r"></div><div class="cur" id="${id}c">${CURSOR}</div></div>`, h, w, x, y, crop }
}

/** The state of a window at capture time t: the frame, its placement (with an optional zoom about a crop point),
 *  the pointer and a click ripple. */
export function winState(win, cap, t, { hideCursor = false, zoom = 1, zx = 0.5, zy = 0.5, opacity, cursorScale } = {}) {
  const k0 = win.w / (win.crop.w * cap.scale) // frame px -> window px
  const k = k0 * zoom
  const ox = -win.crop.x * cap.scale * k - win.w * zx * (zoom - 1), oy = -win.crop.y * cap.scale * k - win.w * (win.crop.h / win.crop.w) * zy * (zoom - 1)
  const st = { imgs: { [win.id + 'i']: { src: cap.frameAt(t), x: ox, y: oy, k, o: opacity } }, els: {}, cur: {}, rip: {} }
  const c = cap.cursorAt(t)
  const inside = c && c.x >= win.crop.x && c.x <= win.crop.x + win.crop.w && c.y >= win.crop.y && c.y <= win.crop.y + win.crop.h
  const toWin = (p) => ({ x: (p.x - win.crop.x) * cap.scale * k + ox + win.crop.x * cap.scale * k, y: (p.y - win.crop.y) * cap.scale * k + oy + win.crop.y * cap.scale * k, k: cursorScale })
  st.cur[win.id + 'c'] = inside && !hideCursor ? toWin(c) : null
  const cl = cap.clickAt(t)
  st.rip[win.id + 'r'] = cl && !hideCursor ? { ...toWin(cl), k: (t - cl.t) / 0.45 } : null
  return st
}
export const merge = (...sts) => sts.reduce((a, b) => ({ imgs: { ...a.imgs, ...b.imgs }, els: { ...a.els, ...b.els }, cur: { ...a.cur, ...b.cur }, rip: { ...a.rip, ...b.rip } }), { imgs: {}, els: {}, cur: {}, rip: {} })

/** Eases: entrances ease out, moves across the screen ease in-out (BRIEF.md, Motion). */
export const expoOut = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k))
export const inOut = (k) => (k < 0.5 ? 2 * k * k : 1 - (2 - 2 * k) ** 2 / 2)
export const clamp01 = (k) => Math.max(0, Math.min(1, k))

/** Render a page frame by frame: `state(t)` per frame, screenshots into dir as f%05d.png. */
export async function render(browser, { file, w, h, scale, fps, dur, state, dir, omitBackground = true, type = 'png' }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale })
  const p = await ctx.newPage()
  await p.goto('file://' + file)
  await p.evaluate(() => document.fonts.ready)
  const n = Math.round(dur * fps)
  for (let i = 0; i < n; i++) {
    await p.evaluate((st) => window.show(st), state(i / fps))
    await p.screenshot({ path: join(dir, `f${String(i).padStart(5, '0')}.${type}`), omitBackground, type, ...(type === 'jpeg' ? { quality: 95 } : {}) })
  }
  await ctx.close()
  return n
}
