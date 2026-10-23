// The System card (#system): update the Pi, with its apt log live; reboot it, then wait until it is back; shut it down.
// Contract: docs/API.md "System actions". All need the token and always ask first.
import { Lock, TriangleAlert, Download, RotateCw, Power } from 'lucide'
import { api, auth } from '../../link/net.js'
import { createUpdateJob } from './update-job.js'
import { watchReboot } from './reboot-watch.js'
import { refs, fmt, badge, ico, esc, setText } from '../../ui/util.js'

const STATE = { running: ['info', 'Running'], succeeded: ['ok', 'Succeeded'], failed: ['bad', 'Failed'] }

export function createSystem({ root, privileged, toast, canChange, info, pretendReboot, onBack }) {
  const R = refs(root)
  R.needs.insertAdjacentHTML('afterbegin', ico(TriangleAlert))
  let busy = null // 'update' | 'reboot' | 'shutdown' while its POST is out
  let away = null // a reboot in progress: {note}, the sticky toast
  let off = false // shut down: nothing to wait for, it stays off

  const host = () => info()?.hostname ?? 'The Pi'

  function append(text) {
    const log = R.log
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 24 // at the bottom: keep following
    log.append(text)
    if (stick) log.scrollTop = log.scrollHeight
  }

  // ---------------------------------------------------------------- the update job

  const updateJob = createUpdateJob({
    api,
    emit: (e) => {
      if (e.type === 'log') append(e.text)
      else if (e.type === 'reset') R.log.textContent = ''
      else if (e.type === 'ended') ended(e.job, e.progress)
      else if (e.type === 'changed') render()
    },
  })

  // the apt log isn't public and needs changes on: every poll this card asks for passes the gate first
  function poll() {
    if (!auth.signedIn || !canChange().configured) return
    updateJob.poll()
  }

  function ended(job, p) {
    if (job.state === 'succeeded')
      toast(
        'ok',
        `Update finished${p.total ? `: ${p.total} package${p.total > 1 ? 's' : ''} upgraded or installed` : p.total === 0 ? ': everything was up to date' : ''}.${job.reboot_required ? ' A reboot is needed to finish it.' : ''}`,
      )
    else
      toast(
        'bad',
        `The update failed (${job.exit_code == null ? 'it was cut short' : `exit code ${job.exit_code}`}). ${summary(job, p)}`,
      )
  }

  function summary(job, p) {
    if (!job || job.state === 'idle' || job.state === 'running') return ''
    const took = job.ended_at && job.started_at ? `, after ${fmt.dur(job.ended_at - job.started_at, true)}` : ''
    if (job.state === 'succeeded')
      return `Finished ${fmt.date(job.ended_at)}${took}. ${p.total == null ? '' : p.total === 0 ? 'Everything was up to date.' : `${p.total} package${p.total > 1 ? 's' : ''} upgraded or installed.`}`
    if (p.locked)
      return 'apt was busy with another job (often unattended-upgrades), so nothing changed. Try again in a few minutes.'
    if (job.exit_code == null)
      return 'It stopped before the end: the Pi restarted or lost power while it ran. Run it again, and check the log.'
    return `apt-get stopped with exit code ${job.exit_code}${took}. The log says why.`
  }

  function startUpdate() {
    return privileged(
      {
        title: 'Update the Pi?',
        body: `${host()} downloads and installs every pending update (apt-get update, then upgrade). It takes a few minutes. The Pi keeps running meanwhile, and services that get a new version restart by themselves.`,
        warn: 'Once it starts it can’t be stopped from here. Don’t reboot or unplug the Pi until it has finished.',
        ok: 'Update now',
      },
      async () => {
        busy = 'update'
        render()
        try {
          if ((await updateJob.start()) === 'running-elsewhere')
            toast('info', 'An update is running already, started from somewhere else. Its log follows here.')
        } finally {
          busy = null
          render()
        }
      },
      (e) => toast('bad', `Couldn’t start the update: ${e.message}`),
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
      (e) =>
        e.code === 'update_running'
          ? toast('warn', 'An update is running: reboot once it has finished.')
          : toast('bad', `Couldn’t reboot: ${e.message}`),
    )
  }

  // ---------------------------------------------------------------- shut down

  function shutdown() {
    return privileged(
      {
        title: `Shut down ${host()}?`,
        body: 'It powers off cleanly now: services stop and the disk is synced, so it’s safe to unplug afterwards. Everything on it stops, this dashboard included.',
        warn: 'Nothing can turn it back on from here. Press the Pi’s power button, or unplug it and plug it back in.',
        ok: 'Shut down',
      },
      async () => {
        busy = 'shutdown'
        render()
        try {
          await api('/api/system/shutdown', { method: 'POST' })
          if (pretendReboot()) toast('info', 'Mock mode: the shutdown is only pretended, so nothing stops.')
          else {
            // ponytail: trusts the 202 (sudo -l passed first); if poweroff then fails, a reload re-enables the pads
            off = true
            toast(
              'warn',
              `${host()} is shutting down. Once its power LED turns red it’s off and safe to unplug; its power button starts it again.`,
              { sticky: true },
            )
          }
        } finally {
          busy = null
          render()
        }
      },
      (e) =>
        e.code === 'update_running'
          ? toast('warn', 'An update is running: shut down once it has finished.')
          : toast('bad', `Couldn’t shut down: ${e.message}`),
    )
  }

  /** Waits until the Pi has been away and answers again (reboot-watch.js), saying each phase on the card. */
  function watch() {
    if (pretendReboot()) {
      toast('info', 'Mock mode: the reboot is only pretended, so nothing restarts.')
      return poll()
    }
    away = { note: toast('warn', `Rebooting ${host()}…`, { sticky: true, busy: true }) }
    watchReboot({
      api,
      boot: info()?.boot_time,
      onPhase({ s, gone }) {
        const msg = !gone
          ? `Rebooting ${host()}… waiting for it to shut down.`
          : s < 240
            ? `Rebooting… reconnecting. Away for ${fmt.dur(s, true)}; it usually takes about a minute.`
            : `Still away after ${fmt.dur(s)}. Check the Pi’s power and network; this page keeps trying.`
        // the toast is a live region: it changes with the phase only, the card counts the seconds
        away.note.set(
          !gone
            ? msg
            : s < 240
              ? 'Rebooting… reconnecting.'
              : `${host()} is still away. Check its power and network; this page keeps trying.`,
        )
        setText(R['rebooting-text'], msg)
        render()
      },
      onBack({ s }) {
        away.note.close()
        away = null
        toast('ok', `${host()} is back, after ${fmt.dur(s, true)}.`)
        onBack()
        poll()
        render()
      },
      onTimeout() {
        away.note.close()
        away = null
        toast('bad', `${host()} didn’t go down, so the reboot probably failed. Check journalctl -u pidash on the Pi.`)
        render()
      },
    })
  }

  // ---------------------------------------------------------------- render

  // each action carries its own mark, so Reboot and Shut down never read as twins (the padlock replaces it signed out)
  function pad(b, label, { lock, icon, disabled, busy: isBusy }) {
    const html = `${ico(lock ? Lock : icon)}<span>${esc(label)}</span>`
    if (b._h !== html) b.innerHTML = b._h = html
    // aria-disabled, not disabled: the button that started an action keeps the focus while it runs
    b.setAttribute('aria-disabled', String(disabled))
    b.toggleAttribute('data-busy', !!isBusy)
  }

  function render() {
    const gate = canChange()
    const on = gate.configured
    const { job, lost, progress: p } = updateJob.state()
    const running = job?.state === 'running'
    root.toggleAttribute('data-rebooting', !!away)
    R.lock.hidden = on || !!gate.waiting
    if (!R.lock.hidden) R.lock.innerHTML = `${ico(Lock)}<span>${esc(gate.why)}</span>`
    const lock = on && !auth.signedIn
    const blocked = !on || !!away || off || running || !!busy
    pad(R.upd, running ? 'Updating…' : 'Update…', {
      lock,
      icon: Download,
      disabled: blocked,
      busy: busy === 'update' || running,
    })
    pad(R.reboot, away ? 'Rebooting…' : 'Reboot…', {
      lock,
      icon: RotateCw,
      disabled: blocked,
      busy: busy === 'reboot' || !!away,
    })
    pad(R.shutdown, off ? 'Shutting down…' : 'Shut down…', {
      lock,
      icon: Power,
      disabled: blocked,
      busy: busy === 'shutdown',
    })
    R.reboot.title = R.shutdown.title = running
      ? 'Wait until the update has finished'
      : off
        ? 'The Pi is shutting down'
        : ''
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
    if (running) {
      const f = Math.max(0.02, p.frac)
      R.bar.style.setProperty('--f', f)
      R.meter.setAttribute('aria-valuenow', Math.round(f * 100))
      setText(R.phase, lost ? 'Can’t reach the Pi. Retrying…' : p.label)
      setText(R.elapsed, fmt.dur(Date.now() / 1000 - job.started_at, true))
    }
    const sum = summary(job, p)
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
  on(R.shutdown, shutdown)
  render()

  return {
    state: () => (away ? 'rebooting' : off ? 'off' : null),
    setInfo() {
      off = false // a hello: the Pi is up (again)
      poll()
      render()
    },
    authChanged() {
      if (auth.signedIn) poll()
      else updateJob.stop() // the apt log isn't public: it goes with the session, and no poll outlives it
      render()
    },
  }
}
