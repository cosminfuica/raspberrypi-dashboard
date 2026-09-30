// The hero: the verdict carried on the board (a part named by a reason gets an LED on its callout and leader pad),
// verdict-first focus order, callouts in their drawn order, the grid-area layout, Health First, and the update log's
// empty state. Serves a production build itself, with the in-browser demo (?demo, &healthy, &hot).
//   npm run build, then: DIST=frontend/dist [OUT=<shots dir>] [AXE=<path to axe.min.js>] node frontend/scripts/herocheck.mjs
// Needs Playwright where node resolves it (npm i --no-save playwright), as navcheck.mjs does.
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
}).listen(5402, '127.0.0.1')
const BASE = 'http://127.0.0.1:5402/'
let axeSrc = null
if (process.env.AXE) axeSrc = fs.readFileSync(process.env.AXE, 'utf8')
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
const b = await chromium.launch({ args: GL })
let fails = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) fails++ }

async function page(w, h, q, extra = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', ...(w < 700 ? { isMobile: true, hasTouch: true } : {}), ...extra })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  await p.goto(BASE + '?' + q)
  await p.waitForFunction(() => document.querySelector('[data-bind=verdict]')?.textContent !== 'Waiting for data')
  await p.waitForTimeout(3200)
  return { p, ctx, errs }
}

for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024], [375, 812]]) {
  const { p, ctx, errs } = await page(w, h, 'demo')
  const r = await p.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const box = (s) => { const e = q(s).getBoundingClientRect(); return { top: Math.round(e.top), bottom: Math.round(e.bottom), left: Math.round(e.left), right: Math.round(e.right) } }
    const pm = q('.callout[data-part=pmic]')
    const led = pm.querySelector('.callout-led')
    const toned = [...document.querySelectorAll('.callout[data-tone]')].map((c) => `${c.dataset.part}:${c.dataset.tone}`)
    const lastReason = [...document.querySelectorAll('.checks li')].at(-1).getBoundingClientRect().bottom
    return {
      toned,
      ledShown: getComputedStyle(led).display !== 'none',
      ledColor: getComputedStyle(led).backgroundImage,
      why: pm.querySelector('.callout-why').textContent,
      name: pm.querySelector('a').innerText.replace(/\s+/g, ' '),
      padTone: document.querySelector('.leaders [data-tone] circle') ? getComputedStyle(document.querySelector('.leaders [data-tone] circle')).fill : null,
      padR: document.querySelector('.leaders [data-tone] circle')?.getAttribute('r'),
      verdict: box('.verdict'), stage: box('.stage'), fan: box('.fanctl'),
      lastReason: Math.round(lastReason),
      overflow: document.documentElement.scrollWidth > innerWidth,
      calloutOrder: [...q('[data-bind=callouts]').children].map((c) => c.dataset.part).join(','),
      calloutY: [...q('[data-bind=callouts]').children].map((c) => Math.round(c.getBoundingClientRect().top)).join(','),
      verdictBorder: getComputedStyle(q('.verdict')).borderTopColor,
    }
  })
  console.log(`\n== ${w}x${h}`, JSON.stringify(r))
  ok(r.toned.includes('pmic:warn') && r.toned.length === 1, `${w}: only the PMIC callout carries a tone (${r.toned})`)
  ok(r.ledShown && /255, 185, 62/.test(r.ledColor || ''), `${w}: PMIC LED shown in LED amber`)
  ok(/Under-voltage/.test(r.why), `${w}: the callout names its reason for assistive tech`)
  ok(r.lastReason <= h, `${w}: Health First, last reason at ${r.lastReason} <= ${h}`)
  ok(!r.overflow, `${w}: no horizontal overflow`)
  ok(errs.length === 0, `${w}: no page errors ${errs.join(' | ')}`)
  if (w >= 1101) {
    ok(r.verdict.left > r.stage.right && r.fan.top > r.verdict.bottom, `${w}: verdict right of the stage, fan under it`)
    ok(/led-warn/.test(r.padTone || '') && r.padR === '5', `${w}: leader pad is the amber LED lens (${r.padTone}, r=${r.padR})`)
  } else {
    ok(r.verdict.bottom <= r.stage.top && r.stage.bottom <= r.fan.top, `${w}: verdict, then stage, then fan`)
  }
  if (w >= 701) {
    const ys = r.calloutY.split(',').map(Number)
    const order = r.calloutOrder.split(',')
    // left column (fan, soc, wifi, pmic) first, top to bottom, then the right column
    const left = order.slice(0, 4)
    ok(['fan', 'soc', 'wifi', 'pmic'].every((x) => left.includes(x)) && ys.slice(0, 4).every((y, i, a) => i === 0 || y > a[i - 1]) && ys.slice(4).every((y, i, a) => i === 0 || y > a[i - 1]), `${w}: callouts in drawn order (${r.calloutOrder})`)
  }
  // focus order: after the nav strip, the verdict reasons come before any callout
  await p.keyboard.press('Tab') // skip link
  const seq = []
  for (let i = 0; i < 26; i++) {
    await p.keyboard.press('Tab')
    seq.push(await p.evaluate(() => { const e = document.activeElement; return e.closest('.verdict') ? 'V' : e.closest('.callouts') ? 'C' : e.closest('.fanctl') ? 'F' : e.closest('.fingers') ? 'n' : e.closest('header') ? 'h' : '?' }))
  }
  const s = seq.join('')
  ok(/^[hn]*V+C+F/.test(s), `${w}: Tab order header/nav, verdict, callouts, fan (${s})`)
  // a reason lights its part: hover the under-voltage row
  if (w >= 701) {
    await p.hover('.check[data-part=pmic]')
    await p.waitForTimeout(150)
    const lit = await p.evaluate(() => ({ callout: document.querySelector('.callout[data-part=pmic]').classList.contains('lit'), section: document.getElementById('power').hasAttribute('data-lit'), row: document.querySelector('.check[data-part=pmic]').hasAttribute('data-lit') }))
    ok(lit.callout && lit.section && lit.row, `${w}: hovering the reason lights the PMIC callout, Power and the row (${JSON.stringify(lit)})`)
    await p.hover('.callout[data-part=soc] a')
    await p.waitForTimeout(150)
    const lit2 = await p.evaluate(() => [...document.querySelectorAll('.check[data-lit]')].length)
    ok(lit2 === 0, `${w}: a part without a reason lights no row`)
    await p.hover('.callout[data-part=pmic] a')
    await p.waitForTimeout(150)
    ok(await p.evaluate(() => document.querySelector('.check[data-part=pmic]').hasAttribute('data-lit')), `${w}: hovering the PMIC callout underlines its reason`)
    await p.mouse.move(2, h - 2)
  }
  if (out) {
    await p.screenshot({ path: `${out}/demo-${w}-first.png` })
    await p.screenshot({ path: `${out}/demo-${w}-full.png`, fullPage: true })
  }
  if (axeSrc && (w === 1440 || w === 375)) {
    await p.addScriptTag({ content: axeSrc })
    const v = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })).violations.map((x) => `${x.id}(${x.nodes.length})`))
    ok(v.length === 0, `${w}: axe 0 violations ${v.join(' ')}`)
  }
  await ctx.close()
}

// healthy: no callout carries a tone, nothing lit; hot: several parts
for (const q of ['demo&healthy', 'demo&hot']) {
  const { p, ctx } = await page(1440, 900, q)
  if (q === 'demo&hot') await p.waitForTimeout(9000)
  const t = await p.evaluate(() => ({ toned: [...document.querySelectorAll('.callout[data-tone]')].map((c) => `${c.dataset.part}:${c.dataset.tone}`), pads: document.querySelectorAll('.leaders [data-tone]').length, verdict: document.querySelector('[data-bind=verdict]').textContent, rows: [...document.querySelectorAll('.check')].map((c) => `${c.dataset.part || '-'}:${c.dataset.tone}`) }))
  console.log(`\n== ${q}`, JSON.stringify(t))
  if (q === 'demo&healthy') ok(t.toned.length === 0 && t.pads === 0, `healthy: no callout or pad carries a tone`)
  else ok(t.toned.some((x) => x.startsWith('soc:')), `hot: the SoC callout carries its reason (${t.toned})`)
  if (out) await p.screenshot({ path: `${out}/${q.replace('&', '-')}-1440-first.png` })
  await ctx.close()
}

// forced colors (Windows High Contrast): the board's LEDs keep their colours
{
  const { p, ctx } = await page(1440, 900, 'demo', { forcedColors: 'active' })
  const f = await p.evaluate(() => ({ pad: getComputedStyle(document.querySelector('.leaders [data-tone] circle')).fill, led: getComputedStyle(document.querySelector('.callout[data-tone] .callout-led')).backgroundImage, stop: getComputedStyle(document.querySelector('#led-warn stop:nth-child(2)')).stopColor }))
  ok(/led-warn/.test(f.pad) && /255, 185, 62/.test(f.led) && /255, 185, 62/.test(f.stop), `forced colors: pad lens and callout LED keep LED amber (${f.stop})`)
  await ctx.close()
}

// the update log's empty state sits in its middle (signed out)
{
  const { p, ctx } = await page(1440, 900, 'demo')
  const e = await p.evaluate(() => {
    const log = document.querySelector('#system .log')
    const r = log.getBoundingClientRect()
    return { empty: log.dataset.empty, display: getComputedStyle(log).display, h: Math.round(r.height), textAlign: getComputedStyle(log).textAlign }
  })
  ok(e.display === 'grid' && e.textAlign === 'center', `update log empty state centred (${JSON.stringify(e)})`)
  if (out) {
    await p.locator('#system').scrollIntoViewIfNeeded()
    await p.waitForTimeout(300)
    await p.screenshot({ path: `${out}/end-1440.png` })
  }
  await ctx.close()
}

await b.close()
srv.close()
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS')
process.exitCode = fails ? 1 : 0
