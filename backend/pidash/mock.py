"""Synthetic data for `pidash --mock` (docs/API.md "Mock mode").

Same shapes as the real collectors, with time-varying values: the load moves in waves with a burst
every 3 minutes, the SoC heats with the load and cools with the fan, and the fan RPM follows the PWM
that the real FanController writes (through MockFan) with some lag.
"""

import math
import random
import threading
import time

from .collectors import THROTTLE_FLAGS, parse_pmic, parse_throttled

GB = 1024**3
BOOT = time.time() - 85107
RAILS = {  # name: (V, A at idle, A added at full load)
    "VDD_CORE": (0.855, 0.9, 4.2), "3V7_WL_SW": (3.687, 0.077, 0.02), "0V8_SW": (0.803, 0.30, 0.08),
    "1V8_SYS": (1.797, 0.12, 0.02), "1V1_SYS": (1.104, 0.17, 0.03), "3V3_SYS": (3.295, 0.047, 0.004),
    "HDMI": (5.124, 0.017, 0.0), "DDR_VDD2": (1.108, 0.006, 0.01), "3V3_ADC": (3.294, 0.001, 0.0),
    "0V8_AON": (0.799, 0.005, 0.0), "3V3_DAC": (3.301, 0.001, 0.0), "DDR_VDDQ": (0.607, 0.0, 0.001),
}
# name, user, base machine-wide cpu %, rss MB, threads, command
PROCS = [
    ("python3", "root", 6.0, 274, 38, "python3 -m homeassistant --config /config"),
    ("node", "root", 1.5, 180, 11, "node index.js --config /app/data/configuration.yaml"),
    ("python3", "pidash", 1.2, 50, 6, "/opt/pidash/venv/bin/python -m pidash"),
    ("labwc", "cosmin", 0.8, 136, 4, "/usr/bin/labwc -m"),
    ("wayvnc", "cosmin", 0.5, 38, 7, "/usr/bin/wayvnc --render-cursor --detached"),
    ("tailscaled", "root", 0.4, 49, 11, "/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock --port=41641"),
    ("dockerd", "root", 0.3, 90, 11, "/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock"),
    ("containerd", "root", 0.2, 45, 12, "/usr/bin/containerd"),
    ("mosquitto", "1883", 0.1, 9, 1, "/usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf"),
    ("NetworkManager", "root", 0.1, 21, 4, "/usr/sbin/NetworkManager --no-daemon"),
    ("systemd-journald", "root", 0.1, 31, 1, "/usr/lib/systemd/systemd-journald"),
    ("pipewire", "cosmin", 0.1, 14, 3, "/usr/bin/pipewire"),
    ("rpi-connect", "cosmin", 0.1, 29, 9, "/usr/bin/rpi-connect-env /usr/bin/rpi-connect"),
    ("kworker/u8:2-events_unbound", "root", 0.1, 0, 1, ""),
    ("sshd", "root", 0.0, 8, 1, "sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups"),
]
RUNNING = {"accounts-daemon", "avahi-daemon", "bluetooth", "containerd", "cron", "dbus", "docker", "getty@tty1",
           "lightdm", "NetworkManager", "nfs-blkmap", "polkit", "rpcbind", "serial-getty@ttyAMA10", "ssh",
           "systemd-journald", "systemd-logind", "systemd-timesyncd", "systemd-udevd", "tailscaled", "udisks2",
           "unattended-upgrades", "user@1000", "wpa_supplicant", "ModemManager", "upower", "rsyslog", "triggerhappy"}
EXITED = {"alsa-restore", "apparmor", "console-setup", "dphys-swapfile", "fake-hwclock", "ifupdown-pre", "keyboard-setup",
          "kmod-static-nodes", "networking", "NetworkManager-wait-online", "plymouth-quit-wait", "plymouth-read-write",
          "rc-local", "raspi-config", "sshswitch", "systemd-binfmt", "systemd-fsck-root", "systemd-journal-flush",
          "systemd-modules-load", "systemd-random-seed", "systemd-remount-fs", "systemd-sysctl", "systemd-sysusers",
          "systemd-tmpfiles-setup", "systemd-tmpfiles-setup-dev", "systemd-udev-trigger", "systemd-update-utmp",
          "systemd-user-sessions", "user-runtime-dir@1000", "zramswap"}
OTHER = {"alsa-state", "apt-daily", "apt-daily-upgrade", "cups", "cups-browsed", "e2scrub_all", "e2scrub_reap", "fstrim",
         "hciuart", "logrotate", "man-db", "NetworkManager-dispatcher", "nfs-client", "plymouth-quit", "plymouth-start",
         "rng-tools-debian", "rpi-eeprom-update", "systemd-rfkill", "systemd-tmpfiles-clean"}
FAILED = "rpi-display-backlight"
SERVICES = sorted(RUNNING | EXITED | OTHER | {FAILED}
                  | {f"modprobe@{m}" for m in ("configfs", "dm_mod", "drm", "efi_pstore", "fuse", "loop")}
                  | {f"getty@tty{i}" for i in range(2, 7)} | {f"backup-job@{i:02d}" for i in range(1, 41)})


class Sim:
    """A Pi that heats with load and cools with the fan. Advanced lazily by whoever reads it."""

    def __init__(self):
        self.lock = threading.Lock()
        self.t0, self.last = time.time(), time.monotonic()
        self.temp, self.pwm, self.rpm = 49.0, 0, 0.0

    def load(self):
        """0..1: slow and fast waves plus a 50 s burst every 3 minutes."""
        t = time.time() - self.t0
        burst = 0.5 if t % 180 > 130 else 0.0
        return min(1.0, max(0.03, 0.2 + 0.1 * math.sin(t / 23) + 0.06 * math.sin(t / 5.1) + burst))

    def advance(self):
        with self.lock:
            now = time.monotonic()
            dt, self.last = min(5.0, now - self.last), now
            steady = 43 + 38 * self.load() - 8 * self.pwm / 255
            self.temp += (steady - self.temp) * (1 - math.exp(-dt / 20))
            want = 0.0 if self.pwm < 8 else min(9400.0, 39.0 * self.pwm)  # measured: ~39 rpm per pwm step
            self.rpm += (want - self.rpm) * (1 - math.exp(-dt / 1.5))
            return self.temp

    def soc(self):
        """The SoC temperature as the real sensor reports it, in 0.55 °C steps."""
        return round(self.advance() / 0.55) * 0.55


class MockFan:
    """Stands in for SysfsFan: the real FanController drives it, so profiles behave as on the Pi."""

    def __init__(self, sim):
        self.sim = sim

    def soc_temp(self):
        return self.sim.soc()

    def read(self):
        return self.sim.pwm, round(self.sim.rpm / 10) * 10

    def write_pwm(self, pwm):
        self.sim.pwm = int(pwm)

    def writable(self):
        return True

    def release(self):
        pass

    def restore(self):
        self.sim.pwm = 255


def jitter(x, pct=0.1):
    return x * (1 + random.uniform(-pct, pct))


class MockCollector:
    def __init__(self):
        self.sim = Sim()
        self.load_avg = [0.8, 0.7, 0.6]
        self.net_totals = {"wlan0": [16475278, 111434915], "tailscale0": [917882, 101187744], "eth0": [0, 0], "docker0": [439, 220]}

    def info(self):
        return {"hostname": "mock-pi", "model": "Raspberry Pi 5 Model B Rev 1.0", "os": "Debian GNU/Linux 13 (trixie)",
                "kernel": "6.18.50+rpt-rpi-2712", "arch": "aarch64",
                "cpu": {"model": "Cortex-A76", "cores": 4, "min_mhz": 1500, "max_mhz": 2400},
                "memory_total_bytes": 8453947392, "boot_time": int(BOOT),
                "limits": {"nvme_warn_c": 83.8, "nvme_crit_c": 87.8}}

    def system(self):
        return {"uptime_s": int(time.time() - BOOT), "boot_time": int(BOOT),
                "process_count": 200 + random.randint(0, 4), "thread_count": 365 + random.randint(0, 8)}

    def cpu(self):
        load = self.sim.load()
        cores = [min(100.0, max(0.0, jitter(load * 100, 0.35))) for _ in range(4)]
        usage = sum(cores) / 4
        iowait, system, softirq = random.uniform(0, 0.6), usage * 0.22, usage * 0.02
        self.load_avg = [a + (load * 4 - a) * k for a, k in zip(self.load_avg, (1 / 60, 1 / 300, 1 / 900))]
        idle = round(100 - usage, 1)
        return {"usage_pct": round(100 - idle, 1), "per_core_pct": [round(c, 1) for c in cores],
                "times_pct": {"user": round(usage - system - softirq - iowait, 1), "nice": 0.0, "system": round(system, 1),
                              "iowait": round(iowait, 1), "irq": 0.0, "softirq": round(softirq, 1), "idle": idle},
                "freq_mhz": min(2400, 1500 + 100 * round(load * 14)), "governor": "ondemand",
                "load_avg": [round(a, 2) for a in self.load_avg]}

    def memory(self):
        total = 8453947392
        used = int(1.6 * GB + 0.4 * GB * self.sim.load())
        return {"ram": {"total_bytes": total, "used_bytes": used, "available_bytes": total - used,
                        "cached_bytes": 1272086528, "buffers_bytes": 100532224, "used_pct": round(used * 100 / total, 1)},
                "swap": {"total_bytes": 2147467264, "used_bytes": 26214400, "used_pct": 1.2}}

    def temps(self):
        soc, load = self.sim.soc(), self.sim.load()
        return {"soc_c": round(soc, 1), "nvme_c": round(38 + 6 * load + random.uniform(0, 0.4), 1),
                "rp1_c": round(soc - 3.5, 1), "pmic_c": round(soc - 2.8, 1)}

    def throttling(self):
        return {"available": True, **parse_throttled("throttled=0x10000")}  # under-voltage since boot

    def power(self):
        load = self.sim.load()
        lines = []
        for name, (v, a0, a1) in RAILS.items():
            lines += [f"{name}_A current(0)={jitter(a0 + a1 * load, 0.03):.8f}A", f"{name}_V volt(0)={jitter(v, 0.003):.8f}V"]
        lines.append(f"EXT5V_V volt(24)={jitter(5.108, 0.002):.8f}V")
        return {"available": True, **parse_pmic("\n".join(lines))}

    def disks(self):
        r, w = random.choice([0, 0, 0, 4096, 65536]), random.choice([0, 4096, 12288, 45056, 262144])
        return {"devices": [{"name": "nvme0n1", "model": "WD Blue SN580 1TB", "size_bytes": 1000204886016,
                             "read_bytes_per_s": r, "write_bytes_per_s": w, "read_iops": r // 4096,
                             "write_iops": w // 4096 + (w > 0), "busy_pct": round((r + w) / 65536, 1)}],
                "total": {"read_bytes_per_s": r, "write_bytes_per_s": w},
                "filesystems": [
                    {"mount": "/", "device": "/dev/nvme0n1p2", "fstype": "ext4", "total_bytes": 898268385280,
                     "used_bytes": 8738693120, "free_bytes": 852950233088, "used_pct": 1.0},
                    {"mount": "/boot/firmware", "device": "/dev/nvme0n1p1", "fstype": "vfat", "total_bytes": 528592896,
                     "used_bytes": 82630656, "free_bytes": 445962240, "used_pct": 15.6}]}

    def network(self):
        busy = self.sim.load()
        rates = {"wlan0": (int(jitter(5000 + 90000 * busy, 0.4)), int(jitter(8700 + 30000 * busy, 0.4))),
                 "tailscale0": (int(jitter(1200, 0.3)), int(jitter(6600, 0.3))), "eth0": (0, 0), "docker0": (0, 0)}
        meta = {"wlan0": ("wifi", True, ["192.168.0.92"]),
                "tailscale0": ("vpn", True, ["100.106.106.35", "fd7a:115c:a1e0::ce2d:6a24"]),
                "eth0": ("ethernet", False, []), "docker0": ("bridge", False, ["172.17.0.1"])}
        out = []
        for name, (kind, up, addrs) in meta.items():
            rx, tx = rates[name]
            tot = self.net_totals[name]
            tot[0], tot[1] = tot[0] + rx, tot[1] + tx
            out.append({"name": name, "kind": kind, "up": up, "addresses": addrs, "speed_mbps": None,
                        "wifi_signal_dbm": random.randint(-52, -48) if kind == "wifi" else None,
                        "rx_bytes_per_s": rx, "tx_bytes_per_s": tx, "rx_total_bytes": tot[0], "tx_total_bytes": tot[1]})
        return {"interfaces": out, "total": {"rx_bytes_per_s": rates["wlan0"][0], "tx_bytes_per_s": rates["wlan0"][1]}}

    def processes(self):
        load, total = self.sim.load(), 8453947392
        rows = []
        for i, (name, user, cpu, mb, threads, cmd) in enumerate(PROCS):
            cpu = jitter(cpu + (60 * load if i == 0 else 0), 0.3)
            rss = int(jitter(mb * 2**20, 0.02))
            rows.append({"pid": 1000 + 97 * i, "name": name, "user": user, "cpu_pct": round(cpu, 1),
                         "mem_pct": round(rss * 100 / total, 1), "rss_bytes": rss, "threads": threads,
                         "command": cmd or f"[{name}]"})
        top = lambda k: sorted(rows, key=lambda r: r[k], reverse=True)[:10]
        return {"top_cpu": top("cpu_pct"), "top_mem": top("rss_bytes")}

    def services(self):
        rows = []
        for i, name in enumerate(SERVICES):
            base = name.split(".")[0]
            active, sub = (("active", "running") if base in RUNNING else ("active", "exited") if base in EXITED
                           else ("failed", "failed") if base == FAILED else ("inactive", "dead"))
            rows.append({"name": f"{name}.service", "description": base.replace("-", " ").replace("@", " ").capitalize(),
                         "load": "loaded", "active": active, "sub": sub,
                         "enabled": "enabled" if base in RUNNING or base == FAILED else "static",
                         "active_since": int(BOOT) + 15 + i if active == "active" else None,
                         "memory_bytes": (1 + i % 23) * 2_621_440 if sub == "running" else None})
        rows.sort(key=lambda r: ({"failed": 0, "active": 1}.get(r["active"], 2), r["name"].lower()))
        return {"available": True,
                "summary": {"total": len(rows), "active": sum(r["active"] == "active" for r in rows),
                            "running": sum(r["sub"] == "running" for r in rows),
                            "failed": sum(r["active"] == "failed" for r in rows)},
                "units": rows}

    def docker(self):
        load, limit = self.sim.load(), 8453947392
        def c(cid, name, image, state, status, health, created, ports, cpu=None, mem=None):
            return {"id": cid, "name": name, "image": image, "state": state, "status": status, "health": health,
                    "created": created, "ports": ports, "cpu_pct": None if cpu is None else round(cpu, 1),
                    "mem_bytes": mem, "mem_limit_bytes": limit if mem else None,
                    "mem_pct": round(mem * 100 / limit, 1) if mem else None}
        up = int(time.time() - BOOT)
        containers = [
            c("8c1f0e7a2b3d", "homeassistant", "ghcr.io/home-assistant/home-assistant:stable", "running",
              f"Up {up // 3600} hours (healthy)", "healthy", int(BOOT) + 60, ["0.0.0.0:8123->8123/tcp", "[::]:8123->8123/tcp"],
              jitter(6 + 60 * load, 0.3), int(jitter(312475648, 0.01))),
            c("2e7d9c4b1a60", "zigbee2mqtt", "koenkk/zigbee2mqtt:latest", "running",
              f"Up {up // 3600} hours (unhealthy)", "unhealthy", int(BOOT) + 62, ["0.0.0.0:8080->8080/tcp"],
              jitter(1.5, 0.3), int(jitter(188743680, 0.01))),
            c("4b9d2a6e1f07", "alpine-test", "alpine:latest", "exited", "Exited (0) 2 days ago", None, int(BOOT) - 172800, []),
            c("9a0b8c7d6e5f", "backup", "restic/restic:latest", "paused", f"Up {up // 3600} hours (Paused)", None,
              int(BOOT) + 90, []),
        ]
        return {"available": True, "version": "29.8.1",
                "summary": {"total": 4, "running": 2, "paused": 1, "stopped": 1, "images": 5}, "containers": containers}

    def tailscale(self):
        t = int(time.time() - self.sim.t0)
        peer = lambda host, os_, ips, online, conn, rx, tx, seen: {
            "hostname": host, "dns_name": f"{host.lower()}.example-tailnet.ts.net", "os": os_, "ips": ips,
            "online": online, "connection": conn, "relay": "fra", "rx_bytes": rx, "tx_bytes": tx,
            "last_seen": seen, "exit_node": False}
        return {"available": True, "backend_state": "Running", "version": "1.102.4",
                "self": {"hostname": "mock-pi", "dns_name": "mock-pi.example-tailnet.ts.net",
                         "ips": ["100.106.106.35", "fd7a:115c:a1e0::ce2d:6a24"], "online": True, "relay": "fra",
                         "key_expiry": int(time.time()) + 180 * 86400},
                "summary": {"peers": 3, "online": 2},
                "peers": [peer("omarchy", "linux", ["100.77.59.21", "fd7a:115c:a1e0::af35:3b16"], True, "direct",
                               61708 + 900 * t, 84708 + 7000 * t, None),
                          peer("pixel-8", "android", ["100.90.12.44"], True, "relay", 20480 + 50 * t, 9120 + 20 * t, None),
                          peer("Cosmins-MacBook-Pro", "macOS", ["100.85.185.115"], False, "offline", 0, 0,
                               int(time.time()) - 900)]}


assert len(SERVICES) > 120 and len(THROTTLE_FLAGS) == 4
