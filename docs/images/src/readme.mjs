// README screenshots and tour (assets A3 and A4 of docs/design-improvement-plan.md). Run from any directory where
// `npm i --no-save playwright@1.63.0` has been done (the repo itself installs no Playwright), after `npm run build`
// in frontend/:
//
//   node <repo>/docs/images/src/readme.mjs shots [pi]   hero, phone, low-power, services and fan-curve from a real Pi
//                                                       (default http://raspberrypi:8787)
//   node <repo>/docs/images/src/readme.mjs tour         tour.webp, from the in-browser demo (?demo&healthy)
//
// The page is this checkout's frontend/dist, served under the Pi's origin, so its /api and WebSocket reach the Pi and
// every reading is the Pi's own. No token is used: GET /api/auth is answered "signed in", so the header shows the
// ghost Sign out (plan A3), and GET /api/system/update, the one signed-in read the page makes, is answered idle.
// Each file is captured and framed in one go, so nothing is ever framed twice. Needs ImageMagick, and ffmpeg with
// libwebp for the tour.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = createRequire(process.cwd() + '/')('playwright')
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const DIST = join(repo, 'frontend/dist')
const out = (f) => join(repo, 'docs/images', f)
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', webmanifest: 'application/manifest+json' }
// a real GPU keeps the tour at 60 fps (SwiftShader manages about 12). Chromium counts the Pi's tailnet address as
// local network, which a page it didn't load from there may not reach without the last flag
const ARGS = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-features=LocalNetworkAccessChecks']
if (!existsSync(join(DIST, 'index.html'))) throw new Error('build the page first: cd frontend && npm run build')
const tmp = mkdtempSync(join(tmpdir(), 'pidash-readme-'))
const pngSize = (f) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)] }

// Lanczos to w x h (cropping the top of a tall capture to that aspect first), then rounded alpha corners and a 2 px
// #3f444e hairline, so the dark UI keeps its edges on GitHub's dark theme. The radius is 9.5 px as the README shows
// the image (shown = its width there).
function frame(src, dst, w, h, shown) {
  const [sw, sh] = pngSize(src)
  h ??= Math.round((w * sh) / sw) // no height: keep the capture's shape
  const ch = Math.min(sh, Math.round((sw * h) / w))
  const r = Math.round((9.5 * w) / shown)
  execFileSync('magick', [src, '-alpha', 'set', '-crop', `${sw}x${ch}+0+0`, '+repage', '-filter', 'Lanczos', '-resize', `${w}x${h}!`,
    '(', '-size', `${w}x${h}`, 'xc:none', '-fill', 'white', '-draw', `roundrectangle -0.5,-0.5 ${w - 0.5},${h - 0.5} ${r},${r}`, ')',
    '-compose', 'DstIn', '-composite', '-compose', 'Over', // MVG puts pixel centres on integers: .5 lands on edges
    '-fill', 'none', '-stroke', '#3f444e', '-strokewidth', '2', '-draw', `roundrectangle 0.5,0.5 ${w - 1.5},${h - 1.5} ${r - 1},${r - 1}`,
    '-quality', '82', '-define', 'webp:method=6', '-strip', dst])
}

async function open(browser, url, ctxOpts, init) {
  const ctx = await browser.newContext(ctxOpts)
  if (init) await ctx.addInitScript(init)
  await ctx.route(new URL(url).origin + '/**', (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (path === '/api/auth' && req.method() === 'GET') return route.fulfill({ json: { authenticated: true } })
    if (path === '/api/system/update') return route.fulfill({ json: { state: 'idle' } })
    if (path.startsWith('/api/')) return route.continue()
    const f = join(DIST, path === '/' ? 'index.html' : path)
    if (!existsSync(f) || statSync(f).isDirectory()) return route.fulfill({ status: 404 })
    route.fulfill({ body: readFileSync(f), contentType: TYPES[f.split('.').pop()] })
  })
  const page = await ctx.newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('[data-bind=verdict]').textContent !== 'Waiting for data')
  await page.evaluate(() => document.fonts.ready)
  return page
}

async function shots(pi) {
  const b = await chromium.launch({ args: ARGS })
  const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' } // exploded, still
  const raw = (n) => join(tmp, n + '.png')

  let p = await open(b, pi, desk)
  await p.waitForTimeout(6000) // the 3D chunk, the scene and a few live frames
  console.log('verdict:', await p.evaluate(() => [document.querySelector('[data-bind=verdict]').textContent, ...[...document.querySelectorAll('[data-bind=checks] li')].map((l) => l.innerText)].join(' | ')))
  await p.screenshot({ path: raw('hero') })
  frame(raw('hero'), out('hero.webp'), 1600, 1000, 920)
  // the sticky header and nav would cover a card's top, and the fixed skip link and toasts show up in a capture taller
  // than the viewport
  const bare = '.top, .fingers, .skip, .toasts { visibility: hidden !important }'
  await p.addStyleTag({ content: bare })
  // the card down to its 16th row, cut on the row's bottom edge (the table goes on for 140-odd units)
  const clip = await p.evaluate(() => {
    const card = document.querySelector('#services').getBoundingClientRect()
    const row = document.querySelectorAll('#services tbody tr')[15].getBoundingClientRect()
    return { x: card.x + scrollX, y: card.y + scrollY, width: card.width, height: row.bottom - card.top + 2 }
  })
  await p.screenshot({ path: raw('services'), clip, fullPage: true })
  frame(raw('services'), out('services.webp'), 900, 1135, 389) // 1135: the README pairs it with system.webp by height
  await p.context().close()

  p = await open(b, pi, { ...desk, viewport: { width: 1245, height: 900 } }) // the curve editor at the old shot's shape
  await p.waitForTimeout(3000)
  await p.addStyleTag({ content: bare })
  await p.locator('#fan').screenshot({ path: raw('fan') })
  frame(raw('fan'), out('fan-curve.webp'), 1600, null, 797)
  await p.context().close()

  p = await open(b, pi, desk, () => localStorage.setItem('pidash.lowpower', '1'))
  await p.waitForTimeout(4000)
  await p.screenshot({ path: raw('low') })
  frame(raw('low'), out('low-power.webp'), 1600, 1000, 797)
  await p.context().close()

  p = await open(b, pi, { viewport: { width: 390, height: 946 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  await p.waitForTimeout(6000)
  await p.addStyleTag({ content: '.skip, .toasts { visibility: hidden !important }' })
  // down to the third row of reading tiles, cut below a whole row (the NVMe tile sits alone in a fourth). The shot is
  // then about as tall as the Features list it floats beside in the README
  const bottom = await p.evaluate(() => {
    const rows = [...new Set([...document.querySelectorAll('.callout')].map((c) => Math.ceil(c.getBoundingClientRect().bottom + scrollY)))]
    return rows.sort((a, b) => a - b)[2] + 4 // mid-way into the 8 px grid gap
  })
  await p.screenshot({ path: raw('phone'), clip: { x: 0, y: 0, width: 390, height: bottom }, fullPage: true })
  frame(raw('phone'), out('phone.webp'), 600, null, 240)
  await b.close()
}

// the plan's storyboard: the board sways, a drag turns it, hovering the SoC callout lights its part, a click on a fan
// profile changes the pads. The demo is signed in with its public token ("demo"), so no Pi changes profile.
async function tour() {
  const FPS = 12, SECONDS = 10
  const b = await chromium.launch({ args: ARGS })
  const p = await open(b, 'http://pidash.local/?demo&healthy', { viewport: { width: 1440, height: 900 } }, () => {
    localStorage.setItem('pidash.token', 'demo') // traded for a session on load (net.js checkAuth)
    addEventListener('DOMContentLoaded', () => {
      // headless Chromium draws no pointer; this one follows the mouse and never takes a click
      const c = document.createElement('div')
      c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-99px,0)'
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 20 20"><path d="M2 1v16l4.4-4.1 3 6.2 2.7-1.3-3-6.1H15z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>'
      document.body.append(c)
      addEventListener('pointermove', (e) => { c.style.transform = `translate(${e.clientX - 2}px,${e.clientY - 1}px)` }, true)
    })
  })
  await p.waitForTimeout(7000) // scene built and exploded
  const box = async (sel) => { const r = await p.locator(sel).first().boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2] }
  const [vx, vy] = await box('[data-bind=view]')
  const pad = await box('[data-bind=pads] button[aria-pressed=false]')
  const view = await p.locator('[data-bind=view]').boundingBox()
  let at = [vx, view.y + view.height - 30] // under the stack: lights nothing while the board sways
  const glide = async ([x, y], ms) => { // eased, and as long as ms whatever a mouse move costs
    const [x0, y0] = at, start = Date.now()
    for (let k = 0; k < 1; ) {
      k = Math.min(1, (Date.now() - start) / ms)
      const e = k < 0.5 ? 2 * k * k : 1 - (2 - 2 * k) ** 2 / 2
      await p.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e)
      await p.waitForTimeout(8)
    }
    at = [x, y]
  }
  await p.mouse.move(...at)
  await p.waitForTimeout(300)
  console.log('lit at the start:', await p.evaluate(() => [...document.querySelectorAll('.callout.lit, section[data-lit]')].map((e) => e.dataset.part || e.id).join(', ') || 'nothing'))
  const cdp = await p.context().newCDPSession(p)
  const shots = []
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    shots.push({ t: metadata.timestamp, data })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  await p.waitForTimeout(500)
  const t0 = Date.now() / 1000
  const until = (s) => p.waitForTimeout(Math.max(0, t0 * 1000 + s * 1000 - Date.now()))
  const mark = (what) => console.log(`${(Date.now() / 1000 - t0).toFixed(2)} s ${what}`)
  await until(2) // 0-2 s: the board sways
  await glide([vx, vy], 300)
  await p.mouse.down()
  mark('drag')
  await glide([vx + 130, vy + 10], 1100) // about 45 degrees
  await p.mouse.up()
  await until(4) // 2-4 s: a drag turns it
  await glide(await box('.callout[data-part=soc] a'), 500) // measured now: the turn re-sorts the callouts
  mark('on the SoC callout')
  await until(6) // 4-6 s: the SoC callout and its part light
  await glide(pad, 500)
  await p.mouse.down()
  await p.waitForTimeout(90)
  await p.mouse.up()
  mark('clicked a profile')
  await until(SECONDS + 0.2) // 6-10 s: the pads and the fan card follow
  await cdp.send('Page.stopScreencast')
  console.log('pressed after the click:', await p.locator('[data-bind=pads] button[aria-pressed=true] .pad-name').innerText())
  console.log(`painted frames from ${(shots[0].t - t0).toFixed(2)} to ${(shots.at(-1).t - t0).toFixed(2)} s`)
  await b.close()

  // one frame every 1/FPS s: the latest the page painted by then
  for (let i = 0, j = 0; i < FPS * SECONDS; i++) {
    while (j + 1 < shots.length && shots[j + 1].t <= t0 + i / FPS) j++
    const n = String(i).padStart(3, '0')
    writeFileSync(join(tmp, `s${n}.png`), Buffer.from(shots[j].data, 'base64'))
    frame(join(tmp, `s${n}.png`), join(tmp, `f${n}.png`), 800, 500, 797)
  }
  console.log(`${shots.length} painted frames in ${SECONDS} s`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(tmp, 'f%03d.png'), '-c:v', 'libwebp_anim',
    '-pix_fmt', 'yuva420p', '-q:v', '70', '-compression_level', '6', '-loop', '0', out('tour.webp')])
}

if (process.argv[2] === 'tour') await tour()
else if (process.argv[2] === 'shots') await shots(process.argv[3] || 'http://raspberrypi:8787')
else throw new Error('usage: readme.mjs shots [pi] | tour')
rmSync(tmp, { recursive: true })
for (const f of ['hero', 'phone', 'low-power', 'services', 'fan-curve', 'tour']) {
  const s = existsSync(out(f + '.webp')) && statSync(out(f + '.webp'))
  if (s) console.log(f, Math.round(s.size / 1024), 'KB', execFileSync('magick', ['identify', '-format', '%wx%h ', out(f + '.webp') + '[0]']).toString())
}
