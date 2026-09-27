// Checks the section nav's highlight (main.js, "section nav"): exactly one tab is lit, and it is the right one.
// At two widths it clicks every tab, presses every number key, then scrolls from top to bottom with the wheel.
// Needs Playwright (not a dependency) and the dev server, which has in-browser demo data:
//   npm i --no-save playwright && npx playwright install chromium
//   npm run dev, then in another shell: node scripts/navcheck.mjs [http://localhost:5173/?demo]
import { chromium } from 'playwright'

const URL = process.argv[2] || 'http://localhost:5173/?demo'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const lit = (page) => page.evaluate(() => [...document.querySelectorAll('.fingers a[aria-current="true"]')].map((a) => a.hash).join(' '))
// the rule the light follows: the section whose top is lowest above a line 40 % down (the first of a row), the last
// section once the page's last line is on screen
const expected = (page) =>
  page.evaluate(() => {
    const h = document.documentElement.clientHeight
    const secs = [...document.querySelectorAll('.fingers a')].map((a) => document.querySelector(a.hash))
    const tops = secs.map((s) => s.getBoundingClientRect().top)
    const top = Math.max(...tops.filter((t) => t <= h * 0.4))
    const end = scrollY > 0 && document.querySelector('.markings .fine').getBoundingClientRect().top < h
    const s = end ? secs.at(-1) : secs.find((s, i) => tops[i] <= h * 0.4 && tops[i] >= top - 1)
    return s ? `#${s.id}` : ''
  })
async function still(page, ms = 0) {
  for (let last = -1, n = 0; n < 2; await sleep(80)) {
    const y = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(scrollY)))))
    n = y === last ? n + 1 : 0
    last = y
  }
  await sleep(ms) // a live tick can land meanwhile: readings changing height must not move the light
}

let fails = 0
const fail = (msg) => {
  fails++
  console.log(`  FAIL ${msg}`)
}
const browser = await chromium.launch()
for (const [w, h] of [[1440, 900], [390, 844]]) {
  console.log(`${w}×${h}`) // two columns with cards side by side; one column
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  page.on('pageerror', (e) => fail(`page error: ${e.message}`))
  await page.goto(URL)
  await page.waitForFunction(() => document.querySelector('[data-bind=verdict]')?.textContent !== 'Waiting for data')
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.fingers a')].map((a) => a.hash))
  for (const hash of tabs) {
    await page.click(`.fingers a[href="${hash}"]`)
    await still(page, 1100)
    const got = await lit(page)
    if (got !== hash) fail(`click ${hash}: lit ${got || 'none'}`)
  }
  for (const hash of [...tabs].reverse()) {
    await page.keyboard.press(String((tabs.indexOf(hash) + 1) % 10))
    await still(page, 1100)
    const got = await lit(page)
    if (got !== hash) fail(`key for ${hash}: lit ${got || 'none'}`)
    const focus = await page.evaluate(() => document.activeElement.id)
    if (focus !== `${hash.slice(1)}-h`) fail(`key for ${hash}: focus on #${focus}, not the section's heading`)
  }
  await page.keyboard.press('Home')
  await page.mouse.move(4, h * 0.6) // in the page margin: the wheel scrolls the page, not the services table
  await still(page)
  for (let i = 0; i < 300; i++) {
    const [got, want] = [await lit(page), await expected(page)]
    const { y, max } = await page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight }))
    if (got !== want) fail(`scrolled to ${Math.round(y)}: lit ${got || 'none'}, want ${want || 'none'}`)
    if (y >= max - 1) break
    await page.mouse.wheel(0, 150)
    await still(page)
  }
  if ((await lit(page)) !== tabs.at(-1)) fail(`bottom of the page: lit ${await lit(page)}, want ${tabs.at(-1)}`)
  await page.close()
}
await browser.close()
console.log(fails ? `${fails} failed` : 'nav highlight: all checks passed')
process.exit(fails ? 1 : 0)
