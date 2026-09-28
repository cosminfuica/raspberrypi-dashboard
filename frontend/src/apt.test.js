// Checks apt.js, the update progress read from apt-get's log. Run with `npm test`.
import assert from 'node:assert/strict'
import { aptProgress } from './apt.js'

// The mock update log (backend/pidash/system.py MOCK_APT), fed in uneven pieces as the poll delivers them
const LOG = `Hit:1 http://deb.debian.org/debian trixie InRelease
Get:2 http://deb.debian.org/debian trixie-updates InRelease [47.3 kB]
Get:3 http://deb.debian.org/debian-security trixie-security InRelease [43.4 kB]
Hit:4 http://archive.raspberrypi.com/debian trixie InRelease
Get:5 http://deb.debian.org/debian-security trixie-security/main arm64 Packages [61.2 kB]
Fetched 152 kB in 1s (131 kB/s)
Reading package lists...
Reading package lists...
Building dependency tree...
Reading state information...
Calculating upgrade...
The following packages will be upgraded:
  libssl3t64 openssl openssl-provider-legacy raspi-firmware
4 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Need to get 14.1 MB of archives.
After this operation, 8192 B of additional disk space will be used.
Get:1 http://deb.debian.org/debian-security trixie-security/main arm64 libssl3t64 arm64 3.5.1-1+deb13u1 [2262 kB]
Get:2 http://archive.raspberrypi.com/debian trixie/main arm64 raspi-firmware all 1:1.20260915-1 [10.2 MB]
Fetched 14.1 MB in 3s (4870 kB/s)
Preparing to unpack .../libssl3t64_3.5.1-1+deb13u1_arm64.deb ...
Unpacking libssl3t64:arm64 (3.5.1-1+deb13u1) over (3.5.1-1) ...
Preparing to unpack .../raspi-firmware_1%3a1.20260915-1_all.deb ...
Unpacking raspi-firmware (1:1.20260915-1) over (1:1.20250915-1) ...
Setting up libssl3t64:arm64 (3.5.1-1+deb13u1) ...
Setting up raspi-firmware (1:1.20260915-1) ...
Processing triggers for libc-bin (2.41-12) ...
`

const at = (text) => {
  const p = aptProgress()
  for (let i = 0; i < text.length; i += 37) p.feed(text.slice(i, i + 37)) // lines split across polls
  return p.get()
}
const upTo = (marker) => LOG.slice(0, LOG.indexOf(marker))

let s = at('')
assert.equal(s.label, 'Checking for updates')
assert.equal(s.total, null)

s = at(upTo('Fetched 152 kB'))
assert.match(s.label, /^Checking for updates · 5 lists read$/)
assert.ok(s.frac > 0 && s.frac <= 0.1)

s = at(upTo('The following packages'))
assert.equal(s.label, 'Working out what to upgrade')

// "Get:" lines of apt-get update must not count as package downloads
s = at(upTo('Need to get'))
assert.equal(s.total, 4)
assert.equal(s.label, 'Downloading · 0 of 4 packages')

s = at(upTo('Fetched 14.1 MB'))
assert.equal(s.label, 'Downloading · 2 of 4 packages')

s = at(upTo('Preparing to unpack .../raspi'))
assert.equal(s.label, 'Unpacking · 1 of 4 packages')

s = at(upTo('Processing triggers'))
assert.equal(s.label, 'Setting up · 2 of 4 packages')

// progress only ever moves forward through the log
let last = -1
for (let n = 0; n <= LOG.length; n += 50) {
  const f = at(LOG.slice(0, n)).frac
  assert.ok(f >= last, `progress went back at byte ${n}: ${last} -> ${f}`)
  last = f
}
assert.ok(at(LOG).frac < 1, 'only the job state says "done"')

// nothing to do; apt busy with unattended-upgrades
assert.equal(at('Reading package lists...\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n').label, 'Nothing to upgrade')
assert.equal(at('E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 812 (unattended-upgr)\n').locked, true)
// a half line is held back until it ends
const p = aptProgress()
p.feed('4 upgraded, 1 newly ')
assert.equal(p.get().total, null)
p.feed('installed, 0 to remove and 0 not upgraded.\n')
assert.equal(p.get().total, 5)

console.log('apt progress: all checks passed')
