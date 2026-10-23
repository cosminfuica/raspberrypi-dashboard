// Checks update-job.js, the System update job follower, with a fake api and a fake scheduler: no network, no real timers.
// Contract: backend/tests/API.md "GET /api/system/update?offset=N" and "POST /api/system/update" (409 update_running).
import assert from 'node:assert/strict'
import { aptProgress } from './apt.js'
import { createUpdateJob } from './update-job.js'

const GET = (offset) => `/api/system/update?offset=${offset}`
const err = (status, code) => Object.assign(new Error(code), { status, code })
const job = (over = {}) => ({
  id: 'run-a',
  state: 'running',
  exit_code: null,
  started_at: 1790546352,
  ended_at: null,
  reboot_required: false,
  log: '',
  offset: 0,
  ...over,
})
const done = (over = {}) => job({ state: 'succeeded', exit_code: 0, ended_at: 1790546413, ...over })

// Answers each call with the next scripted reply: a value resolves, an `err()` rejects, `later()` stays pending
function fakeApi(replies) {
  const calls = []
  const fn = (path, opts) => {
    calls.push({ path, opts })
    if (!replies.length) throw new Error(`unscripted call ${path}`)
    const r = replies.shift()
    if (r?.pending) return r.promise
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r)
  }
  fn.calls = calls
  fn.paths = () => calls.map((c) => c.path)
  return fn
}
function later() {
  let resolve, reject
  const promise = new Promise((y, n) => ((resolve = y), (reject = n)))
  return { pending: true, promise, resolve, reject }
}

// Records every timer; run() fires the one still pending, as the browser would
function fakeScheduler() {
  const timers = []
  let n = 0
  return {
    timers,
    schedule: (fn, ms) => (timers.push({ fn, ms, id: ++n, cancelled: false }), n),
    cancel: (id) => timers.forEach((t) => t.id === id && (t.cancelled = true)),
    pending: () => timers.filter((t) => !t.cancelled && !t.ran),
    async run() {
      const live = timers.filter((t) => !t.cancelled && !t.ran)
      assert.equal(live.length, 1, `expected one pending timer, got ${live.length}`)
      live[0].ran = true
      await live[0].fn()
    },
  }
}

function setup(replies) {
  const api = fakeApi(replies)
  const sched = fakeScheduler()
  const events = []
  const j = createUpdateJob({ api, schedule: sched.schedule, cancel: sched.cancel, emit: (e) => events.push(e) })
  return { api, sched, events, j, types: () => events.map((e) => e.type) }
}
const flush = () => new Promise((r) => setImmediate(r))

// 1 s cadence while running; GETs carry the last offset and a 10 s timeout
{
  const t = setup([job({ log: 'Hit:1 x\n', offset: 8 }), job({ offset: 8 }), done({ offset: 8 })])
  await t.j.poll()
  assert.deepEqual(t.api.calls[0], { path: GET(0), opts: { timeout: 10000 } })
  assert.deepEqual(
    t.sched.pending().map((x) => x.ms),
    [1000],
  )
  await t.sched.run()
  assert.equal(t.api.calls[1].path, GET(8))
  assert.deepEqual(
    t.sched.pending().map((x) => x.ms),
    [1000],
  )
  await t.sched.run()
  assert.equal(t.sched.pending().length, 0, 'no poll once the job is not running')
}

// backoff while running and failing: 1, 2, 4, 8, 10, 10 s; a success goes back to 1 s and clears `lost`
{
  const t = setup([job(), ...Array.from({ length: 6 }, () => err(0, 'network')), job(), err(502, 'http_502')])
  await t.j.poll()
  await t.sched.run() // the 1 s poll, then six failures
  const delays = [t.sched.pending()[0].ms]
  for (let i = 0; i < 5; i++) {
    await t.sched.run()
    delays.push(t.sched.pending()[0].ms)
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 10000, 10000])
  assert.equal(t.j.state().lost, true)
  await t.sched.run() // the success
  assert.equal(t.j.state().lost, false)
  assert.equal(t.sched.pending()[0].ms, 1000)
  await t.sched.run() // failing again starts over at 1 s
  assert.equal(t.sched.pending()[0].ms, 1000)
}

// a 401 while running schedules nothing: the session is gone, so is the log
{
  const t = setup([job(), err(401, 'unauthorized')])
  await t.j.poll()
  await t.sched.run()
  assert.equal(t.sched.pending().length, 0)
  assert.equal(t.j.state().lost, false)
}

// an error while no job runs schedules nothing (nothing to follow)
{
  const t = setup([err(0, 'network')])
  await t.j.poll()
  const u = setup([done(), err(503, 'http_503')])
  await u.j.poll()
  await u.j.poll()
  assert.equal(t.sched.timers.length + u.sched.timers.length, 0)
  assert.equal(t.j.state().lost || u.j.state().lost, false)
}

// a changed id (another device started a run) emits `reset` and reads the new run from offset 0
{
  const t = setup([
    job({ log: 'old\n', offset: 4 }),
    job({ id: 'run-b', offset: 9 }),
    job({ id: 'run-b', log: 'new\n', offset: 4 }),
  ])
  await t.j.poll()
  await t.sched.run()
  assert.deepEqual(t.api.paths(), [GET(0), GET(4), GET(0)])
  assert.deepEqual(
    t.types().filter((x) => x !== 'changed'),
    ['log', 'reset', 'log'],
  )
  assert.equal(t.events.filter((e) => e.type === 'log').at(-1).text, 'new\n')
  assert.equal(t.j.state().job.id, 'run-b')
}

// `ended` only when this page saw the job running
{
  const t = setup([done(), done()])
  await t.j.poll()
  await t.j.poll()
  assert.ok(!t.types().includes('ended'), 'a job already finished on the first poll is not announced')

  const log = '0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n'
  const u = setup([job(), done({ log, offset: log.length, reboot_required: true }), done({ offset: log.length })])
  await u.j.poll()
  await u.sched.run()
  await u.j.poll()
  const ended = u.events.filter((e) => e.type === 'ended')
  assert.equal(ended.length, 1)
  assert.equal(ended[0].job.state, 'succeeded')
  assert.equal(ended[0].job.reboot_required, true)
  assert.equal(ended[0].progress.total, 0, 'progress includes the log of the last poll')
}

// a log delivered in three pieces reads the same as the whole text fed once (each byte is fed exactly once)
{
  const LOG = `Hit:1 http://deb.debian.org/debian trixie InRelease
Reading package lists...
2 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Get:1 http://deb.debian.org/debian-security trixie-security/main arm64 libssl3t64 arm64 3.5.1-1+deb13u1 [2262 kB]
Unpacking libssl3t64:arm64 (3.5.1-1+deb13u1) over (3.5.1-1) ...
Setting up libssl3t64:arm64 (3.5.1-1+deb13u1) ...
`
  const a = 70
  const b = 190
  const t = setup([
    job({ log: LOG.slice(0, a), offset: a }),
    job({ log: LOG.slice(a, b), offset: b }),
    job({ log: LOG.slice(b), offset: LOG.length }),
  ])
  await t.j.poll()
  await t.sched.run()
  await t.sched.run()
  const whole = aptProgress()
  whole.feed(LOG)
  assert.deepEqual(t.j.state().progress, whole.get())
  assert.equal(t.j.state().progress.label, 'Setting up · 1 of 2 packages')
  assert.equal(
    t.events
      .filter((e) => e.type === 'log')
      .map((e) => e.text)
      .join(''),
    LOG,
  )
  assert.deepEqual(t.api.paths(), [GET(0), GET(a), GET(b)])
}

// a poll answer that arrives after a reset is ignored: stop() while a GET is out
{
  const slow = later()
  const t = setup([slow, job()])
  const p = t.j.poll()
  t.j.stop()
  slow.resolve(job({ log: 'stale\n', offset: 6 }))
  await p
  assert.equal(t.j.state().job, null)
  assert.ok(!t.types().includes('log'))
  assert.equal(t.sched.pending().length, 0)
  await t.j.poll()
  assert.equal(t.api.calls[1].path, GET(0))
}

// ... and start() while an old GET is out: the new run's poll goes out, the old answer never reaches the log
{
  const slow = later()
  const t = setup([slow, { id: 'run-b', state: 'running' }, job({ id: 'run-b', log: 'new\n', offset: 4 })])
  const old = t.j.poll()
  assert.equal(await t.j.start(), 'started')
  slow.resolve(job({ id: 'run-a', log: 'old\n', offset: 4 }))
  await old
  assert.deepEqual(t.api.paths(), [GET(0), '/api/system/update', GET(0)])
  assert.deepEqual(t.api.calls[1].opts, { method: 'POST' })
  assert.deepEqual(
    t.events.filter((e) => e.type === 'log').map((e) => e.text),
    ['new\n'],
  )
  assert.equal(t.j.state().job.id, 'run-b')
  assert.equal(t.sched.pending().length, 1)
}

// ... and an old GET that rejects after start(): no backoff timer, no `lost`, no events from it
{
  const slow = later()
  const t = setup([job(), slow, { id: 'run-b', state: 'running' }, job({ id: 'run-b', offset: 0 })])
  await t.j.poll()
  const old = t.sched.run() // the 1 s poll goes out and hangs
  assert.equal(await t.j.start(), 'started')
  assert.deepEqual(
    t.sched.pending().map((x) => x.ms),
    [1000],
  )
  const seen = t.events.length
  slow.reject(err(0, 'network'))
  await old
  assert.deepEqual(
    t.sched.pending().map((x) => x.ms),
    [1000],
    'the stale rejection schedules nothing',
  )
  assert.equal(t.j.state().lost, false)
  assert.equal(t.events.length, seen, 'the stale rejection emits nothing')
  assert.equal(t.j.state().job.id, 'run-b')
}

// stop() cancels the pending timer, clears the job and emits `reset` (the apt log goes with the session)
{
  const t = setup([job({ log: 'Hit:1 x\n', offset: 8 }), job()])
  await t.j.poll()
  const timer = t.sched.pending()[0]
  t.j.stop()
  assert.equal(timer.cancelled, true)
  assert.equal(t.j.state().job, null)
  assert.equal(t.j.state().lost, false)
  assert.deepEqual(t.j.state().progress, aptProgress().get())
  assert.equal(t.types().at(-1), 'reset')
  await t.j.poll()
  assert.equal(t.api.calls[1].path, GET(0))
}

// stop() while the Pi can't be reached also clears `lost` and the retry
{
  const t = setup([job(), err(0, 'network')])
  await t.j.poll()
  await t.sched.run()
  assert.equal(t.j.state().lost, true)
  t.j.stop()
  assert.equal(t.j.state().lost, false)
  assert.equal(t.sched.pending().length, 0)
}

// poll() while one is in flight makes no second request; poll() cancels a pending timer first
{
  const slow = later()
  const t = setup([job(), slow])
  await t.j.poll()
  const timer = t.sched.pending()[0]
  const p = t.j.poll()
  assert.equal(timer.cancelled, true)
  await t.j.poll()
  assert.equal(t.api.calls.length, 2)
  slow.resolve(done())
  await p
  assert.equal(t.api.calls.length, 2)
}

// start(): a 409 update_running returns 'running-elsewhere' and follows that run; other errors are the caller's
{
  const t = setup([err(409, 'update_running'), job({ log: 'Hit:1 x\n', offset: 8 })])
  assert.equal(await t.j.start(), 'running-elsewhere')
  assert.deepEqual(t.api.paths(), ['/api/system/update', GET(0)])
  await flush()
  assert.equal(t.j.state().job.state, 'running')
  assert.equal(t.sched.pending()[0].ms, 1000)

  const u = setup([err(403, 'csrf_required')])
  await assert.rejects(u.j.start(), (e) => e.code === 'csrf_required')
  assert.equal(u.api.calls.length, 1, 'no poll after a refused start')
}

// start() resets before following the new run: `reset` first, then the GET from offset 0
{
  const t = setup([job({ log: 'a\n', offset: 2 }), done({ offset: 2 }), job({ id: 'run-b' }), job({ id: 'run-b' })])
  await t.j.poll()
  await t.sched.run()
  assert.equal(await t.j.start(), 'started')
  assert.deepEqual(t.api.paths(), [GET(0), GET(2), '/api/system/update', GET(0)])
  assert.equal(
    t
      .types()
      .filter((x) => x !== 'changed')
      .at(-1),
    'reset',
  )
}

// every poll that changes what the card shows tells the caller to render
{
  const t = setup([job(), err(0, 'network')])
  await t.j.poll()
  await t.sched.run()
  assert.deepEqual(t.types(), ['changed', 'changed'])
}

console.log('update job: all checks passed')
