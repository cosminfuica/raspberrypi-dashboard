"""Metric collectors behind GET /api/metrics (docs/API.md). One method per section.

Every source is optional. A missing file or command gives null, or {"available": false, "error": ...}
for the sections the contract marks optional, so the app also runs on a non-Pi machine.
Access (docs/PI_RECON.md): vcgencmd needs the `video` group, the Docker socket the `docker` group.
"""

import http.client
import ipaddress
import json
import os
import platform
import re
import socket
import subprocess
import time
from datetime import datetime
from pathlib import Path

import psutil

HWMON = Path("/sys/class/hwmon")
THERMAL = Path("/sys/class/thermal")
DOCKER_SOCK = "/var/run/docker.sock"
UNIT_FILES_TTL_S = 60
WHOLE_DISK = re.compile(r"(nvme\d+n\d+|sd[a-z]+|mmcblk\d+)$")
KINDS = ("wifi", "ethernet", "vpn", "bridge", "other")
THROTTLE_FLAGS = ("under_voltage", "arm_freq_capped", "throttled", "soft_temp_limit")
PROC_ATTRS = ("pid", "name", "username", "cpu_percent", "memory_percent", "memory_info", "num_threads", "cmdline")


class Unavailable(Exception):
    """An optional source is missing; its section reports available: false with this message."""


def read(path):
    try:
        return Path(path).read_text().strip(" \t\n\0")
    except (OSError, ValueError):
        return None


def milli_c(path):
    """A sysfs millidegree file in °C, unrounded, or None."""
    try:
        return int(read(path)) / 1000
    except (TypeError, ValueError):
        return None


def r1(x):
    return None if x is None else round(x, 1)


def find_hwmon(name, root=None):
    """hwmon numbers change between boots (pwm_fan is a module), so look devices up by name."""
    return next((d for d in sorted((root or HWMON).glob("hwmon*")) if read(d / "name") == name), None)


def find_zone(kind, root=None):
    return next((d for d in sorted((root or THERMAL).glob("thermal_zone*")) if read(d / "type") == kind), None)


def hwmon_c(name, attr="temp1_input"):
    d = find_hwmon(name)
    return milli_c(d / attr) if d else None


def run(*cmd, timeout=5):
    """stdout of a command, or Unavailable with a readable reason."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env={**os.environ, "LC_ALL": "C"})
    except FileNotFoundError:
        raise Unavailable(f"{cmd[0]} not found") from None
    except (OSError, subprocess.TimeoutExpired) as e:
        raise Unavailable(f"{cmd[0]}: {e}") from None
    if p.returncode:
        lines = (p.stderr or p.stdout).strip().splitlines()
        raise Unavailable(f"{' '.join(cmd[:2])} failed: {lines[-1] if lines else f'exit status {p.returncode}'}")
    return p.stdout


def vcgencmd(*args):
    try:
        return run("vcgencmd", *args)
    except Unavailable as e:
        if "not found" in str(e):
            raise
        raise Unavailable(f"{e} (the service user needs the video group)") from None


def optional(fn):
    """Section decorator: Unavailable becomes {"available": false, "error": ...}."""
    def section(*args):
        try:
            return {"available": True, **fn(*args)}
        except Unavailable as e:
            return {"available": False, "error": str(e)}
    section.__name__ = fn.__name__
    return section


def iface_kind(name):
    if name.startswith(("tailscale", "wg", "tun")):
        return "vpn"
    if name.startswith(("docker", "br-")):
        return "bridge"
    if name.startswith("wl") or os.path.isdir(f"/sys/class/net/{name}/wireless"):
        return "wifi"
    if name.startswith(("eth", "en")):
        return "ethernet"
    return "other"


def addresses(addrs):
    """IPv4 first, then IPv6; link-local addresses dropped."""
    out = [a.address.split("%")[0] for f in (socket.AF_INET, socket.AF_INET6) for a in addrs if a.family == f]
    return [a for a in out if not ipaddress.ip_address(a).is_link_local]


def wifi_signal(text):
    """{iface: dBm} from /proc/net/wireless."""
    out = {}
    for line in (text or "").splitlines()[2:]:
        name, _, rest = line.partition(":")
        try:
            out[name.strip()] = int(float(rest.split()[2]))
        except (IndexError, ValueError):
            pass
    return out


def parse_throttled(text):
    raw = text.strip().partition("=")[2]
    bits = int(raw, 16)
    flags = lambda shift: {f: bool(bits >> (shift + i) & 1) for i, f in enumerate(THROTTLE_FLAGS)}
    return {"raw": raw, "now": flags(0), "since_boot": flags(16)}


def parse_pmic(text):
    """`vcgencmd pmic_read_adc` -> the power section (rails with both V and A, EXT5V_V as the input)."""
    vals = {}
    for name, unit, value in re.findall(r"(\S+)_([AV]) \w+\(\d+\)=([\d.]+)", text):
        vals.setdefault(name, {})[unit] = float(value)
    rails = sorted(({"name": n, "v": d["V"], "a": d["A"], "w": d["V"] * d["A"]}
                    for n, d in vals.items() if d.keys() == {"A", "V"}), key=lambda r: -r["w"])
    if not rails:
        raise Unavailable("vcgencmd pmic_read_adc reported no rails")
    r3 = lambda x: None if x is None else round(x, 3)
    core = vals.get("VDD_CORE", {})
    return {
        "input_v": r3(vals.get("EXT5V", {}).get("V")),
        "core_v": r3(core.get("V")),
        "core_a": r3(core.get("A")),
        "pmic_w": round(sum(r["w"] for r in rails), 2),
        "rails": [{"name": r["name"], "v": r3(r["v"]), "a": r3(r["a"]), "w": r3(r["w"])} for r in rails],
    }


def systemd_time(value):
    """`--timestamp=unix` gives "@1790358131"; empty means never."""
    return int(value[1:]) if value and value.startswith("@") else None


def systemd_bytes(value):
    return int(value) if value and value.isdigit() and int(value) < 2**64 - 1 else None


def rfc3339(value):
    """Go timestamps (nanoseconds, "Z") -> epoch seconds; None for missing or Go's zero time."""
    if not value or value.startswith("0001-"):
        return None
    try:
        return int(datetime.fromisoformat(re.sub(r"(\.\d{6})\d+", r"\1", value).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def ts_peer(p):
    online = bool(p.get("Online"))
    conn = "offline" if not online else "idle" if not p.get("Active") else "direct" if p.get("CurAddr") else "relay"
    return {"hostname": p.get("HostName"), "dns_name": (p.get("DNSName") or "").rstrip(".") or None, "os": p.get("OS"),
            "ips": p.get("TailscaleIPs") or [], "online": online, "connection": conn, "relay": p.get("Relay") or None,
            "rx_bytes": p.get("RxBytes", 0), "tx_bytes": p.get("TxBytes", 0),
            "last_seen": None if online else rfc3339(p.get("LastSeen")), "exit_node": bool(p.get("ExitNode"))}


def parse_tailscale(st):
    me = st.get("Self") or {}
    peers = sorted((ts_peer(p) for p in (st.get("Peer") or {}).values()),
                   key=lambda p: (not p["online"], (p["hostname"] or "").lower()))
    return {
        "backend_state": st.get("BackendState"),
        "version": (st.get("Version") or "").split("-")[0] or None,
        "self": {"hostname": me.get("HostName"), "dns_name": (me.get("DNSName") or "").rstrip(".") or None,
                 "ips": me.get("TailscaleIPs") or [], "online": bool(me.get("Online")),
                 "relay": me.get("Relay") or None, "key_expiry": rfc3339(me.get("KeyExpiry"))},
        "summary": {"peers": len(peers), "online": sum(p["online"] for p in peers)},
        "peers": peers,
    }


def docker_ports(ports):
    out = []
    for p in sorted(ports, key=lambda p: (p.get("PrivatePort", 0), p.get("IP", ""))):
        s = f"{p['PrivatePort']}/{p['Type']}"
        if p.get("PublicPort"):
            ip = p.get("IP", "")
            s = f"{f'[{ip}]' if ':' in ip else ip}:{p['PublicPort']}->{s}"
        if s not in out:
            out.append(s)
    return out


def docker_health(status):
    m = re.search(r"\((healthy|unhealthy|health: starting)\)", status or "")
    return None if not m else "starting" if m.group(1) == "health: starting" else m.group(1)


class _UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("localhost", timeout=3)
        self.sock_path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.sock_path)


def docker_get(path):
    conn = _UnixHTTP(DOCKER_SOCK)
    try:
        conn.request("GET", path)
        r = conn.getresponse()
        body = r.read()
    except FileNotFoundError:
        raise Unavailable(f"docker socket not found: {DOCKER_SOCK}") from None
    except PermissionError:
        raise Unavailable(f"permission denied: {DOCKER_SOCK} (add the service user to the docker group)") from None
    except ConnectionRefusedError:
        raise Unavailable(f"docker is not running ({DOCKER_SOCK} refused the connection)") from None
    except OSError as e:
        raise Unavailable(f"docker: {e}") from None
    finally:
        conn.close()
    if r.status != 200:
        raise Unavailable(f"docker API GET {path}: HTTP {r.status}")
    return json.loads(body)


def cpu_model():
    try:
        m = re.search(r"^Model name:\s*(.+)$", run("lscpu"), re.M)
    except Unavailable:
        return None
    return m.group(1).strip() if m else None


class Collector:
    """The real sources. Keeps previous counters so rates are per second.

    Call every method from one thread: psutil keeps its CPU-percent baselines per thread.
    """

    def __init__(self):
        self._prev = {}           # rate baselines: key -> (monotonic time, {name: counters})
        self._docker_cpu = {}     # container id -> (cpu total_usage, system_cpu_usage)
        self._pmic = (-1e9, None)  # (monotonic time, °C): vcgencmd is slow-ish, refreshed every 5 s
        self._unit_files = (-1e9, {})  # (monotonic time, {unit file: enabled state})

    def _rates(self, key, counters, fields):
        """Per-second deltas since the previous call with this key; None without a baseline."""
        now = time.monotonic()
        then, before = self._prev.get(key, (None, {}))
        self._prev[key] = (now, counters)
        out = {}
        for name, c in counters.items():
            b = before.get(name)
            out[name] = {f: max(0.0, (getattr(c, f) - getattr(b, f)) / (now - then)) if b else None for f in fields}
        return out

    def info(self):
        try:
            freq = psutil.cpu_freq()
        except (OSError, NotImplementedError):
            freq = None
        try:
            os_name = platform.freedesktop_os_release().get("PRETTY_NAME")
        except OSError:
            os_name = None
        nvme = find_hwmon("nvme")
        return {
            "hostname": socket.gethostname(),
            "model": read("/proc/device-tree/model") or read("/sys/class/dmi/id/product_name"),
            "os": os_name,
            "kernel": platform.release(),
            "arch": platform.machine(),
            "cpu": {"model": cpu_model(), "cores": psutil.cpu_count(),
                    "min_mhz": round(freq.min) if freq and freq.min else None,
                    "max_mhz": round(freq.max) if freq and freq.max else None},
            "memory_total_bytes": psutil.virtual_memory().total,
            "boot_time": int(psutil.boot_time()),
            "limits": {"nvme_warn_c": r1(milli_c(nvme / "temp1_max")) if nvme else None,
                       "nvme_crit_c": r1(milli_c(nvme / "temp1_crit")) if nvme else None},
        }

    def system(self):
        boot = psutil.boot_time()
        try:
            threads = int(read("/proc/loadavg").split()[3].split("/")[1])
        except (AttributeError, IndexError, ValueError):
            threads = None
        return {"uptime_s": int(time.time() - boot), "boot_time": int(boot),
                "process_count": len(psutil.pids()), "thread_count": threads}

    def cpu(self):
        t = psutil.cpu_times_percent()
        times = {k: round(getattr(t, k, 0.0), 1) for k in ("user", "nice", "system", "iowait", "irq", "softirq", "idle")}
        try:
            freq = psutil.cpu_freq()
        except (OSError, NotImplementedError):
            freq = None
        return {
            "usage_pct": round(100 - times["idle"], 1),
            "per_core_pct": [round(p, 1) for p in psutil.cpu_percent(percpu=True)],
            "times_pct": times,
            "freq_mhz": round(freq.current) if freq else None,
            "governor": read("/sys/devices/system/cpu/cpufreq/policy0/scaling_governor"),
            "load_avg": [round(x, 2) for x in os.getloadavg()],
        }

    def memory(self):
        vm, sw = psutil.virtual_memory(), psutil.swap_memory()
        used = vm.total - vm.available
        return {
            "ram": {"total_bytes": vm.total, "used_bytes": used, "available_bytes": vm.available,
                    "cached_bytes": getattr(vm, "cached", None), "buffers_bytes": getattr(vm, "buffers", None),
                    "used_pct": round(used * 100 / vm.total, 1)},
            "swap": {"total_bytes": sw.total, "used_bytes": sw.used, "used_pct": round(sw.percent, 1)},
        }

    def temps(self):
        zone = find_zone("cpu-thermal")
        at, pmic = self._pmic
        if time.monotonic() - at >= 5:
            try:
                pmic = float(re.search(r"temp=([\d.]+)", vcgencmd("measure_temp", "pmic")).group(1))
            except (Unavailable, AttributeError, ValueError):
                pmic = None
            self._pmic = (time.monotonic(), pmic)
        return {"soc_c": r1(milli_c(zone / "temp")) if zone else None, "nvme_c": r1(hwmon_c("nvme")),
                "rp1_c": r1(hwmon_c("rp1_adc")), "pmic_c": r1(pmic)}

    @optional
    def throttling(self):
        try:
            return parse_throttled(vcgencmd("get_throttled"))
        except ValueError:
            raise Unavailable("vcgencmd get_throttled: unexpected output") from None

    @optional
    def power(self):
        return parse_pmic(vcgencmd("pmic_read_adc"))

    def disks(self):
        io = {k: v for k, v in (psutil.disk_io_counters(perdisk=True) or {}).items() if WHOLE_DISK.match(k)}
        rates = self._rates("disk", io, ("read_bytes", "write_bytes", "read_count", "write_count", "busy_time"))
        num = lambda x: None if x is None else round(x)
        devices = []
        for name in sorted(io):
            r = rates[name]
            size = read(f"/sys/block/{name}/size")
            devices.append({
                "name": name,
                "model": read(f"/sys/block/{name}/device/model") or read(f"/sys/block/{name}/device/name"),
                "size_bytes": int(size) * 512 if size and size.isdigit() else None,
                "read_bytes_per_s": num(r["read_bytes"]), "write_bytes_per_s": num(r["write_bytes"]),
                "read_iops": num(r["read_count"]), "write_iops": num(r["write_count"]),
                "busy_pct": None if r["busy_time"] is None else round(min(100.0, r["busy_time"] / 10), 1),  # ms/s -> %
            })
        filesystems, seen = [], set()
        for part in psutil.disk_partitions():
            # One entry per device: bind mounts (systemd's ProtectSystem= adds some) and btrfs subvolumes repeat it.
            if part.device in seen:
                continue
            seen.add(part.device)
            try:
                u = psutil.disk_usage(part.mountpoint)
            except OSError:
                continue
            filesystems.append({"mount": part.mountpoint, "device": part.device, "fstype": part.fstype,
                                "total_bytes": u.total, "used_bytes": u.used, "free_bytes": u.free,
                                "used_pct": round(u.percent, 1)})
        return {"devices": devices, "total": _total(devices, ("read_bytes_per_s", "write_bytes_per_s")),
                "filesystems": filesystems}

    def network(self):
        stats, addrs = psutil.net_if_stats(), psutil.net_if_addrs()
        io = psutil.net_io_counters(pernic=True)
        rates = self._rates("net", io, ("bytes_recv", "bytes_sent"))
        wifi = wifi_signal(read("/proc/net/wireless"))
        num = lambda x: None if x is None else round(x)
        out = []
        for name, st in stats.items():
            if name == "lo" or name.startswith("veth"):
                continue
            kind, c, r = iface_kind(name), io.get(name), rates.get(name, {})
            out.append({"name": name, "kind": kind, "up": st.isup, "addresses": addresses(addrs.get(name, [])),
                        "speed_mbps": st.speed if st.speed > 0 else None,
                        "wifi_signal_dbm": wifi.get(name) if kind == "wifi" else None,
                        "rx_bytes_per_s": num(r.get("bytes_recv")), "tx_bytes_per_s": num(r.get("bytes_sent")),
                        "rx_total_bytes": c.bytes_recv if c else 0, "tx_total_bytes": c.bytes_sent if c else 0})
        out.sort(key=lambda i: (not i["up"], KINDS.index(i["kind"]), i["name"]))
        # Tailscale traffic already flows through wifi/ethernet: count those only.
        physical = [i for i in out if i["kind"] in ("wifi", "ethernet")]
        return {"interfaces": out, "total": _total(physical, ("rx_bytes_per_s", "tx_bytes_per_s"))}

    def processes(self):
        cores = psutil.cpu_count() or 1
        rows = []
        for p in psutil.process_iter(PROC_ATTRS):
            i = p.info
            rows.append({
                "pid": i["pid"], "name": i["name"], "user": i["username"],
                "cpu_pct": round((i["cpu_percent"] or 0.0) / cores, 1),  # share of the whole machine
                "mem_pct": round(i["memory_percent"] or 0.0, 1),
                "rss_bytes": i["memory_info"].rss if i["memory_info"] else None,
                "threads": i["num_threads"],
                "command": (" ".join(i["cmdline"] or ()) or f"[{i['name']}]")[:200],
            })
        top = lambda key: sorted(rows, key=key, reverse=True)[:10]
        return {"top_cpu": top(lambda r: (r["cpu_pct"], r["rss_bytes"] or 0)), "top_mem": top(lambda r: r["rss_bytes"] or 0)}

    @optional
    def services(self):
        try:
            units = [u for u in json.loads(run("systemctl", "list-units", "--type=service", "--all", "--output=json", "--no-pager"))
                     if u["load"] != "not-found"]
            files = self._unit_file_states()
        except (ValueError, KeyError, TypeError):
            raise Unavailable("systemctl: unexpected JSON output") from None
        props = {}
        active = [u["unit"] for u in units if u["active"] == "active"]
        # ponytail: one `systemctl show` for all active units costs PID 1 ~150 ms per poll on the Pi (~60 units);
        # read memory from cgroupfs and cache start times per InvocationID if that ever matters.
        try:  # only active units have a start time and memory
            out = run("systemctl", "show", "--timestamp=unix", "-p", "Id,ActiveEnterTimestamp,MemoryCurrent", "--", *active) if active else ""
        except Unavailable:
            out = ""
        for block in out.strip().split("\n\n"):
            p = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
            props[p.get("Id")] = p
        rows = []
        for u in units:
            name, p = u["unit"], props.get(u["unit"], {})
            enabled = files.get(name)
            if enabled is None and "@" in name:  # an instance (getty@tty1) takes its template's state
                enabled = files.get(re.sub(r"@.*\.", "@.", name))
            rows.append({"name": name, "description": u.get("description"), "load": u["load"], "active": u["active"],
                         "sub": u["sub"], "enabled": enabled,
                         "active_since": systemd_time(p.get("ActiveEnterTimestamp")),
                         "memory_bytes": systemd_bytes(p.get("MemoryCurrent"))})
        rows.sort(key=lambda r: ({"failed": 0, "active": 1}.get(r["active"], 2), r["name"].lower()))
        summary = {"total": len(rows), "active": sum(r["active"] == "active" for r in rows),
                   "running": sum(r["sub"] == "running" for r in rows), "failed": sum(r["active"] == "failed" for r in rows)}
        return {"summary": summary, "units": rows}

    def _unit_file_states(self):
        """{unit file: enabled state}. Listing unit files costs systemd ~0.5 s of CPU on the Pi, so it is cached.
        ponytail: `systemctl enable/disable` shows up within UNIT_FILES_TTL_S; watch dbus UnitFilesChanged if that lags."""
        at, states = self._unit_files
        if time.monotonic() - at >= UNIT_FILES_TTL_S:
            states = {f["unit_file"]: f["state"] for f in
                      json.loads(run("systemctl", "list-unit-files", "--type=service", "--output=json", "--no-pager"))}
            self._unit_files = (time.monotonic(), states)
        return states

    @optional
    def docker(self):
        version = docker_get("/version").get("Version")
        containers = docker_get("/containers/json?all=1")
        images = len(docker_get("/images/json"))
        seen, rows = {}, []
        for c in containers:
            row = {"id": c["Id"][:12], "name": (c.get("Names") or ["/?"])[0].lstrip("/"), "image": c.get("Image"),
                   "state": c.get("State"), "status": c.get("Status"), "health": docker_health(c.get("Status")),
                   "created": c.get("Created"), "ports": docker_ports(c.get("Ports") or []),
                   "cpu_pct": None, "mem_bytes": None, "mem_limit_bytes": None, "mem_pct": None}
            if c.get("State") == "running":
                try:
                    row.update(self._container_stats(c["Id"], seen))
                except (Unavailable, KeyError, TypeError, ValueError):
                    pass  # a container that just stopped: leave its stats null
            rows.append(row)
        self._docker_cpu = seen
        running = sum(r["state"] == "running" for r in rows)
        paused = sum(r["state"] == "paused" for r in rows)
        return {"version": version,
                "summary": {"total": len(rows), "running": running, "paused": paused,
                            "stopped": len(rows) - running - paused, "images": images},
                "containers": rows}

    def _container_stats(self, cid, seen):
        s = docker_get(f"/containers/{cid}/stats?stream=false&one-shot=true")
        cpu = (s["cpu_stats"]["cpu_usage"]["total_usage"], s["cpu_stats"].get("system_cpu_usage") or 0)
        prev, seen[cid] = self._docker_cpu.get(cid), cpu
        mem = s.get("memory_stats") or {}
        used = mem["usage"] - (mem.get("stats") or {}).get("inactive_file", 0) if "usage" in mem else None
        limit = mem.get("limit")
        return {
            # share of the whole machine: no × online_cpus, unlike `docker stats`
            "cpu_pct": round((cpu[0] - prev[0]) * 100 / (cpu[1] - prev[1]), 1) if prev and cpu[1] > prev[1] else None,
            "mem_bytes": used, "mem_limit_bytes": limit,
            "mem_pct": round(used * 100 / limit, 1) if used is not None and limit else None,
        }

    @optional
    def tailscale(self):
        try:
            return parse_tailscale(json.loads(run("tailscale", "status", "--json")))
        except ValueError:
            raise Unavailable("tailscale status: unexpected output") from None


def _total(rows, keys):
    return {k: sum(r[k] or 0 for r in rows) for k in keys}
