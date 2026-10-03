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

ok(errs.length === 0, `no page errors ${errs.join(' | ')}`)
await b.close()
srv.close()
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS')
process.exitCode = fails ? 1 : 0
