// Checks verdict.js: every Reason, Health level and the No contact rule, under plain node. Run with `npm test`.
// Fixtures are the GET /api/metrics and GET /api/info examples in backend/tests/API.md, changed per case. Reasons
// ported from main.js renderVerdict pin today's text; the `fix: (a)`-`(g)` tests pin the changes the Owner chose
// (plan deepen-six-modules, todo 8).
import test from 'node:test'
import assert from 'node:assert/strict'
import { example } from '../link/api-examples.js'
import { fmt } from '../ui/format.js'
import { verdict, levels, limitsOf, STALE_S } from './verdict.js'

const nb = '\u00a0' // the no-break space fmt puts before a unit
const BASE = example('### GET /api/metrics')
const LIMITS = example('### GET /api/info').limits
const HOST = 'raspberrypi'
const DAY = 86400

/** The verdict on the example snapshot after `edit(m)`; `opts` overrides the other inputs. */
function run(edit, opts = {}) {
  const m = structuredClone(BASE)
  edit?.(m)
  return verdict({ m, limits: LIMITS, hostname: HOST, now: m.ts, ageS: 1, last: null, pi: null, ...opts })
}
const rowsOf = (edit, opts) => run(edit, opts).rows
const find = (rows, start) => rows.find((r) => r.text.startsWith(start))

const failsafe = (m) => Object.assign(m.fan, { mode: 'failsafe', pwm: 255, rpm: 6000, speed_pct: 100 })

// ---------------------------------------------------------------- the example snapshot

test('the example snapshot is Healthy, with its all-clear rows', () => {
  const v = run()
  assert.equal(v.level, 'ok')
  assert.equal(v.headline, 'Healthy')
  assert.deepEqual(v.rows, [
    { level: 'ok', text: `SoC at 56.2${nb}°C.`, href: '#thermals', part: 'soc' },
    { level: 'ok', text: 'No under-voltage or throttling since boot.', href: '#thermals' },
    { level: 'ok', text: 'No failed services.', href: '#services' },
  ])
  assert.deepEqual(v.parts, {})
  assert.deepEqual(v.last, { level: 'ok', headline: 'Healthy', ts: BASE.ts })
})

// ---------------------------------------------------------------- SoC

const SOC_NEXT = 'Check that the fan spins and the case vents are clear. Max cools fastest.'
test('SoC: unreadable is to check', () => {
  assert.deepEqual(
    find(
      rowsOf((m) => (m.temps.soc_c = null)),
      'SoC',
    ),
    {
      level: 'warn',
      text: 'SoC temperature can’t be read.',
      href: '#thermals',
      part: 'soc',
    },
  )
})
test('SoC: at the hard limit ARM and GPU are throttled', () => {
  assert.deepEqual(
    find(
      rowsOf((m) => (m.temps.soc_c = 85)),
      'SoC',
    ),
    {
      level: 'bad',
      text: `SoC at 85.0${nb}°C: ARM and GPU are being throttled.`,
      href: '#thermals',
      part: 'soc',
      next: SOC_NEXT,
    },
  )
})
test('SoC: at the throttle point the ARM cores are throttled', () => {
  for (const t of [80, 84.9])
    assert.deepEqual(
      find(
        rowsOf((m) => (m.temps.soc_c = t)),
        'SoC',
      ),
      {
        level: 'bad',
        text: `SoC at ${t.toFixed(1)}${nb}°C: the ARM cores are being throttled.`,
        href: '#thermals',
        part: 'soc',
        next: SOC_NEXT,
      },
    )
})
test('SoC: within 10 °C of the throttle point is to check', () => {
  for (const t of [70, 79.9])
    assert.deepEqual(
      find(
        rowsOf((m) => (m.temps.soc_c = t)),
        'SoC',
      ),
      {
        level: 'warn',
        text: `SoC at ${t.toFixed(1)}${nb}°C, close to the 80${nb}°C throttle point.`,
        href: '#thermals',
        part: 'soc',
        next: 'Performance or Max keeps it cooler.',
      },
    )
})
test('SoC: below that it is healthy', () => {
  assert.deepEqual(
    find(
      rowsOf((m) => (m.temps.soc_c = 69.9)),
      'SoC',
    ),
    {
      level: 'ok',
      text: `SoC at 69.9${nb}°C.`,
      href: '#thermals',
      part: 'soc',
    },
  )
})
test('SoC: the limits come from info.limits', () => {
  const rows = rowsOf((m) => (m.temps.soc_c = 76), { limits: { ...LIMITS, soc_throttle_c: 75 } })
  assert.equal(find(rows, 'SoC').text, `SoC at 76.0${nb}°C: the ARM cores are being throttled.`)
})
test('SoC: one cause, one row: the fan failsafe is said in the hot SoC row and lights both parts', () => {
  const v = run((m) => {
    m.temps.soc_c = 82
    failsafe(m)
    m.throttling.now.throttled = true
  })
  assert.deepEqual(v.rows, [
    {
      level: 'bad',
      text: `SoC at 82.0${nb}°C: the ARM cores are being throttled, and the fan is forced to full speed (failsafe).`,
      href: '#thermals',
      part: ['soc', 'fan'],
      next: `Check that the fan spins and the case vents are clear. Your profile returns below 75${nb}°C.`,
    },
  ])
  assert.deepEqual(Object.keys(v.parts), ['soc', 'fan'])
})

// ---------------------------------------------------------------- throttle flags

const PSU = 'Use the official 27 W USB-C supply and a short, thick cable.'
test('flags: under-voltage right now is a problem', () => {
  assert.deepEqual(
    find(
      rowsOf((m) => (m.throttling.now.under_voltage = true)),
      'Under-voltage',
    ),
    {
      level: 'bad',
      text: 'Under-voltage right now: the power supply can’t keep up.',
      href: '#thermals',
      part: 'pmic',
      next: PSU,
    },
  )
})
test('flags: throttled or frequency-capped right now is a problem', () => {
  for (const k of ['throttled', 'arm_freq_capped'])
    assert.deepEqual(
      find(
        rowsOf((m) => (m.throttling.now[k] = true)),
        'The firmware',
      ),
      {
        level: 'bad',
        text: 'The firmware is throttling the CPU right now.',
        href: '#thermals',
        part: 'soc',
        next: `It stops once the SoC is below 80${nb}°C and the power holds steady.`,
      },
    )
})
test('flags: with the SoC past its throttle point the SoC row says it', () => {
  const rows = rowsOf((m) => {
    m.temps.soc_c = 81
    m.throttling.now.arm_freq_capped = true
  })
  assert.equal(find(rows, 'The firmware'), undefined)
  assert.equal(rows.length, 1)
})
test('flags: under-voltage since boot is to check', () => {
  assert.deepEqual(
    find(
      rowsOf((m) => (m.throttling.since_boot.under_voltage = true)),
      'Under-voltage',
    ),
    {
      level: 'warn',
      text: 'Under-voltage happened since boot.',
      href: '#thermals',
      part: 'pmic',
      next: PSU,
    },
  )
})
test('flags: throttling since boot is to check', () => {
  for (const k of ['throttled', 'arm_freq_capped', 'soft_temp_limit'])
    assert.deepEqual(
      find(
        rowsOf((m) => (m.throttling.since_boot[k] = true)),
        'The CPU',
      ),
      {
        level: 'warn',
        text: 'The CPU was throttled at some point since boot.',
        href: '#thermals',
        part: 'soc',
        next: 'Nothing to do unless it happens again: the flag clears at the next reboot.',
      },
    )
})
test('flags: unreadable flags give no row', () => {
  const rows = rowsOf((m) => (m.throttling = { available: false, error: 'vcgencmd not found' }))
  assert.equal(find(rows, 'No under-voltage'), undefined)
})

// ---------------------------------------------------------------- fan

test('fan: failsafe without a hot SoC is its own problem', () => {
  assert.deepEqual(find(rowsOf(failsafe), 'Fan failsafe'), {
    level: 'bad',
    text: 'Fan failsafe: forced to full speed.',
    href: '#fan',
    part: 'fan',
    next: `The Pi is protecting itself: your profile returns below 75${nb}°C.`,
  })
})
test('fan: powered but not spinning is a problem', () => {
  assert.deepEqual(
    find(
      rowsOf((m) => (m.fan.rpm = 0)),
      'The fan',
    ),
    {
      level: 'bad',
      text: 'The fan is powered but not spinning.',
      href: '#fan',
      part: 'fan',
      next: 'Check that its cable is in the FAN header and nothing blocks the blades.',
    },
  )
  assert.equal(
    find(
      rowsOf((m) => Object.assign(m.fan, { pwm: 0, rpm: 0 })),
      'The fan',
    ),
    undefined,
  )
})
test('fan: unreadable is to check', () => {
  assert.deepEqual(
    find(
      rowsOf((m) => (m.fan = { available: false, error: 'no hwmon' })),
      'The fan',
    ),
    {
      level: 'warn',
      text: 'The fan can’t be read.',
      href: '#fan',
      part: 'fan',
    },
  )
})

// ---------------------------------------------------------------- services

const unit = (name, active) => ({ name: `${name}.service`, active, sub: active === 'failed' ? 'failed' : 'running' })
test('services: one failed service', () => {
  const rows = rowsOf((m) => {
    m.services.units.push(unit('backup', 'failed'))
    m.services.summary.failed = 1
  })
  assert.deepEqual(find(rows, '1 failed'), {
    level: 'bad',
    text: '1 failed service: backup.',
    href: '#services',
    next: 'Read its logs in Services, then restart it.',
  })
})
test('services: several failed services name the first three', () => {
  const rows = rowsOf((m) => {
    for (const n of ['a', 'b', 'c', 'd']) m.services.units.push(unit(n, 'failed'))
    m.services.summary.failed = 4
  })
  assert.deepEqual(find(rows, '4 failed'), {
    level: 'bad',
    text: '4 failed services: a, b, c.',
    href: '#services',
    next: 'Read their logs in Services, then restart them.',
  })
})
test('services: unreadable services give no row', () => {
  assert.equal(
    find(
      rowsOf((m) => (m.services = { available: false, error: 'x' })),
      'No failed',
    ),
    undefined,
  )
})

// ---------------------------------------------------------------- containers

const ctr = (name, state, health = null) => ({ name, state, health })
test('containers: one restarting container keeps today’s wording', () => {
  assert.deepEqual(
    find(
      rowsOf((m) => m.docker.containers.push(ctr('db', 'restarting'))),
      'Container',
    ),
    {
      level: 'warn',
      text: 'Container db is restarting.',
      href: '#containers',
      next: 'See docker logs db on the Pi.',
    },
  )
})
test('containers: created and exited containers give no row', () => {
  const rows = rowsOf((m) => m.docker.containers.push(ctr('x', 'created'), ctr('y', 'exited')))
  assert.equal(find(rows, 'Container'), undefined)
})
test('fix: (a) containers: one row for the problem containers and one for those to check', () => {
  const rows = rowsOf((m) =>
    m.docker.containers.push(
      ctr('web', 'running', 'unhealthy'),
      ctr('db', 'dead'),
      ctr('cache', 'paused'),
      ctr('mq', 'restarting'),
    ),
  )
  assert.deepEqual(find(rows, 'Containers need a look: web'), {
    level: 'bad',
    text: 'Containers need a look: web (unhealthy), db (dead).',
    href: '#containers',
    next: 'See docker logs <name> on the Pi for each.',
  })
  assert.deepEqual(find(rows, 'Containers need a look: cache'), {
    level: 'warn',
    text: 'Containers need a look: cache (paused), mq (restarting).',
    href: '#containers',
    next: 'See docker logs <name> on the Pi for each.',
  })
  const one = rowsOf((m) =>
    m.docker.containers.push(ctr('web', 'running', 'unhealthy'), ctr('app', 'running', 'starting')),
  )
  assert.deepEqual(find(one, 'Container web'), {
    level: 'bad',
    text: 'Container web is unhealthy.',
    href: '#containers',
    next: 'See docker logs web on the Pi.',
  })
  assert.deepEqual(find(one, 'Container app'), {
    level: 'warn',
    text: 'Container app is starting.',
    href: '#containers',
    next: 'See docker logs app on the Pi.',
  })
})

// ---------------------------------------------------------------- memory and filesystems

const MEM_NEXT = 'Top processes in Processor, sorted by Memory, shows what uses it.'
test('memory: 90 % is a problem, 80 % to check', () => {
  const at = (p) =>
    find(
      rowsOf((m) => (m.memory.ram.used_pct = p)),
      'Memory',
    )
  assert.deepEqual(at(90), {
    level: 'bad',
    text: `Memory 90${nb}% used.`,
    href: '#memory',
    part: 'ram',
    next: MEM_NEXT,
  })
  assert.deepEqual(at(89.4), {
    level: 'warn',
    text: `Memory 89${nb}% used.`,
    href: '#memory',
    part: 'ram',
    next: MEM_NEXT,
  })
  assert.equal(at(80).level, 'warn')
  assert.equal(at(79.9), undefined)
})
test('filesystems: 95 % is a problem, 90 % to check, the NVMe ones on the SSD', () => {
  const FS_NEXT = 'Free space on it: old logs, unused Docker images or downloads.'
  const rows = rowsOf((m) => {
    m.disks.filesystems[0].used_pct = 95
    m.disks.filesystems[1].used_pct = 90
    m.disks.filesystems.push({ mount: '/mnt/usb', device: '/dev/sda1', used_pct: 94.9 })
    m.disks.filesystems.push({ mount: '/mnt/old', device: '/dev/sdb1', used_pct: 89.9 })
  })
  assert.deepEqual(find(rows, '/ '), {
    level: 'bad',
    text: `/ is 95${nb}% full.`,
    href: '#storage',
    part: 'ssd',
    next: FS_NEXT,
  })
  assert.deepEqual(find(rows, '/boot'), {
    level: 'warn',
    text: `/boot/firmware is 90${nb}% full.`,
    href: '#storage',
    part: 'ssd',
    next: FS_NEXT,
  })
  assert.deepEqual(find(rows, '/mnt/usb'), {
    level: 'warn',
    text: `/mnt/usb is 95${nb}% full.`,
    href: '#storage',
    next: FS_NEXT,
  })
  assert.equal(find(rows, '/mnt/old'), undefined)
})

// ---------------------------------------------------------------- NVMe

const NVME_NEXT = 'Pause heavy disk writes and check that air reaches the drive.'
test('fix: (f) NVMe is to check at its warning limit and a problem at its critical limit', () => {
  const at = (t, limits = LIMITS) =>
    find(
      rowsOf((m) => (m.temps.nvme_c = t), { limits }),
      'NVMe',
    )
  assert.equal(at(83.7), undefined)
  assert.deepEqual(at(83.8), {
    level: 'warn',
    text: `NVMe at 83.8${nb}°C, above its warning limit.`,
    href: '#storage',
    part: 'ssd',
    next: NVME_NEXT,
  })
  assert.deepEqual(at(87.8), {
    level: 'bad',
    text: `NVMe at 87.8${nb}°C, above its critical limit.`,
    href: '#storage',
    part: 'ssd',
    next: NVME_NEXT,
  })
  assert.equal(at(99, { ...LIMITS, nvme_warn_c: undefined, nvme_crit_c: undefined }), undefined)
})

// ---------------------------------------------------------------- Tailscale

const KEY_NEXT = 'Renew the key, or turn off key expiry for this machine, in the Tailscale admin console.'
const keyIn = (s) => (m) => (m.tailscale.self.key_expiry = m.ts + s)
test('tailscale: not running is to check', () => {
  assert.deepEqual(
    find(
      rowsOf((m) => (m.tailscale.backend_state = 'Stopped')),
      'Tailscale',
    ),
    {
      level: 'warn',
      text: 'Tailscale is Stopped.',
      href: '#tailnet',
      next: 'Run tailscale status on the Pi to see why.',
    },
  )
})
test('tailscale: a key expiring within 3 days is a problem, within 14 days to check', () => {
  assert.deepEqual(find(rowsOf(keyIn(2 * DAY)), 'The Tailscale key'), {
    level: 'bad',
    text: `The Tailscale key expires in 2${nb}d.`,
    href: '#tailnet',
    next: KEY_NEXT,
  })
  assert.deepEqual(find(rowsOf(keyIn(13 * DAY)), 'The Tailscale key'), {
    level: 'warn',
    text: `The Tailscale key expires in 13${nb}d.`,
    href: '#tailnet',
    next: KEY_NEXT,
  })
  assert.equal(find(rowsOf(keyIn(14 * DAY)), 'The Tailscale key'), undefined)
  assert.equal(
    find(
      rowsOf((m) => (m.tailscale.self.key_expiry = null)),
      'The Tailscale key',
    ),
    undefined,
  )
})
test('fix: (b) Tailscale running while this Pi is offline in the tailnet is to check', () => {
  assert.deepEqual(
    find(
      rowsOf((m) => (m.tailscale.self.online = false)),
      'Tailscale',
    ),
    {
      level: 'warn',
      text: 'Tailscale is running, but this Pi is offline in the tailnet.',
      href: '#tailnet',
      next: 'Run tailscale status on the Pi to see why.',
    },
  )
})
test('fix: (e) an expired Tailscale key says it has expired', () => {
  for (const s of [0, -3600])
    assert.deepEqual(find(rowsOf(keyIn(s)), 'The Tailscale key'), {
      level: 'bad',
      text: 'The Tailscale key has expired.',
      href: '#tailnet',
      next: KEY_NEXT,
    })
})

// ---------------------------------------------------------------- the other fixes

test('fix: (c) under-voltage since boot is to check on its flag badge too', () => {
  assert.equal(levels.flagSinceBoot('under_voltage', true), 'warn')
  assert.equal(
    find(
      rowsOf((m) => (m.throttling.since_boot.under_voltage = true)),
      'Under-voltage',
    ).level,
    'warn',
  )
})
test('fix: (d) a soft temperature limit right now counts as throttling right now', () => {
  assert.deepEqual(
    find(
      rowsOf((m) => (m.throttling.now.soft_temp_limit = true)),
      'The firmware',
    ),
    {
      level: 'bad',
      text: 'The firmware is throttling the CPU right now.',
      href: '#thermals',
      part: 'soc',
      next: `It stops once the SoC is below 80${nb}°C and the power holds steady.`,
    },
  )
  const hot = rowsOf((m) => {
    m.temps.soc_c = 81
    m.throttling.now.soft_temp_limit = true
  })
  assert.equal(find(hot, 'The firmware'), undefined)
})
test('fix: (g) data STALE_S old gives No contact whatever the snapshot holds', () => {
  // a reconnect can replay an old snapshot as a full one: its readings look fresh, its age does not
  const v = run((m) => (m.temps.soc_c = 95), { ageS: 25 })
  assert.equal(v.level, 'off')
  assert.match(v.headline, /^No contact with the Pi for /)
  assert.deepEqual(v.parts, {})
})

// ---------------------------------------------------------------- headline, order, collapse, parts, title

const warnRAM = (m) => (m.memory.ram.used_pct = 85)
test('headline counts what it names', () => {
  assert.equal(run(warnRAM).headline, '1 thing to check')
  assert.equal(
    run((m) => {
      warnRAM(m)
      m.temps.soc_c = 75
    }).headline,
    '2 things to check',
  )
  assert.equal(run((m) => (m.fan.rpm = 0)).headline, '1 problem')
  const v = run((m) => {
    m.fan.rpm = 0
    m.throttling.now.under_voltage = true
    warnRAM(m)
  })
  assert.equal(v.headline, '2 problems, 1 to check')
  assert.equal(v.level, 'bad')
})
test('rows sort worst first and keep their order within a level, without the all-clear rows', () => {
  const v = run((m) => {
    warnRAM(m)
    m.temps.soc_c = 75
    m.fan.rpm = 0
  })
  assert.deepEqual(
    v.rows.map((r) => r.text),
    [
      'The fan is powered but not spinning.',
      `SoC at 75.0${nb}°C, close to the 80${nb}°C throttle point.`,
      `Memory 85${nb}% used.`,
    ],
  )
})
test('a seventh row and later collapse into one "more" row', () => {
  const v = run((m) => {
    m.temps.soc_c = 75
    m.throttling.since_boot.under_voltage = true
    m.temps.nvme_c = 84
    m.fan.rpm = 0
    warnRAM(m)
    m.disks.filesystems[0].used_pct = 91
    m.tailscale.backend_state = 'Starting'
    m.tailscale.self.key_expiry = m.ts + 10 * DAY
  })
  assert.equal(v.headline, '1 problem, 7 to check')
  assert.equal(v.rows.length, 6)
  // shown[5] onwards: the filesystem, Tailscale and key rows, each cut at its first "." or ":"
  assert.deepEqual(v.rows[5], {
    level: 'warn',
    text: `3 more: / is 91${nb}% full · Tailscale is Starting · The Tailscale key expires in 10${nb}d.`,
    href: '#storage',
  })
  assert.equal(
    run((m) => {
      m.temps.soc_c = 75
      m.throttling.since_boot.under_voltage = true
      m.temps.nvme_c = 84
      m.fan.rpm = 0
      warnRAM(m)
      m.disks.filesystems[0].used_pct = 91
    }).rows.length,
    6,
  )
})
test('collapse boundary: six rows all show, a seventh folds rows 6 and 7 into "2 more"', () => {
  // six amber Reasons, then a seventh that sorts last (all one level, so add() order holds)
  const six = (m) => {
    m.temps.soc_c = 75
    m.throttling.since_boot.under_voltage = true
    m.temps.nvme_c = 84
    warnRAM(m)
    m.disks.filesystems[0].used_pct = 91
    m.tailscale.backend_state = 'Starting'
  }
  const key = (m) => (m.tailscale.self.key_expiry = m.ts + 10 * DAY)
  const shownSix = run(six).rows
  assert.equal(shownSix.length, 6)
  assert.ok(!shownSix.some((r) => /^\d+ more:/.test(r.text)), 'six rows never collapse')
  const seventh = run(key).rows[0]
  const cut = (r) => r.text.replace(/[.:].*$/, '') // the "more" row's short name of a Reason
  assert.deepEqual(
    run((m) => {
      six(m)
      key(m)
    }).rows,
    [
      ...shownSix.slice(0, 5),
      { level: shownSix[5].level, text: `2 more: ${cut(shownSix[5])} · ${cut(seventh)}.`, href: shownSix[5].href },
    ],
  )
})
test('parts: each part with a reason, worst level first, every part of an array', () => {
  const v = run((m) => {
    m.temps.soc_c = 82
    failsafe(m)
    m.throttling.since_boot.under_voltage = true
    m.memory.ram.used_pct = 85
  })
  assert.deepEqual(v.parts, {
    soc: { tone: 'bad', text: [v.rows[0].text] },
    fan: { tone: 'bad', text: [v.rows[0].text] },
    pmic: { tone: 'warn', text: ['Under-voltage happened since boot.'] },
    ram: { tone: 'warn', text: [`Memory 85${nb}% used.`] },
  })
  const two = run((m) => {
    m.temps.soc_c = 75
    m.throttling.now.throttled = true
  })
  assert.deepEqual(two.parts.soc, {
    tone: 'bad',
    text: [
      'The firmware is throttling the CPU right now.',
      `SoC at 75.0${nb}°C, close to the 80${nb}°C throttle point.`,
    ],
  })
})
test('title: hostname and pidash when healthy, the headline first otherwise', () => {
  assert.equal(run().title, 'raspberrypi · pidash')
  assert.equal(run(null, { hostname: undefined }).title, 'pidash')
  assert.equal(run(warnRAM).title, '1 thing to check · raspberrypi')
  assert.equal(run(warnRAM, { hostname: undefined }).title, '1 thing to check · pidash')
  assert.deepEqual(run(warnRAM).last, { level: 'warn', headline: '1 thing to check', ts: BASE.ts })
})

// ---------------------------------------------------------------- No contact

const off = (opts) => run(null, { ageS: STALE_S, ...opts })
test('No contact starts at STALE_S, not before', () => {
  assert.equal(STALE_S, 20)
  assert.equal(run(null, { ageS: 19.9 }).level, 'ok')
  const v = off()
  assert.equal(v.level, 'off')
  assert.equal(v.headline, `No contact with the Pi for 20${nb}s`)
  assert.equal(v.title, 'Offline · raspberrypi')
  assert.equal(off({ hostname: undefined }).title, 'Offline · pidash')
  assert.deepEqual(v.parts, {})
  assert.equal(v.last, null)
  assert.equal(off({ ageS: 125 }).headline, `No contact with the Pi for 2${nb}min 5${nb}s`)
})
test('No contact: the row says what was last seen', () => {
  const now = BASE.ts
  const ts = now - 60
  const text = (last, at = now) => off({ last, now: at }).rows[0].text
  assert.equal(text(null), 'No data from the Pi since this page opened.')
  assert.equal(text({ level: 'ok', headline: 'Healthy', ts }), `Last seen healthy at ${fmt.clock(ts)}.`)
  assert.equal(
    text({ level: 'bad', headline: '2 problems, 1 to check', ts }),
    `Last seen at ${fmt.clock(ts)}: 2 problems, 1 to check.`,
  )
  assert.equal(text({ level: 'ok', headline: 'Healthy', ts }, ts + DAY), `Last seen healthy at ${fmt.clock(ts)}.`)
  assert.equal(text({ level: 'ok', headline: 'Healthy', ts }, ts + DAY + 1), `Last seen healthy at ${fmt.date(ts)}.`)
})
test('No contact: the next step follows the System card', () => {
  const row = (pi) => off({ pi }).rows[0]
  assert.deepEqual(row(null), {
    level: 'off',
    text: 'No data from the Pi since this page opened.',
    next: 'Check that the Pi has power and its network is up. This page keeps retrying by itself.',
    retry: true,
  })
  assert.equal(row('rebooting').next, 'It is restarting: back in about a minute, and this page reconnects by itself.')
  assert.equal(row('off').next, 'It was shut down: start it with its power button.')
})
test('no verdict before the first snapshot, No contact once that takes STALE_S', () => {
  const v = (ageS) => verdict({ m: {}, limits: {}, now: 0, ageS, last: null, pi: null })
  assert.equal(v(3), null)
  assert.equal(v(STALE_S).level, 'off')
})

// ---------------------------------------------------------------- levels

test('limitsOf: the fallbacks the page used without info', () => {
  assert.deepEqual(limitsOf({}), {
    soc_throttle_c: 80,
    soc_throttle_hard_c: 85,
    fan_failsafe_c: 80,
    fan_failsafe_release_c: 75,
    nvme_warn_c: null,
    nvme_crit_c: null,
  })
  assert.deepEqual(limitsOf(LIMITS), LIMITS)
  assert.deepEqual(limitsOf(undefined), limitsOf({}))
})
test('levels.soc', () => {
  const s = (c) => levels.soc(c, LIMITS)
  assert.deepEqual([null, 69.9, 70, 79.9, 80, 85].map(s), ['warn', 'ok', 'warn', 'warn', 'bad', 'bad'])
  assert.equal(levels.soc(80, {}), 'bad')
})
test('levels.flagNow and levels.flagSinceBoot', () => {
  assert.equal(levels.flagNow(true), 'bad')
  assert.equal(levels.flagNow(false), 'ok')
  for (const k of ['under_voltage', 'arm_freq_capped', 'throttled', 'soft_temp_limit']) {
    assert.equal(levels.flagSinceBoot(k, true), 'warn')
    assert.equal(levels.flagSinceBoot(k, false), 'off')
  }
})
test('levels.nvme', () => {
  const n = (c) => levels.nvme(c, LIMITS)
  assert.deepEqual([null, 83.7, 83.8, 87.7, 87.8].map(n), [null, 'ok', 'warn', 'warn', 'bad'])
  assert.equal(levels.nvme(99, {}), null)
  assert.equal(levels.nvme(99, { nvme_warn_c: 83.8 }), 'warn')
})
test('levels.ram and levels.fs', () => {
  assert.deepEqual([79.9, 80, 89.9, 90].map(levels.ram), ['ok', 'warn', 'warn', 'bad'])
  assert.deepEqual([89.9, 90, 94.9, 95].map(levels.fs), ['ok', 'warn', 'warn', 'bad'])
})
test('levels.container', () => {
  const c = (state, health = null) => levels.container({ state, health })
  assert.equal(c('running'), 'ok')
  assert.equal(c('running', 'healthy'), 'ok')
  assert.equal(c('running', 'starting'), 'warn')
  assert.equal(c('running', 'unhealthy'), 'bad')
  assert.equal(c('paused'), 'warn')
  assert.equal(c('restarting'), 'warn')
  assert.equal(c('dead'), 'bad')
  assert.equal(c('created'), null)
  assert.equal(c('exited'), null)
})
test('levels.tailscale', () => {
  const t = (backend_state, online) => levels.tailscale({ available: true, backend_state, self: { online } })
  assert.equal(t('Running', true), 'ok')
  assert.equal(t('Running', false), 'warn')
  assert.equal(t('Stopped', true), 'warn')
  assert.equal(levels.tailscale({ available: false, error: 'x' }), null)
})
test('levels.fan', () => {
  const f = (o) => levels.fan({ available: true, mode: 'curve', pwm: 84, rpm: 3480, ...o })
  assert.equal(f({}), 'ok')
  assert.equal(f({ mode: 'failsafe' }), 'bad')
  assert.equal(f({ rpm: 0 }), 'bad')
  assert.equal(f({ pwm: 0, rpm: 0 }), 'ok')
  assert.equal(levels.fan({ available: false, error: 'x' }), 'warn')
  assert.equal(levels.fan(undefined), null)
})
test('levels.keyExpiry', () => {
  assert.deepEqual([null, -1, 0, 3 * DAY - 1, 3 * DAY, 14 * DAY - 1, 14 * DAY].map(levels.keyExpiry), [
    null,
    'bad',
    'bad',
    'bad',
    'warn',
    'warn',
    'ok',
  ])
})
test('levels.service: a failed unit is a problem; the other states stay badge-only', () => {
  assert.equal(levels.service({ active: 'failed' }), 'bad')
  for (const active of ['active', 'activating', 'reloading', 'deactivating', 'inactive'])
    assert.equal(levels.service({ active }), null)
})
