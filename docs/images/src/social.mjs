// Social preview poster (asset A2 of docs/design-improvement-plan.md). Run from any directory where
// `npm i --no-save playwright@1.63.0` has been done (the repo itself installs no Playwright):
//
//   node <repo>/docs/images/src/social.mjs board [url]   re-capture board.png from a running frontend
//                                                        (default http://127.0.0.1:5199/?demo)
//   node <repo>/docs/images/src/social.mjs               render social.html -> ../social-preview.png + ../poster.webp
//
// Needs frontend/node_modules (npm ci in frontend/) for the Archivo font, and ImageMagick for the WebP.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { rmSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const { chromium } = createRequire(process.cwd() + '/')('playwright')
const here = (f) => fileURLToPath(new URL(f, import.meta.url))
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']

if (process.argv[2] === 'board') {
  // the live 3D board alone on transparency. Reduced motion = fully exploded, no sway: the same pose every time
  const b = await chromium.launch({ args: GL })
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  await p.goto(process.argv[3] || 'http://127.0.0.1:5199/?demo')
  await p.waitForTimeout(6000) // scene built, readings live
  await p.addStyleTag({
    content: `html, body, main, .hero, .stage, .stage::before, .stage::after { background: none !important; border-color: transparent !important; box-shadow: none !important }
      body::before, body::after, .top, .fingers, .hero-side, .callouts, .leaders, .stage-hint, .scale, .grid, .duo, .markings { visibility: hidden !important }`,
  })
  await p.waitForTimeout(400)
  const raw = here('board-raw.png')
  await (await p.$('.stage [data-bind=view]')).screenshot({ path: raw, omitBackground: true })
  await b.close()
  // crop to the alpha bounding box plus 40 px
  execFileSync('magick', [raw, '-trim', '+repage', '-bordercolor', 'none', '-border', '40', '-strip', here('board.png')])
  rmSync(raw)
  console.log('wrote', here('board.png'), execFileSync('magick', ['identify', '-format', '%wx%h', here('board.png')]).toString())
} else {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files'] })
  const p = await b.newPage({ viewport: { width: 1280, height: 640 } })
  await p.goto('file://' + here('social.html'))
  await p.evaluate(() => document.fonts.ready)
  // the plan's pick rule: the wordmark keeps at least 7:1 against the brightest pixel behind it, measured on the
  // rendered card with the text hidden (plate, scrim and board as they really land)
  const box = await p.evaluate(() => {
    const r = document.querySelector('h1').getBoundingClientRect()
    const text = [...document.querySelectorAll('.text > *')].map((e) => e.getBoundingClientRect())
    return {
      clip: { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) },
      inSafe: text.every((t) => t.left >= 40 && t.right <= 1240 && t.top >= 40 && t.bottom <= 600),
    }
  })
  await p.addStyleTag({ content: '.text { visibility: hidden }' })
  const behind = (await p.screenshot({ clip: box.clip })).toString('base64')
  await p.addStyleTag({ content: '.text { visibility: visible }' })
  const contrast = await p.evaluate(async (b64) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const cv = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
    const x = cv.getContext('2d')
    x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, img.width, img.height).data
    const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    const L = (R, G, B) => 0.2126 * lin(R) + 0.7152 * lin(G) + 0.0722 * lin(B)
    let max = 0
    for (let i = 0; i < d.length; i += 4) max = Math.max(max, L(d[i], d[i + 1], d[i + 2]))
    return (L(237, 240, 232) + 0.05) / (max + 0.05)
  }, behind)
  const c = { contrast, inSafe: box.inSafe }
  console.log(`wordmark contrast ${c.contrast.toFixed(1)}:1, text inside the central 1200x560: ${c.inSafe}`)
  const png = here('../social-preview.png')
  await p.screenshot({ path: png })
  await b.close()
  execFileSync('magick', [png, '-quality', '80', '-define', 'webp:method=6', here('../poster.webp')])
  for (const f of [png, here('../poster.webp')]) console.log(`${(statSync(f).size / 1024).toFixed(0)} KB  ${f}`)
  if (c.contrast < 7 || !c.inSafe) process.exit(1)
}
