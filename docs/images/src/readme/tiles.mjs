// The README's bento tiles (animated WebP, dark and light) from the captures capture.mjs made
// (.github/readme/BRIEF.md has the look; the layout is the readme-enhancer skill's launch page + bento template).
//
//   node docs/images/src/readme/tiles.mjs <frames-dir> <out-dir> [tile ...]     tiles: see TILES below, or all
//
// Run from a directory where `npm i --no-save playwright` has been done. Each tile is an HTML page drawn as a pure
// function of time: a chamfered footprint, a benefit title, one line, and a window onto the captured frames with the
// pointer drawn from the capture's events. Frames are stepped at 10 fps, screenshotted with a transparent half-gutter,
// and encoded with libwebp (quality 82). Every loop opens on its settled end state, which is also its last frame, so
// a paused image shows the result and the loop doesn't jump.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { THEMES, base, capture as cap_, chromium, EXE, esc, merge, render, window_, winState } from './compose.mjs'

const [framesDir, outDir, ...names] = process.argv.slice(2)
if (!framesDir || !outDir) throw new Error('usage: tiles.mjs <frames-dir> <out-dir> [tile ...]')
const capture = (n) => cap_(framesDir, n)
const FPS = 10
const K = 1.6 // render scale: a 400-class tile is 640 px, so its text stays crisp at 2x of the README's column
const G = 16 // the transparent half-gutter
const WORK = join(outDir, '_work')
mkdirSync(WORK, { recursive: true })

/** The footprint card with its chamfered pin-1 corner and dot, inside the half-gutter. */
function page(theme, w, h, body) {
  const T = THEMES[theme], c = 14
  const card = `<div style="position:absolute;left:${G}px;top:${G}px;width:${w}px;height:${h}px;background:${T.mask};clip-path:polygon(${c}px 0,100% 0,100% 100%,0 100%,0 ${c}px)"></div>` +
    `<svg style="position:absolute;left:${G}px;top:${G}px;pointer-events:none" width="${w}" height="${h}"><path d="M${c} .5H${w - 0.5}V${h - 0.5}H.5V${c}Z" fill="none" stroke="${T.line}"/></svg>` +
    `<div style="position:absolute;left:${G + c * 0.58 - 2}px;top:${G + c * 0.58 - 2}px;width:4px;height:4px;border-radius:50%;background:${T.ink}"></div>` +
    `<div style="position:absolute;left:${G}px;top:${G}px;width:${w}px;height:${h}px">${body}</div>`
  return base(theme, w + 2 * G, h + 2 * G, card, `.win{outline:1px solid ${T.line2};outline-offset:-1px}`)
}

/** Time mapping for a loop that opens on the settled end: hold the last frame for `hold` s, then play [from, to]. */
function loop(from, to, hold = 1.2) {
  return { dur: hold + (to - from), at: (t) => (t < hold ? to : from + (t - hold)) }
}
/** A 400-class tile's content: the window on top (352x212), the benefit title and its line under it. */
function block(id, cap, crop, title, line, dy = 0, ratio = 0.6) {
  const w = window_(id, 24, 24 + dy, 352, { ...crop, h: crop.w * ratio })
  return { win: w, html: w.html + text(24, 24 + dy + w.h + 16, 352, title, line) }
}
const text = (x, y, w, title, line, kicker) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px">${kicker ? `<div class="lbl" style="margin-bottom:6px">${esc(kicker)}</div>` : ''}<div class="title">${esc(title)}</div><div class="line" style="margin-top:7px">${esc(line)}</div></div>`

// ------------------------------------------------------------------ the tiles: size class (w x h CSS px before K) and a builder
const TILES = {
  // feature 1 above feature 2: one tall image beside the preview card
  'stack-1-2': { w: 400, h: 800, build: () => {
    const hero = capture('hero'), fan = capture('fan')
    const vb = hero.rect('.verdict'), st = hero.rect('.stage')
    const c1 = { x: 560, y: vb.y - 10, w: vb.x + vb.width - 560 + 6 } // the verdict box and the board beside it, where the PMIC lights
    const fc = fan.rect('.fanctl')
    const c2 = { x: fc.x - 2, y: fc.y - 2, w: fc.width + 4 } // the readout and the first pads
    const b1 = block('a', hero, c1, "Know what's wrong, and where", 'One line says Healthy, or 1 problem, 2 to check; the part at fault lights on the board.')
    const b2 = block('b', fan, c2, 'Quieter or cooler, no reboot', 'Pick a profile and the fan follows it within a second.', 400)
    const l1 = loop(0.9, 7.4), l2 = loop(0.3, 7.4)
    return { html: b1.html + b2.html, dur: 8.6, state: (t) => merge(winState(b1.win, hero, l1.at(t)), winState(b2.win, fan, l2.at(t))) }
  } },
  'feature-3': { w: 400, h: 400, build: () => {
    const cap = capture('curve'), r = cap.rect('#fan')
    const b = block('a', cap, { x: r.x + 8, y: r.y + 34, w: r.width * 0.52 }, 'Draw your own fan curve', 'Drag the points, set the hysteresis; the Pi does exactly what the preview shows.'), l = loop(0.2, 6.4)
    return { html: b.html, dur: l.dur, state: (t) => winState(b.win, cap, l.at(t)) }
  } },
  'feature-4': { w: 400, h: 400, build: () => {
    const cap = capture('night'), fc = cap.rect('.fanctl'), n = cap.rect('[data-bind=night]')
    const b = block('a', cap, { x: fc.x - 2, y: n.y - 68, w: fc.width + 4 }, 'Quiet at night, by itself', "One profile from a start to an end time, on the Pi's clock."), l = loop(0.2, 4.4)
    return { html: b.html, dur: l.dur, state: (t) => winState(b.win, cap, l.at(t)) }
  } },
  'feature-5': { w: 400, h: 400, build: () => {
    const cap = capture('update-phone'), top = cap.rect('.fingers')
    const c = { x: 0, y: 268, w: 390, h: 566 } // the three actions, the confirm dialog over them, the reboot notice and the finished toast
    const w1 = window_('a', 24 + (352 - 160) / 2, 24, 160, c), l = loop(0.2, 10.8, 1.5)
    return { html: w1.html + text(24, 24 + w1.h + 16, 352, 'Updates and reboots from your phone', 'Every action asks first, then streams its log.'), dur: l.dur, state: (t) => winState(w1, cap, l.at(t)) }
  } },
  'feature-6': { w: 400, h: 400, build: () => {
    const cap = capture('services'), r = cap.rect('#services')
    const b = block('a', cap, { x: r.x + 106, y: r.y - 36, w: 930 }, 'Every service, one list, with logs', 'Failed units first; restart one, or read its journal in place.'), l = loop(0.2, 6.8)
    return { html: b.html, dur: l.dur, state: (t) => winState(b.win, cap, l.at(t)) }
  } },
  'feature-7': { w: 400, h: 400, build: () => {
    const cap = capture('console'), r = cap.rect('#console')
    const b = block('a', cap, { x: r.x, y: r.y, w: r.width }, 'A real shell, in the browser', 'bash on the Pi as the pidash user, behind your token.'), l = loop(0.2, 7.8)
    return { html: b.html, dur: l.dur, state: (t) => winState(b.win, cap, l.at(t)) }
  } },
  'feature-8': { w: 400, h: 400, build: () => {
    const cap = capture('thermals'), r = cap.rect('#thermals')
    const b = block('a', cap, { x: r.x, y: r.y + 60, w: r.width }, 'Readings only a Pi 5 has', 'PMIC rails, the RP1 temperature, throttle flags, the fan tach.', 0, 0.72), l = loop(0, 3.9, 0.1)
    return { html: b.html, dur: l.dur, state: (t) => winState(b.win, cap, l.at(t), { hideCursor: true }) }
  } },
  // the big card: a walk through the page's main screens, labelled, with a dot indicator
  preview: { w: 800, h: 800, build: (theme) => {
    const T = THEMES[theme]
    const screens = [
      { cap: capture('home'), label: 'Home: the board, the verdict, the fan', from: 1.2, to: 3.9 },
      { cap: capture('curve'), label: 'Fan curve: the editor', from: 0.4, to: 6.4 },
      { cap: capture('services'), label: 'Services: the journal of a failed unit', from: 0.2, to: 6.8 },
      { cap: capture('update'), label: 'System: an update, streamed', from: 2.0, to: 10.8 },
    ]
    const SEG = 4.2, X = 0.45 // seconds per screen, crossfade
    const full = { x: 0, y: 0, w: 1600, h: 900 }
    const wins = screens.map((s, i) => window_('s' + i, 24, 60, 752, full))
    const dots = screens.map((_, i) => `<i id="d${i}" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${T.faint};margin-left:8px;opacity:.5"></i>`).join('')
    return {
      html: `<div class="lbl" id="lab" style="position:absolute;left:24px;top:28px"></div><div style="position:absolute;right:24px;top:27px">${dots}</div>` +
            wins.map((w) => w.html).join('') +
            text(24, 560, 752, 'One page: health, fan, services and the system', 'Every number from the Pi with its unit, over one WebSocket, on any device in your tailnet. Shown here on demo data.'),
      dur: SEG * screens.length,
      state: (t) => {
        const i = Math.floor(t / SEG) % screens.length, k = (t % SEG) / SEG, next = (i + 1) % screens.length
        const st = { imgs: {}, els: {}, cur: {}, rip: {} }
        screens.forEach((s, j) => {
          const local = s.from + Math.min(s.to - s.from, (t % SEG) * ((s.to - s.from) / SEG))
          const o = j === i ? 1 : j === next && k > 1 - X / SEG ? (k - (1 - X / SEG)) / (X / SEG) : 0
          const ws = winState(wins[j], s.cap, j === i ? local : j === next ? s.from : s.to, { opacity: o, hideCursor: j !== i })
          Object.assign(st.imgs, ws.imgs); Object.assign(st.cur, ws.cur); Object.assign(st.rip, ws.rip)
          st.els['d' + j] = { style: { opacity: j === i ? 1 : 0.35, background: j === i ? T.ok : T.faint } }
        })
        st.els.lab = { text: screens[i].label }
        return st
      },
    }
  } },
  // the command a visitor will copy, typed live, with the real output
  code: { w: 800, h: 400, build: (theme) => {
    const T = THEMES[theme]
    const cmd = 'PIDASH_TOKEN=demo pidash --mock'
    const out = ['INFO:     Started server process [1308]', 'INFO:     Waiting for application startup.', 'INFO pidash.fan: fan control on: profile balanced', 'INFO:     Application startup complete.', 'INFO:     Uvicorn running on http://127.0.0.1:8787 (Press CTRL+C to quit)']
    const T1 = 0.6, TYPE = 0.07, OUT0 = T1 + cmd.length * TYPE + 0.5, GAP = 0.35, HOLD = 2.0, END = OUT0 + out.length * GAP + HOLD
    const dot = `<i style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#edf0e8;opacity:.3;margin-right:8px"></i>`
    return {
      html: text(24, 24, 752, 'Try it on any computer', 'No Pi needed: made-up data from a mock Pi. Sign in with demo to try the controls.') +
            `<div style="position:absolute;left:24px;top:124px;width:752px;height:252px;background:${T.win};outline:1px solid ${T.line2};outline-offset:-1px;padding:18px 22px;box-sizing:border-box;font-family:M,monospace;font-size:16px;line-height:1.55;color:#edf0e8;white-space:pre"><div style="margin-bottom:12px">${dot}${dot}${dot}</div><div><span style="color:#d9b35d">$ </span><span id="cmd"></span><span id="caret" style="display:inline-block;width:9px;height:18px;background:#d9b35d;vertical-align:-3px"></span></div><div id="out" style="color:#b3bfb6"></div></div>`,
      dur: END,
      state: (t) => {
        const tt = t < HOLD ? END : t - HOLD // opens on the finished run, then plays
        const n = Math.max(0, Math.min(cmd.length, Math.floor((tt - T1) / TYPE)))
        const lines = Math.max(0, Math.min(out.length, Math.floor((tt - OUT0) / GAP) + 1))
        return { els: { cmd: { text: cmd.slice(0, n) }, caret: { style: { visibility: tt < OUT0 && Math.floor(tt * 2.5) % 2 === 0 ? 'visible' : 'hidden' } }, out: { text: out.slice(0, lines).join('\n') } }, imgs: {}, cur: {}, rip: {} }
      },
    }
  } },
  // what it reads, one by one
  list: { w: 400, h: 400, build: (theme) => {
    const T = THEMES[theme]
    const items = ['SoC and RP1 temperatures', 'PMIC rails and power draw', 'NVMe temperature and I/O', 'Fan tach and PWM', 'Throttle flags since boot', 'CPU, memory, storage, network', 'systemd units and their logs', 'Docker containers', 'Tailnet peers and key expiry']
    const T1 = 0.5, GAP = 0.32, HOLD = 2.2, END = T1 + items.length * GAP + HOLD
    return {
      html: text(24, 24, 352, 'Reads', 'Every number with its unit, straight from the Pi.') +
            `<ul id="ul" style="position:absolute;left:24px;top:104px;margin:0;padding:0;list-style:none;font-size:16px;line-height:1.95;color:${T.ink}"></ul>`,
      dur: END,
      state: (t) => {
        const tt = t < HOLD ? END : t - HOLD
        const n = Math.max(0, Math.min(items.length, Math.floor((tt - T1) / GAP) + 1))
        return { els: { ul: { html: items.slice(0, n).map((s) => `<li><i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${T.ok};margin:0 12px 2px 0;box-shadow:inset 0 0 0 1px rgb(0 0 0/.35)"></i>${esc(s)}</li>`).join('') } }, imgs: {}, cur: {}, rip: {} }
      },
    }
  } },
}

// ------------------------------------------------------------------ render and encode
const b = await chromium.launch({ args: ['--allow-file-access-from-files'], executablePath: EXE })
const list = names.length && names[0] !== 'all' ? names : Object.keys(TILES)
for (const name of list) {
  const tile = TILES[name]
  if (!tile) throw new Error(`no tile ${name}`)
  for (const theme of ['dark', 'light']) {
    const built = tile.build(theme)
    const file = join(WORK, `${name}-${theme}.html`)
    writeFileSync(file, page(theme, tile.w, tile.h, built.html))
    const dir = join(WORK, `${name}-${theme}`)
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir)
    const t0 = Date.now()
    const n = await render(b, { file, w: tile.w + 2 * G, h: tile.h + 2 * G, scale: K, fps: FPS, dur: built.dur, state: built.state, dir })
    const out = join(outDir, `tile-${name}-${theme}.webp`)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, 'f%05d.png'), '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '82', '-compression_level', '6', '-pix_fmt', 'yuva420p', '-loop', '0', out])
    const kb = Math.round(execFileSync('stat', ['-c', '%s', out]).toString() / 1024)
    console.log(`${out}  ${n} frames, ${built.dur.toFixed(1)} s, ${kb} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  }
}
await b.close()
