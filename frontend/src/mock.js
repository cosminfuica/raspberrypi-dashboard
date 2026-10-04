// In-browser demo backend (open the page with ?demo). Implements the docs/API.md contract with synthetic,
// time-varying data: the same messages, sections, refresh cadence and fan PUTs as `pidash --mock`.
// Options: &docker=off (Docker absent), &fan=kernel (read-only fan), &auth=off (no token configured),
//          &hot (sustained load: failsafe and throttling), &flaky (the socket drops every 25 s),
//          &healthy (none of the three built-in faults: the failed backup, the old under-voltage, the unhealthy container),
//          &outage=A-B (from A to B s after load the Pi stops answering: the socket goes silent, new ones hang, REST fails).
// Sign in with the token "demo". The update, reboot, shutdown and service restarts are pretend, the service logs are made
// up, and there is no console.
import { step, validateCurve, DEFAULT_CONSTRAINTS, nightBegan, nightState, validateNight } from './curve.js'

const q = new URLSearchParams(location.search)
const opt = {
  docker: q.get('docker') !== 'off',
  fanKernel: q.get('fan') === 'kernel',
  auth: q.get('auth') !== 'off',
  hot: q.has('hot'),
  flaky: q.has('flaky'),
  healthy: q.has('healthy'),
  outage: /^(\d+)-(\d+)$/.exec(q.get('outage') ?? '')?.slice(1).map(Number), // [A, B]; any other value is ignored
}
const TOKEN = 'demo'
const GiB = 1024 ** 3
const TOTAL_RAM = 8453947392
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const r1 = (v) => Math.round(v * 10) / 10
const r3 = (v) => Math.round(v * 1000) / 1000

// Deterministic noise, so the replayed history and the live stream are one continuous signal.
const hash = (x, k = 0) => {
  const s = Math.sin(x * 127.1 + k * 311.7) * 43758.5453
  return s - Math.floor(s)
}
const vnoise = (x, k = 0) => {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i, k) * (1 - u) + hash(i + 1, k) * u
}
const wave = (t, p, ph = 0) => 0.5 + 0.5 * Math.sin((t / p) * 2 * Math.PI + ph)
const burst = (t, period, len, k) => {
  const w = Math.floor(t / period)
  const x = t - w * period - (8 + hash(w, k) * (period - len - 16))
  return x > 0 && x < len ? Math.min(1, x / 5) * Math.min(1, (len - x) / 6) : 0
}

// ------------------------------------------------------------------ static facts

const now0 = Date.now() / 1000
const BOOT = Math.floor(now0 - 85107)
// &outage=A-B: a hung Pi (issue #6), so the page's watchdog, backoff and offline view can be tried without one
const hung = () => {
  const s = Date.now() / 1000 - now0
  return opt.outage != null && s >= opt.outage[0] && s < opt.outage[1]
}

const PROFILES = [
  { id: 'silent', name: 'Silent', builtin: true, description: 'Fan off up to 59 °C, then a slow ramp. Quietest; the SoC runs warmer under load.', hysteresis_c: 4, points: [[59, 0], [60, 20], [68, 40], [75, 70], [79, 100]] },
  { id: 'balanced', name: 'Balanced', builtin: true, description: 'Your current config.txt curve, smoothed: 30 % at 55 °C, full speed at 75 °C. The default.', hysteresis_c: 5, points: [[54, 0], [55, 30], [63, 50], [70, 70], [75, 100]] },
  { id: 'performance', name: 'Performance', builtin: true, description: 'Always on (30 % minimum), full speed from 72 °C. Coolest under load, audible at idle.', hysteresis_c: 3, points: [[40, 30], [55, 55], [65, 80], [72, 100]] },
  { id: 'max', name: 'Max', builtin: true, description: 'Full speed all the time.', hysteresis_c: 0, points: [[20, 100], [80, 100]] },
  { id: 'custom', name: 'Custom', builtin: false, description: 'Your own curve. Starts as a copy of Balanced.', hysteresis_c: 5, points: [[54, 0], [55, 30], [63, 50], [70, 70], [75, 100]] },
].map((p) => ({ ...p, points: p.points.map(([temp_c, speed_pct]) => ({ temp_c, speed_pct })) }))
let active = 'balanced'
// The night schedule (docs/API.md "PUT /api/fan/night"), off by default, and fan.json's `skip`: the local date of the
// night a pick paused, which the server never sends
let night = { enabled: false, profile: 'silent', start: '23:00', end: '07:00' }
let skip = null

const info = () => ({
  api_version: 1,
  app_version: '0.4.0',
  mock: true,
  hostname: 'mock-pi',
  model: 'Raspberry Pi 5 Model B Rev 1.0',
  os: 'Debian GNU/Linux 13 (trixie)',
  kernel: '6.18.50+rpt-rpi-2712',
  arch: 'aarch64',
  cpu: { model: 'Cortex-A76', cores: 4, min_mhz: 1500, max_mhz: 2400 },
  memory_total_bytes: TOTAL_RAM,
  boot_time: BOOT,
  server_time: r3(Date.now() / 1000),
  utc_offset_s: -new Date().getTimezoneOffset() * 60,
  history_s: 600,
  auth_configured: opt.auth,
  console_enabled: false, // the demo has no shell
  limits: { soc_throttle_c: 80, soc_throttle_hard_c: 85, nvme_warn_c: 83.8, nvme_crit_c: 87.8, fan_failsafe_c: 80, fan_failsafe_release_c: 75 },
})

const fanProfiles = () => ({ active, constraints: { ...DEFAULT_CONSTRAINTS }, profiles: structuredClone(PROFILES), night: { ...night } })
const profileById = (id) => PROFILES.find((p) => p.id === id)

// [code, name, description, enabled]. Codes: R active/running, E active/exited, I inactive/dead, F failed.
const UNITS = `
R accounts-daemon|Accounts Service|enabled
E alsa-restore|Save/Restore Sound Card State|static
I alsa-state|Manage Sound Card State (restore and store)|static
E apparmor|Load AppArmor profiles|enabled
I apt-daily|Daily apt download activities|static
I apt-daily-upgrade|Daily apt upgrade and clean activities|static
R avahi-daemon|Avahi mDNS/DNS-SD Stack|enabled
R bluetooth|Bluetooth service|enabled
E bthelper@hci0|Raspberry Pi bluetooth helper|static
E cloud-config|Cloud-init: Config Stage|enabled
E cloud-final|Cloud-init: Final Stage|enabled
E cloud-init-local|Cloud-init: Local Stage (pre-network)|enabled
E cloud-init-main|Cloud-init: Single Process|enabled
E cloud-init-network|Cloud-init: Network Stage|enabled
R colord|Manage, Install and Generate Color Profiles|static
E console-setup|Set console font and keymap|enabled
R containerd|containerd container runtime|enabled
R cron|Regular background program processing daemon|enabled
R cups|CUPS Scheduler|enabled
R cups-browsed|Make remote CUPS printers available locally|enabled
R dbus|D-Bus System Message Bus|static
R docker|Docker Application Container Engine|enabled
I dpkg-db-backup|Daily dpkg database backup service|static
I e2scrub_all|Online ext4 Metadata Check for All Filesystems|static
E e2scrub_reap|Remove Stale Online ext4 Metadata Check Snapshots|enabled
I emergency|Emergency Shell|static
E fake-hwclock|Restore / save the current clock|enabled
I fstrim|Discard unused blocks on filesystems from /etc/fstab|static
R getty@tty1|Getty on tty1|enabled
I getty-static|getty on tty2-tty6 if dbus and logind are not available|static
E glamor-test|Check for glamor|enabled
E hciuart|Configure Bluetooth Modems connected by UART|enabled
I ifupdown-pre|Helper to synchronize boot up for ifupdown|static
I initrd-cleanup|Cleaning Up and Shutting Down Daemons|static
I initrd-parse-etc|Mountpoints Configured in the Real Root|static
I initrd-switch-root|Switch Root|static
I initrd-udevadm-cleanup-db|Cleanup udev Database|static
E keyboard-setup|Set the console keyboard layout|enabled
E kmod-static-nodes|Create List of Static Device Nodes|static
I ldconfig|Rebuild Dynamic Linker Cache|static
R lightdm|Light Display Manager|indirect
I logrotate|Rotate log files|static
I man-db|Daily man-db regeneration|static
R ModemManager|Modem Manager|enabled
I modprobe@configfs|Load Kernel Module configfs|static
I modprobe@dm_mod|Load Kernel Module dm_mod|static
I modprobe@drm|Load Kernel Module drm|static
I modprobe@efi_pstore|Load Kernel Module efi_pstore|static
I modprobe@fuse|Load Kernel Module fuse|static
I modprobe@loop|Load Kernel Module loop|static
E networking|Raise network interfaces|enabled
R NetworkManager|Network Manager|enabled
I NetworkManager-dispatcher|Network Manager Script Dispatcher Service|enabled
E NetworkManager-wait-online|Network Manager Wait Online|enabled
I nfs-blkmap|pNFS block layout mapping daemon|disabled
I nftables|nftables|disabled
I packagekit|PackageKit Daemon|static
R pidash|pidash Raspberry Pi dashboard|enabled
I plymouth-quit|Terminate Plymouth Boot Screen|static
I plymouth-quit-wait|Hold until boot process finishes up|static
E plymouth-read-write|Tell Plymouth To Write Out Runtime Data|static
I plymouth-start|Show Plymouth Boot Screen|static
R polkit|Authorization Manager|static
E rc-local|/etc/rc.local Compatibility|generated
I rescue|Rescue Shell|static
F restic-backup|Nightly restic backup to the NAS|static
R rng-tools-debian|LSB: rng-tools (Debian variant)|generated
I rpc-statd-notify|Notify NFS peers of a restart|static
R rpcbind|RPC bind portmap service|enabled
E rp1-test|Check for RP1 displays for Xorg|enabled
E rpi-display-backlight|Raspberry Pi backlight|enabled
E rpi-eeprom-update|Check for Raspberry Pi EEPROM updates|enabled
I rsync|fast remote file copy program daemon|enabled
R rtkit-daemon|RealtimeKit Scheduling Policy Service|static
R serial-getty@ttyAMA10|Serial Getty on ttyAMA10|enabled
R ssh|OpenBSD Secure Shell server|enabled
E sshswitch|Turn on SSH if /boot/ssh is present|enabled
I sudo|sudo.service|masked
I systemd-ask-password-console|Dispatch Password Requests to Console|static
I systemd-ask-password-plymouth|Forward Password Requests to Plymouth|static
I systemd-ask-password-wall|Forward Password Requests to Wall|static
I systemd-battery-check|Check battery level during early boot|static
E systemd-binfmt|Set Up Additional Binary Formats|static
I systemd-bsod|Displays emergency message in full screen.|static
I systemd-confext|Merge System Configuration Images into /etc/|disabled
I systemd-exit|Exit the Container|static
I systemd-firstboot|First Boot Wizard|static
E systemd-fsck-root|File System Check on Root Device|static
I systemd-halt|System Halt|static
I systemd-hostnamed|Hostname Service|static
I systemd-hwdb-update|Rebuild Hardware Database|static
I systemd-initctl|initctl Compatibility Daemon|static
E systemd-journal-catalog-update|Rebuild Journal Catalog|static
E systemd-journal-flush|Flush Journal to Persistent Storage|static
R systemd-journald|Journal Service|static
I systemd-kexec|Reboot via kexec|static
I systemd-localed|Locale Service|static
R systemd-logind|User Login Management|static
I systemd-machine-id-commit|Save Transient machine-id to Disk|static
E systemd-modules-load|Load Kernel Modules|static
I systemd-networkd|Network Configuration|disabled
I systemd-networkd-wait-online|Wait for Network to be Configured|disabled
I systemd-poweroff|System Power Off|static
E systemd-pstore|Platform Persistent Storage Archival|enabled
I systemd-quotacheck-root|Root File System Quota Check|static
E systemd-random-seed|Load/Save OS Random Seed|static
I systemd-reboot|System Reboot|static
E systemd-remount-fs|Remount Root and Kernel File Systems|static
E systemd-rfkill|Load/Save RF Kill Switch Status|static
I systemd-soft-reboot|Reboot System Userspace|static
E systemd-sysctl|Apply Kernel Variables|static
I systemd-sysext|Merge System Extension Images into /usr/ and /opt/|disabled
E systemd-sysusers|Create System Users|static
I systemd-timedated|Time & Date Service|static
R systemd-timesyncd|Network Time Synchronization|enabled
I systemd-tmpfiles-clean|Cleanup of Temporary Directories|static
E systemd-tmpfiles-setup|Create System Files and Directories|static
E systemd-tmpfiles-setup-dev|Create Static Device Nodes in /dev|static
E systemd-tmpfiles-setup-dev-early|Create Static Device Nodes in /dev gracefully|static
I systemd-tpm2-setup|TPM2 SRK Setup|static
I systemd-tpm2-setup-early|Early TPM2 SRK Setup|static
R systemd-udevd|Rule-based Manager for Device Events and Files|static
E systemd-udev-trigger|Coldplug All udev Devices|static
I systemd-update-done|Update is Completed|static
E systemd-update-utmp|Record System Boot/Shutdown in UTMP|static
I systemd-update-utmp-runlevel|Record Runlevel Change in UTMP|static
E systemd-user-sessions|Permit User Sessions|static
E systemd-zram-setup@zram0|Create swap on /dev/zram0|static
R tailscaled|Tailscale node agent|enabled
R triggerhappy|triggerhappy global hotkey daemon|enabled
R udisks2|Disk Manager|enabled
R unattended-upgrades|Unattended Upgrades Shutdown|enabled
R upower|Daemon for power management|disabled
R user@1000|User Manager for UID 1000|static
E user-runtime-dir@1000|User Runtime Directory /run/user/1000|static
R wayvnc|VNC Server|enabled
R wpa_supplicant|WPA supplicant|enabled
E wtmpdb-update-boot|Write boot and shutdown times into wtmpdb|static
I wtmpdb-rotate|Rotate wtmpdb|static
I x11-common|x11-common.service|masked`
  .trim()
  .split('\n')
  .map((line, i) => {
    const [head, description, enabled] = line.split('|')
    const [flag, name] = head.split(' ')
    const code = opt.healthy && flag === 'F' ? 'I' : flag // healthy: the failed backup ran fine, so it is inactive
    const [active, sub] = { R: ['active', 'running'], E: ['active', 'exited'], I: ['inactive', 'dead'], F: ['failed', 'failed'] }[code]
    return {
      name: `${name}.service`,
      description,
      load: 'loaded',
      active,
      sub,
      enabled,
      active_since: active === 'active' ? BOOT + 14 + Math.floor(hash(i, 3) * 40) : null,
      memory_bytes: code === 'R' ? Math.round((1.2 + hash(i, 4) * 60) * 1048576) : null,
    }
  })
const rank = (u) => (u.active === 'failed' ? 0 : u.active === 'active' ? 1 : 2)
UNITS.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
Object.assign(UNITS.find((u) => u.name === 'pidash.service'), { memory_bytes: 52428800 })
Object.assign(UNITS.find((u) => u.name === 'docker.service'), { memory_bytes: 98304000 })
Object.assign(UNITS.find((u) => u.name === 'tailscaled.service'), { memory_bytes: 60817408 })

// [pid, name, user, command, cpu share of the load, rss bytes, threads]
const PROCS = [
  [3121, 'python3', 'root', 'python3 -m homeassistant --config /config', 0.34, 287309824, 38],
  [4410, 'node', 'root', 'node index.js', 0.07, 126877696, 11],
  [20931, 'python3', 'pidash', '/opt/pidash/venv/bin/python -m pidash', 0.06, 52428800, 6],
  [1259, 'tailscaled', 'root', '/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock --port=41641', 0.035, 51134464, 11],
  [1363, 'labwc', 'cosmin', '/usr/bin/labwc -m', 0.03, 142508032, 4],
  [2008, 'dockerd', 'root', '/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock', 0.022, 94617600, 11],
  [1876, 'containerd', 'root', '/usr/bin/containerd', 0.016, 48234496, 12],
  [1740, 'wayvnc', 'cosmin', '/usr/bin/wayvnc --render-cursor --keyboard=gb', 0.014, 33554432, 6],
  [1502, 'wf-panel-pi', 'cosmin', 'wf-panel-pi', 0.011, 88080384, 5],
  [1511, 'Xwayland', 'cosmin', '/usr/bin/Xwayland :0 -rootless -core -terminate 10', 0.007, 70254592, 3],
  [612, 'systemd-journald', 'root', '/usr/lib/systemd/systemd-journald', 0.005, 23068672, 1],
  [981, 'NetworkManager', 'root', '/usr/sbin/NetworkManager --no-daemon', 0.004, 19922944, 4],
  [1498, 'pcmanfm', 'cosmin', 'pcmanfm --desktop --profile LXDE-pi', 0.004, 61865984, 4],
  [2240, 'mosquitto', '1883', '/usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf', 0, 7340032, 1],
  [88, 'kworker/u8:3-events_unbound', 'root', '[kworker/u8:3-events_unbound]', 0.004, 0, 1],
  [1, 'systemd', 'root', '/sbin/init splash', 0.002, 13107200, 1],
  [57, 'kswapd0', 'root', '[kswapd0]', 0.001, 0, 1],
]

const RAILS = [
  ['VDD_CORE', 0.855, 0], ['3V7_WL_SW', 3.687, 0.077], ['0V8_SW', 0.803, 0.327], ['1V8_SYS', 1.797, 0.124],
  ['1V1_SYS', 1.104, 0.176], ['3V3_SYS', 3.295, 0.047], ['HDMI', 5.124, 0.017], ['DDR_VDD2', 1.108, 0.008],
  ['3V3_ADC', 3.294, 0.001], ['0V8_AON', 0.799, 0.005], ['3V3_DAC', 3.301, 0.001], ['DDR_VDDQ', 0.607, 0],
]

// ------------------------------------------------------------------ simulation

const sim = {
  t: 0,
  soc: 49,
  nvme: 40.5,
  rpm: 0,
  fan: null, // the curve loop's previous tick
  kernelState: 0,
  rx: { wlan0: 16475278, tailscale0: 917882, eth0: 0, docker0: 439 },
  tx: { wlan0: 111434915, tailscale0: 101187744, eth0: 0, docker0: 220 },
  peers: { omarchy: [61708, 84708], 'cosmin-iphone': [20480, 41984] },
  m: {},
}

const load = (t) => {
  let l = 0.1 + 0.14 * wave(t, 97) + 0.07 * wave(t, 31, 1.3) + 0.05 * (vnoise(t / 6, 1) - 0.5)
  l += 0.62 * burst(t, 210, 55, 9)
  if (opt.hot) l = Math.max(l, 0.94)
  return clamp(l, 0.02, 1)
}
const rpmFor = (pwm) => (pwm === 0 ? 0 : Math.max(0, 51 * pwm - 875))

function tick(t) {
  const l = load(t)
  const run = nightState(active, night, skip, new Date(t * 1000)) // the profile applied now, as the server's status()
  const prof = profileById(run.profile)
  const c = DEFAULT_CONSTRAINTS
  // SoC temperature: first-order lag to an equilibrium that load raises and the fan lowers.
  const fanPct = sim.fan ? sim.fan.target : 0
  const eq = 43 + 38 * l - 9 * (fanPct / 100) + (opt.hot ? 13 : 0)
  sim.soc += (eq - sim.soc) / 18 + (vnoise(t / 3, 2) - 0.5) * 0.25
  const soc = r1(sim.soc)
  let mode = 'curve'
  let pwm
  let target = null
  if (opt.fanKernel) {
    // config.txt trips (55/63/70/75 °C, 5 °C hysteresis) → cooling levels 0/75/125/175/250.
    const trips = [55, 63, 70, 75]
    let s = sim.kernelState
    while (s < 4 && soc >= trips[s]) s++
    while (s > 0 && soc < trips[s - 1] - 5) s--
    sim.kernelState = s
    pwm = [0, 75, 125, 175, 250][s]
    mode = 'kernel'
  } else {
    sim.fan = step(sim.fan, prof, soc, c, { fan_failsafe_c: 80, fan_failsafe_release_c: 75 })
    mode = sim.fan.mode
    target = r1(sim.fan.target)
    pwm = Math.round((sim.fan.target * 255) / 100)
  }
  sim.rpm += (rpmFor(pwm) * (1 + (hash(t, 5) - 0.5) * 0.03) - sim.rpm) * 0.4
  if (pwm === 0 && sim.rpm < 60) sim.rpm = 0

  const perCore = [0, 1, 2, 3].map((k) => r1(clamp(l * 100 * (0.55 + 0.9 * vnoise(t / 4, 10 + k)) + (k === 2 ? 6 : 0), 0.5, 100)))
  const usage = r1(perCore.reduce((a, b) => a + b, 0) / 4)
  const freq = l < 0.08 ? 1500 : Math.min(2400, 1500 + Math.round((l * 3 * 900) / 100) * 100)
  const la = sim.m.cpu?.load_avg || [l * 4, l * 4, l * 4]
  const load_avg = [la[0] + (l * 4 * 1.05 - la[0]) / 12, la[1] + (l * 4 - la[1]) / 60, la[2] + (l * 4 - la[2]) / 180].map((v) => Math.round(v * 100) / 100)
  // times_pct sums to 100 and usage_pct = 100 − idle, as docs/API.md defines
  const user = r1(usage * 0.75)
  const system = r1(usage * 0.2)
  const iowait = r1(Math.min(usage * 0.04, 0.3 + burst(t, 97, 10, 7) * 2))
  const softirq = r1(Math.max(0, usage - user - system - iowait))

  const diskW = Math.round(18000 + 42000 * hash(t, 11) + 14e6 * burst(t, 97, 10, 7))
  const diskR = Math.round(hash(t, 12) > 0.85 ? 4096 * (1 + Math.floor(hash(t, 13) * 6)) : 0) + Math.round(2.2e6 * burst(t, 210, 55, 9) * (hash(t, 14) > 0.5 ? 1 : 0))
  sim.nvme += (38 + 0.12 * (sim.soc - 45) + (diskW + diskR) / 4.5e6 - sim.nvme) / 60

  const dl = burst(t, 180, 22, 15)
  const wl = { rx: Math.round(4200 + 2600 * hash(t, 16) + 3.3e6 * dl), tx: Math.round(7600 + 2400 * hash(t, 17) + 42000 * dl) }
  const ts0 = { rx: Math.round(1100 + 400 * hash(t, 18)), tx: Math.round(6200 + 1300 * hash(t, 19)) }
  const dk = { rx: opt.docker ? Math.round(180 + 160 * hash(t, 20)) : 0, tx: opt.docker ? Math.round(260 + 200 * hash(t, 21)) : 0 }
  const rates = { wlan0: wl, tailscale0: ts0, eth0: { rx: 0, tx: 0 }, docker0: dk }
  for (const k in rates) {
    sim.rx[k] += rates[k].rx
    sim.tx[k] += rates[k].tx
  }
  sim.peers.omarchy[0] += ts0.tx * 0.8
  sim.peers.omarchy[1] += ts0.rx * 0.8
  sim.peers['cosmin-iphone'][0] += 90
  sim.peers['cosmin-iphone'][1] += 40

  const used = Math.round(1.62e9 + 0.24e9 * l + 0.06e9 * wave(t, 300))
  const cached = Math.round(1.27e9 + 0.03e9 * wave(t, 420, 2))
  const ts = r3(t)
  const m = sim.m
  m.ts = ts
  m.system = { uptime_s: Math.floor(t - BOOT), boot_time: BOOT, process_count: 201 + Math.round(4 * hash(Math.floor(t / 5), 22)), thread_count: 368 + Math.round(12 * hash(Math.floor(t / 5), 23)) }
  m.cpu = { usage_pct: usage, per_core_pct: perCore, times_pct: { user, nice: 0, system, iowait, irq: 0, softirq, idle: r1(100 - usage) }, freq_mhz: freq, governor: 'ondemand', load_avg }
  m.memory = {
    ram: { total_bytes: TOTAL_RAM, used_bytes: used, available_bytes: TOTAL_RAM - used, cached_bytes: cached, buffers_bytes: 100532224, used_pct: r1((used / TOTAL_RAM) * 100) },
    swap: { total_bytes: 2147467264, used_bytes: 12058624, used_pct: 0.6 },
  }
  const pmicT = m.temps?.pmic_c
  m.temps = { soc_c: soc, nvme_c: r1(sim.nvme), rp1_c: r1(47 + 0.35 * (sim.soc - 45) + (hash(t, 24) - 0.5) * 0.4), pmic_c: pmicT != null && Math.floor(t) % 5 ? pmicT : r1(49 + 0.3 * (sim.soc - 45) + 1.5 * l) }
  const hotNow = sim.soc >= 80
  const raw = (hotNow ? 0xe : 0) | (opt.healthy ? 0 : 0x10000) | (opt.hot ? 0xe0000 : 0)
  m.throttling = {
    available: true,
    raw: `0x${raw.toString(16)}`,
    now: { under_voltage: false, arm_freq_capped: hotNow, throttled: hotNow, soft_temp_limit: hotNow },
    since_boot: { under_voltage: !opt.healthy, arm_freq_capped: opt.hot, throttled: opt.hot, soft_temp_limit: opt.hot },
  }
  m.fan = {
    available: true,
    rpm: Math.round(sim.rpm),
    pwm,
    speed_pct: r1((pwm * 100) / 255),
    mode,
    profile: run.profile,
    schedule: run.schedule,
    target_pct: target,
    control_temp_c: soc,
    writable: !opt.fanKernel,
    reboot_required: false,
  }
  m.disks = {
    devices: [{ name: 'nvme0n1', model: 'WD Blue SN580 1TB', size_bytes: 1000204886016, read_bytes_per_s: diskR, write_bytes_per_s: diskW, read_iops: Math.ceil(diskR / 65536) * (diskR ? 3 : 0), write_iops: Math.max(1, Math.round(diskW / 7400)), busy_pct: r1(Math.min(100, 0.3 + (diskR + diskW) / 1.6e6)) }],
    total: { read_bytes_per_s: diskR, write_bytes_per_s: diskW },
    filesystems: [
      { mount: '/', device: '/dev/nvme0n1p2', fstype: 'ext4', total_bytes: 898268385280, used_bytes: 8738693120, free_bytes: 852950233088, used_pct: 1.0 },
      { mount: '/boot/firmware', device: '/dev/nvme0n1p1', fstype: 'vfat', total_bytes: 528592896, used_bytes: 82630656, free_bytes: 445962240, used_pct: 15.6 },
    ],
  }
  const iface = (name, kind, up, addresses, extra = {}) => ({
    name, kind, up, addresses, speed_mbps: null, wifi_signal_dbm: null, ...extra,
    rx_bytes_per_s: rates[name].rx, tx_bytes_per_s: rates[name].tx, rx_total_bytes: sim.rx[name], tx_total_bytes: sim.tx[name],
  })
  m.network = {
    interfaces: [
      iface('wlan0', 'wifi', true, ['192.168.0.92'], { wifi_signal_dbm: -50 - Math.round(4 * vnoise(t / 20, 25)) }),
      iface('tailscale0', 'vpn', true, ['100.106.106.35', 'fd7a:115c:a1e0::ce2d:6a24']),
      iface('eth0', 'ethernet', false, []),
      iface('docker0', 'bridge', opt.docker, ['172.17.0.1']),
    ],
    total: { rx_bytes_per_s: wl.rx, tx_bytes_per_s: wl.tx },
  }

  const sec = Math.floor(t)
  if (!m.processes || sec % 3 === 0) {
    const list = PROCS.map(([pid, name, user, command, share, rss, threads], i) => ({
      pid, name, user,
      cpu_pct: r1(share * usage * (0.65 + 0.7 * vnoise(t / 5, 30 + i)) * (i === 0 ? 1 + burst(t, 210, 55, 9) : 1)),
      mem_pct: r1((rss / TOTAL_RAM) * 100), rss_bytes: rss, threads, command,
    }))
    m.processes = {
      top_cpu: [...list].sort((a, b) => b.cpu_pct - a.cpu_pct || a.pid - b.pid).slice(0, 10),
      top_mem: [...list].sort((a, b) => b.rss_bytes - a.rss_bytes || a.pid - b.pid).slice(0, 10),
    }
  }
  if (!m.power || sec % 5 === 0) {
    const coreA = 1.3 + 3.3 * l + (hash(t, 31) - 0.5) * 0.1
    const coreV = r3(0.72 + (freq - 1500) / 6000)
    const rails = RAILS.map(([name, v, a], i) => {
      const amps = i === 0 ? coreA : a * (0.95 + 0.1 * hash(t, 40 + i))
      const vv = i === 0 ? coreV : v
      return { name, v: r3(vv), a: r3(amps), w: r3(vv * amps) }
    }).sort((a, b) => b.w - a.w)
    m.power = { available: true, input_v: r3(5.118 - 0.07 * l - 0.01 * hash(t, 32)), core_v: coreV, core_a: r3(coreA), pmic_w: Math.round(rails.reduce((s, r) => s + r.w, 0) * 100) / 100, rails }
    const failed = UNITS.filter((u) => u.active === 'failed').length
    const act = UNITS.filter((u) => u.active === 'active').length
    m.services = { available: true, summary: { total: UNITS.length, active: act, running: UNITS.filter((u) => u.sub === 'running').length, failed }, units: UNITS }
    const ha = m.processes.top_cpu.find((p) => p.pid === 3121)?.cpu_pct ?? 12
    const up = (s) => `Up ${Math.max(1, Math.floor((t - s) / 3600))} hours`
    const started = BOOT + 70000
    m.docker = opt.docker
      ? {
          available: true,
          version: '29.8.1',
          summary: { total: 4, running: 2, paused: 1, stopped: 1, images: 5 },
          containers: [
            { id: '8c1f0e7a2b3d', name: 'homeassistant', image: 'ghcr.io/home-assistant/home-assistant:stable', state: 'running', status: `${up(started)} (healthy)`, health: 'healthy', created: started - 600, ports: ['0.0.0.0:8123->8123/tcp'], cpu_pct: ha, mem_bytes: 312475648, mem_limit_bytes: TOTAL_RAM, mem_pct: 3.7 },
            { id: '5e2a9c4d7b18', name: 'zigbee2mqtt', image: 'koenkk/zigbee2mqtt:2.6.1', state: 'running', status: `${up(started)} (${opt.healthy ? 'healthy' : 'unhealthy'})`, health: opt.healthy ? 'healthy' : 'unhealthy', created: started - 580, ports: ['0.0.0.0:8080->8080/tcp'], cpu_pct: r1(usage * 0.07), mem_bytes: 131072000, mem_limit_bytes: TOTAL_RAM, mem_pct: 1.6 },
            { id: 'a73f0b2c9d41', name: 'mosquitto', image: 'eclipse-mosquitto:2.0', state: 'paused', status: `${up(started)} (Paused)`, health: null, created: started - 560, ports: ['0.0.0.0:1883->1883/tcp'], cpu_pct: null, mem_bytes: null, mem_limit_bytes: null, mem_pct: null },
            { id: '4b9d2a6e1f07', name: 'alpine-test', image: 'alpine:latest', state: 'exited', status: 'Exited (0) 2 days ago', health: null, created: 1790270000, ports: [], cpu_pct: null, mem_bytes: null, mem_limit_bytes: null, mem_pct: null },
          ],
        }
      : { available: false, error: 'permission denied: /var/run/docker.sock (add the service user to the docker group)' }
    m.tailscale = {
      available: true,
      backend_state: 'Running',
      version: '1.102.4',
      self: { hostname: 'raspberrypi', dns_name: 'raspberrypi.example-tailnet.ts.net', ips: ['100.106.106.35', 'fd7a:115c:a1e0::ce2d:6a24'], online: true, relay: 'fra', key_expiry: BOOT + 173 * 86400 },
      summary: { peers: 3, online: 2 },
      peers: [
        { hostname: 'omarchy', dns_name: 'omarchy.example-tailnet.ts.net', os: 'linux', ips: ['100.77.59.21', 'fd7a:115c:a1e0::af35:3b16'], online: true, connection: 'direct', relay: 'fra', rx_bytes: Math.round(sim.peers.omarchy[0]), tx_bytes: Math.round(sim.peers.omarchy[1]), last_seen: null, exit_node: false },
        { hostname: 'cosmin-iphone', dns_name: 'cosmin-iphone.example-tailnet.ts.net', os: 'iOS', ips: ['100.92.14.60'], online: true, connection: 'relay', relay: 'fra', rx_bytes: Math.round(sim.peers['cosmin-iphone'][0]), tx_bytes: Math.round(sim.peers['cosmin-iphone'][1]), last_seen: null, exit_node: false },
        { hostname: 'Cosmins-MacBook-Pro', dns_name: 'cosmins-macbook-pro.example-tailnet.ts.net', os: 'macOS', ips: ['100.85.185.115'], online: false, connection: 'offline', relay: 'fra', rx_bytes: 0, tx_bytes: 0, last_seen: Math.floor(now0 - 5400), exit_node: false },
      ],
    }
  }
  return m
}

// History ring: 600 one-second samples, columns aligned with ts.
const SERIES = {
  cpu_pct: (m) => m.cpu.usage_pct,
  cpu_freq_mhz: (m) => m.cpu.freq_mhz,
  load_1m: (m) => m.cpu.load_avg[0],
  soc_temp_c: (m) => m.temps.soc_c,
  nvme_temp_c: (m) => m.temps.nvme_c,
  fan_rpm: (m) => m.fan.rpm,
  fan_pct: (m) => m.fan.speed_pct,
  mem_used_pct: (m) => m.memory.ram.used_pct,
  swap_used_pct: (m) => m.memory.swap.used_pct,
  disk_read_bytes_per_s: (m) => m.disks.total.read_bytes_per_s,
  disk_write_bytes_per_s: (m) => m.disks.total.write_bytes_per_s,
  net_rx_bytes_per_s: (m) => m.network.total.rx_bytes_per_s,
  net_tx_bytes_per_s: (m) => m.network.total.tx_bytes_per_s,
  pmic_w: (m) => m.power.pmic_w,
}
const ring = { ts: [], series: Object.fromEntries(Object.keys(SERIES).map((k) => [k, []])), net: {} }
function record(m) {
  ring.ts.push(m.ts)
  for (const k in SERIES) ring.series[k].push(SERIES[k](m))
  for (const i of m.network.interfaces) {
    const n = (ring.net[i.name] ||= { rx_bytes_per_s: [], tx_bytes_per_s: [] })
    n.rx_bytes_per_s.push(i.rx_bytes_per_s)
    n.tx_bytes_per_s.push(i.tx_bytes_per_s)
  }
  if (ring.ts.length > 600) {
    ring.ts.shift()
    for (const k in ring.series) ring.series[k].shift()
    for (const k in ring.net) {
      ring.net[k].rx_bytes_per_s.shift()
      ring.net[k].tx_bytes_per_s.shift()
    }
  }
}
const history = (seconds = 600) => {
  const n = Math.min(ring.ts.length, Math.max(1, seconds))
  const cut = (a) => a.slice(-n)
  return {
    interval_s: 1,
    ts: cut(ring.ts),
    series: Object.fromEntries(Object.entries(ring.series).map(([k, a]) => [k, cut(a)])),
    net: Object.fromEntries(Object.entries(ring.net).map(([k, v]) => [k, { rx_bytes_per_s: cut(v.rx_bytes_per_s), tx_bytes_per_s: cut(v.tx_bytes_per_s) }])),
  }
}

// ------------------------------------------------------------------ transport

const sockets = new Set()
let started = false
let downUntil = 0
const SLOW = ['processes', 'power', 'services', 'docker', 'tailscale']

export function start() {
  if (started) return
  started = true
  const t0 = Math.floor(Date.now() / 1000)
  for (let t = t0 - 700; t < t0; t++) {
    tick(t + 0.512)
    if (t >= t0 - 600) record(sim.m)
  }
  const loop = () => {
    const t = Date.now() / 1000
    tick(t)
    record(sim.m)
    const sec = Math.floor(t)
    const data = { ts: sim.m.ts }
    for (const k of ['system', 'cpu', 'memory', 'temps', 'throttling', 'fan', 'disks', 'network']) data[k] = sim.m[k]
    if (sec % 3 === 0) data.processes = sim.m.processes
    if (sec % 5 === 0) for (const k of SLOW.slice(1)) data[k] = sim.m[k]
    send({ type: 'metrics', data })
    setTimeout(loop, 1000 - (Date.now() % 1000) + 512)
  }
  setTimeout(loop, 1000 - (Date.now() % 1000) + 512)
}

function send(msg) {
  if (hung()) return // the open socket goes silent; net.js's 5 s watchdog drops it
  const s = JSON.stringify(msg)
  for (const sock of sockets) sock.onmessage?.({ data: s })
}

/** A WebSocket look-alike: hello → fan_profiles → history → full metrics, then the 1 Hz stream. */
export function socket() {
  const sock = {
    onmessage: null,
    onclose: null,
    onerror: null,
    close() {
      sockets.delete(sock)
    },
  }
  setTimeout(() => {
    if (hung()) return // no hello and no close: the handshake hangs until net.js's watchdog drops it
    if (Date.now() < downUntil) {
      sock.onclose?.({})
      return
    }
    const one = (type, data) => sock.onmessage?.({ data: JSON.stringify({ type, data }) })
    one('hello', info())
    one('fan_profiles', fanProfiles())
    one('history', history())
    one('metrics', structuredClone(sim.m))
    sockets.add(sock)
    if (opt.flaky)
      setTimeout(() => {
        if (!sockets.has(sock)) return
        sockets.delete(sock)
        downUntil = Date.now() + 6000
        sock.onclose?.({})
      }, 25000)
  }, 220)
  return sock
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const err = (status, error, message) => json(status, { error, message })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Sign-in and the system actions (docs/API.md "Auth", "System actions"), as `pidash --mock` does them: the session
// lasts until the page reloads, the update replays a short apt log, a reboot only clears the reboot flag.
let session = false
let rebootRequired = false
let job = { id: null, state: 'idle', exit_code: null, started_at: null, ended_at: null, log: '' }
const APT = `Hit:1 http://deb.debian.org/debian trixie InRelease
Get:2 http://deb.debian.org/debian trixie-updates InRelease [47.3 kB]
Get:3 http://deb.debian.org/debian-security trixie-security InRelease [43.4 kB]
Hit:4 http://archive.raspberrypi.com/debian trixie InRelease
Fetched 90.7 kB in 1s (84.2 kB/s)
Reading package lists...
Building dependency tree...
Reading state information...
Calculating upgrade...
The following packages will be upgraded:
  libssl3t64 openssl raspi-firmware
3 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Need to get 14.1 MB of archives.
Get:1 http://deb.debian.org/debian-security trixie-security/main arm64 libssl3t64 arm64 3.5.1-1+deb13u1 [2262 kB]
Get:2 http://deb.debian.org/debian-security trixie-security/main arm64 openssl arm64 3.5.1-1+deb13u1 [1493 kB]
Get:3 http://archive.raspberrypi.com/debian trixie/main arm64 raspi-firmware all 1:1.20260915-1 [10.2 MB]
Fetched 14.1 MB in 3s (4870 kB/s)
Unpacking libssl3t64:arm64 (3.5.1-1+deb13u1) over (3.5.1-1) ...
Unpacking openssl (3.5.1-1+deb13u1) over (3.5.1-1) ...
Unpacking raspi-firmware (1:1.20260915-1) over (1:1.20250915-1) ...
Setting up libssl3t64:arm64 (3.5.1-1+deb13u1) ...
Setting up openssl (3.5.1-1+deb13u1) ...
Setting up raspi-firmware (1:1.20260915-1) ...
Processing triggers for libc-bin (2.41-12) ...
`
function runUpdate() {
  const t = Math.floor(Date.now() / 1000)
  job = { id: Math.random().toString(16).slice(2), state: 'running', exit_code: null, started_at: t, ended_at: null, log: '' }
  const lines = APT.split(/(?<=\n)/)
  const next = () => {
    if (lines.length) {
      job.log += lines.shift()
      return setTimeout(next, 250)
    }
    Object.assign(job, { state: 'succeeded', exit_code: 0, ended_at: Math.floor(Date.now() / 1000) })
    rebootRequired = true
  }
  setTimeout(next, 400)
}

// Service logs, made up as `pidash --mock` does: start lines, a failure for the failed unit, and a line every 5 s
// while a unit runs. Cursors are "i=<index in hex>", with journalctl's paging: the last `lines`, or the first after one.
const LOG_LINES = [[6, 'accepted connection from 100.77.59.21'], [7, 'cache hit ratio 0.93'], [6, 'health check ok'], [5, 'configuration reloaded'], [4, 'slow response from upstream (1.2 s)'], [6, 'request served in 12 ms'], [3, 'connection reset by peer']]
function unitLog(u, lines, after) {
  const short = u.name.replace(/\.service$/, '')
  const head = [[BOOT + 14, 6, 'systemd', `Starting ${u.name} - ${u.description}...`], [BOOT + 15, 6, 'systemd', `Started ${u.name} - ${u.description}.`]]
  if (u.active === 'failed')
    head.push(
      [BOOT + 16, 3, short, 'Fatal: unable to open config file: stat /mnt/nas/restic: no such file or directory'],
      [BOOT + 16, 5, 'systemd', `${u.name}: Main process exited, code=exited, status=1/FAILURE`],
      [BOOT + 16, 4, 'systemd', `${u.name}: Failed with result 'exit-code'.`],
    )
  else if (u.active === 'inactive') head.push([BOOT + 16, 6, 'systemd', `${u.name}: Deactivated successfully.`])
  const n = head.length + (u.sub === 'running' ? Math.floor((Date.now() / 1000 - BOOT - 20) / 5) : 0)
  const entry = (i) => {
    let ts, priority, ident, message
    if (i < head.length) [ts, priority, ident, message] = head[i]
    else {
      const k = i - head.length
      ;[priority, message] = LOG_LINES[(k * 5) % LOG_LINES.length]
      ;[ts, ident] = [BOOT + 20 + k * 5, short]
    }
    return { ts, priority, ident, pid: ident === 'systemd' ? 1 : 1042, message }
  }
  const first = after ? parseInt(after.split('=')[1], 16) + 1 : Math.max(0, n - lines)
  const last = Math.min(n, first + lines)
  const entries = []
  for (let i = first; i < last; i++) entries.push(entry(i))
  return { unit: u.name, entries, cursor: last > first ? `i=${(last - 1).toString(16)}` : (after ?? null) }
}

export async function fetch(path, init = {}) {
  await sleep(160 + Math.random() * 180)
  if (hung()) throw new TypeError('Failed to fetch') // what the browser's fetch throws; net.js api() makes it its network error
  const url = new URL(path, location.origin)
  const method = (init.method || 'GET').toUpperCase()
  const authed = () => {
    if (!opt.auth) return err(403, 'auth_not_configured', 'set PIDASH_TOKEN on the server to enable changes')
    if (!session) return err(401, 'unauthorized', 'missing or invalid bearer token')
    return null
  }
  const body = () => {
    try {
      return JSON.parse(init.body)
    } catch {
      return null
    }
  }
  const put = (profile) => {
    send({ type: 'fan_profiles', data: fanProfiles() })
    return json(200, { active, applied: !opt.fanKernel && (profile.id !== 'custom' || nightState(active, night, skip).profile === 'custom'), reboot_required: false, profile: structuredClone(profile) })
  }
  switch (`${method} ${url.pathname}`) {
    case 'GET /api/info':
      return json(200, info())
    case 'GET /api/metrics':
      return json(200, sim.m)
    case 'GET /api/history':
      return json(200, history(Number(url.searchParams.get('seconds')) || 600))
    case 'GET /api/auth':
      return authed() || json(200, { authenticated: true })
    case 'GET /api/fan':
      return json(200, sim.m.fan)
    case 'GET /api/fan/profiles':
      return json(200, fanProfiles())
    case 'GET /api/fan/profile':
      return json(200, profileById(active))
    case 'PUT /api/fan/profile': {
      const denied = authed()
      if (denied) return denied
      const b = body()
      if (!b || typeof b.id !== 'string') return err(422, 'invalid_request', 'body must be {"id": "<profile id>"}')
      const p = profileById(b.id)
      if (!p) return err(422, 'unknown_profile', `no profile '${b.id}'`)
      active = p.id
      // a pick inside tonight's window applies now and pauses the schedule until its next start
      skip = night.enabled ? nightBegan(night, new Date()) : null
      return put(p)
    }
    case 'PUT /api/fan/profiles/custom': {
      const denied = authed()
      if (denied) return denied
      const b = body()
      if (!b || !Array.isArray(b.points)) return err(422, 'invalid_request', 'body must have hysteresis_c and points')
      const problem = validateCurve(b, DEFAULT_CONSTRAINTS)
      if (problem) return err(422, 'invalid_curve', problem)
      const custom = profileById('custom')
      custom.hysteresis_c = b.hysteresis_c
      custom.points = b.points.map((p) => ({ temp_c: p.temp_c, speed_pct: p.speed_pct }))
      return put(custom)
    }
    case 'PUT /api/fan/night': {
      const denied = authed()
      if (denied) return denied
      const b = body()
      const problem = validateNight(b, PROFILES.map((p) => p.id))
      if (problem) return err(422, problem.code, problem.message)
      night = { enabled: b.enabled, profile: b.profile, start: b.start, end: b.end }
      skip = null // any change ends tonight's pause: the same settings again = resume
      send({ type: 'fan_profiles', data: fanProfiles() })
      return json(200, { night, ...nightState(active, night, skip) })
    }
    case 'POST /api/auth/login': {
      if (!opt.auth) return err(403, 'auth_not_configured', 'set PIDASH_TOKEN on the server to enable changes')
      if (body()?.token !== TOKEN) return err(401, 'unauthorized', 'wrong token')
      session = true
      return json(200, { authenticated: true, expires: Math.floor(Date.now() / 1000) + 7 * 86400 })
    }
    case 'POST /api/auth/logout':
      session = false
      return json(200, { authenticated: false })
    case 'GET /api/system/update': {
      const denied = authed()
      if (denied) return denied
      const from = Math.min(Number(url.searchParams.get('offset')) || 0, job.log.length)
      return json(200, { ...job, log: job.log.slice(from), offset: job.log.length, reboot_required: rebootRequired })
    }
    case 'POST /api/system/update': {
      const denied = authed()
      if (denied) return denied
      if (job.state === 'running') return err(409, 'update_running', 'an update is already running')
      runUpdate()
      return json(202, { ...job, offset: 0, reboot_required: rebootRequired })
    }
    case 'POST /api/system/reboot': {
      const denied = authed()
      if (denied) return denied
      if (job.state === 'running') return err(409, 'update_running', 'an update is running: reboot once it has finished')
      rebootRequired = false
      return json(202, { rebooting: true })
    }
    case 'POST /api/system/shutdown': {
      const denied = authed()
      if (denied) return denied
      if (job.state === 'running') return err(409, 'update_running', 'an update is running: shut down once it has finished')
      return json(202, { shutting_down: true })
    }
    default: {
      const logs = /^GET \/api\/services\/([^/]+)\/logs$/.exec(`${method} ${url.pathname}`)?.[1]
      if (logs) {
        const denied = authed()
        if (denied) return denied
        const unit = UNITS.find((u) => u.name === decodeURIComponent(logs))
        if (!unit) return err(404, 'unknown_service', `no service '${decodeURIComponent(logs)}' in the services list`)
        return json(200, unitLog(unit, Number(url.searchParams.get('lines')) || 200, url.searchParams.get('after')))
      }
      const name = /^POST \/api\/services\/([^/]+)\/restart$/.exec(`${method} ${url.pathname}`)?.[1]
      if (name) {
        const denied = authed()
        if (denied) return denied
        const unit = UNITS.find((u) => u.name === decodeURIComponent(name))
        if (!unit) return err(404, 'unknown_service', `no service '${decodeURIComponent(name)}' in the services list`)
        await sleep(900) // a restart takes a moment: long enough to see the row's spinner
        if (unit.active === 'active') unit.active_since = Math.floor(Date.now() / 1000)
        return json(unit.name === 'pidash.service' ? 202 : 200, { ...unit })
      }
      return err(404, 'not_found', `no route ${method} ${url.pathname}`)
    }
  }
}

export const DEMO_TOKEN = TOKEN
export const GIB = GiB
