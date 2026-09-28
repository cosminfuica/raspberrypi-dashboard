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
  - Unknown `/api/*` routes → 404 `not_found`. A known path with the wrong method → 405 `method_not_allowed`.
  - Malformed or wrongly typed request bodies → 422 `invalid_request`. This replaces FastAPI's default validation-error format.
  - The fan choice couldn't be saved (disk full, permissions) → 500 `state_write_failed`; nothing changed. Any other server bug → 500 `internal_error`.
- **Versioning:** `api_version` (currently `1`) in `/api/info` and in the WebSocket `hello`. Breaking changes bump it.

## Configuration

All settings are environment variables. On the Pi, the systemd unit loads them from `EnvironmentFile=/etc/pidash/pidash.env`, which `install.sh` writes (root:pidash, mode 0640).

| Variable | Default | Meaning |
|---|---|---|
| `PIDASH_TOKEN` | *(unset)* | Auth token for changes. When unset, every mutating endpoint returns 403 `auth_not_configured`. The installer generates a random value, `secrets.token_urlsafe(32)` |
| `PIDASH_HOST` | `127.0.0.1` | Bind address. See [Security notes](#security-notes) |
| `PIDASH_PORT` | `8787` | Port |
| `PIDASH_STATE_DIR` | `./state` | Where `fan.json` is persisted: active profile + custom curve. On the Pi: `/var/lib/pidash` |
| `PIDASH_FAN_CONTROL` | `1` | `0` = never write to the fan (read-only). The kernel's config.txt curve stays in charge; profile choices are saved but not applied |
| `PIDASH_MOCK` | `0` | `1` = mock mode, same as the `--mock` flag. See [Mock mode](#mock-mode) |
| `PIDASH_STATIC_DIR` | `frontend/dist` | Built frontend to serve |
| `PIDASH_CONSOLE` | `1` (`0` in mock mode) | `1` turns the [web console](#console-apiconsolews) on, `0` off (`true`/`false`, `yes`/`no`, `on`/`off` work too; any other value is off). It is always off while `PIDASH_TOKEN` is unset |
| `PIDASH_CONSOLE_IDLE_S` | `900` | A console session closes after this many seconds without input. `0` = never |

CLI: `pidash [--host H] [--port P] [--mock]`. Flags override env vars.
- `pidash --restore-fan` hands the fan back to the kernel if a run died while holding it, then exits. The systemd unit runs it as `ExecStopPost=`.

Fan write access comes from a udev rule, [deploy/90-pidash-fan.rules](../deploy/90-pidash-fan.rules): the `pidash` group may write hwmon `pwm1` and `trip_point_1..4_temp`. The service runs as the unprivileged `pidash` user. Without the rule, `fan.mode` is `"kernel"` and the rest of the app works. The reference unit is [deploy/pidash.service](../deploy/pidash.service).

Root is needed only for the [system actions](#system-actions), through a sudoers drop-in: see there.

## Auth

- **One secret, `PIDASH_TOKEN`.** A request is signed in by either:
  - **`Authorization: Bearer <token>`**: scripts, curl. The server compares it in constant time.
  - **The session cookie** from `POST /api/auth/login`: browsers. It is also the only auth a browser WebSocket can carry (the [console](#console-apiconsolews)).
- **Which endpoints need it.** Every mutating endpoint: the fan `PUT`s, every [system action](#system-actions), and any later POST, PUT, PATCH or DELETE. A test fails if a new mutating route forgets it. `GET /api/system/update` needs it too: the apt log is not public.
  - Other reads and the `/api/ws` stream are open to anyone who can reach the port. The port should only be reachable over the tailnet.
- **CSRF.** A browser attaches the cookie by itself, so a cookie-signed POST/PUT/PATCH/DELETE must also send the header **`X-Pidash-CSRF: 1`**, or it gets 403 `csrf_header_missing`. Login and logout need it too. Another site can't add a custom header without a CORS preflight, which pidash never grants. The cookie is also `HttpOnly` and `SameSite=Strict`. Bearer requests need no CSRF header.
- **The session cookie** `pidash_session` (`Path=/api`, 7 days, `Secure` when served over HTTPS) holds its expiry and an HMAC of it keyed by the token. Nothing is stored on the server: sessions survive restarts and reboots, and **changing `PIDASH_TOKEN` ends every session**. Logout deletes the cookie in that browser.
- **Login flow (frontend):**
  1. If `info.auth_configured` is false, disable the controls and say why.
  2. Show a "token" prompt, then `POST /api/auth/login` with `{"token": "..."}` and `X-Pidash-CSRF: 1`. On 200 the browser holds the cookie; the page never sees it (`HttpOnly`).
  3. Is this browser signed in? `GET /api/auth`: 200 or 401.
  4. Send `X-Pidash-CSRF: 1` on every POST/PUT/PATCH/DELETE. On any 401, show the prompt again.
  5. Sign out: `POST /api/auth/logout` with `X-Pidash-CSRF: 1`.
  - The existing fan controls send the token as a Bearer header from `localStorage`; that keeps working.
- **WebSocket Origin check.** A browser handshake whose `Origin` host:port doesn't match the request's `Host` (or `X-Forwarded-Host`) is refused with HTTP 403. This stops other websites from reading the stream. Clients that send no `Origin` (curl, scripts) are allowed.
- **Reusing it** (backend): `pidash/auth.py`. HTTP routes take `dependencies=[Depends(auth.require)]`. A WebSocket route checks `same_origin(ws.headers)` and `auth.check(ws)` before `ws.accept()`, and closes with 1008 otherwise; the module docstring has the snippet.

Errors:

```text
401 {"error": "unauthorized", "message": "missing or invalid bearer token"}
401 {"error": "unauthorized", "message": "wrong token"}             (login)
403 {"error": "auth_not_configured", "message": "set PIDASH_TOKEN on the server to enable changes"}
403 {"error": "csrf_header_missing", "message": "a browser POST must send the header X-Pidash-CSRF: 1"}
```

### Audit log

Every POST/PUT/PATCH/DELETE under `/api/`, refused ones included, adds one JSON line to `$PIDASH_STATE_DIR/audit.log` (on the Pi `/var/lib/pidash/audit.log`, mode 0600) and to the journal:

```text
{"ts": 1790546351.827, "user": "cosmin@github", "ip": "100.77.59.21", "auth": "session", "action": "POST /api/system/reboot", "status": 202}
```

- `user` is the tailnet login from the `Tailscale-User-Login` header, which `tailscale serve` sets and strips from what clients send. `null` for local requests.
- `ip` is the client's address (`tailscale serve` passes it on), `auth` is `bearer`, `session` or `null`.
- Request bodies and tokens are never logged.
- Console sessions add their own lines: see [Console → Audit](#console-apiconsolews).

## Endpoints

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/info` | – | Static facts about the host and server |
| GET | `/api/metrics` | – | Full snapshot, every section |
| GET | `/api/history?seconds=N` | – | Recent time series for charts (default and max: `info.history_s`) |
| GET | `/api/auth` | Bearer | `200 {"authenticated": true}` or 401/403 |
| POST | `/api/auth/login` | – (CSRF header) | `{"token": "..."}` → session cookie. See [Auth](#auth) |
| POST | `/api/auth/logout` | – (CSRF header) | Deletes the session cookie |
| GET | `/api/fan` | – | Live fan state (same object as the `fan` metrics section) |
| GET | `/api/fan/profiles` | – | All profiles, the active id and the curve constraints |
| GET | `/api/fan/profile` | – | The active profile |
| PUT | `/api/fan/profile` | Bearer | Switch the active profile |
| PUT | `/api/fan/profiles/custom` | Bearer | Replace the custom curve |
| POST | `/api/system/reboot` | Bearer | `202`, then the Pi reboots. See [System actions](#system-actions) |
| POST | `/api/system/update` | Bearer | `202` + the update job: `apt-get update && apt-get -y upgrade` |
| GET | `/api/system/update?offset=N` | Bearer | The latest update job and its log from byte `N` |
| POST | `/api/services/{name}/restart` | Bearer | Restart one service from the services list; returns its new state |
| WS | `/api/ws` | – (Origin check) | `hello`, `fan_profiles`, `history`, then a `metrics` stream |
| WS | `/api/console/ws` | Bearer or cookie (+ Origin check) | A shell on a terminal. See [Console](#console-apiconsolews) |

"Bearer" means signed in: a Bearer token, or the session cookie plus `X-Pidash-CSRF: 1` (see [Auth](#auth)).

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
  "console_enabled": true,
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
- `console_enabled`: whether `/api/console/ws` takes sessions (a token is set and `PIDASH_CONSOLE` isn't off). See [Console](#console-apiconsolews).

### GET /api/metrics

The full snapshot. The WebSocket `metrics` messages carry the **same object**, but only the sections refreshed on that tick (see [WebSocket](#websocket-apiws)).

- The Pi really runs **zero** Docker containers today. The example shows two containers, plus the matching `homeassistant` process under `processes`, to illustrate the shape.
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
    "min_running_pct": 8
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
- `min_running_pct` is the stall guard. Measured on the NEO 5 blower: it starts from standstill at pwm 10 (4 %, about 270 rpm) and stops at pwm 5, so the guard is 8 % (pwm 20, about 670 rpm), twice the start threshold. See [PI_RECON.md → Verified on the hardware](PI_RECON.md#verified-on-the-hardware).

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

## System actions

Reboot, system update and service restart. All need auth ([Auth](#auth)) and are written to the [audit log](#audit-log). Code: `backend/pidash/system.py`.

**How root is reached.** The service still runs as the unprivileged `pidash` user. `install.sh` installs a sudoers drop-in, [deploy/pidash.sudoers](../deploy/pidash.sudoers) → `/etc/sudoers.d/pidash`, checked with `visudo` first. It allows exactly three commands, with fixed arguments, and nothing else (no shell, no other `systemctl` verb, no `apt-get` with arguments from the app):

```text
/usr/bin/systemctl reboot
/usr/bin/systemctl start --no-block pidash-update.service
/usr/bin/systemctl ^restart --no-block -- [A-Za-z0-9][A-Za-z0-9@._:-]*[.]service$     (a regex: sudo >= 1.9.10)
```

- The update runs in its own root unit, [deploy/pidash-update.service](../deploy/pidash-update.service), which runs [deploy/pidash-update](../deploy/pidash-update). dpkg needs to write `/usr`, `/etc` and `/boot/firmware`, which pidash's sandbox can't; and restarting pidash mid-update can't kill dpkg.
- For sudo to work, `pidash.service` no longer sets `NoNewPrivileges=yes`. `ProtectSystem=full`, `ProtectHome` and `PrivateTmp` stay.
- Check it on the Pi: `sudo -l -U pidash`.

**`POST /api/system/reboot`** → `202 {"rebooting": true}`

- The reboot starts right after the response has been sent: `systemctl reboot` (a clean shutdown).
- The Pi is gone within seconds and back after about 30–60 s. Poll `GET /api/info` until it answers, then reload.
- `409 update_running` while an update runs.

**`POST /api/system/update`** → `202` and the job (same shape as below, `state: "running"`)

- Runs `apt-get update && apt-get -y --with-new-pkgs upgrade` with `DEBIAN_FRONTEND=noninteractive`. Changed config files are kept (`--force-confold`). `--with-new-pkgs` lets new kernels in, as `apt upgrade` does; nothing is ever removed.
- **One at a time:** `409 {"error": "update_running", "message": "an update is already running"}`.
- **Update/reboot pairing:** a reboot is refused while the update runs.
- If apt is already busy (e.g. `unattended-upgrades`), the job fails at once with apt's `Could not get lock …` in the log and exit code 100. Nothing was changed; try again later.

**`GET /api/system/update?offset=N`** → the latest update job, or `state: "idle"` if there never was one

```json
{
  "id": "ba7cf6a49c434c64aac7f8a9062d032b",
  "state": "succeeded",
  "exit_code": 0,
  "started_at": 1790546352,
  "ended_at": 1790546413,
  "reboot_required": true,
  "log": "Hit:1 http://deb.debian.org/debian trixie InRelease\nReading package lists...\n",
  "offset": 478
}
```

- `id`: the systemd invocation id of the run. `state`: `idle`, `running`, `succeeded` or `failed`. A run cut short (the Pi lost power) is `failed` with a null `exit_code`.
- `exit_code`: apt-get's exit status. `null` while running.
- `started_at`, `ended_at`: epoch seconds. `ended_at` is `null` while running.
- `reboot_required`: `/var/run/reboot-required` exists (Debian creates it when e.g. a new kernel is installed). It is independent of the job, so it is also useful with `state: "idle"`.
- **Streaming the log.** `log` is the output from byte `offset` of the request; the response's `offset` is where the next request should start. Poll about once a second with the last `offset`, append `log`, stop when `state` is not `running`. While running, only whole lines are returned. If `id` changes between polls, another client started a new run: clear the log and start again from offset 0. The job and its log live in `/var/log/pidash-update.log`, so they survive a pidash restart; a new update replaces them.

**`POST /api/services/{name}/restart`** → `200` and the unit, in the same shape as a `services.units[]` row

```json
{"name": "ssh.service", "description": "OpenBSD Secure Shell server", "load": "loaded", "active": "active", "sub": "running", "enabled": "enabled", "active_since": 1790546351, "memory_bytes": 5767168}
```

- `name` must be a unit from the current `services.units` list, e.g. `ssh.service`, `getty@tty1.service`:
  - `422 invalid_service_name`: not a plain unit name (letters, digits, `@._:-`, ending in `.service`, not starting with `-`). Escaped names such as `systemd-fsck@dev-disk-by\x2d….service` can't be restarted.
  - `404 unknown_service`: not in the services list.
  - `403 restart_not_allowed`: units that reboot or power off the Pi when they run (`systemd-poweroff.service`, `systemd-reboot.service`, …: systemd's `SuccessAction`/`FailureAction`), units systemd won't restart by hand (`RefuseManualStart`/`RefuseManualStop`), units that take over the console (`rescue.service`, `emergency.service`), and `pidash-update.service`. The message says which.
- The response comes once the restart has finished, or after 20 s for a slow unit (the metrics stream shows the rest).
- **Restarting `pidash.service` itself** answers `202` with its current state, then restarts: the page loses its connection for a few seconds and reconnects.
- Restarting `tailscaled.service` or `ssh.service` briefly drops the connection you're using. `restart_not_allowed` doesn't block them: the frontend should warn.

**Errors** (all actions): `500 command_failed` when sudo or systemctl refuses (the message says why, e.g. the sudoers drop-in is missing), and `500 update_not_started` when the update unit didn't start within 5 s.

**Mock mode.** Nothing runs as root. The update replays a canned apt log (a line every 0.15 s, then `reboot_required: true`), a reboot only clears that flag, and a restart returns the mock unit with a fresh `active_since`.

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

## Console `/api/console/ws`

A shell on the Pi, in the page: `bash -l` on a pseudo-terminal (PTY), relayed over a WebSocket. Built for xterm.js with its fit addon. Code: `backend/pidash/console.py`.

**Opening a session.** Checked during the handshake, before any shell starts:
- signed in: the session cookie (browsers) or `Authorization: Bearer` (scripts);
- a browser's `Origin` matches the host, as for `/api/ws`;
- the console is on: `info.console_enabled` (a token is set and `PIDASH_CONSOLE` isn't off; see [Configuration](#configuration)).

If any check fails, the handshake gets HTTP 403. A browser can't read that status: it only sees `onclose` with code 1006. So check first: `info.console_enabled`, then `GET /api/auth` (401 → show the sign-in prompt), then connect.

**At most 3 sessions at a time**, all clients together. A 4th that is signed in is accepted and closed at once with code 4429.

**Frames.** Set `ws.binaryType = "arraybuffer"`.

| Direction | Frame | Content |
|---|---|---|
| client → server | binary | Keystrokes: the bytes of xterm.js `onData` (UTF-8 encoded) and of `onBinary` (one byte per char, some mouse reports) |
| client → server | text | A control message. There is one: `{"type": "resize", "cols": 120, "rows": 32}`, integers from 1 to 1000 |
| server → client | binary | Terminal output. A UTF-8 character or escape sequence can be split across frames: pass the bytes to `term.write()`, which joins them |

The server sends no text frames. Any other text frame (a keystroke sent as text, malformed JSON, a size out of range) closes the session with 1003.

- **Size.** The terminal starts at 80×24. Send a `resize` as soon as the socket opens and on every `term.onResize`. The program in the foreground (bash, `htop`, `vim`) gets `SIGWINCH` and redraws.
- **Signals are keystrokes.** Ctrl+C is the byte `\x03`, Ctrl+Z `\x1a`, Ctrl+D `\x04`, as in any terminal. Job control works.

```js
const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/console/ws`)
ws.binaryType = 'arraybuffer'
const resize = () => ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
ws.onopen = () => { fit.fit(); resize() }
ws.onmessage = (e) => term.write(new Uint8Array(e.data))
ws.onclose = (e) => showDisconnected(e.code, e.reason)   // see the table below
const text = new TextEncoder()
term.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(text.encode(d)))
term.onBinary((d) => ws.readyState === WebSocket.OPEN && ws.send(Uint8Array.from(d, (c) => c.charCodeAt(0))))
term.onResize(() => ws.readyState === WebSocket.OPEN && resize())
```

**How a session ends.** `CloseEvent.code` and `.reason`:

| Code | Why | `reason` |
|---|---|---|
| 1000 | The shell exited (`exit`, Ctrl+D) | `shell exited (status 0)`, or `shell killed by signal 9` |
| 1003 | A text frame that isn't a valid `resize` | what was expected |
| 1011 | The shell couldn't start | `could not start the shell: …` |
| 1012 | pidash is restarting (e.g. an update of pidash, or `systemctl restart pidash`) | |
| 4408 | No input for `PIDASH_CONSOLE_IDLE_S` seconds (default 900) | `closed after 900 s without input` |
| 4429 | 3 sessions are open already | `3 console sessions are open already` |
| 1006 | The handshake was refused (not signed in, wrong Origin, console off), or the connection dropped | |

- **Idle** means no client message: keystrokes and `resize` count, output doesn't. A `top` left running in a forgotten tab still closes.
- **Closing the page or the socket** hangs up the terminal, like closing an SSH session: bash and its jobs get `SIGHUP`. A shell that ignores it is killed 2 s later. A dead connection is noticed within about 40 s (WebSocket pings).
- **Don't reconnect automatically:** a new connection is a new shell, and nothing of the old one comes back. Offer a Reconnect button. A job that must outlive the tab can run in `tmux` or `screen`, if installed, and be re-attached from the next session.

**The shell.** bash as the service user `pidash`, inside the service's sandbox ([deploy/pidash.service](../deploy/pidash.service)):
- It can read most of the system, but `/usr`, `/boot` and `/etc` are read-only, `/home` is hidden and `/tmp` is private to pidash.
- `HOME` and the working directory are `$PIDASH_STATE_DIR/console` (on the Pi `/var/lib/pidash/console`, mode 0700), created on first use. `~/.bash_profile` there runs at the start of every session.
- The environment is clean: `HOME`, `USER`, `LOGNAME`, `SHELL`, `PATH`, `TERM=xterm-256color` and pidash's `LANG`. Nothing else from pidash's own environment, such as `PIDASH_TOKEN`.
- As root it can run only the dashboard's three commands (`sudo systemctl reboot`, …; see [System actions](#system-actions)). Anything else asks for a password, and `pidash` has none.
- Its processes run in pidash's cgroup: stopping or restarting pidash ends every session and every job, including `nohup` ones.

**Audit.** Each session adds two lines to the [audit log](#audit-log): `console start` (`pid` of the shell) and `console end` (`pid`, `duration_s`, `reason`). A refused handshake adds `console refused`, with `reason` `unauthorized`, `cross_origin`, `disabled` or `too_many_sessions`. Keystrokes and output are never logged.

```text
{"ts": 1790551203.114, "user": "cosmin@github", "ip": "100.77.59.21", "auth": "session", "action": "console start", "pid": 48211}
{"ts": 1790551268.902, "user": "cosmin@github", "ip": "100.77.59.21", "auth": "session", "action": "console end", "pid": 48211, "duration_s": 65.8, "reason": "shell exited (status 0)"}
```

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
- **The console is not mocked**: it is a real shell on the machine running pidash, as the user running it. So in mock mode it is off unless you set `PIDASH_CONSOLE=1`. Then use a token other than the well-known `dev` if anyone else, or a web page through DNS rebinding, could reach the port.
- Other states need no special mode:
  - Missing sensors and unavailable sections: run **without** `--mock` on a non-Pi machine, and those sections report `available: false`.
  - Disconnects: stop the server.

## Security notes

- **Bind address.** Don't bind `0.0.0.0` on the Pi: `wlan0` is on the home LAN and there is no firewall. Use one of:
  - the default `127.0.0.1`, published on the tailnet with `tailscale serve`;
  - the Tailscale IP, `PIDASH_HOST=100.106.106.35`.

  **Never** use `tailscale funnel`: it exposes the dashboard to the public internet.
- **What reads expose.** Reads are unauthenticated by design, and they include process command lines. Anyone who can reach the port sees them. Keep the port tailnet-only.
- **The token.** Anyone with the token can change the fan curve, reboot the Pi, run a system update and restart services. Fan curves are bounded by the failsafe (full speed at 80 °C) and the kernel's critical trip.
- **The console makes the token a shell login.** Anyone with the token gets a shell as the `pidash` user (see [Console](#console-apiconsolews)). With the `docker` group, which `install.sh` adds by default, that shell is **root-equivalent** (`docker run -v /:/host …`). If that is too much, set `PIDASH_CONSOLE=0`, or install with `--no-docker`.
  - The shell can edit `audit.log`, which belongs to the `pidash` user. The copy of each audit line in the journal (`journalctl -u pidash`) can't be changed from the console.
- **Root access** is limited to the three commands in `/etc/sudoers.d/pidash` ([System actions](#system-actions)). A bug in pidash can't run anything else as root. sudoers can't know the services list, so at that level the `pidash` user may restart any `*.service`. The app itself only restarts listed units.
- **Docker access.** The Docker panel needs the service user in the `docker` group, which is root-equivalent. Without it, `docker.available` is false and nothing else breaks.

## Deviations

None in payload shapes. Additions and clarifications made while implementing the backend (task t_a1dd6c7f):

- `constraints.min_running_pct` is **8**, measured on the hardware; the placeholder was 20.
- Extra error codes: 405 `method_not_allowed`, 500 `state_write_failed`, 500 `internal_error` (see Conventions → Errors). 401 responses also carry `WWW-Authenticate: Bearer`.
- `GET /api/history?seconds=N` clamps `N` to 1…`history_s`.
- `fan.mode` is also `"kernel"` when releasing the kernel governor failed at start-up. The backend retries every 10 s to take the fan when it is missing or not writable yet (boot order), but not after a failed release.
- CLI flag `--restore-fan` (see Configuration).
- `docker.containers[].mem_bytes` is usage minus the page cache (`inactive_file`), as `docker stats` shows it.

Added with the system actions (task t_ff7f55c4):

- Auth also accepts a session cookie (`POST /api/auth/login`), with the `X-Pidash-CSRF: 1` header on changes. Bearer tokens work as before.
- New: `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/system/reboot`, `POST /api/system/update`, `GET /api/system/update`, `POST /api/services/{name}/restart`, and the audit log.
- `pidash.service` drops `NoNewPrivileges=yes`, which would block sudo.

Added with the console (task t_a0833a14):

- New: the WebSocket `/api/console/ws`, `info.console_enabled`, `PIDASH_CONSOLE` and `PIDASH_CONSOLE_IDLE_S`, and the `console start`/`console end`/`console refused` audit lines.
- The console uses binary frames for the terminal's bytes and JSON text frames for control, unlike the JSON-only `/api/ws`.
