# Pi recon: `cosmin-pi` (Raspberry Pi 5)

Read-only inspection over Tailscale on 2026-09-26. Nothing on the Pi was changed. The only side
effect was a 60 s CPU load (`yes` × 4) to watch the fan react.

## At a glance

| | |
|---|---|
| Board | Raspberry Pi 5 Model B Rev 1.0 (`d04170`), 8 GB RAM |
| CPU | 4 × Cortex-A76, 1.5–2.4 GHz in 100 MHz steps. One cpufreq policy (`policy0`) for all cores, governor `ondemand` |
| OS | Raspberry Pi OS 64-bit on **Debian 13 trixie** (13.7), not Bookworm. systemd 257, Python 3.13.5, `python3-venv` and `python3-psutil` 7.0 installed, **no Node.js**, no `uv` |
| Kernel | `6.18.50+rpt-rpi-2712` (aarch64). Bootloader EEPROM 2026-09-12 (latest) |
| Hostname | `cosmin-pi` (Linux). Tailscale machine name: `raspberrypi` |
| Tailscale | 1.102.4, `100.106.106.35` / `fd7a:115c:a1e0::ce2d:6a24`, MagicDNS `raspberrypi` = `raspberrypi.<tailnet>.ts.net` |
| Storage | WD Blue SN580 1 TB NVMe, PCIe Gen 2 ×1 (5 GT/s, deliberately; the drive can do Gen 4 ×4) |
| Swap | 2 GB zram (`/dev/zram0`) |
| Network | `wlan0` up (Wi-Fi, −50 dBm), `eth0` down, `tailscale0`, `docker0` (down) |
| Power supply | 5 A negotiated (`/proc/device-tree/chosen/power/max_current` = 5000, `usb_max_current_enable=1`) |
| Desktop | lightdm plus a Raspberry Pi Connect/wayvnc session is running (about 700 MB RAM used at idle) |
| Listening | `:22` ssh, `:111` rpcbind, Tailscale. **Port 8787 is free**, so the dashboard uses it |
| Firewall | No `ufw`. `nft`/`iptables` are installed, but the ruleset wasn't inspected (that needs root) |

**Reaching the Pi from later tasks:** `ssh cosmin@100.106.106.35` (or `cosmin@raspberrypi`).
- Only password auth works from the desktop today. The desktop key isn't in `authorized_keys`.
- The password is the sudo password from task t_f223b99e. sudo prompts for it; there is no NOPASSWD.
- Non-interactive use that worked: `SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=force`, with a `ControlMaster` socket so the password is sent once.
- Feed scripts on stdin (`ssh … bash -s < script.sh`) so no files land on the Pi.

## Tailscale

```
100.106.106.35  raspberrypi          linux  -
100.77.59.21    omarchy              linux  active; direct <lan-ip>:41641   <- this desktop
100.85.185.115  cosmins-macbook-pro  macOS  offline
```

- The desktop reaches the Pi **directly** over the LAN, not through a DERP relay.
- `/var/run/tailscale/tailscaled.sock` is `0666`, so `tailscale status --json` works as any user (9 ms).
- Fields the dashboard uses: `.Self.{HostName,DNSName,TailscaleIPs,Online,Relay,KeyExpiry}`, `.BackendState`, `.Version`, and `.Peer[].{HostName,DNSName,OS,TailscaleIPs,Online,Active,CurAddr,Relay,RxBytes,TxBytes,LastSeen,ExitNode}`.
- **HTTPS certificates are not enabled for the tailnet** (`CertDomains` is null). `tailscale serve` over HTTPS needs them switched on in the admin console. Plain HTTP over the tailnet works as is.
- `tailscale serve`: no config. Funnel: off. Tailscale SSH: off.

## Docker

- **Installed:** Docker CE 29.8.1 (Engine API 1.56) + containerd, cgroup v2, `overlayfs`. The `memory` controller is enabled (`cgroup_enable=memory` on the cmdline), so per-container memory stats work.
- **Containers: none**, neither running nor stopped. Images: `alpine`, `hello-world`.
  - The UI must handle "Docker present, zero containers" separately from "Docker absent".
- The socket `/var/run/docker.sock` is `root:docker 0660`. Reading it needs the `docker` group, which is **root-equivalent**.
- Engine API over the socket: 12 ms for `GET /containers/json?all=1`.

## systemd

- `list-units --all` shows 158 service units: 139 `loaded`, and 19 `not-found` (referenced but not installed).
  - Of those: **25 running**, 33 exited, 100 inactive/dead, **0 failed**.
  - There are 235 service unit files.
- `systemctl list-units --type=service --all --output=json` works unprivileged (13 ms). It returns `unit`, `load`, `active`, `sub`, `description`.
- `systemctl list-unit-files --type=service --output=json` adds the enabled state (`state`, `preset`).
- Running: accounts-daemon, avahi-daemon, bluetooth, containerd, cron, dbus, docker, getty@tty1, lightdm, NetworkManager, nfs-blkmap, polkit, rpcbind, serial-getty@ttyAMA10, ssh, systemd-journald, systemd-logind, systemd-timesyncd, systemd-udevd, tailscaled, udisks2, unattended-upgrades, user@1000, wpa_supplicant.
- User services (desktop session): pipewire, wireplumber, rpi-connect, rpi-connect-wayvnc, xdg-desktop-portal*, gvfs*.
- Existing custom tools from the config repo: `/usr/local/bin/pi-fan` (fan status), `pi-thermal-test` (load test) and `pi-help`. The dashboard doesn't depend on them.

## Storage

```
NAME        MODEL               SIZE TYPE FSTYPE MOUNTPOINTS
nvme0n1     WD Blue SN580 1TB 931.5G disk
├─nvme0n1p1                     512M part vfat   /boot/firmware   (505M, 16 % used)
├─nvme0n1p2                     850G part ext4   /                (837G, 2 % used, noatime)
└─nvme0n1p3                      81G part ext4   (not mounted: restore-image copy)
zram0                             2G disk swap   [SWAP]
```

- NVMe firmware `281010WD`. PCIe link `5.0 GT/s x1` (device max `16.0 GT/s x4`).
- `nvme-cli` and `smartctl` are **not installed**, and `/dev/nvme0` is root-only.
  - For temperature, use the kernel hwmon device `nvme` instead: no root and no extra packages.
- `psutil.disk_io_counters(perdisk=True)` also lists partitions, loop*, ram* and zram0. Keep `nvme0n1` only.

## Sensors

| Metric | Source | Access | Idle sample | Cost |
|---|---|---|---|---|
| SoC temp | `/sys/class/thermal/thermal_zone0/temp` (`cpu-thermal`; same sensor as hwmon `cpu_thermal` and `vcgencmd measure_temp`) | anyone | 41–45 °C, 0.55 °C steps, ±0.5 °C noise | sysfs |
| NVMe temp | hwmon `nvme`: `temp1_input` Composite, `temp2/3` Sensor 1/2 | anyone | 35.9 / 42.9 / 35.9 °C. `temp1_max` 83.85, `temp1_crit` 87.85 | sysfs |
| RP1 temp | hwmon `rp1_adc` `temp1_input` | anyone | 49.7 °C | sysfs |
| PMIC temp | `vcgencmd measure_temp pmic` | `video` group | 48.2 °C | ~10 ms |
| Throttling | `vcgencmd get_throttled` | `video` | `0x0` | 1 ms |
| Under-voltage alarm | hwmon `rpi_volt` `in0_lcrit_alarm` | anyone | 0 | sysfs |
| ARM clock | `cpufreq/policy0/scaling_cur_freq` (or `vcgencmd measure_clock arm`) | anyone (`video`) | 1500 MHz | sysfs (11 ms) |
| Rails V/A/W | `vcgencmd pmic_read_adc`: 12 rails with V + A, `EXT5V_V` input voltage, no input current | `video` | rail sum ≈ 1.9 W; VDD_CORE 0.72 V × 0.96 A; EXT5V 5.11 V | 23 ms |
| Fan | hwmon `pwmfan` `fan1_input` (rpm), `pwm1` (0–255) | anyone (read) | 0 rpm, pwm 0 | sysfs |
| Wi-Fi signal | `/proc/net/wireless` | anyone | −50 dBm | procfs |
| CPU/mem/disk/net/procs | psutil 7.0 | anyone | 199 processes, 365 threads | — |

- **hwmon numbers aren't stable.** Today they are hwmon0 `cpu_thermal`, 1 `nvme`, 2 `rp1_adc`, 3 `pwmfan`, 4 `rpi_volt`, but `pwm_fan` is a module. Look the devices up by `name`.
- **vcgencmd** opens `/dev/vcio_gencmd` (confirmed with strace), which is `root:video 0660`. The service user needs the `video` group. `/dev/vcio` itself is root-only and not needed.
- `psutil.sensors_temperatures()` returns `cpu_thermal`, `nvme` (3 sensors) and `rp1_adc`. `psutil.sensors_fans()` returns `pwmfan`.
- lm-sensors (`sensors`) is not installed. It isn't needed.
- **Throttle bits:**

  | Meaning | Bit, now | Bit, since boot |
  |---|---|---|
  | under-voltage | 0 | 16 |
  | ARM frequency capped | 1 | 17 |
  | throttled | 2 | 18 |
  | soft temperature limit | 3 | 19 |

- **Firmware throttling:** the ARM throttles from **80 °C** and the GPU too from 85 °C. The Linux critical trip is 110 °C.
- **The "power" metric is the sum of the PMIC rails.** It leaves out loads fed straight from the 5 V input (USB, the PCIe/NVMe board), so it reads below wall power.

## Fan control (Argon NEO 5): how it actually works

### Hardware and driver

- The NEO 5's 30 mm PWM blower plugs into the **Pi 5 FAN header**.
- **No Argon software or hardware is in the loop:**
  - No Argon daemon, package, service, unit file or script is installed (checked `/etc`, `/usr/local`, `/opt`, `dpkg`, unit files).
  - No I²C fan MCU exists. That is an Argon ONE feature, and the GPIO I²C bus isn't even enabled.
  - Argon's own guidance for the NEO 5 is the `config.txt` dtparams below. The user's config repo `raspberrypi/argon-neo5-fan` documents this with sources.
- **Driver:** the kernel `pwm_fan` module, loaded from the device-tree node `/cooling_fan` (`compatible = "pwm-fan"`, status `okay`).
  - PWM comes from RP1: `pwms = <&rp1_pwm1 3 41566 PWM_POLARITY_INVERTED>`, about 24 kHz.
  - RPM comes from an RP1 register (`rpm-regmap`, `rpm-offset = 0x3c`), not from a tach IRQ.
  - hwmon `pwmfan` exposes `pwm1` (0–255, root 0644), `pwm1_enable` = 1 and `fan1_input`.
- **Thermal wiring:**
  - The driver registers as thermal `cooling_device0` (type `pwm-fan`, states 0–4), with `cooling-levels = <0 75 125 175 250>`. That is the PWM for each state, taken from the `fan_temp*_speed` dtparams.
  - It is bound to `thermal_zone0` (`cpu-thermal`), which polls every 1 s.
  - The governor is `step_wise`, the only one compiled in (`CONFIG_THERMAL_GOV_USER_SPACE`, `BANG_BANG` and `FAIR_SHARE` are not set).

Trip points, from the `fan_temp*` dtparams in `/boot/firmware/config.txt`:

| sysfs trip | DT node | type | temp | hyst | → cooling state → PWM |
|---|---|---|---|---|---|
| `trip_point_0` | cpu-crit | critical | 110 °C | 0 | kernel emergency shutdown (step_wise ignores critical trips) |
| `trip_point_1` | cpu-tepid | active | 55 °C | 5 °C | 1 → 75 (29 %) |
| `trip_point_2` | cpu-warm | active | 63 °C | 5 °C | 2 → 125 (49 %) |
| `trip_point_3` | cpu-hot | active | 70 °C | 5 °C | 3 → 175 (69 %) |
| `trip_point_4` | cpu-vhot | active | 75 °C | 5 °C | 4 → 250 (98 %) |

The Raspberry Pi defaults, without these dtparams, would be 50 / 60 / 67.5 / 75 °C.

The `config.txt` block is owned by the user's config repo and written by its `install.sh`:

```
# >>> argon-neo5-fan (config repo: raspberrypi/argon-neo5-fan) >>>
dtparam=nvme
dtparam=fan_temp0=55000
dtparam=fan_temp0_hyst=5000
dtparam=fan_temp0_speed=75
... fan_temp1 63000/5000/125, fan_temp2 70000/5000/175, fan_temp3 75000/5000/250
# <<< argon-neo5-fan <<<
```

### Observed on the hardware

60 s all-core load, sampled every 3 s:

```
  0s  43.0 °C  state 0  pwm 0    0 rpm
 43s  55.1 °C  state 0  pwm 0    0 rpm
 49s  54.6 °C  state 1  pwm 75   2775 rpm   <- step_wise engaged state 1 at the 55 °C trip
 64s  55.1 °C  state 1  pwm 75   2878 rpm   (load stopped)
 +5s  49.6 °C  state 0  pwm 0    0 rpm      <- off again below 50 °C (55 − 5 hyst)
```

- **The tach works.**
- **Speeds at each PWM** (from the config repo's 10-minute stress test, 2026-09-25):
  - pwm 75 ≈ 2.8–3.3 k rpm.
  - pwm 125 ≈ 5.2–5.8 k rpm.
  - Peak SoC 69.4 °C, no throttling.
- **Not measured yet** (both need a pwm write): RPM at pwm 255, and the lowest PWM that starts the fan from standstill. The DT sets no `fan-stop-to-start-percent`, so there is no kick-start.

### Can the fan curve change at runtime?

**Yes.** The kernel lets you move the trip temperatures at runtime. Custom speeds need a userspace loop with the governor released. These findings come from the [rpi-6.18.y kernel source](https://github.com/raspberrypi/linux/tree/rpi-6.18.y/drivers/thermal) and the sysfs modes on this Pi:

| Knob | Runtime-writable? | Evidence |
|---|---|---|
| `thermal_zone0/trip_point_{1..4}_temp` | **Yes** (root, 0644) | `thermal_of.c` flags every DT trip `THERMAL_TRIP_FLAG_RW_TEMP`, and `thermal_sysfs.c` only installs the store handler when that flag is set. `CONFIG_THERMAL_WRITABLE_TRIPS` no longer exists in 6.18 (it's absent from `/boot/config-*`), so the config repo's "trip points are read-only" pitfall is outdated. |
| `trip_point_*_hyst` | No (0444) | DT trips don't get `RW_HYST`, so hysteresis is fixed at boot (5 °C) |
| PWM per cooling state | No | `pwm-fan.c` reads `cooling-levels` once, at probe time |
| governor (`policy`) | No choice | `available_policies` = `step_wise` |
| `thermal_zone0/mode` | Yes (root, 0644) | `disabled` stops the whole zone, including the 110 °C critical trip |
| hwmon `pwm1` | Yes (root, 0644) | Any value 0–255, **but step_wise overrides it** (see below) |
| `cooling_device0/cur_state` | Yes (root, 0644) | Same as `pwm1`, limited to the 5 fixed levels |

**Why direct `pwm1` writes alone don't stick.**
- `gov_step_wise.c`, `get_target_state()`: when a trip isn't throttling and the trend is `DROPPING`, the instance target becomes `instance->lower` whenever `cur_state` is above it.
- **Changing a target marks the cooling device for update.** The governor then applies the highest target. On a falling-temperature poll that steps a manually written PWM at level ≥ 2 back down, one level per poll, while a level-1 PWM stays put. The outcome depends on the value and on the trend history.
- With the sensor's ±0.5 °C noise, a "dropping" trend happens every few seconds. So a userspace loop fighting the governor would produce a sawtooth.

**The options, compared:**

| Approach | Changes | Reboot | If the app dies |
|---|---|---|---|
| Write trip temps only (kernel keeps control) | *When* the four fixed speeds (29/49/69/98 %) engage. Not the speeds, not the hysteresis | No (lost at reboot) | Fine: the kernel keeps running the curve |
| **Userspace loop + governor released** | Everything: any points, any PWM 0–255, any hysteresis | No | Must hand back to the kernel (see the fail-safe below) |
| `config.txt` dtparams | Temps, speeds, hysteresis (4 steps) | **Yes** | n/a. But the user's config repo owns this block |

### Decision (the backend implements this)

**Mechanism: a userspace control loop in the backend. `config.txt` is never touched.**

1. **Profiles:** every profile (Silent, Balanced, Performance, Max, Custom) is a list of temperature → speed points. See docs/API.md for the curve rules. A 1 Hz loop writes hwmon `pwm1`.
2. **Releasing the governor:**
   - First save the current `trip_point_{1..4}_temp`.
   - Then write `THERMAL_TEMP_INVALID` (**-274000**) to each of them.
   - `trip_point_temp_store()` explicitly accepts that value, and `step_wise_manage()` skips invalid trips. The fan is then left alone while the **110 °C critical trip stays armed**.
   - Fallback if that misbehaves on hardware: `echo disabled > thermal_zone0/mode`. That drops the critical trip too, but the firmware's own 80/85 °C throttling is unaffected.
3. **Restoring:**
   - Write the saved trip temps back: 55000, 63000, 70000, 75000 today.
   - If the saved values are already invalid (for example after a crash), take them from `/proc/device-tree/thermal-zones/cpu-thermal/trips/cpu-{tepid,warm,hot,vhot}/temperature`, which hold the boot values.
   - After a restore, the kernel's config.txt curve takes over again.
4. **Fail-safe:**
   - On every stop or crash, restore the trips and set `pwm1=255`. The kernel then steps the fan down from full, one level per poll, as the temperature allows.
   - **The 255 is required, not just a precaution.** step_wise only moves the fan when some trip instance's target *changes*. From level 4 (pwm 255) that always happens, so the fan steps down one level per falling-temperature poll. If the fan is handed back at level 1 (pwm 1–124, including 75), no target changes at idle. The kernel then leaves it spinning until the SoC next crosses a trip.
   - The systemd unit does the same in `ExecStopPost=`, which runs after crashes too.
   - `WatchdogSec=` plus `sd_notify` pings from the loop catch a hung loop.
   - Inside the loop, SoC ≥ 80 °C or an unreadable temperature forces 100 % until the SoC drops below 75 °C.
   - Trip order in sysfs, as observed: `trip_point_0..4` = crit, tepid, warm, hot, vhot. This is *not* the `/proc/device-tree` readdir order, so match trips by temperature and type, not by DT node order.
5. **Start-up:** re-apply the saved profile every time the service starts. Trips reset to the config.txt values at every boot.
6. **Relationship to config.txt:** the config.txt curve stays the boot default, and the fallback whenever the dashboard isn't running. There is no `reboot_required` path on this Pi. The field stays in the API for a hypothetical config.txt fallback.

**Verify first on the hardware (backend task):**
- A trip write works (write the same value first as a no-op).
- `-274000` releases the governor, and `pwm1` holds for several minutes with the temperature wandering.
- Restore brings the kernel curve back.
- RPM at 255.
- The minimum start PWM.

### Privileges for the fan writes

All targets are `root:root 0644`: `pwm1`, `trip_point_{1..4}_temp`, `mode`. Options, from least to most code:

1. **udev rule (recommended).** Set group `pidash` + `g+w` on:
   - `pwm1` of the hwmon device named `pwmfan`
   - `trip_point_[1-4]_temp` (+ `mode`) of `thermal_zone0`

   The service then writes directly: no root process, no sudo. `ExecStopPost=` runs as the same user and can restore.
2. **sudoers entry for a single root helper** (`pidash-fan release|restore`), plus the udev rule for `pwm1`.
3. **A separate tiny root service** that owns the loop.

The backend task picks one and documents it.

## What the dashboard service needs

| Access | For | How |
|---|---|---|
| Nothing special | thermal/hwmon reads, `/proc`, psutil, `systemctl list-units`, Tailscale socket (0666) | — |
| `video` group | vcgencmd: throttling, PMIC temp, rails | add the service user to `video` |
| `docker` group | Docker panel (socket 0660). **Root-equivalent** | add it, or the panel reports `available: false` |
| Fan write access | `pwm1` + trip temps | udev rule (above) |

- Bind to `127.0.0.1` and publish it with `tailscale serve`, or bind the Tailscale IP.
  - Don't bind `0.0.0.0`: `wlan0` is on the home LAN, there is no ufw, and metric reads are unauthenticated.
- Node.js isn't on the Pi (trixie's apt has `nodejs` 20.19). Either ship a pre-built `frontend/dist` or install Node just for the build.
- `python3 -m venv` works, and PyPI is reachable from the Pi.
