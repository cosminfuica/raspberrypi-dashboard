// The System card (#system): update the Pi, with its apt log live, and reboot it, then wait until it is back.
// Contract: docs/API.md "System actions". Both need the token and always ask first.
import { Lock, TriangleAlert } from 'lucide'
import { api, auth } from './net.js'
import { aptProgress } from './apt.js'
import { refs, fmt, badge, ico, esc, setText } from './util.js'

const STATE = { running: ['info', 'Running'], succeeded: ['ok', 'Succeeded'], failed: ['bad', 'Failed'] }

export function createSystem({ root, privileged, toast, canChange, info, pretendReboot, onBack }) {
  const R = refs(root)
  R.needs.insertAdjacentHTML('afterbegin', ico(TriangleAlert))
  let job = null // the last GET /api/system/update; its log is in R.log
  let offset = 0
  let apt = aptProgress()
  let timer = 0
  let inflight = false
  let fails = 0
  let follow = false // this page saw the job running, so it says how it ended
  let lost = false // polls fail while it runs
  let busy = null // 'update' | 'reboot' while its POST is out
  let away = null // a reboot in progress: {t0, boot, gone, note}

  const host = () => info()?.hostname ?? 'The Pi'

  function reset() {
    job = null
    offset = 0
    apt = aptProgress()
    R.log.textContent = ''
  }

  function append(text) {
    if (!text) return
    apt.feed(text)
    const log = R.log
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 24 // at the bottom: keep following
    log.append(text)
    if (stick) log.scrollTop = log.scrollHeight
  }

  // ---------------------------------------------------------------- the update job

  async function poll() {
    clearTimeout(timer)
    if (inflight || !auth.signedIn || !canChange().configured) return
    inflight = true
    let st
    try {
      st = await api(`/api/system/update?offset=${offset}`, { timeout: 10000 })
      fails = 0
      lost = false
    } catch (e) {
      if (e.status !== 401 && job?.state === 'running') {
        // pidash restarting, or the network: keep trying, the update runs on without us
        lost = true
        timer = setTimeout(poll, Math.min(10000, 1000 * 2 ** fails++))
      }
      return
    } finally {
      inflight = false
      render()
    }
    if (job && st.id !== job.id) {
      reset() // another run started (from another device): read it from the start
      return poll()
    }
    append(st.log)
    offset = st.offset
    const was = job?.state
    job = st
    if (st.state === 'running') {
      follow = true
      timer = setTimeout(poll, 1000)
    } else if (was === 'running' && follow) ended()
    render()
  }

  function ended() {
    follow = false
    const p = apt.get()
    if (job.state === 'succeeded')
      toast('ok', `Update finished${p.total ? `: ${p.total} package${p.total > 1 ? 's' : ''} upgraded or installed` : p.total === 0 ? ': everything was up to date' : ''}.${job.reboot_required ? ' A reboot is needed to finish it.' : ''}`)
    else toast('bad', `The update failed (${job.exit_code == null ? 'it was cut short' : `exit code ${job.exit_code}`}). ${summary(p)}`)
  }

  function summary(p) {
    if (!job || job.state === 'idle' || job.state === 'running') return ''
    const took = job.ended_at && job.started_at ? `, after ${fmt.dur(job.ended_at - job.started_at, true)}` : ''
    if (job.state === 'succeeded')
      return `Finished ${fmt.date(job.ended_at)}${took}. ${p.total == null ? '' : p.total === 0 ? 'Everything was up to date.' : `${p.total} package${p.total > 1 ? 's' : ''} upgraded or installed.`}`
    if (p.locked) return 'apt was busy with another job (often unattended-upgrades), so nothing changed. Try again in a few minutes.'
    if (job.exit_code == null) return 'It stopped before the end: the Pi restarted or lost power while it ran. Run it again, and check the log.'
    return `apt-get stopped with exit code ${job.exit_code}${took}. The log says why.`
  }

  function startUpdate() {
    return privileged(
      {
        title: 'Update the Pi?',
        body: `${host()} downloads and installs every pending update (apt-get update, then upgrade). It takes a few minutes. The Pi keeps running meanwhile, and services that get a new version restart by themselves.`,
        warn: 'Don’t reboot or unplug the Pi until it has finished.',
        ok: 'Update now',
      },
      async () => {
        busy = 'update'
        render()
        try {
          await api('/api/system/update', { method: 'POST' })
          reset()
          follow = true
          await poll()
        } finally {
          busy = null
          render()
        }
      },
      (e) => {
        if (e.code !== 'update_running') return toast('bad', `Couldn’t start the update: ${e.message}`)
        toast('info', 'An update is running already, started from somewhere else. Its log follows here.')
        follow = true
        poll()
      },
    )
  }

  // ---------------------------------------------------------------- reboot

  function reboot() {
    return privileged(
      {
        title: `Reboot ${host()}?`,
        body: 'It restarts now. For about a minute everything on it stops, this dashboard included: containers, SSH sessions and the console. The page reconnects by itself once it’s back.',
        ok: 'Reboot',
      },
      async () => {
        busy = 'reboot'
        render()
        try {
          await api('/api/system/reboot', { method: 'POST' })
          watch()
        } finally {
          busy = null
          render()
        }
      },
      (e) => (e.code === 'update_running' ? toast('warn', 'An update is running: reboot once it has finished.') : toast('bad', `Couldn’t reboot: ${e.message}`)),
    )
  }

  /** Polls GET /api/info until the Pi has been away and answers again, or answers with a new boot time. */
  function watch() {
    if (pretendReboot()) {
      toast('info', 'Mock mode: the reboot is only pretended, so nothing restarts.')
      return poll()
    }
    away = { t0: Date.now(), boot: info()?.boot_time, gone: false, note: toast('warn', `Rebooting ${host()}…`, { sticky: true, busy: true }) }
    check()
  }

  async function check() {
    if (!away) return
    let back = null
    try {
      back = await api('/api/info', { timeout: 3000 })
    } catch {
      away.gone = true // pidash is down (tailscale serve answers 502), or the whole Pi is
    }
    const s = (Date.now() - away.t0) / 1000
    if (back && (away.gone || back.boot_time !== away.boot)) {
      away.note.close()
      away = null
      toast('ok', `${host()} is back, after ${fmt.dur(s, true)}.`)
      onBack()
      poll()
      return render()
    }
    if (!away.gone && s > 90) {
      away.note.close()
      away = null
      toast('bad', `${host()} didn’t go down, so the reboot probably failed. Check journalctl -u pidash on the Pi.`)
      return render()
    }
    const msg = !away.gone
      ? `Rebooting ${host()}… waiting for it to shut down.`
      : s < 240
        ? `Rebooting… reconnecting. Away for ${fmt.dur(s, true)}; it usually takes about a minute.`
        : `Still away after ${fmt.dur(s)}. Check the Pi’s power and network; this page keeps trying.`
    // the toast is a live region: it changes with the phase only, the card counts the seconds
    away.note.set(!away.gone ? msg : s < 240 ? 'Rebooting… reconnecting.' : `${host()} is still away. Check its power and network; this page keeps trying.`)
    setText(R['rebooting-text'], msg)
    render()
    setTimeout(check, away.gone ? 2000 : 1000)
  }

  // ---------------------------------------------------------------- render

  function pad(b, label, { lock, disabled, busy: isBusy }) {
    const html = `${lock ? ico(Lock) : ''}<span>${esc(label)}</span>`
    if (b._h !== html) b.innerHTML = b._h = html
    // aria-disabled, not disabled: the button that started an action keeps the focus while it runs
    b.setAttribute('aria-disabled', String(disabled))
    b.toggleAttribute('data-busy', !!isBusy)
  }

  function render() {
    const gate = canChange()
    const on = gate.configured
    const running = job?.state === 'running'
    root.toggleAttribute('data-rebooting', !!away)
    R.lock.hidden = on || !!gate.waiting
    if (!R.lock.hidden) R.lock.innerHTML = `${ico(Lock)}<span>${esc(gate.why)}</span>`
    const lock = on && !auth.signedIn
    const blocked = !on || !!away || running || !!busy
    pad(R.upd, running ? 'Updating…' : 'Update…', { lock, disabled: blocked, busy: busy === 'update' || running })
    pad(R.reboot, away ? 'Rebooting…' : 'Reboot…', { lock, disabled: blocked, busy: busy === 'reboot' || !!away })
    R.reboot.title = running ? 'Wait until the update has finished' : ''
    R['reboot-now'].setAttribute('aria-disabled', String(blocked))

    R.rebooting.hidden = !away
    R.needs.hidden = !job?.reboot_required || !!away || running

    const st = job && job.state !== 'idle' ? job.state : null
    R['job-state'].hidden = !st
    if (st) {
      const [tone, label] = STATE[st]
      badge(R['job-state'], tone, job.exit_code == null ? label : `${label} · exit code ${job.exit_code}`)
    }
    R.progress.hidden = !running
    const p = apt.get()
    if (running) {
      const f = Math.max(0.02, p.frac)
      R.bar.style.setProperty('--f', f)
      R.meter.setAttribute('aria-valuenow', Math.round(f * 100))
      setText(R.phase, lost ? 'Can’t reach the Pi. Retrying…' : p.label)
      setText(R.elapsed, fmt.dur(Date.now() / 1000 - job.started_at, true))
    }
    const sum = summary(p)
    R['job-sum'].hidden = !sum
    if (sum) setText(R['job-sum'], sum)
    R.log.dataset.empty = !on
      ? 'Changes are off on this Pi.'
      : !auth.signedIn
        ? 'Sign in to see the update log: it isn’t public.'
        : st
          ? ''
          : 'No update has run since pidash was installed.'
    setText(R.sum, running ? 'Updating now' : job?.ended_at ? `Last updated ${fmt.date(job.ended_at)}` : info()?.os)
  }

  const on = (b, f) => b.addEventListener('click', () => b.getAttribute('aria-disabled') !== 'true' && f())
  on(R.upd, startUpdate)
  on(R.reboot, reboot)
  on(R['reboot-now'], reboot)
  render()

  return {
    setInfo() {
      poll()
      render()
    },
    authChanged() {
      if (auth.signedIn) poll()
      else {
        clearTimeout(timer) // the apt log isn't public: it goes with the session
        reset()
      }
      render()
    },
  }
}
