// The Verdict (GLOSSARY "Health"): its Reasons, the Health level of each reading, and No contact. No DOM and no
// clock: health/verdict-view.js passes the snapshot, the server time `now` and the data age `ageS`, and paints what comes back.
// Section badges read the same `levels`, so a badge and its Reason never disagree (plan deepen-six-modules, Q1b).
// Levels are the tone strings styles/ and herocheck.mjs select on: 'ok', 'warn', 'bad', 'off'.
import { fmt, NB } from '../ui/format.js'

// s without data before the Verdict stops vouching for old data: a pidash restart (about 9 s) stays under it (#6)
export const STALE_S = 20

/** info.limits with the fallbacks the page uses before info arrives. The NVMe limits have none: no limit, no rule. */
export const limitsOf = (L = {}) => ({
  soc_throttle_c: L.soc_throttle_c ?? 80,
  soc_throttle_hard_c: L.soc_throttle_hard_c ?? 85,
  fan_failsafe_c: L.fan_failsafe_c ?? 80,
  fan_failsafe_release_c: L.fan_failsafe_release_c ?? 75,
  nvme_warn_c: L.nvme_warn_c ?? null,
  nvme_crit_c: L.nvme_crit_c ?? null,
})

const DAY = 86400

/** One Health level rule per reading; null where the reading rates nothing. */
export const levels = {
  soc(c, L) {
    const { soc_throttle_c: t } = limitsOf(L)
    return c == null ? 'warn' : c >= t ? 'bad' : c >= t - 10 ? 'warn' : 'ok'
  },
  flagNow: (v) => (v ? 'bad' : 'ok'),
  // every flag alike, under-voltage too: once since boot is To check, not a Problem (Owner decision Q1c)
  flagSinceBoot: (name, v) => (v ? 'warn' : 'off'),
  nvme(c, L) {
    const { nvme_warn_c: w, nvme_crit_c: x } = limitsOf(L)
    if (c == null || w == null) return null
    return x != null && c >= x ? 'bad' : c >= w ? 'warn' : 'ok'
  },
  ram: (pct) => (pct >= 90 ? 'bad' : pct >= 80 ? 'warn' : 'ok'),
  fs: (pct) => (pct >= 95 ? 'bad' : pct >= 90 ? 'warn' : 'ok'),
  container(c) {
    if (c.health === 'unhealthy' || c.state === 'dead') return 'bad'
    if (c.health === 'starting' || c.state === 'paused' || c.state === 'restarting') return 'warn'
    return c.state === 'running' ? 'ok' : null
  },
  tailscale: (ts) =>
    !ts?.available ? null : ts.backend_state !== 'Running' || ts.self?.online === false ? 'warn' : 'ok',
  fan(f) {
    if (!f) return null
    if (!f.available) return 'warn'
    return f.mode === 'failsafe' || (f.pwm > 0 && f.rpm === 0) ? 'bad' : 'ok'
  },
  keyExpiry: (left) => (left == null ? null : left < 3 * DAY ? 'bad' : left < 14 * DAY ? 'warn' : 'ok'),
  // only a failed unit rates this Pi's health; activating, reloading and stopping stay badge-only (Owner decision Q1d)
  service: (u) => (u.active === 'failed' ? 'bad' : null),
}

const rank = { bad: 0, warn: 1, ok: 2 }

/**
 * The Verdict for one snapshot `m`. `now`: server time in s; `ageS`: age of the newest data in s; `last`: the `last`
 * of an earlier verdict, for the No contact row; `pi`: the System card's 'rebooting' | 'off' | null.
 * Returns null before the first snapshot, else { level, headline, title, rows, parts, last }: a row is
 * { level, text, href?, part?, next?, retry? }, `parts` maps a Part to { tone, text: [...] } for stage.health, and
 * `last` is null under No contact (keep the earlier one).
 */
export function verdict({ m, limits, hostname, now, ageS, last, pi }) {
  // the age, not the link state: a reconnect can replay an old snapshot as a full one (plan fix g, GAP-2)
  if (ageS >= STALE_S) return noContact({ hostname, now, ageS, last, pi })
  if (!m?.ts) return null
  const L = limitsOf(limits)
  const checks = []
  // `part`: the board part a reason is about, so the board can carry the verdict too (stage.health)
  const add = (level, text, href, part, next) => {
    const row = { level, text, href }
    if (part) row.part = part
    if (next) row.next = next
    checks.push(row)
  }
  const soc = m.temps?.soc_c
  const th = m.throttling
  const socLevel = levels.soc(soc, L)
  const cool = 'Check that the fan spins and the case vents are clear. Max cools fastest.'
  if (soc == null) add(socLevel, 'SoC temperature can’t be read.', '#thermals', 'soc')
  else if (soc >= L.soc_throttle_hard_c)
    add(socLevel, `SoC at ${fmt.temp(soc)}: ARM and GPU are being throttled.`, '#thermals', 'soc', cool)
  else if (socLevel === 'bad')
    add(socLevel, `SoC at ${fmt.temp(soc)}: the ARM cores are being throttled.`, '#thermals', 'soc', cool)
  else if (socLevel === 'warn')
    add(
      socLevel,
      `SoC at ${fmt.temp(soc)}, close to the ${L.soc_throttle_c}${NB}°C throttle point.`,
      '#thermals',
      'soc',
      'Performance or Max keeps it cooler.',
    )
  else add(socLevel, `SoC at ${fmt.temp(soc)}.`, '#thermals', 'soc')
  // one cause, one row: with the SoC past the throttle point, the firmware throttling and the fan's failsafe are its
  // effects, said in the SoC's row (the fan still lights on the board)
  const socHot = socLevel === 'bad'
  const f = m.fan
  if (socHot && f?.available && f.mode === 'failsafe') {
    const row = checks[checks.length - 1]
    row.text = row.text.replace(/\.$/, ', and the fan is forced to full speed (failsafe).')
    row.part = ['soc', 'fan']
    row.next = `Check that the fan spins and the case vents are clear. Your profile returns below ${L.fan_failsafe_release_c}${NB}°C.`
  }
  if (th?.available) {
    const psu = 'Use the official 27 W USB-C supply and a short, thick cable.'
    // a soft temperature limit is the firmware throttling too (plan fix d)
    const throttledNow = th.now.throttled || th.now.arm_freq_capped || th.now.soft_temp_limit
    if (th.now.under_voltage)
      add(levels.flagNow(true), 'Under-voltage right now: the power supply can’t keep up.', '#thermals', 'pmic', psu)
    else if (throttledNow && !socHot)
      add(
        levels.flagNow(true),
        'The firmware is throttling the CPU right now.',
        '#thermals',
        'soc',
        `It stops once the SoC is below ${L.soc_throttle_c}${NB}°C and the power holds steady.`,
      )
    else if (throttledNow) {
      // the SoC row already says it
    } else if (th.since_boot.under_voltage)
      add(levels.flagSinceBoot('under_voltage', true), 'Under-voltage happened since boot.', '#thermals', 'pmic', psu)
    else if (th.since_boot.throttled || th.since_boot.arm_freq_capped || th.since_boot.soft_temp_limit)
      add(
        levels.flagSinceBoot('throttled', true),
        'The CPU was throttled at some point since boot.',
        '#thermals',
        'soc',
        'Nothing to do unless it happens again: the flag clears at the next reboot.',
      )
    else if (![...Object.values(th.now), ...Object.values(th.since_boot)].some(Boolean))
      add('ok', 'No under-voltage or throttling since boot.', '#thermals')
  }
  const nv = m.temps?.nvme_c
  const nvLevel = levels.nvme(nv, L)
  if (nvLevel === 'warn' || nvLevel === 'bad')
    add(
      nvLevel,
      `NVMe at ${fmt.temp(nv)}, above its ${nvLevel === 'bad' ? 'critical' : 'warning'} limit.`,
      '#storage',
      'ssd',
      'Pause heavy disk writes and check that air reaches the drive.',
    )
  if (f?.available) {
    if (f.mode === 'failsafe' && !socHot)
      add(
        levels.fan(f),
        'Fan failsafe: forced to full speed.',
        '#fan',
        'fan',
        `The Pi is protecting itself: your profile returns below ${L.fan_failsafe_release_c}${NB}°C.`,
      )
    else if (f.pwm > 0 && f.rpm === 0)
      add(
        levels.fan(f),
        'The fan is powered but not spinning.',
        '#fan',
        'fan',
        'Check that its cable is in the FAN header and nothing blocks the blades.',
      )
  } else if (f) add(levels.fan(f), 'The fan can’t be read.', '#fan', 'fan')
  if (m.services?.available) {
    const n = m.services.summary.failed
    const failed = m.services.units.filter((u) => levels.service(u) === 'bad')
    if (n)
      add(
        'bad', // a failed unit is a Problem, as levels.service rates its row
        `${n} failed service${n > 1 ? 's' : ''}: ${failed
          .map((u) => u.name.replace(/\.service$/, ''))
          .slice(0, 3)
          .join(', ')}.`,
        '#services',
        undefined,
        n > 1 ? 'Read their logs in Services, then restart them.' : 'Read its logs in Services, then restart it.',
      )
    else add('ok', 'No failed services.', '#services')
  }
  if (m.docker?.available) {
    // one row per level, Problems first (plan fix a): the card shows unhealthy and dead red, paused and starting amber
    const word = (c) => (c.health === 'unhealthy' || c.health === 'starting' ? c.health : c.state)
    for (const level of ['bad', 'warn']) {
      const cs = m.docker.containers.filter((c) => levels.container(c) === level)
      if (cs.length)
        add(
          level,
          cs.length > 1
            ? `Containers need a look: ${cs.map((c) => `${c.name} (${word(c)})`).join(', ')}.`
            : `Container ${cs[0].name} is ${word(cs[0])}.`,
          '#containers',
          undefined,
          cs.length > 1 ? 'See docker logs <name> on the Pi for each.' : `See docker logs ${cs[0].name} on the Pi.`,
        )
    }
  }
  const ram = m.memory?.ram
  const ramLevel = ram && levels.ram(ram.used_pct)
  if (ramLevel === 'bad' || ramLevel === 'warn')
    add(
      ramLevel,
      `Memory ${fmt.pct(ram.used_pct, 0)} used.`,
      '#memory',
      'ram',
      'Top processes in Processor, sorted by Memory, shows what uses it.',
    )
  for (const fs of m.disks?.filesystems || []) {
    const level = levels.fs(fs.used_pct)
    if (level !== 'ok')
      add(
        level,
        `${fs.mount} is ${fmt.pct(fs.used_pct, 0)} full.`,
        '#storage',
        fs.device?.startsWith('/dev/nvme') ? 'ssd' : undefined,
        'Free space on it: old logs, unused Docker images or downloads.',
      )
  }
  const ts = m.tailscale
  if (ts?.available) {
    const why = 'Run tailscale status on the Pi to see why.'
    if (ts.backend_state !== 'Running')
      add(levels.tailscale(ts), `Tailscale is ${ts.backend_state}.`, '#tailnet', undefined, why)
    // the Tailnet badge's "Offline" is a Reason too (plan fix b)
    else if (levels.tailscale(ts) === 'warn')
      add('warn', 'Tailscale is running, but this Pi is offline in the tailnet.', '#tailnet', undefined, why)
    const left = ts.self?.key_expiry != null ? ts.self.key_expiry - (m.ts ?? 0) : null
    const keyLevel = levels.keyExpiry(left)
    if (keyLevel === 'bad' || keyLevel === 'warn')
      add(
        keyLevel,
        // not "expires in 0 s" (plan fix e)
        left <= 0 ? 'The Tailscale key has expired.' : `The Tailscale key expires in ${fmt.dur(left)}.`,
        '#tailnet',
        undefined,
        'Renew the key, or turn off key expiry for this machine, in the Tailscale admin console.',
      )
  }
  checks.sort((a, b) => rank[a.level] - rank[b.level]) // stable: within a level, the order above
  const level = checks[0]?.level ?? 'ok'
  // the board carries it too: each part with a reason gets its LED on the stage (worst level first, as sorted)
  const parts = {}
  for (const c of checks)
    if (c.level !== 'ok')
      for (const p of [].concat(c.part ?? [])) (parts[p] ??= { tone: c.level, text: [] }).text.push(c.text)
  const issues = checks.filter((c) => c.level !== 'ok').length
  const bad = checks.filter((c) => c.level === 'bad').length
  // the headline counts what it names: "2 problems" means two red rows, and amber rows are "to check"
  const headline =
    level === 'ok'
      ? 'Healthy'
      : level === 'warn'
        ? `${issues} thing${issues > 1 ? 's' : ''} to check`
        : `${bad} problem${bad > 1 ? 's' : ''}${issues > bad ? `, ${issues - bad} to check` : ''}`
  // the browser tab carries the verdict too: pidash lives in a tab, and the tab strip is where a glance lands
  const title = (level === 'ok' ? [hostname, 'pidash'] : [headline, hostname ?? 'pidash']).filter(Boolean).join(' · ')
  // with anything wrong, the list names only what is wrong; the all-clear rows show when there is nothing else.
  // Six rows at most: a seventh and later collapse into one "more" row, so the headline's count always adds up
  const shown = level === 'ok' ? checks : checks.filter((c) => c.level !== 'ok')
  const rows =
    shown.length > 6
      ? [
          ...shown.slice(0, 5),
          {
            level: shown[5].level,
            text: `${shown.length - 5} more: ${shown
              .slice(5)
              .map((c) => c.text.replace(/[.:].*$/, ''))
              .join(' · ')}.`,
            href: shown[5].href,
          },
        ]
      : shown
  return { level, headline, title, rows, parts, last: { level, headline, ts: m.ts } }
}

// No contact for STALE_S: say so instead of vouching for old data (Product Principle 1, issue #6)
function noContact({ hostname, now, ageS, last: l, pi }) {
  const when = l && (now - l.ts > DAY ? fmt.date(l.ts) : fmt.clock(l.ts))
  const text = !l
    ? 'No data from the Pi since this page opened.'
    : l.level === 'ok'
      ? `Last seen healthy at ${when}.`
      : `Last seen at ${when}: ${l.headline}.`
  const next =
    pi === 'rebooting'
      ? 'It is restarting: back in about a minute, and this page reconnects by itself.'
      : pi === 'off'
        ? 'It was shut down: start it with its power button.'
        : 'Check that the Pi has power and its network is up. This page keeps retrying by itself.'
  return {
    level: 'off',
    headline: `No contact with the Pi for ${fmt.dur(ageS, true)}`,
    title: `Offline · ${hostname ?? 'pidash'}`,
    rows: [{ level: 'off', text, next, retry: true }],
    parts: {}, // nothing on the board is known now
    last: null,
  }
}
