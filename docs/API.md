# pidash API contract (v1)

The backend (`backend/`, FastAPI) and the frontend (`frontend/`, Vite) are built against this file in parallel.
- **Source of truth:** if the implementation has to deviate from this file, change this file in the same commit and note the change under [Deviations](#deviations).
- **Hardware background:** see [PI_RECON.md](PI_RECON.md). It covers the sensors, why each field exists, and the fan-control mechanism.

## Conventions

- **One process.** It serves everything on one port, default **8787**:
  - `/api/*`: REST (JSON) and the WebSocket at `/api/ws`
  - everything else: the built frontend (`frontend/dist`)
- **Same origin only.** No CORS headers are sent. In development, the Vite dev server proxies `/api` (see `frontend/vite.config.js`).
- **JSON.** Keys are `snake_case`. Requests with a body use `Content-Type: application/json`.
- **Units are in the key names:**
  - `_c` °C
  - `_pct` percent 0–100
  - `_bytes` bytes
  - `_bytes_per_s` bytes per second (**not** bits)
  - `_mhz`, `_rpm`, `_v`, `_a`, `_w`
  - `_s` seconds
- **Numbers:**
  - Temperatures are rounded to 0.1.
  - Percentages are rounded to 0.1. `cpu_pct` of processes and containers is a share of the **whole machine** (0–100 across all 4 cores), not per-core like `top`.
  - Rates and byte counts are integers.
- **Timestamps:** Unix epoch seconds, from the Pi's clock. `ts` and `server_time` have millisecond precision; every other timestamp is an integer.
- **Missing data:**
  - A value that can't be read is `null`. The frontend shows it as "—".
  - Sections with optional sources report `"available": false` with an `error` string, and all their other fields are omitted. These are `throttling`, `power`, `fan`, `docker`, `tailscale` and `services`.
  - If a collector crashes unexpectedly, its whole section is `null` and the error goes to the server log.
  - The app must run on a non-Pi dev machine.
- **Errors:** any 4xx/5xx response has the body `{"error": "<code>", "message": "<human readable>"}`.
  - Unknown `/api/*` routes → 404 `not_found`.
  - Malformed or wrongly typed request bodies → 422 `invalid_request`. This replaces FastAPI's default validation-error format.
- **Versioning:** `api_version` (currently `1`) in `/api/info` and in the WebSocket `hello`. Breaking changes bump it.

## Configuration

All settings are environment variables. On the Pi, the systemd unit loads them from `EnvironmentFile=` (the deploy task writes it, mode 0640).

| Variable | Default | Meaning |
|---|---|---|
| `PIDASH_TOKEN` | *(unset)* | Auth token for changes. When unset, every mutating endpoint returns 403 `auth_not_configured`. The installer generates a random value, `secrets.token_urlsafe(32)` |
| `PIDASH_HOST` | `127.0.0.1` | Bind address. See [Security notes](#security-notes) |
| `PIDASH_PORT` | `8787` | Port |
| `PIDASH_STATE_DIR` | `./state` | Where `fan.json` is persisted: active profile + custom curve. On the Pi: `/var/lib/pidash` |
| `PIDASH_FAN_CONTROL` | `1` | `0` = never write to the fan (read-only). The kernel's config.txt curve stays in charge; profile choices are saved but not applied |
| `PIDASH_MOCK` | `0` | `1` = mock mode, same as the `--mock` flag. See [Mock mode](#mock-mode) |
| `PIDASH_STATIC_DIR` | `frontend/dist` | Built frontend to serve |

CLI: `pidash [--host H] [--port P] [--mock]`. Flags override env vars.

## Auth

- **Scheme.** A single shared token, sent as `Authorization: Bearer <token>`. The server compares it in constant time.
- **Which endpoints need it.** Every mutating endpoint: `PUT /api/fan/profile` and `PUT /api/fan/profiles/custom`, plus any later POST, PUT, PATCH or DELETE.
  - Reads and the WebSocket are open to anyone who can reach the port. The port should only be reachable over the tailnet.
- **Login flow (frontend):**
  1. Show a "token" prompt. Call `GET /api/auth` with the token.
  2. On 200, store it in `localStorage["pidash.token"]`.
  3. On any 401 later, drop the stored token and prompt again.
  4. If `info.auth_configured` is false, disable the controls and say why.
- **No cookies.** The token travels in a header, so no CSRF defence is needed.
- **WebSocket Origin check.** A browser handshake whose `Origin` host:port doesn't match the request's `Host` (or `X-Forwarded-Host`) is refused with HTTP 403. This stops other websites from reading the stream. Clients that send no `Origin` (curl, scripts) are allowed.

Errors:

```text
401 {"error": "unauthorized", "message": "missing or invalid bearer token"}
403 {"error": "auth_not_configured", "message": "set PIDASH_TOKEN on the server to enable changes"}
```

## Endpoints

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/info` | – | Static facts about the host and server |
| GET | `/api/metrics` | – | Full snapshot, every section |
| GET | `/api/history?seconds=N` | – | Recent time series for charts (default and max: `info.history_s`) |
| GET | `/api/auth` | Bearer | `200 {"authenticated": true}` or 401/403 |
| GET | `/api/fan` | – | Live fan state (same object as the `fan` metrics section) |
| GET | `/api/fan/profiles` | – | All profiles, the active id and the curve constraints |
| GET | `/api/fan/profile` | – | The active profile |
| PUT | `/api/fan/profile` | Bearer | Switch the active profile |
| PUT | `/api/fan/profiles/custom` | Bearer | Replace the custom curve |
| WS | `/api/ws` | – (Origin check) | `hello`, `fan_profiles`, `history`, then a `metrics` stream |

### GET /api/info

```json
{
  "api_version": 1,
  "app_version": "0.1.0",
  "mock": false,
  "hostname": "cosmin-pi",
  "model": "Raspberry Pi 5 Model B Rev 1.0",
  "os": "Debian GNU/Linux 13 (trixie)",
  "kernel": "6.18.50+rpt-rpi-2712",
  "arch": "aarch64",
  "cpu": {"model": "Cortex-A76", "cores": 4, "min_mhz": 1500, "max_mhz": 2400},
  "memory_total_bytes": 8453947392,
  "boot_time": 1790358093,
  "server_time": 1790443200.512,
  "history_s": 600,
  "auth_configured": true,
  "limits": {
    "soc_throttle_c": 80,
    "soc_throttle_hard_c": 85,
    "nvme_warn_c": 83.8,
    "nvme_crit_c": 87.8,
    "fan_failsafe_c": 80,
    "fan_failsafe_release_c": 75
  }
}
```

- `limits` is for colouring gauges:
  - The firmware throttles the ARM from 80 °C, and the ARM and GPU from 85 °C.
  - The NVMe values come from the drive's own hwmon `temp1_max` and `temp1_crit`. They are `null` if unknown.
- `server_time` lets the frontend correct for clock skew when it shows "x s ago".

### GET /api/metrics

The full snapshot. The WebSocket `metrics` messages carry the **same object**, but only the sections refreshed on that tick (see [WebSocket](#websocket-apiws)).

- The Pi really runs **zero** Docker containers today. The example shows two to illustrate the shape.
- `processes.top_mem` and `services.units` are shortened here.

```json
{
  "ts": 1790443200.512,
  "system": {
    "uptime_s": 85107,
    "boot_time": 1790358093,
    "process_count": 201,
    "thread_count": 368
  },
  "cpu": {
    "usage_pct": 24.3,
    "per_core_pct": [31.0, 12.4, 44.8, 8.9],
    "times_pct": {"user": 17.6, "nice": 0.0, "system": 5.9, "iowait": 0.3, "irq": 0.0, "softirq": 0.5, "idle": 75.7},
    "freq_mhz": 2400,
    "governor": "ondemand",
    "load_avg": [1.21, 0.86, 0.52]
  },
  "memory": {
    "ram": {
      "total_bytes": 8453947392,
      "used_bytes": 1719488512,
      "available_bytes": 6734458880,
      "cached_bytes": 1272086528,
      "buffers_bytes": 100532224,
      "used_pct": 20.3
    },
    "swap": {"total_bytes": 2147467264, "used_bytes": 0, "used_pct": 0.0}
  },
  "temps": {
    "soc_c": 56.2,
    "nvme_c": 41.9,
    "rp1_c": 52.3,
    "pmic_c": 53.1
  },
  "throttling": {
    "available": true,
    "raw": "0x0",
    "now": {"under_voltage": false, "arm_freq_capped": false, "throttled": false, "soft_temp_limit": false},
    "since_boot": {"under_voltage": false, "arm_freq_capped": false, "throttled": false, "soft_temp_limit": false}
  },
  "power": {
    "available": true,
    "input_v": 5.108,
    "core_v": 0.855,
    "core_a": 2.902,
    "pmic_w": 3.71,
    "rails": [
      {"name": "VDD_CORE", "v": 0.855, "a": 2.902, "w": 2.482},
      {"name": "3V7_WL_SW", "v": 3.687, "a": 0.077, "w": 0.284},
      {"name": "0V8_SW", "v": 0.803, "a": 0.327, "w": 0.262},
      {"name": "1V8_SYS", "v": 1.797, "a": 0.124, "w": 0.223},
      {"name": "1V1_SYS", "v": 1.104, "a": 0.176, "w": 0.194},
      {"name": "3V3_SYS", "v": 3.295, "a": 0.047, "w": 0.154},
      {"name": "HDMI", "v": 5.124, "a": 0.017, "w": 0.089},
      {"name": "DDR_VDD2", "v": 1.108, "a": 0.008, "w": 0.009},
      {"name": "3V3_ADC", "v": 3.294, "a": 0.001, "w": 0.005},
      {"name": "0V8_AON", "v": 0.799, "a": 0.005, "w": 0.004},
      {"name": "3V3_DAC", "v": 3.301, "a": 0.001, "w": 0.004},
      {"name": "DDR_VDDQ", "v": 0.607, "a": 0.0, "w": 0.0}
    ]
  },
  "fan": {
    "available": true,
    "rpm": 3480,
    "pwm": 84,
    "speed_pct": 32.9,
    "mode": "curve",
    "profile": "balanced",
    "target_pct": 33.0,
    "control_temp_c": 56.2,
    "writable": true,
    "reboot_required": false
  },
  "disks": {
    "devices": [
      {
        "name": "nvme0n1",
        "model": "WD Blue SN580 1TB",
        "size_bytes": 1000204886016,
        "read_bytes_per_s": 0,
        "write_bytes_per_s": 45056,
        "read_iops": 0,
        "write_iops": 6,
        "busy_pct": 0.4
      }
    ],
    "total": {"read_bytes_per_s": 0, "write_bytes_per_s": 45056},
    "filesystems": [
      {"mount": "/", "device": "/dev/nvme0n1p2", "fstype": "ext4", "total_bytes": 898268385280, "used_bytes": 8738693120, "free_bytes": 852950233088, "used_pct": 1.0},
      {"mount": "/boot/firmware", "device": "/dev/nvme0n1p1", "fstype": "vfat", "total_bytes": 528592896, "used_bytes": 82630656, "free_bytes": 445962240, "used_pct": 15.6}
    ]
  },
  "network": {
    "interfaces": [
      {"name": "wlan0", "kind": "wifi", "up": true, "addresses": ["192.168.0.92"], "speed_mbps": null, "wifi_signal_dbm": -50,
       "rx_bytes_per_s": 5120, "tx_bytes_per_s": 8704, "rx_total_bytes": 16475278, "tx_total_bytes": 111434915},
      {"name": "tailscale0", "kind": "vpn", "up": true, "addresses": ["100.106.106.35", "fd7a:115c:a1e0::ce2d:6a24"], "speed_mbps": null, "wifi_signal_dbm": null,
       "rx_bytes_per_s": 1210, "tx_bytes_per_s": 6620, "rx_total_bytes": 917882, "tx_total_bytes": 101187744},
      {"name": "eth0", "kind": "ethernet", "up": false, "addresses": [], "speed_mbps": null, "wifi_signal_dbm": null,
       "rx_bytes_per_s": 0, "tx_bytes_per_s": 0, "rx_total_bytes": 0, "tx_total_bytes": 0},
      {"name": "docker0", "kind": "bridge", "up": false, "addresses": ["172.17.0.1"], "speed_mbps": null, "wifi_signal_dbm": null,
       "rx_bytes_per_s": 0, "tx_bytes_per_s": 0, "rx_total_bytes": 439, "tx_total_bytes": 220}
    ],
    "total": {"rx_bytes_per_s": 5120, "tx_bytes_per_s": 8704}
  },
  "processes": {
    "top_cpu": [
      {"pid": 3121, "name": "python3", "user": "root", "cpu_pct": 18.5, "mem_pct": 3.4, "rss_bytes": 287309824, "threads": 38, "command": "python3 -m homeassistant --config /config"},
      {"pid": 20931, "name": "python3", "user": "pidash", "cpu_pct": 2.4, "mem_pct": 0.6, "rss_bytes": 52428800, "threads": 6, "command": "/opt/pidash/venv/bin/python -m pidash"},
      {"pid": 1363, "name": "labwc", "user": "cosmin", "cpu_pct": 0.9, "mem_pct": 1.7, "rss_bytes": 142508032, "threads": 4, "command": "/usr/bin/labwc -m"},
      {"pid": 1259, "name": "tailscaled", "user": "root", "cpu_pct": 0.6, "mem_pct": 0.6, "rss_bytes": 51134464, "threads": 11, "command": "/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock --port=41641"},
      {"pid": 2008, "name": "dockerd", "user": "root", "cpu_pct": 0.4, "mem_pct": 1.1, "rss_bytes": 94617600, "threads": 11, "command": "/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock"}
    ],
    "top_mem": [
      {"pid": 3121, "name": "python3", "user": "root", "cpu_pct": 18.5, "mem_pct": 3.4, "rss_bytes": 287309824, "threads": 38, "command": "python3 -m homeassistant --config /config"},
      {"pid": 1363, "name": "labwc", "user": "cosmin", "cpu_pct": 0.9, "mem_pct": 1.7, "rss_bytes": 142508032, "threads": 4, "command": "/usr/bin/labwc -m"}
    ]
  },
  "services": {
    "available": true,
    "summary": {"total": 139, "active": 58, "running": 25, "failed": 0},
    "units": [
      {"name": "cloud-final.service", "description": "Cloud-init: Final Stage", "load": "loaded", "active": "active", "sub": "exited", "enabled": "enabled", "active_since": 1790358131, "memory_bytes": null},
      {"name": "docker.service", "description": "Docker Application Container Engine", "load": "loaded", "active": "active", "sub": "running", "enabled": "enabled", "active_since": 1790358113, "memory_bytes": 98304000},
      {"name": "ssh.service", "description": "OpenBSD Secure Shell server", "load": "loaded", "active": "active", "sub": "running", "enabled": "enabled", "active_since": 1790358110, "memory_bytes": 5767168},
      {"name": "tailscaled.service", "description": "Tailscale node agent", "load": "loaded", "active": "active", "sub": "running", "enabled": "enabled", "active_since": 1790358109, "memory_bytes": 60817408},
      {"name": "apt-daily.service", "description": "Daily apt download activities", "load": "loaded", "active": "inactive", "sub": "dead", "enabled": "static", "active_since": null, "memory_bytes": null}
    ]
  },
  "docker": {
    "available": true,
    "version": "29.8.1",
    "summary": {"total": 2, "running": 1, "paused": 0, "stopped": 1, "images": 2},
    "containers": [
      {"id": "8c1f0e7a2b3d", "name": "homeassistant", "image": "ghcr.io/home-assistant/home-assistant:stable",
       "state": "running", "status": "Up 3 hours (healthy)", "health": "healthy", "created": 1790431000,
       "ports": ["0.0.0.0:8123->8123/tcp"], "cpu_pct": 18.5, "mem_bytes": 312475648, "mem_limit_bytes": 8453947392, "mem_pct": 3.7},
      {"id": "4b9d2a6e1f07", "name": "alpine-test", "image": "alpine:latest",
       "state": "exited", "status": "Exited (0) 2 days ago", "health": null, "created": 1790270000,
       "ports": [], "cpu_pct": null, "mem_bytes": null, "mem_limit_bytes": null, "mem_pct": null}
    ]
  },
  "tailscale": {
    "available": true,
    "backend_state": "Running",
    "version": "1.102.4",
    "self": {"hostname": "raspberrypi", "dns_name": "raspberrypi.example-tailnet.ts.net", "ips": ["100.106.106.35", "fd7a:115c:a1e0::ce2d:6a24"],
             "online": true, "relay": "fra", "key_expiry": 1805895298},
    "summary": {"peers": 2, "online": 1},
    "peers": [
      {"hostname": "omarchy", "dns_name": "omarchy.example-tailnet.ts.net", "os": "linux", "ips": ["100.77.59.21", "fd7a:115c:a1e0::af35:3b16"],
       "online": true, "connection": "direct", "relay": "fra", "rx_bytes": 61708, "tx_bytes": 84708, "last_seen": null, "exit_node": false},
      {"hostname": "Cosmins-MacBook-Pro", "dns_name": "cosmins-macbook-pro.example-tailnet.ts.net", "os": "macOS", "ips": ["100.85.185.115"],
       "online": false, "connection": "offline", "relay": "fra", "rx_bytes": 0, "tx_bytes": 0, "last_seen": 1790442300, "exit_node": false}
    ]
  }
}
```

An unavailable section looks like this (two sections shown):

```text
"docker": {"available": false, "error": "permission denied: /var/run/docker.sock (add the service user to the docker group)"}
"fan":    {"available": false, "error": "no hwmon device named pwmfan"}
```

#### Field notes

Only the fields that aren't obvious from the example.

**`system`**
- `thread_count` is the total number of scheduling entities (the 4th field of `/proc/loadavg`).

**`cpu`**
- `usage_pct` = 100 − `times_pct.idle`.
- `freq_mhz`: all four cores share one clock on the Pi 5 (one cpufreq policy), so frequency is a single value. It is not per core.

**`memory`**
- `used_bytes` = `total_bytes` − `available_bytes`. This is what "used" means in `free` and in `used_pct`.
- Swap is 2 GB of zram, i.e. compressed RAM, not disk.

**`temps`**
- `soc_c` comes from the `cpu-thermal` zone. The fan curve uses it.
- `nvme_c` is the drive's "Composite" temperature (hwmon `nvme`).
- `rp1_c` is the RP1 I/O chip (hwmon `rp1_adc`).
- `pmic_c` is the power-management IC, from vcgencmd. It can lag up to 5 s.

**`throttling`**
- `raw` is `vcgencmd get_throttled` as printed.
- `now` = bits 0–3: under-voltage, ARM frequency capped, throttled, soft temperature limit. `since_boot` = the same flags in bits 16–19.
- Example: `"0x50005"` → `now.under_voltage`, `now.throttled`, `since_boot.under_voltage` and `since_boot.throttled` are all true.
- Show under-voltage prominently. It means the power supply is inadequate.

**`power`**
- Source: `vcgencmd pmic_read_adc`.
- `input_v` is the 5 V input (`EXT5V_V`). `core_v` and `core_a` are the `VDD_CORE` rail.
- `rails` is sorted by `w`, highest first. Each rail's `w` is computed from the unrounded readings and rounded to 3 decimals.
- `pmic_w` is the sum of all rail powers, rounded to 2 decimals. It **excludes** loads fed straight from 5 V (USB devices, the NVMe board), so it is lower than wall power. Label it "SoC power" or similar, not "total power".

**`fan`**
- `pwm` is the live hwmon `pwm1` value (0–255); `speed_pct` = `pwm` × 100 / 255.
- `rpm` is measured by the tach. It is 0 when the fan is stopped.
- `mode`:
  - `"curve"`: the dashboard's control loop is applying `profile`.
  - `"failsafe"`: forced to 100 %, because the SoC is at or above `limits.fan_failsafe_c` or its temperature is unreadable. It stays forced until the SoC drops below `limits.fan_failsafe_release_c`.
  - `"kernel"`: the dashboard is not driving the fan (`PIDASH_FAN_CONTROL=0` or no write permission). The config.txt curve is in charge; `profile` is saved but not applied, and `target_pct` is null.
- `target_pct`: what the curve asks for right now, after hysteresis and the minimum-running clamp. The frontend can draw it as the live point on the curve at `control_temp_c`.
- `writable`: the backend has permission to drive the fan.
- `reboot_required`: always false with the runtime mechanism. It stays in the contract in case a config.txt path is ever added.

**`disks`**
- `devices`: whole disks only (`nvme*n*`, `sd?`, `mmcblk?`). Partitions, loop, ram and zram devices are excluded.
- `busy_pct` is the share of time with I/O in flight.
- `filesystems`: mounted real filesystems. `used_pct` matches `df`, which excludes the root-reserved blocks.

**`network`**
- `interfaces`: everything except `lo` and `veth*`.
- `kind` is one of `wifi`, `ethernet`, `vpn` (`tailscale*`, `wg*`, `tun*`), `bridge` (`docker*`, `br-*`) or `other`.
- `addresses`: IPv4 and global IPv6 only. Link-local addresses are dropped.
- `speed_mbps`: `null` when unknown.
- `wifi_signal_dbm`: only for Wi-Fi interfaces.
- `total`: the sum over `wifi` and `ethernet` interfaces only. Tailscale traffic is already inside those, so adding `tailscale0` would count it twice.

**`processes`**
- The top 10 processes by CPU and the top 10 by resident memory.
- `command` is the full command line, truncated to 200 characters. Kernel threads show as `[name]`.

**`services`**
- All `*.service` units that systemd has loaded; `not-found` units are dropped.
- `active` is one of `active`, `inactive`, `failed`, `activating`, `deactivating`, `reloading`.
- `sub` is the finer state: `running`, `exited`, `dead`, `failed`, `auto-restart`, …
- `enabled` comes from `list-unit-files`: `enabled`, `disabled`, `static`, `masked`, `indirect`, `alias`, `generated`, `transient`, or `null`.
- `active_since` and `memory_bytes` are only filled for units whose state is `active`.
- `units` order: failed first, then active, then the rest, alphabetical within each group.

**`docker`**
- `state` is one of `created`, `running`, `paused`, `restarting`, `removing`, `exited`, `dead`.
- `health` is `healthy`, `unhealthy`, `starting`, or `null` when the container has no healthcheck.
- `cpu_pct`, `mem_bytes`, `mem_limit_bytes` and `mem_pct` are only filled for running containers.
- `ports` uses `docker ps` notation.
- Zero containers (`"containers": []`) and "Docker absent" (`available: false`) are different states. Render them differently.

**`tailscale`**
- `version` is shortened to the release number.
- `connection`:
  - `offline`: the peer is not online.
  - `idle`: online, but no active session.
  - `direct`: an active session over a direct UDP path.
  - `relay`: an active session through a DERP relay.
- `last_seen` is `null` while the peer is connected.
- `key_expiry` is the node key expiry. Warn the user when it gets close.

### GET /api/history

This is the server's ring buffer: 1 sample per second for the last `info.history_s` seconds (600).
- It lets charts start full after a page load or a reconnect.
- The response has columns: every array is aligned with `ts`.
- A value that was missing at a given second is `null`.

```json
{
  "interval_s": 1,
  "ts": [1790443198.511, 1790443199.512, 1790443200.512],
  "series": {
    "cpu_pct": [22.9, 25.1, 24.3],
    "cpu_freq_mhz": [2400, 2400, 2400],
    "load_1m": [1.18, 1.18, 1.21],
    "soc_temp_c": [55.6, 56.2, 56.2],
    "nvme_temp_c": [41.9, 41.9, 41.9],
    "fan_rpm": [3390, 3452, 3480],
    "fan_pct": [31.4, 32.9, 32.9],
    "mem_used_pct": [20.3, 20.3, 20.3],
    "swap_used_pct": [0.0, 0.0, 0.0],
    "disk_read_bytes_per_s": [0, 4096, 0],
    "disk_write_bytes_per_s": [12288, 0, 45056],
    "net_rx_bytes_per_s": [4870, 5302, 5120],
    "net_tx_bytes_per_s": [8120, 9433, 8704],
    "pmic_w": [3.65, 3.71, 3.71]
  },
  "net": {
    "wlan0": {"rx_bytes_per_s": [4870, 5302, 5120], "tx_bytes_per_s": [8120, 9433, 8704]},
    "tailscale0": {"rx_bytes_per_s": [1180, 1260, 1210], "tx_bytes_per_s": [6410, 7010, 6620]}
  }
}
```

`net` has an entry for every interface in `network.interfaces`. `eth0` and `docker0` are left out above only to keep the example short.

**How each series maps to the live metrics.** Keep appending live `metrics` values to these series:

| History series | Metrics field |
|---|---|
| `cpu_pct` | `cpu.usage_pct` |
| `cpu_freq_mhz` | `cpu.freq_mhz` |
| `load_1m` | `cpu.load_avg[0]` |
| `soc_temp_c` | `temps.soc_c` |
| `nvme_temp_c` | `temps.nvme_c` |
| `fan_rpm` | `fan.rpm` |
| `fan_pct` | `fan.speed_pct` |
| `mem_used_pct` | `memory.ram.used_pct` |
| `swap_used_pct` | `memory.swap.used_pct` |
| `disk_read_bytes_per_s` | `disks.total.read_bytes_per_s` |
| `disk_write_bytes_per_s` | `disks.total.write_bytes_per_s` |
| `net_rx_bytes_per_s` | `network.total.rx_bytes_per_s` |
| `net_tx_bytes_per_s` | `network.total.tx_bytes_per_s` |
| `pmic_w` | `power.pmic_w` (the last value is repeated between its 5 s refreshes) |
| `net.<if>.rx_bytes_per_s` / `tx_bytes_per_s` | the matching entry in `network.interfaces[]` |

### Fan endpoints

The fan-control mechanism (a userspace curve loop with the kernel governor released) is described in [PI_RECON.md → Fan control](PI_RECON.md#fan-control-argon-neo-5-how-it-actually-works).

**`GET /api/fan`** returns the `fan` section shown above.

**`GET /api/fan/profiles`**

```json
{
  "active": "balanced",
  "constraints": {
    "points_min": 2,
    "points_max": 8,
    "temp_min_c": 20,
    "temp_max_c": 80,
    "hysteresis_max_c": 10,
    "min_running_pct": 20
  },
  "profiles": [
    {"id": "silent", "name": "Silent", "builtin": true,
     "description": "Fan off up to 59 °C, then a slow ramp. Quietest; the SoC runs warmer under load.",
     "hysteresis_c": 4,
     "points": [{"temp_c": 59, "speed_pct": 0}, {"temp_c": 60, "speed_pct": 20}, {"temp_c": 68, "speed_pct": 40}, {"temp_c": 75, "speed_pct": 70}, {"temp_c": 79, "speed_pct": 100}]},
    {"id": "balanced", "name": "Balanced", "builtin": true,
     "description": "Your current config.txt curve, smoothed: 30 % at 55 °C, full speed at 75 °C. The default.",
     "hysteresis_c": 5,
     "points": [{"temp_c": 54, "speed_pct": 0}, {"temp_c": 55, "speed_pct": 30}, {"temp_c": 63, "speed_pct": 50}, {"temp_c": 70, "speed_pct": 70}, {"temp_c": 75, "speed_pct": 100}]},
    {"id": "performance", "name": "Performance", "builtin": true,
     "description": "Always on (30 % minimum), full speed from 72 °C. Coolest under load, audible at idle.",
     "hysteresis_c": 3,
     "points": [{"temp_c": 40, "speed_pct": 30}, {"temp_c": 55, "speed_pct": 55}, {"temp_c": 65, "speed_pct": 80}, {"temp_c": 72, "speed_pct": 100}]},
    {"id": "max", "name": "Max", "builtin": true,
     "description": "Full speed all the time.",
     "hysteresis_c": 0,
     "points": [{"temp_c": 20, "speed_pct": 100}, {"temp_c": 80, "speed_pct": 100}]},
    {"id": "custom", "name": "Custom", "builtin": false,
     "description": "Your own curve. Starts as a copy of Balanced.",
     "hysteresis_c": 5,
     "points": [{"temp_c": 54, "speed_pct": 0}, {"temp_c": 55, "speed_pct": 30}, {"temp_c": 63, "speed_pct": 50}, {"temp_c": 70, "speed_pct": 70}, {"temp_c": 75, "speed_pct": 100}]}
  ]
}
```

- The builtin curves above are part of the contract. The frontend may show them as-is.
- **Balanced** reproduces the curve in `config.txt` today: on at about 55 °C, off again at 49 °C. Installing the dashboard doesn't change how the fan behaves until you pick another profile.
- `constraints` mirrors the server-side validation, so the editor can enforce the same rules.
- `min_running_pct` is the lowest non-zero speed the fan reliably spins at. 20 is a placeholder; the backend task measures the real value on the hardware and updates it here.

**`GET /api/fan/profile`** returns the active profile object, e.g. the `balanced` entry above.

**`PUT /api/fan/profile`** (Bearer)

Request:

```json
{"id": "performance"}
```

Response `200`:

```json
{
  "active": "performance",
  "applied": true,
  "reboot_required": false,
  "profile": {"id": "performance", "name": "Performance", "builtin": true,
              "description": "Always on (30 % minimum), full speed from 72 °C. Coolest under load, audible at idle.",
              "hysteresis_c": 3,
              "points": [{"temp_c": 40, "speed_pct": 30}, {"temp_c": 55, "speed_pct": 55}, {"temp_c": 65, "speed_pct": 80}, {"temp_c": 72, "speed_pct": 100}]}
}
```

- `applied`: whether the new curve is driving the fan now. It is false in `kernel` mode (no write access, or `PIDASH_FAN_CONTROL=0`, or no fan). The choice is still saved.
- The change is persisted to `$PIDASH_STATE_DIR/fan.json` before the response is sent. It takes effect on the next control-loop tick (≤ 1 s).
- Errors: `422 {"error": "unknown_profile", "message": "no profile 'turbo'"}`.

**`PUT /api/fan/profiles/custom`** (Bearer)

Replaces the custom curve. It does **not** activate it: call `PUT /api/fan/profile {"id": "custom"}` for that. If custom is already active, the new curve applies on the next tick.

Request (both fields required):

```json
{
  "hysteresis_c": 2,
  "points": [
    {"temp_c": 45, "speed_pct": 0},
    {"temp_c": 46, "speed_pct": 30},
    {"temp_c": 60, "speed_pct": 60},
    {"temp_c": 70, "speed_pct": 100}
  ]
}
```

Response `200`: the same shape as `PUT /api/fan/profile`, with `profile` set to the updated custom profile and `active` set to whichever profile is active. `applied` is true only if custom is active and the fan is writable.

```json
{
  "active": "balanced",
  "applied": false,
  "reboot_required": false,
  "profile": {"id": "custom", "name": "Custom", "builtin": false,
              "description": "Your own curve. Starts as a copy of Balanced.",
              "hysteresis_c": 2,
              "points": [{"temp_c": 45, "speed_pct": 0}, {"temp_c": 46, "speed_pct": 30}, {"temp_c": 60, "speed_pct": 60}, {"temp_c": 70, "speed_pct": 100}]}
}
```

Validation. Every rule failure returns `422 {"error": "invalid_curve", "message": "…"}`, and the message names the offending point.
- 2 to 8 points.
- `temp_c`: integers from 20 to 80, **strictly increasing**.
- `speed_pct`: integers from 0 to 100, **non-decreasing**.
- `hysteresis_c`: an integer from 0 to 10.

Example: `422 {"error": "invalid_curve", "message": "points[2].temp_c must be greater than points[1].temp_c (60 <= 60)"}`.

#### Curve semantics

Both sides need to agree on this, so the editor's preview matches the hardware. Each tick (1 s), the loop does:

1. `t` = `temps.soc_c`. If `t` is unreadable or `t ≥ 80` (`fan_failsafe_c`), switch to **failsafe**: 100 %, until `t < 75` (`fan_failsafe_release_c`).
2. `s(x)` = linear interpolation between the points. Below the first point it takes the first speed; above the last point, the last speed.
3. **Hysteresis.** Speed rises immediately and falls late:
   ```
   target = s(t)                                   if s(t) >= previous_target
   target = min(previous_target, s(t + hysteresis_c))   otherwise
   ```
   So with Balanced (hysteresis 5), the fan switches on just above 54 °C and only turns off again at 49 °C.
   A jittery sensor (±0.5 °C) can't make it oscillate.
4. **Stall guard.** `0 < target < min_running_pct` is raised to `min_running_pct`. 0 means off.
5. `pwm = round(target × 255 / 100)`, written to hwmon `pwm1`.

The builtin curves turn the fan on with a 1 °C step (e.g. 49 → 0 %, 50 → 25 %) to get a clean on/off point. The editor should allow the same kind of step.

## WebSocket `/api/ws`

The server pushes; the client never needs to send anything, and client messages are ignored. Every message is a JSON text frame of the form `{"type": "...", "data": {...}}`.

On connect (and on every reconnect) the server sends, in order:

1. `hello`: `data` = the `GET /api/info` object.
2. `fan_profiles`: `data` = the `GET /api/fan/profiles` object.
3. `history`: `data` = the `GET /api/history` object.
4. `metrics`: `data` = a **full** snapshot, every section (the `GET /api/metrics` object).

Afterwards:

- **`metrics`, about once per second.** `data` holds `ts` plus only the sections refreshed on that tick. The client merges it shallowly: `Object.assign(state, msg.data)`. Every section arrives whole, so sections are never merged field by field.

  | Section | Refresh | Source |
  |---|---|---|
  | `system`, `cpu`, `memory`, `temps`, `throttling`, `fan`, `disks`, `network` | 1 s | psutil, sysfs/hwmon, `vcgencmd get_throttled` |
  | `processes` | 3 s | psutil |
  | `power`, `services`, `docker`, `tailscale` | 5 s | `vcgencmd pmic_read_adc`, `systemctl`, Docker socket, tailscaled socket |

  A 1 s tick. `system`, `cpu`, `memory`, `throttling`, `disks` and `network` are also present on every tick, with exactly the shapes shown in `GET /api/metrics`; they are left out here only for length:

  ```json
  {"type": "metrics", "data": {
    "ts": 1790443201.513,
    "temps": {"soc_c": 56.8, "nvme_c": 41.9, "rp1_c": 52.3, "pmic_c": 53.1},
    "fan": {"available": true, "rpm": 3560, "pwm": 88, "speed_pct": 34.5, "mode": "curve", "profile": "balanced",
            "target_pct": 34.5, "control_temp_c": 56.8, "writable": true, "reboot_required": false}
  }}
  ```

  A 5 s tick additionally carries `power`, `services`, `docker` and `tailscale`, and a 3 s tick carries `processes`.

- **`fan_profiles`.** Sent to **every** connected client whenever the active profile or the custom curve changes, from any device. `data` is the same object as `GET /api/fan/profiles`. This keeps a phone and a desktop in sync.

Client guidance:
- **Stale connection.** Treat the connection as stale if no message arrives for 5 s. Close it and reconnect with backoff (1 s, 2 s, 4 s, … up to 10 s), and show a connection indicator.
- **Reconnect.** A reconnect replays `hello` → `fan_profiles` → `history` → full `metrics`, so the client just replaces its state.
- **Upgrades.** If `hello.data.app_version` changes between connections, the backend was upgraded. Reload the page to pick up the matching frontend.
- The server may skip ticks for a slow client. It never queues a backlog.

## Mock mode

`pidash --mock` (or `PIDASH_MOCK=1`) serves the full contract with synthetic data. This lets the frontend be built and demoed without a Pi.

- `info.mock` is `true` and `hostname` is `mock-pi`. Everything else has the real shapes and realistic, **time-varying** values:
  - load moves in waves;
  - the SoC temperature follows the load;
  - the fan RPM follows the PWM with some lag, and the PWM follows the active profile's curve.
- The data covers the frontend's edge cases:
  - 4 containers: running+healthy, running+unhealthy, exited, paused;
  - more than 120 services, including one `failed`;
  - `throttling.since_boot.under_voltage = true`;
  - 3 tailnet peers: direct, relay, offline.
- Fan PUTs work and persist exactly as in real mode (same state file, same validation).
- The auth rules are unchanged. For local frontend work run `PIDASH_TOKEN=dev pidash --mock` and log in with `dev`.
- Other states need no special mode:
  - Missing sensors and unavailable sections: run **without** `--mock` on a non-Pi machine, and those sections report `available: false`.
  - Disconnects: stop the server.

## Security notes

- **Bind address.** Don't bind `0.0.0.0` on the Pi: `wlan0` is on the home LAN and there is no firewall. Use one of:
  - the default `127.0.0.1`, published on the tailnet with `tailscale serve`;
  - the Tailscale IP, `PIDASH_HOST=100.106.106.35`.

  **Never** use `tailscale funnel`: it exposes the dashboard to the public internet.
- **What reads expose.** Reads are unauthenticated by design, and they include process command lines. Anyone who can reach the port sees them. Keep the port tailnet-only.
- **The token.** Anyone with the token can change the fan curve. Every curve is bounded by the failsafe (full speed at 80 °C) and the kernel's critical trip, so the worst case is noise or a warm Pi, not damage.
- **Docker access.** The Docker panel needs the service user in the `docker` group, which is root-equivalent. Without it, `docker.available` is false and nothing else breaks.

## Deviations

None yet. Record here any place where the implementation differs from this document.
