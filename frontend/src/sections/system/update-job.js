// Follows the System update job and its apt log. Contract: backend/tests/API.md "POST /api/system/update" and
// "GET /api/system/update?offset=N": poll about once a second with the last offset, stop when it isn't running, and
// start again from offset 0 when the id changes. The api and the timers are injected, so update-job.test.js runs it
// under plain node. It shows nothing itself: the System card renders from `emit` and `state()`.
import { aptProgress } from './apt.js'

/**
 * emit receives {type: 'log', text} (append it), {type: 'reset'} (clear the log), {type: 'ended', job, progress}
 * (a run this page saw running has finished) and {type: 'changed'} (render).
 */
export function createUpdateJob({ api, schedule = setTimeout, cancel = clearTimeout, emit }) {
  let job = null // the last GET answer
  let offset = 0
  let apt = aptProgress()
  let timer = 0
  let inflight = false
  let fails = 0
  let lost = false // polls fail while it runs
  let gen = 0 // bumped by reset(): an answer to an older request is dropped

  function reset() {
    cancel(timer)
    gen++
    job = null
    offset = 0
    apt = aptProgress()
    inflight = false
    fails = 0
    lost = false
  }

  async function poll() {
    cancel(timer)
    if (inflight) return
    inflight = true
    const g = gen
    let st
    try {
      st = await api(`/api/system/update?offset=${offset}`, { timeout: 10000 })
    } catch (e) {
      if (g !== gen) return
      inflight = false
      if (e.status !== 401 && job?.state === 'running') {
        // pidash restarting, or the network: keep trying, the update runs on without us
        lost = true
        timer = schedule(poll, Math.min(10000, 1000 * 2 ** fails++))
      }
      emit({ type: 'changed' })
      return
    }
    if (g !== gen) return
    inflight = false
    fails = 0
    lost = false
    if (job && st.id !== job.id) {
      reset() // another run started (from another device): read it from the start
      emit({ type: 'reset' })
      return poll()
    }
    if (st.log) {
      apt.feed(st.log)
      emit({ type: 'log', text: st.log })
    }
    offset = st.offset
    const was = job?.state
    job = st
    if (st.state === 'running') timer = schedule(poll, 1000)
    else if (was === 'running') emit({ type: 'ended', job, progress: apt.get() })
    emit({ type: 'changed' })
  }

  /** POSTs the update and follows it. 'started', or 'running-elsewhere' on 409 update_running (then it follows that
   *  run); any other ApiError is thrown to the caller. */
  async function start() {
    try {
      await api('/api/system/update', { method: 'POST' })
    } catch (e) {
      if (e.code !== 'update_running') throw e
      poll()
      return 'running-elsewhere'
    }
    reset()
    emit({ type: 'reset' })
    await poll()
    return 'started'
  }

  return {
    start,
    poll,
    /** Forgets the job and its log, e.g. on sign-out: the apt log isn't public, it goes with the session. */
    stop() {
      reset()
      emit({ type: 'reset' })
    },
    state: () => ({ job, lost, progress: apt.get() }),
  }
}
