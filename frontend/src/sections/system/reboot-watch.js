// The wait for the Pi to come back after POST /api/system/reboot: polls GET /api/info until the Pi has been away and
// answers again, or answers with a new boot_time. The api, the clock and the scheduler are injected so
// reboot-watch.test.js runs it without real time; the phase texts stay with the caller (system.js).
export function watchReboot({
  api,
  now = () => Date.now(),
  schedule = setTimeout,
  cancel = clearTimeout,
  boot,
  onPhase,
  onBack,
  onTimeout,
}) {
  const t0 = now()
  let gone = false
  let timer = null
  let stopped = false

  async function check() {
    timer = null
    let info = null
    try {
      info = await api('/api/info', { timeout: 3000 })
    } catch {
      gone = true // pidash is down (tailscale serve answers 502), or the whole Pi is
    }
    if (stopped) return
    const s = (now() - t0) / 1000
    if (info && (gone || info.boot_time !== boot)) {
      stopped = true
      return onBack({ s })
    }
    if (!gone && s > 90) {
      stopped = true // never went down within 90 s: the reboot probably failed
      return onTimeout({ s })
    }
    onPhase({ s, gone })
    timer = schedule(check, gone ? 2000 : 1000)
  }

  check()
  return function stop() {
    stopped = true
    if (timer !== null) cancel(timer)
    timer = null
  }
}
