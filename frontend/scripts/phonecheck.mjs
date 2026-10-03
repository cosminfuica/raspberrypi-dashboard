// Phone checks for the persona-review fixes (docs/design-review/2026-10-02-persona, issues #6-#12): the persona's
// 412 px touch phone on the in-browser demo (?demo, token "demo"). Serves a production build itself, like herocheck.mjs.
//   npm run build, then: DIST=frontend/dist [OUT=<shots dir>] node frontend/scripts/phonecheck.mjs
// Needs Playwright where node resolves it (npm i --no-save playwright), as herocheck.mjs does.
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const root = process.env.DIST
const out = process.env.OUT
if (out) fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }
const srv = http.createServer((q, r) => {
  let p = new URL(q.url, 'http://x').pathname
  if (p === '/') p = '/index.html'
  const f = path.join(root, p)
  if (!fs.existsSync(f)) return r.writeHead(404).end()
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(r)
}).listen(5403, '127.0.0.1')
const BASE = 'http://127.0.0.1:5403/'
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
const b = await chromium.launch({ args: GL })
let fails = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) fails++ }
// the persona's phone: a 412 px Android with a thumb
const PHONE = { viewport: { width: 412, height: 839 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }
const errs = []

async function open(q, extra = {}) {
  const ctx = await b.newContext({ ...PHONE, ...extra })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push(`${q}: ${e.message}`))
  p.on('console', (m) => m.type() === 'error' && errs.push(`${q}: ${m.text()}`))
  await p.goto(BASE + '?' + q)
  await p.waitForFunction(() => document.querySelector('[data-bind=verdict]')?.textContent !== 'Waiting for data')
  return { p, ctx }
}

// a change asks for the token first: answer the dialog it opens
async function signIn(p) {
  await p.waitForSelector('[data-bind=login][open]', { timeout: 5000 })
  await p.fill('[data-bind=login-token]', 'demo')
  await p.tap('[data-bind=login-submit]')
  await p.waitForSelector('[data-bind=login][open]', { state: 'detached', timeout: 5000 })
}

// badge (#12): the fan badge names a picked profile as soon as the note says it is active, not at the next tick. The
// observer stores the card at the first moment the note says so: no timing guess
try {
  const { p, ctx } = await open('demo&healthy')
  await p.evaluate(() => {
    const note = document.querySelector('[data-bind=pads-note]')
    new MutationObserver((_, o) => {
      if (!/is active/.test(note.textContent)) return
      o.disconnect()
      window.__atNote = {
        badge: document.querySelector('[data-bind=fan-mode]').textContent,
        pressed: document.querySelector('[data-bind=pads] [data-v=performance]').getAttribute('aria-pressed'),
      }
    }).observe(note, { childList: true, characterData: true, subtree: true })
  })
  await p.tap('[data-bind=pads] [data-v=performance]')
  await signIn(p)
  await p.waitForFunction(() => window.__atNote, null, { timeout: 5000 })
  const r = await p.evaluate(() => window.__atNote)
  ok(/Performance/.test(r.badge), `badge: the fan badge names the pick when the note says it is active (${r.badge})`)
  ok(r.pressed === 'true', `badge: the Performance pad is pressed then (aria-pressed=${r.pressed})`)
  if (out) await p.locator('.fanctl').screenshot({ path: `${out}/badge-412.png` })
  await ctx.close()
} catch (e) {
  ok(false, `badge: ${e.message.split('\n')[0]}`)
}

// a condition the page reaches within ms, as true or false: the ok() after it reports what was there instead
const until = (p, fn, ms) => p.waitForFunction(fn, null, { timeout: ms }).then(() => true, () => false)

// preview (#7): a curve tab that isn't running reads as a preview. The section summary names the running curve, the bar
// right under the tabs says what the fan follows and holds Use, the chart marker says "If Silent were on", and Use
// switches the fan
try {
  const { p, ctx } = await open('demo&healthy')
  await p.locator('#fan').scrollIntoViewIfNeeded()
  await p.tap('#fan [role=tab][data-v=silent]')
  // the tab's click renders the whole editor in one task: once it is selected, the bar and the chart are drawn
  await p.waitForSelector('#fan [role=tab][data-v=silent][aria-selected=true]', { timeout: 5000 })
  const r = await p.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const bar = q('#fan [data-ref=preview]')
    const use = [...(bar?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim() === 'Use Silent')
    return {
      sum: q('#fan [data-ref=sum]').textContent,
      bar: bar?.textContent ?? null,
      use: use ? Math.round(use.getBoundingClientRect().top) : null,
      wrap: Math.round(q('#fan .curve-wrap').getBoundingClientRect().top),
      tabs: Math.round(q('#fan .tabs').getBoundingClientRect().bottom),
      label: q('#fan .curve .live-label')?.textContent ?? null,
    }
  })
  ok(r.sum.startsWith('Balanced:'), `preview: the section summary describes the running curve (${r.sum})`)
  ok(/Preview: the fan follows Balanced, not Silent/.test(r.bar), `preview: the bar under the tabs says the Silent tab is a preview (${r.bar})`)
  ok(r.use != null && r.use < r.wrap && r.use - r.tabs < 120, `preview: Use Silent sits in the bar, above the chart and under the tabs (${r.use == null ? 'not in the bar' : `${r.use - r.tabs} px under the tabs, chart at ${r.wrap - r.tabs} px`})`)
  ok(/^If Silent were on: /.test(r.label), `preview: the chart marker reads as a preview (${r.label})`)
  if (out) await p.locator('#fan .curve-main').screenshot({ path: `${out}/preview-412.png` })
  await p.locator('#fan [data-ref=preview] button', { hasText: 'Use Silent' }).tap({ timeout: 5000 })
  await signIn(p)
  const used = await until(p, () => /Silent/.test(document.querySelector('[data-bind=fan-mode]').textContent) && /Silent is driving the fan/.test(document.querySelector('#fan [data-ref=preview]').textContent), 3000)
  const s = await p.evaluate(() => `${document.querySelector('[data-bind=fan-mode]').textContent} | ${document.querySelector('#fan [data-ref=preview]').textContent}`)
  ok(used, `preview: Use Silent switches the fan within 3 s and the bar says so (${s})`)
  await ctx.close()
} catch (e) {
  ok(false, `preview: ${e.message.split('\n')[0]}`)
}

// swipe (#8): real touch through CDP, the review's gesture: 12 moves of 30 px up, 16 ms apart, then 700 ms for the page
// to scroll. A swipe on the verdict first: the gesture scrolls the page there, so a 0 on the chart is the chart keeping
// the thumb. A touch that starts on a point of the editable Custom curve drags the point instead, and a double-tap still
// removes one
try {
  const { p, ctx } = await open('demo&healthy')
  const cdp = await ctx.newCDPSession(p)
  const touch = (type, [x, y] = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  const pause = (ms) => new Promise((r) => setTimeout(r, ms))
  // the page holds still for 6 frames in a row (at most 300), so a fling from one gesture can't move the next one's start
  const settle = () => p.evaluate(() => new Promise((r) => {
    let y = scrollY
    let still = 0
    let n = 0
    const f = () => {
      still = scrollY === y ? still + 1 : 0
      y = scrollY
      if (still >= 6 || ++n > 300) r()
      else requestAnimationFrame(f)
    }
    requestAnimationFrame(f)
  }))
  // the chart 220 px under the sticky strip, so every gesture starts on screen and below the strip
  const place = async () => {
    await settle()
    await p.evaluate(() => scrollBy(0, document.querySelector('#fan .curve-wrap').getBoundingClientRect().top - document.querySelector('.fingers').getBoundingClientRect().bottom - 220))
    await settle()
  }
  // a spot in the i-th match: its fraction fx/fy of the box, and what a touch there lands on
  const spot = (sel, fx = 0.5, fy = 0.5, i = 0) => p.evaluate(([sel, fx, fy, i]) => {
    const r = document.querySelectorAll(sel)[i].getBoundingClientRect()
    const at = [Math.round(r.left + r.width * fx), Math.round(r.top + r.height * fy)]
    const e = document.elementFromPoint(...at)
    return { at, on: `${e?.tagName.toLowerCase()}.${String(e?.className?.baseVal ?? e?.className).split(' ')[0]}` }
  }, [sel, fx, fy, i])
  async function swipe({ at }, n = 12, dy = -30) {
    const y0 = await p.evaluate(() => scrollY)
    await touch('touchStart', at)
    for (let i = 1; i <= n; i++) {
      await pause(16)
      await touch('touchMove', [at[0], at[1] + i * dy])
    }
    await touch('touchEnd')
    await pause(700)
    return Math.round((await p.evaluate(() => scrollY)) - y0)
  }
  await settle()
  const ctl = await spot('.verdict')
  const control = await swipe(ctl)
  ok(control >= 200, `swipe: a swipe on the verdict (${ctl.on}) scrolls the page ${control} px, so the gesture scrolls`)
  await place()
  const plot = await spot('#fan .curve-wrap', 0.3, 0.3)
  const builtin = await swipe(plot)
  ok(builtin >= 200, `swipe: a swipe on the Balanced chart (${plot.on}) scrolls the page ${builtin} px`)
  await p.tap('#fan [role=tab][data-v=custom]')
  await p.waitForSelector('#fan .curve[data-editable]', { timeout: 5000 })
  await place()
  const speed = () => p.locator('#fan [data-ref=rows] tr:nth-child(3) [data-k=speed_pct]').inputValue({ timeout: 2000 })
  const before = await speed()
  const knob = await spot('#fan .curve .handle .knob', 0.5, 0.5, 2)
  const dragged = await swipe(knob, 6, 8)
  const after = await speed()
  ok(before === '50' && after !== '50' && dragged === 0, `swipe: dragging Custom point 3 (${knob.on}) down edits it (${before} → ${after} %) and scrolls the page ${dragged} px`)
  await place()
  const count = () => p.evaluate(() => document.querySelectorAll('#fan .curve .handle').length)
  const n0 = await count()
  const { at } = await spot('#fan .curve .handle .knob', 0.5, 0.5, 3)
  await touch('touchStart', at)
  await touch('touchEnd')
  await pause(90)
  await touch('touchStart', at)
  await touch('touchEnd')
  const removed = await until(p, () => document.querySelectorAll('#fan .curve .handle').length === 4, 2000)
  ok(n0 === 5 && removed, `swipe: a double-tap on Custom point 4 removes it (${n0} → ${await count()} points)`)
  await place()
  const empty = await spot('#fan .curve-wrap', 0.3, 0.3)
  const freed = await swipe(empty)
  ok(freed >= 200, `swipe: a swipe on the empty plot of the Custom curve (${empty.on}) scrolls the page ${freed} px`)
  await ctx.close()
} catch (e) {
  ok(false, `swipe: ${e.message.split('\n')[0]}`)
}

ok(errs.length === 0, `no page errors ${errs.join(' | ')}`)
await b.close()
srv.close()
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS')
process.exitCode = fails ? 1 : 0
