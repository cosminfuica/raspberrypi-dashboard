// Proves two builds of the page behave the same: the CSS bytes, the chunk set and three.js kept out of the entry
// chunk, then, under a frozen clock and a seeded Math.random, the same DOM, canvas pixels, page errors and order of
// addEventListener / observe / matchMedia calls in 8 ?demo scenarios at 1440 and 412 px plus a keyboard and pointer
// script, and a 3D smoke run. Built for pure restructures: any difference fails, nothing is stored between runs.
//   npm run build, then from frontend/: node scripts/snapcheck.mjs <distA> <distB>   (serves them on 5501 and 5502)
// Needs Playwright where node resolves it (npm i --no-save playwright), as herocheck.mjs does.
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const dists = process.argv.slice(2, 4).map((d) => path.resolve(d))
if (dists.length !== 2 || !dists.every((d) => fs.existsSync(path.join(d, 'index.html')))) {
  console.error('usage: node scripts/snapcheck.mjs <distA> <distB> (each a built dist with index.html)')
  process.exit(2)
}
const PORTS = [5501, 5502]
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

class Fail extends Error {}
const fail = (check, msg) => {
  throw new Fail(`SNAPCHECK FAIL ${check}: ${msg}`)
}

// ------------------------------------------------------------------ static checks (no browser)

// Vite names assets <name>-<8-char hash>.<ext>; the hash may itself contain '-'
const strip = (f) => f.replace(/-[\w-]{8}(?=\.[a-z0-9]+$)/, '')
function staticChecks() {
  const [a, b] = dists.map((d) => fs.readdirSync(path.join(d, 'assets')).sort())
  const errs = []
  // (a) CSS: same names without the hash, same bytes
  const css = (d, list) =>
    new Map(list.filter((f) => f.endsWith('.css')).map((f) => [strip(f), fs.readFileSync(path.join(d, 'assets', f))]))
  const [ca, cb] = [css(dists[0], a), css(dists[1], b)]
  for (const n of new Set([...ca.keys(), ...cb.keys()])) {
    if (!ca.has(n) || !cb.has(n)) errs.push(`CSS ${n} only in ${ca.has(n) ? 'A' : 'B'}`)
    else if (!ca.get(n).equals(cb.get(n))) {
      const [x, y] = [ca.get(n), cb.get(n)]
      let i = 0
      while (i < x.length && x[i] === y[i]) i++
      errs.push(
        `CSS ${n} bytes differ at offset ${i} (A ${x.length}, B ${y.length} bytes): A …${x.subarray(i, i + 80)}… B …${y.subarray(i, i + 80)}…`,
      )
    }
  }
  // (b) the asset set without hashes
  const [sa, sb] = [new Set(a.map(strip)), new Set(b.map(strip))]
  const only = (x, y) => [...x].filter((n) => !y.has(n))
  if (only(sa, sb).length || only(sb, sa).length)
    errs.push(`assets differ: only in A [${only(sa, sb)}], only in B [${only(sb, sa)}]`)
  // (c) the lazy chunks exist in both, (d) three.js stays out of the entry chunk
  for (const [k, list] of [
    ['A', a],
    ['B', b],
  ]) {
    for (const p of ['mock-', 'scene3d-', 'xterm-', 'addon-fit-'])
      if (!list.some((f) => f.startsWith(p) && f.endsWith('.js'))) errs.push(`chunk ${p}*.js missing in ${k}`)
    const d = dists[k === 'A' ? 0 : 1]
    for (const f of list.filter((f) => /^index-.*\.js$/.test(f)))
      if (fs.readFileSync(path.join(d, 'assets', f), 'utf8').includes('WebGLRenderer'))
        errs.push(`entry chunk ${k} ${f} contains WebGLRenderer`)
  }
  if (errs.length)
    fail(
      'static',
      '\n' +
        errs
          .map((e) => `  ${e.startsWith('CSS') ? 'css' : e.startsWith('assets') ? 'assets' : 'chunk'}: ${e}`)
          .join('\n'),
    )
}

// ------------------------------------------------------------------ servers and browser

function serve(root, port) {
  return new Promise((res, rej) => {
    const s = http.createServer((q, r) => {
      let p = new URL(q.url, 'http://x').pathname
      if (p === '/') p = '/index.html'
      const f = path.join(root, p)
      if (!fs.existsSync(f)) return r.writeHead(404).end()
      r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' })
      fs.createReadStream(f).pipe(r)
    })
    s.once('error', rej)
    s.listen(port, '127.0.0.1', () => res(s))
  })
}

// Runs in the page before its scripts: a seeded Math.random, the 2D Board, and the trace of wiring calls
function init(lowpower) {
  let seed = 1
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  if (lowpower) {
    try {
      localStorage.setItem('pidash.lowpower', '1')
    } catch {
      /* no storage: the run fails on the Board instead */
    }
  }
  // Observer callbacks and scroll events follow real rendering, not the fake clock. A fresh observer's first callback
  // comes after every notification of that rendering update, so awaiting it lets the page's own observers catch up.
  const IO = IntersectionObserver
  const ioObserve = IO.prototype.observe
  window.__settle = () =>
    new Promise((r) => {
      const o = new IO(() => {
        o.disconnect()
        r()
      })
      ioObserve.call(o, document.documentElement)
    })
  const trace = (window.__trace = [])
  const name = (o) => {
    if (o === window) return 'window'
    if (o === document) return 'document'
    if (o instanceof MediaQueryList) return `mq ${o.media}`
    if (o instanceof Element)
      return `${o.closest('[id]')?.id ?? ''} ${o.tagName} ${o.dataset?.bind ?? o.dataset?.ref ?? ''}`
    return o?.constructor?.name ?? String(o)
  }
  const ael = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    trace.push(['on', name(this), type, typeof opts === 'boolean' ? opts : !!opts?.capture])
    return ael.call(this, type, fn, opts)
  }
  for (const C of [IntersectionObserver, ResizeObserver]) {
    const obs = C.prototype.observe
    C.prototype.observe = function (t, o) {
      trace.push([C.name, name(t)])
      return obs.call(this, t, o)
    }
  }
  const mm = window.matchMedia
  window.matchMedia = function (q) {
    trace.push(['mm', q])
    return mm.call(window, q)
  }
}

const SCENARIOS = [
  'demo',
  'demo&healthy',
  'demo&hot',
  'demo&flaky',
  'demo&docker=off',
  'demo&fan=kernel',
  'demo&auth=off',
  'demo&healthy&outage=3-30',
]
const VIEWPORTS = [
  { viewport: { width: 1440, height: 900 } },
  { viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true },
]
const T0 = new Date('2026-10-03T12:00:00+03:00')

async function snapshot(p, acts) {
  const s = await p.evaluate(() => ({
    title: document.title,
    favicon: document.querySelector('[data-bind=favicon]')?.href.replace(/blob:[^"')\s]+/g, 'blob:X') ?? null,
    html: document.body.outerHTML.replace(/blob:[^"')\s]+/g, 'blob:X'),
    canvas: [...document.querySelectorAll('canvas')].map((c) => c.toDataURL()),
    trace: JSON.stringify(window.__trace),
  }))
  // A and B are served on different ports: absolute URLs (the favicon href) differ only by origin
  for (const k of ['favicon', 'html']) s[k] = s[k]?.replaceAll(/http:\/\/127\.0\.0\.1:550[12]/g, 'ORIGIN') ?? null
  s.canvas = s.canvas.map((u) => crypto.createHash('sha256').update(u).digest('hex').slice(0, 16)).join(' ')
  s.actions = acts.splice(0).join('; ')
  return s
}

// One scenario at one viewport on one dist: the snapshots it yields, in order, plus its page errors
async function run(browser, port, q, vp, interact) {
  const ctx = await browser.newContext({ ...vp, reducedMotion: 'reduce' })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
  p.on('console', (m) => m.type() === 'error' && errs.push(`console: ${m.text()}`))
  const shots = []
  const acts = []
  const settle = () => p.evaluate(() => window.__settle())
  const runFor = async (ms) => {
    await settle()
    await p.clock.runFor(ms)
  }
  const shot = async (step) => {
    await settle()
    shots.push({ step, ...(await snapshot(p, acts)) })
  }
  try {
    await p.addInitScript(init, true)
    // install() lets the fake clock follow real time; pauseAt() freezes it, so only runFor() moves it
    await p.clock.install({ time: T0 })
    await p.clock.pauseAt(T0)
    await p.goto(`http://127.0.0.1:${port}/?${q}`)
    // the demo backend is a lazy chunk: let it and the fonts arrive before any fake time passes
    await p.waitForLoadState('networkidle')
    await runFor(5000)
    await p.evaluate(() => document.fonts.ready)
    await shot('load')
    if (interact) {
      // an action whose target is absent is recorded, not thrown, so both dists must skip it alike
      const visible = async (loc, what) => {
        if (await loc.isVisible()) return true
        acts.push(`absent ${what}`)
        return false
      }
      for (const k of '1234567890-=') {
        await p.keyboard.press(k)
        await runFor(1000)
        await shot(`1 key ${k}`)
      }
      await p.keyboard.press('/')
      await p.keyboard.press('Escape')
      await shot('2 / Escape')
      await p.keyboard.press('f')
      await shot('3 f')
      for (const sel of ['section[id][data-part]', '.check']) {
        const all = p.locator(sel)
        for (let i = 0, n = await all.count(); i < n; i++)
          if (await visible(all.nth(i), `${sel} #${i}`)) await all.nth(i).hover({ timeout: 5000 })
      }
      await shot('4 hover')
      const failed = p.locator('#services [data-v=failed]')
      if (await visible(failed, 'failed filter')) await failed.click({ timeout: 5000 })
      await shot('5 failed')
      const search = p.locator('#services [data-ref=q]')
      if (await visible(search, 'search')) {
        await search.fill('ssh')
        await search.press('Escape')
      }
      await shot('6 search')
      const iface = p.locator('#network .iface').nth(1)
      if (await visible(iface, 'second iface')) await iface.click({ timeout: 5000 })
      await shot('7 iface')
      const signin = p.locator('[data-bind=signin]')
      if (await visible(signin, 'signin')) {
        await signin.click({ timeout: 5000 })
        await p.locator('[data-bind=login-token]').fill('demo', { timeout: 5000 })
        await p.locator('[data-bind=login-submit]').click({ timeout: 5000 })
      }
      await runFor(2000)
      await shot('8 signin')
      const rs = p.locator('#services .rs').filter({ visible: true }).first()
      if (await visible(rs, 'restart')) {
        await rs.click({ timeout: 5000 })
        await runFor(1000)
        const cancel = p.locator('[data-bind=confirm-cancel]')
        if (await visible(cancel, 'confirm-cancel')) await cancel.click({ timeout: 5000 })
      }
      await shot('9 restart cancel')
    }
    if (q.includes('outage=')) {
      for (let i = 1; i <= 6; i++) {
        await runFor(5000)
        await shot(`outage +${i * 5}s`)
      }
    }
  } catch (e) {
    errs.push(`script: ${e.message.split('\n')[0]}`)
  } finally {
    await ctx.close()
  }
  return { shots, errs }
}

// 3D smoke: the real Board (no low-power switch) loads scene3d and ends in 3D. stage.js catches a failing scene3d
// import or createScene3D, warns '3D view unavailable' and falls back to 2D, so a page error alone proves nothing.
async function smoke(port) {
  const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  const b = await chromium.launch({ args: GL })
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' || m.text().includes('3D view unavailable'))
        errs.push(`console ${m.type()}: ${m.text()}`)
    })
    const got = p.waitForResponse((r) => r.url().includes('/assets/scene3d-'), { timeout: 20000 })
    await p.goto(`http://127.0.0.1:${port}/?demo`)
    await got.catch(() => errs.push('no /assets/scene3d- response within 20 s'))
    // stage.js sets data-placed once a view (3D or the 2D fallback) is up, and data-mode to the one it ended in
    const mode = await p
      .waitForSelector('[data-bind=stage][data-placed]', { state: 'attached', timeout: 20000 })
      .then(() => p.evaluate(() => document.querySelector('[data-bind=stage]').dataset.mode))
      .catch(() => 'not placed within 20 s')
    if (mode !== '3d') errs.push(`Board mode is ${mode}, want 3d`)
    // two frames, so the scene's first render runs before the errors are read
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    return errs
  } finally {
    await b.close()
  }
}

function compare(where, a, b) {
  for (const [field, check] of [
    ['title', 'DOM'],
    ['favicon', 'DOM'],
    ['html', 'DOM'],
    ['actions', 'DOM'],
    ['canvas', 'canvas'],
    ['trace', 'trace'],
  ]) {
    if (a[field] === b[field]) continue
    let detail
    if (field === 'trace') {
      const [x, y] = [JSON.parse(a.trace), JSON.parse(b.trace)]
      let i = 0
      while (i < Math.max(x.length, y.length) && JSON.stringify(x[i]) === JSON.stringify(y[i])) i++
      detail = `first difference at call #${i} (A ${x.length}, B ${y.length} calls)\n  A: ${JSON.stringify(x[i])}\n  B: ${JSON.stringify(y[i])}`
    } else {
      let i = 0
      while (a[field][i] === b[field][i]) i++
      const at = (s) => s.slice(Math.max(0, i - 100), i + 100)
      detail = `first difference at offset ${i}\n  A: ${at(a[field])}\n  B: ${at(b[field])}`
    }
    fail(check, `${where} step=${a.step} field=${field}: ${detail}`)
  }
}

// ------------------------------------------------------------------ main

let servers = []
let browser
try {
  staticChecks()
  servers = await Promise.all(dists.map((d, i) => serve(d, PORTS[i])))
  browser = await chromium.launch()
  let n = 0
  for (const q of SCENARIOS) {
    for (const vp of VIEWPORTS) {
      const where = `?${q} ${vp.viewport.width}px`
      const interact = vp.viewport.width === 1440
      const [A, B] = [await run(browser, PORTS[0], q, vp, interact), await run(browser, PORTS[1], q, vp, interact)]
      for (const [k, r] of [
        ['A', A],
        ['B', B],
      ])
        if (r.errs.length) fail('errors', `${where} in ${k}:\n  ${r.errs.join('\n  ')}`)
      if (A.shots.length !== B.shots.length)
        fail('DOM', `${where}: ${A.shots.length} snapshots in A, ${B.shots.length} in B`)
      A.shots.forEach((s, i) => compare(where, s, B.shots[i]))
      n += A.shots.length
    }
  }
  for (const [k, port] of [
    ['A', PORTS[0]],
    ['B', PORTS[1]],
  ]) {
    const errs = await smoke(port)
    if (errs.length) fail('3d', `in ${k}:\n  ${errs.join('\n  ')}`)
  }
  console.log(`SNAPCHECK PASS ${n} snapshots`)
} catch (e) {
  console.log(e instanceof Fail ? e.message : `SNAPCHECK FAIL run: ${e.stack}`)
  process.exitCode = 1
} finally {
  await browser?.close()
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))))
}
