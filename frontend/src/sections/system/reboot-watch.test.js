// Checks reboot-watch.js, the wait for the Pi to come back after a reboot. Run with `node src/sections/system/reboot-watch.test.js`.
// A fake api, a fake clock and a fake scheduler: no real timers, no sleeps.
import assert from 'node:assert/strict'
import { watchReboot } from './reboot-watch.js'

const BOOT = 1761200000 // GET /api/info boot_time before the reboot

// Every resolved promise settles before the next macrotask, so this lets one check() run to its end.
const settle = () => new Promise((r) => setImmediate(r))

function rig(answers) {
  const t = { now: 0, timers: [], calls: [], phases: [], backs: [], timeouts: [] }
  let id = 0
  t.api = async (path, opts) => {
    t.calls.push([path, opts])
    const a = answers.shift()
    if (a instanceof Error) throw a
    return a
  }
  t.start = async () => {
    t.stop = watchReboot({
      api: t.api,
      now: () => t.now,
      schedule: (fn, ms) => (t.timers.push({ id: ++id, fn, ms }), id),
      cancel: (i) => (t.timers = t.timers.filter((x) => x.id !== i)),
      boot: BOOT,
      onPhase: (p) => t.phases.push(p),
      onBack: (p) => t.backs.push(p),
      onTimeout: (p) => t.timeouts.push(p),
    })
    await settle()
  }
  // advance the clock by the scheduled delay and run the one pending check
  t.tick = async () => {
    assert.equal(t.timers.length, 1, 'exactly one check is scheduled')
    const { fn, ms } = t.timers.shift()
    t.now += ms
    fn()
    await settle()
  }
  return t
}

const down = () => new Error('502')
const up = (boot_time) => ({ boot_time })

// back after the Pi was gone (same boot_time is fine once it was seen gone)
{
  const t = rig([up(BOOT), down(), down(), up(BOOT)])
  await t.start()
  assert.deepEqual(t.calls[0], ['/api/info', { timeout: 3000 }])
  assert.deepEqual(t.phases, [{ s: 0, gone: false }])
  assert.equal(t.timers[0].ms, 1000, '1000 ms before the Pi is gone')
  await t.tick()
  assert.deepEqual(t.phases.at(-1), { s: 1, gone: true })
  assert.equal(t.timers[0].ms, 2000, '2000 ms once it is gone')
  await t.tick()
  assert.deepEqual(t.phases.at(-1), { s: 3, gone: true })
  await t.tick()
  assert.deepEqual(t.backs, [{ s: 5 }])
  assert.equal(t.phases.length, 3, 'no phase on the pass that sees it back')
  assert.deepEqual(t.timeouts, [])
  assert.equal(t.timers.length, 0, 'nothing scheduled after it is back')
}

// back on a new boot_time without ever being seen gone
{
  const t = rig([up(BOOT), up(BOOT + 40)])
  await t.start()
  await t.tick()
  assert.deepEqual(t.backs, [{ s: 1 }])
  assert.equal(t.phases.length, 1)
  assert.equal(t.timers.length, 0)
}

// s is fractional, exactly (now - t0) / 1000
{
  const t = rig([up(BOOT), up(BOOT)])
  t.now = 5000
  await t.start()
  t.now += 250
  await t.tick()
  assert.deepEqual(t.phases.at(-1), { s: 1.25, gone: false })
}

// never gone: onTimeout once past 90 s, not at exactly 90.0 s, nothing scheduled after
{
  const t = rig(Array.from({ length: 100 }, () => up(BOOT)))
  await t.start()
  while (t.now < 89000) await t.tick()
  assert.equal(t.now, 89000)
  await t.tick() // 90.0 s exactly: still waiting
  assert.equal(t.now, 90000)
  assert.deepEqual(t.phases.at(-1), { s: 90, gone: false })
  assert.deepEqual(t.timeouts, [])
  await t.tick() // 91 s
  assert.deepEqual(t.timeouts, [{ s: 91 }])
  assert.deepEqual(t.backs, [])
  assert.equal(t.timers.length, 0, 'nothing scheduled after the timeout')
}

// gone means no timeout, however long it takes (the 240 s text is the caller's)
{
  const t = rig([down(), ...Array.from({ length: 200 }, () => down())])
  await t.start()
  while (t.now < 300000) await t.tick()
  assert.deepEqual(t.timeouts, [])
  assert.deepEqual(t.phases.at(-1), { s: 300, gone: true })
  assert.equal(t.timers[0].ms, 2000)
}

// stop() cancels the scheduled check
{
  const t = rig([up(BOOT)])
  await t.start()
  assert.equal(t.timers.length, 1)
  t.stop()
  assert.equal(t.timers.length, 0)
}

// stop() during a check in flight: no callback, nothing scheduled
{
  let answer
  const t = rig([])
  t.api = () => new Promise((r) => (answer = r))
  await t.start()
  t.stop()
  answer(up(BOOT + 1))
  await settle()
  assert.deepEqual([t.phases, t.backs, t.timeouts, t.timers], [[], [], [], []])
}

console.log('reboot watch: all checks passed')
