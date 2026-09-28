// Checks the privileged features end to end against a real backend, in headless Chromium: sign in, restart a service
// (ok, failed, session expired), the update and its log, reboot (away and back), and a real shell in the console
// (typing, resize, disconnect, reconnect, exit), on a desktop and a touch phone.
// Needs Playwright (not a dependency) and pidash in mock mode with the console on:
//   npm i --no-save playwright && npx playwright install chromium && npm run build
//   cd ../backend && PIDASH_TOKEN=e2e-token-4fc PIDASH_CONSOLE=1 PIDASH_STATE_DIR=/tmp/pidash-check .venv/bin/pidash --mock --port 18787
//   then: node scripts/actionscheck.mjs [http://127.0.0.1:18787/] [token]
// The console is a real shell on this machine, as you: use a throwaway token, and stop pidash afterwards.
import { chromium } from 'playwright'

const URL = process.argv[2] || 'http://127.0.0.1:18787/'
const TOKEN = process.argv[3] || 'e2e-token-4fc'
const OUT = process.env.OUT // set it to a directory to keep screenshots
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`)
  if (!cond) fails++
}
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
// the browser logs every non-2xx response; GET /api/auth answering 401 while signed out is the contract, not an error
page.on('console', (m) => m.type() === 'error' && !/status of (401|500)/.test(m.text()) && errors.push(m.text()))
await page.goto(URL)
await page.waitForFunction(() => document.querySelector('[data-bind=verdict]')?.textContent !== 'Waiting for data')
await sleep(1500)

const text = (sel) => page.$eval(sel, (e) => e.textContent.trim())
const focused = () => page.evaluate(() => document.activeElement?.dataset.bind || document.activeElement?.dataset.ref || document.activeElement?.className || document.activeElement?.tagName)
const toasts = () => page.$$eval('.toast p', (ps) => ps.map((p) => p.textContent))

// ---- locked state
ok((await text('[data-bind=signin]')) === 'Sign in', 'header shows Sign in while locked')
ok(await page.$eval('[data-bind=lock-state]', (e) => e.hidden), 'no unlocked badge while locked')
ok((await page.$eval('#system [data-ref=upd]', (e) => e.innerHTML)).includes('<svg'), 'Update pad carries a lock icon while locked')
ok((await page.$eval('#system [data-ref=log]', (e) => e.dataset.empty)).startsWith('Sign in'), 'update log says to sign in')

// ---- restart asks to sign in first; wrong token, then right token
await page.evaluate(() => document.querySelector('#services').scrollIntoView())
const svc = 'ssh.service'
await page.fill('#services [data-ref=q]', 'ssh')
await sleep(300)
const rsSel = `#services .rs[data-u="${svc}"]`
ok((await page.$eval(rsSel, (b) => b.getAttribute('aria-label'))) === 'Restart ssh', 'restart button is labelled')
await page.focus(rsSel)
ok((await page.$eval(rsSel, (b) => getComputedStyle(b, '::after').content)).includes('Sign in to restart'), 'tooltip on focus says sign in first')
await page.click(rsSel)
await page.waitForSelector('[data-bind=login][open]')
ok((await focused()) === 'login-token', 'sign-in dialog focuses the token field')
await page.fill('[data-bind=login-token]', 'wrong')
await page.click('[data-bind=login-submit]')
await page.waitForSelector('[data-bind=login-error]:not([hidden])')
ok((await text('[data-bind=login-error]')).includes('isn’t right'), 'wrong token is refused with a message')
await page.fill('[data-bind=login-token]', TOKEN)
await page.click('[data-bind=login-submit]')
// then the confirm dialog opens, with Cancel focused
await page.waitForSelector('[data-bind=confirm][open]')
ok((await text('[data-bind=confirm-h]')) === 'Restart ssh?', 'confirm dialog asks before restarting')
ok((await focused()) === 'confirm-cancel', 'confirm focuses Cancel')
ok((await text('[data-bind=confirm-body]')).includes('SSH'), 'ssh restart warns about SSH sessions')
if (OUT) await page.screenshot({ path: `${OUT}/confirm-restart.png` })
await page.keyboard.press('Escape')
await sleep(300)
ok(!(await page.$('[data-bind=confirm][open]')), 'Escape cancels')
ok((await focused()) === 'rs', 'focus returns to the restart button')
ok((await text('[data-bind=signin]')) === 'Sign out', 'header shows Sign out once signed in')
ok(!(await page.$eval('[data-bind=lock-state]', (e) => e.hidden)), 'unlocked badge shows')

// ---- restart for real: spinner, then toast, then the row is live again
await page.click(rsSel)
await page.waitForSelector('[data-bind=confirm][open]')
await page.click('[data-bind=confirm-ok]')
await page.waitForFunction((s) => document.querySelector(s)?.hasAttribute('data-busy') || document.querySelector('.toast'), rsSel, { timeout: 5000 }).catch(() => {})
const busySeen = await page.$eval(rsSel, (b) => b.hasAttribute('data-busy')).catch(() => false)
await page.waitForFunction(() => [...document.querySelectorAll('.toast p')].some((p) => /restarted|ran and is/.test(p.textContent)), null, { timeout: 30000 })
ok(true, `restart toast: ${(await toasts()).at(-1)} (spinner seen: ${busySeen})`)
await sleep(200) // the row re-renders on the next frame
ok(!(await page.$eval(rsSel, (b) => b.hasAttribute('data-busy'))), 'spinner gone after the restart')
ok((await focused()) === 'rs', 'focus stays on the restart button')

// ---- a refused restart (what the Pi answers when sudo refuses): error toast, row back to normal
await page.route('**/api/services/*/restart', (r) =>
  r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'command_failed', message: 'sudo /usr/bin/systemctl restart --no-block -- ssh.service: sudo: a password is required' }) }),
)
await page.click(rsSel)
await page.waitForSelector('[data-bind=confirm][open]')
await page.click('[data-bind=confirm-ok]')
await page.waitForSelector('.toast[data-tone=bad]', { timeout: 15000 })
ok(true, `a failed restart surfaces as an error toast: ${await page.$eval('.toast[data-tone=bad] p', (p) => p.textContent)}`)
ok((await page.$eval('.toast[data-tone=bad]', (t) => t.getAttribute('role'))) === 'alert', 'error toast is role=alert')
await sleep(200)
ok(!(await page.$eval(rsSel, (b) => b.hasAttribute('data-busy'))), 'spinner gone after the failure')
await page.click('.toast[data-tone=bad] .toast-x')
await page.unroute('**/api/services/*/restart')
// the session expired meanwhile: the next restart asks to sign in again, then goes through
await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Pidash-CSRF': '1' } }))
await page.click(rsSel)
await page.waitForSelector('[data-bind=confirm][open]')
await page.click('[data-bind=confirm-ok]')
await page.waitForSelector('[data-bind=login][open]')
ok((await text('[data-bind=login-error]')).includes('expired'), 'an expired session asks to sign in again')
await page.fill('[data-bind=login-token]', TOKEN)
await page.click('[data-bind=login-submit]')
await page.waitForFunction(() => document.querySelectorAll('.toast[data-tone=ok]').length >= 1 && [...document.querySelectorAll('.toast p')].at(-1).textContent === 'ssh restarted.', null, { timeout: 15000 })
ok(!(await page.$('[data-bind=confirm][open]')), 'the retry after signing in again does not ask twice')

// ---- update: confirm, live log, progress, exit code, reboot-required
await page.evaluate(() => document.querySelector('#system').scrollIntoView())
await page.click('#system [data-ref=upd]')
await page.waitForSelector('[data-bind=confirm][open]')
ok((await text('[data-bind=confirm-h]')) === 'Update the Pi?', 'update asks first')
await page.click('[data-bind=confirm-ok]')
await page.waitForSelector('#system [data-ref=progress]:not([hidden])', { timeout: 10000 })
await sleep(1500)
ok((await page.$eval('#system [data-ref=log]', (e) => e.textContent.length)) > 0, 'log streams in while running')
ok((await page.$eval('#system [data-ref=log]', (e) => getComputedStyle(e).fontFamily)).includes('monospace'), 'log is monospace')
ok((await page.$eval('#system [data-ref=meter]', (e) => +e.getAttribute('aria-valuenow'))) > 0, 'progress bar has a value')
ok((await text('#system [data-ref=phase]')).length > 0, `progress phase: ${await text('#system [data-ref=phase]')}`)
ok(await page.$eval('#system [data-ref=reboot]', (b) => b.getAttribute('aria-disabled') === 'true'), 'reboot is blocked during the update')
if (OUT) await page.screenshot({ path: `${OUT}/update-running.png` })
const stuck = await page.$eval('#system [data-ref=log]', (e) => e.scrollHeight - e.scrollTop - e.clientHeight)
ok(stuck < 30, `log follows the tail (${stuck}px from the bottom)`)
await page.waitForSelector('#system [data-ref=job-state][data-tone=ok]', { timeout: 30000 })
ok((await text('#system [data-ref=job-state]')).includes('exit code 0'), `final state: ${await text('#system [data-ref=job-state]')}`)
ok(!(await page.$eval('#system [data-ref=needs]', (e) => e.hidden)), 'reboot-required notice shows')
ok((await text('#system [data-ref=job-sum]')).length > 0, `summary: ${await text('#system [data-ref=job-sum]')}`)
await sleep(400)
if (OUT) await page.screenshot({ path: `${OUT}/update-done.png` })
if (OUT) await page.locator('#system').screenshot({ path: `${OUT}/system-card.png` })

// ---- one-click reboot from the notice (mock: pretended, clears the flag)
await page.click('#system [data-ref=reboot-now]')
await page.waitForSelector('[data-bind=confirm][open]')
ok((await text('[data-bind=confirm-h]')).startsWith('Reboot '), 'reboot asks first')
await page.click('[data-bind=confirm-ok]')
await page.waitForFunction(() => [...document.querySelectorAll('.toast p')].some((p) => /Mock mode/.test(p.textContent)), null, { timeout: 10000 })
await page.waitForFunction(() => document.querySelector('#system [data-ref=needs]').hidden, null, { timeout: 10000 })
ok(true, 'mock reboot: pretend toast, and the reboot-required notice clears')

// ---- console: connect, type, resize, disconnect, reconnect
await page.evaluate(() => document.querySelector('#console').scrollIntoView())
await page.click('#console [data-ref=connect]')
await page.waitForSelector('#console[data-state=open]', { timeout: 15000 })
ok((await text('#console [data-ref=state]')) === 'Connected', 'console connects')
ok((await page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea'))), 'terminal takes the focus')
await sleep(800)
await page.keyboard.type('echo pidash-e2e-$((6*7)); tput cols; tput lines\n')
await sleep(1200)
const screen = await page.$eval('#console .xterm-rows', (e) => e.innerText)
ok(screen.includes('pidash-e2e-42'), 'a typed command runs on the Pi and its output shows')
const size = await text('#console [data-ref=size]')
const [cols, rows] = size.split(/\s*×\s*/).map(Number)
ok(screen.includes(`\n${cols}\n`) || screen.includes(`${cols}\n${rows}`), `the shell sees the fitted size ${size}`)
if (OUT) await page.screenshot({ path: `${OUT}/console-desktop.png` })
if (OUT) await page.locator('#console').screenshot({ path: `${OUT}/console-card.png` })
// resize: a narrower window refits and the shell sees it
await page.setViewportSize({ width: 1000, height: 900 })
await sleep(900)
const size2 = await text('#console [data-ref=size]')
ok(size2 !== size, `resize refits the terminal: ${size} → ${size2}`)
await page.keyboard.type('tput cols\n')
await sleep(900)
ok((await page.$eval('#console .xterm-rows', (e) => e.innerText)).includes(`\n${size2.split(/\s*×\s*/)[0]}\n`), 'the shell got the resize')
await page.setViewportSize({ width: 1440, height: 900 })
await sleep(600)
// disconnect
await page.click('#console [data-ref=disconnect]')
await sleep(300)
ok((await text('#console [data-ref=state]')) === 'Disconnected', 'Disconnect shows the disconnected state')
ok((await text('#console [data-ref=connect]')) === 'Reconnect', 'cover offers Reconnect')
ok((await focused()) === 'connect', 'focus moves to Reconnect')
if (OUT) await page.screenshot({ path: `${OUT}/console-disconnected.png` })
// reconnect, then exit the shell: 1000 close shows why
await page.click('#console [data-ref=connect]')
await page.waitForSelector('#console[data-state=open]', { timeout: 15000 })
await sleep(600)
await page.keyboard.type('exit 3\n')
await page.waitForSelector('#console[data-state=closed]', { timeout: 10000 })
ok((await text('#console [data-ref=cover-msg]')).includes('status 3'), `shell exit is explained: ${await text('#console [data-ref=cover-msg]')}`)

// ---- sign out closes a console and locks again
await page.click('#console [data-ref=connect]')
await page.waitForSelector('#console[data-state=open]', { timeout: 15000 })
await page.click('[data-bind=signin]')
await page.waitForFunction(() => document.querySelector('[data-bind=signin]').textContent.trim() === 'Sign in')
await sleep(300)
ok((await text('#console [data-ref=cover-msg]')).includes('signed out'), 'signing out closes the console')
ok((await page.evaluate(() => fetch('/api/auth').then((r) => r.status))) === 401, 'the session is gone on the server')

// ---- mobile: console usable, key strip present
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`))
await phone.goto(URL)
await phone.waitForFunction(() => document.querySelector('[data-bind=verdict]')?.textContent !== 'Waiting for data')
await phone.evaluate(() => document.querySelector('#console').scrollIntoView())
await phone.tap('#console [data-ref=connect]')
await phone.waitForSelector('[data-bind=login][open]')
await phone.fill('[data-bind=login-token]', TOKEN)
await phone.tap('[data-bind=login-submit]')
await phone.waitForSelector('#console[data-state=open]', { timeout: 15000 })
ok(!(await phone.$eval('#console [data-ref=keys]', (e) => e.hidden)), 'phone: touch key strip shows')
await sleep(700)
await phone.tap('#console [data-k=ctrl]')
ok((await phone.$eval('#console [data-k=ctrl]', (e) => e.getAttribute('aria-pressed'))) === 'true', 'phone: Ctrl latches')
await phone.tap('#console [data-k=ctrl]')
await phone.keyboard.type('echo phone-$((1+1))\n')
await sleep(1000)
ok((await phone.$eval('#console .xterm-rows', (e) => e.innerText)).includes('phone-2'), 'phone: typing works')
const psize = await phone.$eval('#console [data-ref=size]', (e) => e.textContent)
ok(Number(psize.split(/\s*×\s*/)[0]) >= 30, `phone: terminal fits the screen (${psize})`)
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth)
ok(overflow <= 0, `phone: no sideways page scroll (${overflow}px)`)
if (OUT) await phone.locator('#console').screenshot({ path: `${OUT}/console-phone.png` })
await phone.evaluate(() => document.querySelector('#system').scrollIntoView())
await sleep(300)
if (OUT) await phone.locator('#system').screenshot({ path: `${OUT}/system-phone.png` })
await phone.evaluate(() => document.querySelector('#services').scrollIntoView())
await sleep(300)
if (OUT) await phone.screenshot({ path: `${OUT}/services-phone.png` })
await phone.tap('#console [data-ref=disconnect]').catch(() => {})
await phone.close()

ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
await browser.close()

// ---- reboot on a real Pi: the page waits until it is gone, then back. pidash --mock only pretends to reboot, so the
// hello says mock:false here, and the network plays the Pi going away for 6 s (the live socket drops, /api/info fails)
{
  const b2 = await chromium.launch()
  const p = await b2.newPage({ viewport: { width: 1440, height: 900 } })
  let down = false
  const socks = new Set()
  await p.routeWebSocket('**/api/ws', (ws) => {
    if (down) return ws.close()
    const server = ws.connectToServer()
    server.onMessage((m) => ws.send(typeof m === 'string' ? m.replace('"mock":true', '"mock":false') : m))
    socks.add(ws)
  })
  await p.route('**/api/info', (r) => (down ? r.abort('connectionrefused') : r.continue()))
  await p.goto(URL)
  await p.waitForFunction(() => document.querySelector('[data-bind=verdict]')?.textContent !== 'Waiting for data')
  await p.evaluate(() => document.querySelector('#system').scrollIntoView())
  await p.click('#system [data-ref=reboot]')
  await p.waitForSelector('[data-bind=login][open]')
  await p.fill('[data-bind=login-token]', TOKEN)
  await p.click('[data-bind=login-submit]')
  await p.waitForSelector('[data-bind=confirm][open]')
  await p.click('[data-bind=confirm-ok]')
  await p.waitForSelector('#system [data-ref=rebooting]:not([hidden])', { timeout: 10000 })
  down = true
  for (const ws of socks) ws.close()
  await p.waitForFunction(() => /reconnecting/.test(document.querySelector('#system [data-ref=rebooting-text]').textContent), null, { timeout: 10000 })
  ok(true, `while away: ${await p.$eval('#system [data-ref=rebooting-text]', (e) => e.textContent)}`)
  ok(await p.$eval('#system [data-ref=upd]', (e) => e.getAttribute('aria-disabled') === 'true'), 'while away: update and reboot are blocked')
  if (OUT) await p.screenshot({ path: `${OUT}/rebooting.png` })
  await sleep(6000)
  down = false
  await p.waitForFunction(() => [...document.querySelectorAll('.toast p')].some((e) => / is back, after /.test(e.textContent)), null, { timeout: 20000 })
  ok(true, `back: ${await p.$$eval('.toast p', (ps) => ps.map((e) => e.textContent).find((t) => / is back/.test(t)))}`)
  await p.waitForFunction(() => document.querySelector('.link-state').dataset.state === 'live', null, { timeout: 15000 })
  ok(await p.$eval('#system [data-ref=rebooting]', (e) => e.hidden), 'back: the rebooting notice is gone and the stream is live again')
  await b2.close()
}
console.log(fails ? `${fails} failed` : 'privileged actions: all checks passed')
process.exit(fails ? 1 : 0)
