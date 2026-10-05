// Frame captures of the real page for the README's bento tiles and the demo clip (.github/readme/BRIEF.md).
//
//   node docs/images/src/readme/capture.mjs <out-dir> <scene> [scene...]      scenes: see SCENES below, or "all"
//
// Run from a directory where `npm i --no-save playwright` has been done (the repo installs no Playwright), with the
// built page served by `PIDASH_TOKEN=demo pidash --mock --port 18787` and, for the console scene, a second instance
// `PIDASH_TOKEN=demo PIDASH_CONSOLE=1 pidash --mock --port 18788` started from the repo root. Every frame is a pure
// function of a fake clock: the page's timers, animation frames and Date are stepped by Playwright's clock, so the
// in-browser demo's 1 Hz readings, its fan ramp and its update log land on the same frames every run (the clock is
// paused, so a slow software-rendered frame doesn't let the demo's simulation run ahead). The 3D board
// is captured under prefers-reduced-motion (fully exploded, no sway; a drag still turns it), because software WebGL
// here takes seconds per animated frame. Headless Chromium paints no pointer: each scene writes events.json (the
// cursor per frame, the clicks, the marks) for the composition to draw one.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { chromium } = createRequire(process.cwd() + '/')('playwright') // from the directory it is run in, as readme.mjs does

const [outDir, ...names] = process.argv.slice(2)
if (!outDir || !names.length) throw new Error('usage: capture.mjs <out-dir> <scene|all> [...]')
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const BASE = process.env.PIDASH_URL || 'http://127.0.0.1:18787'
const CONSOLE_BASE = process.env.PIDASH_CONSOLE_URL || 'http://127.0.0.1:18788'
const T0 = '2026-10-05T15:30:00' // the fake clock's start, so every "Last updated" reads the same
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (2 - 2 * k) ** 2 / 2)
const RECTS = ['.verdict', '.fanctl', '[data-bind=pads]', '[data-bind=night]', '.stage', '[data-bind=view]', '#fan', '#cpu', '#thermals', '#power', '#memory', '#services', '#containers', '#system', '#console', '.top', '.fingers', 'dialog[open]']

/** One scene: open the page, then run a timeline against the fake clock while recording frames. */
async function scene(name, s) {
  const dir = join(outDir, name)
  mkdirSync(dir, { recursive: true })
  const b = await chromium.launch({ args: GL, executablePath: EXE })
  const vp = s.viewport || { width: 1600, height: 900 }
  const scale = s.scale ?? 1.2
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: scale, reducedMotion: 'reduce', isMobile: !!s.mobile, hasTouch: !!s.mobile })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message))
  await p.clock.install({ time: new Date(T0) })
  await p.clock.pauseAt(new Date(new Date(T0).getTime() + 1000)) // paused: time moves only by runFor below, however long a frame takes to draw
  await p.addInitScript(() => localStorage.setItem('pidash.token', 'demo'))
  if (s.lowpower) await p.addInitScript(() => localStorage.setItem('pidash.lowpower', '1'))
  await p.goto((s.console ? CONSOLE_BASE : BASE) + (s.path ?? '/?demo&healthy'))
  await p.evaluate(() => document.fonts.ready)
  for (let i = 0; i < (s.settle ?? 7); i++) { await p.clock.runFor(1000); await p.waitForTimeout(s.console ? 150 : 20) }
  if (s.settleReal) await p.waitForTimeout(s.settleReal) // a real backend fills its sections in real time, and the masonry re-measures as they land
  await p.addStyleTag({ content: '.skip { visibility: hidden !important }' + (s.css || '') })
  if (s.scrollTo) await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'start' }), s.scrollTo)
  if (s.scrollTo || s.scrollBy) { await p.evaluate((dy) => scrollBy(0, dy), s.scrollBy ?? -4); await p.clock.runFor(200) }
  const box = (sel) => p.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, width: r.width, height: r.height } }, sel)
  const centre = async (sel, dx = 0, dy = 0) => { const r = await box(sel); if (!r) throw new Error(`${name}: no ${sel}`); return [r.x + r.width / 2 + dx, r.y + r.height / 2 + dy] }

  // the pointer: glides are interpolated per frame, so the app sees a real move on every frame
  let cur = s.cursor ?? [vp.width * 0.56, 30], from = cur, to = cur, gT0 = 0, gT1 = 0, down = false // resting in the header's empty middle: nothing there reacts to it
  const events = []
  const timeline = (await s.timeline({ p, box, centre })).sort((a, b) => a.t - b.t)
  const fps = s.fps ?? 24
  const frames = Math.round((s.duration ?? 5) * fps)
  await p.mouse.move(...cur)
  let ti = 0
  const t1 = Date.now()
  for (let i = 0; i < frames; i++) {
    const t = i / fps
    // the pointer first, then this frame's events, so a press lands where a finished glide left the pointer (and not
    // a frame earlier, which would hand the stage one big drag step). A move only when the pointer moves: over the
    // 3D stage every pointer event costs a software re-render
    if (t < gT1) {
      const k = ease(Math.min(1, (t - gT0) / (gT1 - gT0)))
      cur = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k]
      await p.mouse.move(...cur)
    } else if (cur !== to) { cur = to; await p.mouse.move(...cur) }
    while (ti < timeline.length && timeline[ti].t <= t + 1e-6) {
      const ev = timeline[ti++]
      let target = ev.glide
      if (ev.sel) target = [...(await centre(ev.sel, ev.dx ?? 0, ev.dy ?? 0)), ev.dur ?? 0.6]
      if (ev.rel) target = [cur[0] + ev.rel[0], cur[1] + ev.rel[1], ev.rel[2] ?? 0.8]
      if (target) { from = cur; to = target.slice(0, 2); gT0 = t; gT1 = t + (target[2] ?? 0.6) }
      if (ev.down) { await p.mouse.down(); down = true; events.push({ t, type: 'down', x: cur[0], y: cur[1] }) }
      if (ev.up) { await p.mouse.move(...cur); await p.mouse.up(); down = false; events.push({ t, type: 'up', x: cur[0], y: cur[1] }) }
      if (ev.fn) await ev.fn()
      if (ev.type) { await p.keyboard.type(ev.type, { delay: 0 }); events.push({ t, type: 'type', text: ev.type }) }
      if (ev.press) { await p.keyboard.press(ev.press); events.push({ t, type: 'press', key: ev.press }) }
      if (ev.mark) events.push({ t, type: 'mark', what: ev.mark })
    }
    events.push({ t, type: 'cursor', x: cur[0], y: cur[1], down })
    if (s.console) await p.waitForTimeout(60) // the shell answers in real time
    await p.screenshot({ path: join(dir, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94, timeout: 240000 }) // a 3D re-render under software GL can take a while
    await p.clock.runFor(Math.round(((i + 1) * 1000) / fps) - Math.round((i * 1000) / fps))
  }
  const rects = {}
  for (const sel of RECTS) rects[sel] = await box(sel)
  rects.scroll = await p.evaluate(() => ({ x: scrollX, y: scrollY }))
  writeFileSync(join(dir, 'events.json'), JSON.stringify({ scene: name, fps, frames, viewport: vp, scale, rects, events }, null, 1))
  console.log(`[${name}] ${frames} frames in ${((Date.now() - t1) / 1000).toFixed(0)} s`)
  await b.close()
}

const SCENES = {
  // the home screen with its faults: a slow turn of the board, then the pointer on the under-voltage reason, which
  // lights the PMIC callout, its leader and the part on the board
  hero: {
    path: '/?demo', duration: 7.5, fps: 24,
    timeline: async ({ centre }) => {
      const [vx, vy] = await centre('[data-bind=view]')
      return [
        { t: 0.6, glide: [vx, vy, 0.5] }, { t: 1.2, down: true }, { t: 1.25, glide: [vx + 32, vy + 2, 1.8] }, { t: 3.2, up: true }, // the stage adds inertia per frame, so a short drag turns it far enough
        { t: 3.7, sel: '[data-bind=checks] a.check[data-part=pmic] .check-text', dx: -60, dur: 0.7 }, { t: 4.4, mark: 'lit' },
      ]
    },
  },
  // the fan card: a press on Performance, "Switching…", then the readout climbing at the demo's pace
  fan: {
    duration: 7.5, fps: 12, scrollBy: 90,
    timeline: async () => [{ t: 0.5, sel: '[data-bind=pads] button[data-v=performance]', dx: 60, dur: 0.7 }, { t: 1.4, down: true }, { t: 1.5, up: true, mark: 'pressed' }],
  },
  // Quiet at night: the switch under the pads
  night: {
    duration: 4.5, fps: 12, scrollBy: 90,
    timeline: async () => [{ t: 0.4, sel: '[data-bind=night-switch]', dur: 0.6 }, { t: 1.2, down: true }, { t: 1.3, up: true, mark: 'on' }],
  },
  // the curve editor: the Custom tab, then a handle dragged up and to the left
  curve: {
    duration: 6.5, fps: 12, scrollTo: '#fan',
    timeline: async () => [
      { t: 0.4, sel: '#fan button[role=tab][data-v=custom]', dur: 0.6 }, { t: 1.1, down: true }, { t: 1.2, up: true, mark: 'custom' },
      { t: 1.9, sel: '#fan .handle[data-i="2"]', dur: 0.6 }, { t: 2.7, down: true }, { t: 2.8, rel: [-28, -70, 1.3] }, { t: 4.3, up: true, mark: 'moved' },
    ],
  },
  // the System card on the desktop: Update..., the confirm dialog, Update now, the log streaming, Succeeded
  update: {
    duration: 11, fps: 12, scrollTo: '#system',
    timeline: async ({ p }) => [
      { t: 0.05, fn: () => p.evaluate(() => document.querySelector('#system').scrollIntoView({ block: 'start' })) }, // once more: the masonry re-measures after the first scroll
      { t: 0.4, sel: '#system [data-ref=upd]', dur: 0.6 }, { t: 1.1, down: true }, { t: 1.2, up: true, mark: 'dialog' },
      { t: 1.9, sel: '[data-bind=confirm-ok]', dur: 0.6 }, { t: 2.7, down: true }, { t: 2.8, up: true, mark: 'confirmed' },
    ],
  },
  // the same on a phone
  'update-phone': {
    duration: 11, fps: 12, scrollTo: '#system', viewport: { width: 390, height: 844 }, scale: 2, mobile: true, cursor: [300, 30],
    timeline: async () => [
      { t: 0.4, sel: '#system [data-ref=upd]', dur: 0.6 }, { t: 1.1, down: true }, { t: 1.2, up: true, mark: 'dialog' },
      { t: 1.9, sel: '[data-bind=confirm-ok]', dur: 0.6 }, { t: 2.7, down: true }, { t: 2.8, up: true, mark: 'confirmed' },
    ],
  },
  // Services: the failed unit's Logs button opens the journal dialog
  services: {
    path: '/?demo', duration: 7, fps: 12, scrollTo: '#services',
    timeline: async () => [{ t: 0.5, sel: 'button[aria-label="Logs of restic-backup"]', dur: 0.7 }, { t: 1.4, down: true }, { t: 1.5, up: true, mark: 'logs' }],
  },
  // the console: Connect, then two commands typed into the real shell
  console: {
    path: '/', console: true, duration: 8, fps: 12, scrollTo: '#console', settle: 8, settleReal: 9000,
    timeline: async ({ p }) => [
      { t: 0.05, fn: () => p.evaluate(() => document.querySelector('#console').scrollIntoView({ block: 'start' })) }, // once more, after the layout settled
      { t: 0.5, sel: '#console [data-ref=connect]', dur: 0.6 }, { t: 1.2, down: true }, { t: 1.3, up: true, mark: 'connect' },
      { t: 2.6, type: 'uptime' }, { t: 3.0, press: 'Enter' }, { t: 4.4, type: 'free -h' }, { t: 4.8, press: 'Enter', mark: 'typed' },
    ],
  },
  // Thermals and Power side by side, their readings ticking
  thermals: { duration: 4, fps: 12, scrollTo: '#thermals', scrollBy: -60, timeline: async () => [] },
  // the home screen, healthy, with the board turned a little (the preview card's first screen)
  home: {
    duration: 4, fps: 12,
    timeline: async ({ centre }) => { const [vx, vy] = await centre('[data-bind=view]'); return [{ t: 0.1, glide: [vx, vy, 0.2] }, { t: 0.3, down: true }, { t: 0.35, glide: [vx + 14, vy, 0.8] }, { t: 1.2, up: true }] },
  },
}

const list = names[0] === 'all' ? Object.keys(SCENES) : names
for (const n of list) {
  if (!SCENES[n]) throw new Error(`no scene ${n}`)
  await scene(n, SCENES[n])
}
