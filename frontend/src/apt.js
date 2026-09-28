// How far a system update got, read from apt-get's output as it streams in. deploy/pidash-update runs
// `apt-get update && apt-get -y --with-new-pkgs upgrade`. Pure, so `npm test` checks it (apt.test.js).
// ponytail: this reads apt's human-readable lines, which are stable but not an API. APT::Status-Fd would be exact, but
// the update unit doesn't expose it. If a line ever changes, only this estimate suffers, never the update itself.
const SUMMARY = /^(\d+) upgraded, (\d+) newly installed, \d+ to remove and \d+ not upgraded/

export function aptProgress() {
  let lists = 0 // index files apt-get update fetched or checked
  let planning = false // apt-get update is done; upgrade is working out what to do
  let total = null // packages to install: upgraded + newly installed
  let got = 0
  let unpacked = 0
  let setUp = 0
  let triggers = false
  let locked = false // apt was busy (unattended-upgrades): nothing changed
  let rest = '' // a line not finished yet

  function line(s) {
    if (s.includes('Could not get lock')) locked = true
    const m = SUMMARY.exec(s)
    if (m) total = Number(m[1]) + Number(m[2])
    else if (total == null) {
      if (/^(Hit|Get|Ign|Err):\d+ /.test(s)) lists++
      else if (s.startsWith('Reading package lists')) planning = true
    } else if (/^Get:\d+ /.test(s)) got++
    else if (s.startsWith('Unpacking ')) unpacked++
    else if (s.startsWith('Setting up ')) setUp++
    else if (s.startsWith('Processing triggers ')) triggers = true
  }

  return {
    /** Feeds the next piece of the log; it may end mid-line. */
    feed(text) {
      const lines = (rest + text).split('\n')
      rest = lines.pop()
      for (const l of lines) line(l.replace(/\r$/, ''))
    },
    /** {frac: 0–1, label, total: packages to install (null until apt says), locked} */
    get() {
      const at = (frac, label) => ({ frac, label, total, locked })
      if (total == null) {
        if (planning) return at(0.12, 'Working out what to upgrade')
        return at(Math.min(0.1, lists * 0.008), lists ? `Checking for updates · ${lists} lists read` : 'Checking for updates')
      }
      if (total === 0) return at(1, 'Nothing to upgrade')
      const of = (n) => `${Math.min(n, total)} of ${total}`
      if (!unpacked && !setUp) return at(0.15 + 0.3 * Math.min(got / total, 1), `Downloading · ${of(got)} packages`)
      if (triggers && setUp >= total) return at(0.98, 'Finishing up')
      const frac = 0.45 + 0.25 * Math.min(unpacked / total, 1) + 0.25 * Math.min(setUp / total, 1)
      return at(frac, setUp ? `Setting up · ${of(setUp)} packages` : `Unpacking · ${of(unpacked)} packages`)
    },
  }
}
