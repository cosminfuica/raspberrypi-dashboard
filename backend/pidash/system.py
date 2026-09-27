"""Privileged actions: reboot, system update and service restart (docs/API.md "System actions").

pidash runs as the unprivileged `pidash` user. deploy/pidash.sudoers lets it run exactly these as root:

    /usr/bin/systemctl reboot
    /usr/bin/systemctl start --no-block pidash-update.service
    /usr/bin/systemctl restart --no-block -- <name>.service      (name: SERVICE_NAME)

The update runs deploy/pidash-update in its own unit, deploy/pidash-update.service:
- dpkg writes /usr, /etc and /boot/firmware, which pidash's sandbox (ProtectSystem=full) can't;
- restarting pidash (or anything else) mid-update doesn't kill dpkg;
- no apt-get argument ever comes from the app.
The job's record is its log file, so it survives pidash restarts. Every command is an argv list: no shell.
"""

import logging
import os
import re
import secrets
import subprocess
import threading
import time
from pathlib import Path

from .auth import ApiError
from .collectors import Unavailable, run, systemd_bytes, systemd_time

log = logging.getLogger("pidash")

SYSTEMCTL = "/usr/bin/systemctl"
UPDATE_UNIT = "pidash-update.service"
UPDATE_LOG = "/var/log/pidash-update.log"  # written by deploy/pidash-update
REBOOT_FLAG = "/var/run/reboot-required"
# The same pattern as deploy/pidash.sudoers. No "\": escaped names (systemd-fsck@dev-disk-by\x2d…) can't be restarted.
SERVICE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9@._:-]*[.]service")
# deploy/pidash-update writes these as the first and the last line of its log.
START = re.compile(rb"pidash-update: started (\d+) (\S+)\n")
END = re.compile(rb"pidash-update: exit (\d+) at (\d+)\n\Z")
MARKER = re.compile(rb"pidash-update: (?:started \d+ \S+|exit \d+ at \d+)\n")  # also mid-line: apt's last line may lack \n
RESTART_WAIT_S = 20
UPDATE_START_WAIT_S = 5
UNIT_PROPS = "Description,LoadState,ActiveState,SubState,UnitFileState,ActiveEnterTimestamp,MemoryCurrent,Job"


def show(unit, props):
    """`systemctl show` for one unit, as {property: value}. Reading needs no privileges."""
    try:
        out = run("systemctl", "show", "--timestamp=unix", "-p", props, "--", unit)
    except Unavailable as e:
        raise ApiError(500, "command_failed", str(e)) from None
    return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)


def unit_row(name, p):
    """A unit in the shape of a `services.units[]` row of GET /api/metrics."""
    active = p.get("ActiveState") == "active"
    return {"name": name, "description": p.get("Description") or None, "load": p.get("LoadState"),
            "active": p.get("ActiveState"), "sub": p.get("SubState"), "enabled": p.get("UnitFileState") or None,
            "active_since": systemd_time(p.get("ActiveEnterTimestamp")) if active else None,
            "memory_bytes": systemd_bytes(p.get("MemoryCurrent")) if active else None}


def first_line(path):
    try:
        with open(path, "rb") as f:
            return f.readline()
    except OSError:
        return b""


def job_status(log_path, running, offset=0):
    """The latest update, read from the markers in its log, and the log text from byte `offset` on."""
    idle = {"id": None, "state": "idle", "exit_code": None, "started_at": None, "ended_at": None, "log": "", "offset": 0}
    try:
        with open(log_path, "rb") as f:
            start = START.match(f.readline())
            size = f.seek(0, os.SEEK_END)
            f.seek(max(0, size - 256))
            end = END.search(f.read())
            offset = min(max(0, offset), size)
            f.seek(offset)
            data = f.read()
    except OSError:
        return idle
    if not start:
        return idle
    code = ended = None
    if running:
        state, data = "running", data[:data.rfind(b"\n") + 1]  # whole lines only: no half-written character
    elif end:
        code, ended = int(end[1]), int(end[2])
        state = "succeeded" if code == 0 else "failed"
    else:
        state = "failed"  # no exit line: it was stopped, or the Pi went down mid-update
    return {"id": start[2].decode(), "state": state, "exit_code": code, "started_at": int(start[1]), "ended_at": ended,
            "log": MARKER.sub(b"", data).decode("utf-8", "replace"), "offset": offset + len(data)}


class System:
    def __init__(self, log_path=UPDATE_LOG, reboot_flag=REBOOT_FLAG):
        self.log_path, self.reboot_flag = Path(log_path), Path(reboot_flag)
        self.lock = threading.Lock()  # update starts and reboot checks, one at a time

    def _sudo(self, *argv):
        """`sudo -n <argv>`. -n: fail at once instead of asking for a password."""
        try:
            p = subprocess.run(["sudo", "-n", *argv], capture_output=True, text=True, timeout=15)
        except (OSError, subprocess.TimeoutExpired) as e:
            detail = str(e)
        else:
            if not p.returncode:
                return
            lines = (p.stderr or p.stdout).strip().splitlines()
            detail = lines[-1] if lines else f"exit status {p.returncode}"
        hint = " (sudo -l -U pidash should list it: install.sh sets up /etc/sudoers.d/pidash)" if "sudo" in detail else ""
        raise ApiError(500, "command_failed", f"sudo {' '.join(argv)}: {detail}{hint}")

    def _later(self, *argv):
        """For actions that stop pidash: run after the response has gone out. systemd may kill sudo as it stops
        pidash, so a failure here can be a false alarm."""
        def run_it():
            try:
                self._sudo(*argv)
            except ApiError as e:
                log.warning("%s (harmless if pidash or the Pi went down right after)", e.message)
        return run_it

    def _running(self):
        u = show(UPDATE_UNIT, "ActiveState,Job")
        return u.get("ActiveState") in ("activating", "deactivating") or bool(u.get("Job"))

    def reboot(self):
        """Checks that a reboot may start; returns the reboot itself, to run after the response."""
        with self.lock:
            if self._running():
                raise ApiError(409, "update_running", "an update is running: reboot once it has finished")
            self._sudo("-l", SYSTEMCTL, "reboot")  # -l only asks sudoers; it runs nothing
        return self._later(SYSTEMCTL, "reboot")

    def start_update(self):
        with self.lock:
            if self._running():
                raise ApiError(409, "update_running", "an update is already running")
            before = first_line(self.log_path)
            self._sudo(SYSTEMCTL, "start", "--no-block", UPDATE_UNIT)
            deadline = time.monotonic() + UPDATE_START_WAIT_S
            while not (START.match(line := first_line(self.log_path)) and line != before):  # the new run's marker
                if time.monotonic() > deadline:
                    raise ApiError(500, "update_not_started", f"{UPDATE_UNIT} did not start: see journalctl -u {UPDATE_UNIT}")
                time.sleep(0.05)
        return self.update_status()

    def update_status(self, offset=0):
        return {**job_status(self.log_path, self._running(), offset), "reboot_required": self.reboot_flag.exists()}

    def restart(self, name):
        """Restarts a unit the caller found in the services list. Returns (its state, None) once the restart is
        done or after RESTART_WAIT_S; for pidash itself, (its state now, the restart to run after the response)."""
        p = show(name, "SuccessAction,FailureAction,RefuseManualStart,RefuseManualStop,StandardInput,MainPID")
        why = ("it reboots or powers off the Pi when it runs"  # systemd-poweroff.service and friends
               if {p.get("SuccessAction") or "none", p.get("FailureAction") or "none"} != {"none"} else
               "systemd refuses to restart it by hand" if "yes" in (p.get("RefuseManualStart"), p.get("RefuseManualStop"))
               else "it takes over the Pi's console" if p.get("StandardInput") == "tty-force"  # rescue, emergency
               else "restarting it would kill apt: use POST /api/system/update" if name == UPDATE_UNIT else None)
        if why:
            raise ApiError(403, "restart_not_allowed", f"{name}: {why}")
        argv = (SYSTEMCTL, "restart", "--no-block", "--", name)
        if p.get("MainPID") == str(os.getpid()):  # systemd stops pidash at once: answer first
            return unit_row(name, show(name, UNIT_PROPS)), self._later(*argv)
        self._sudo(*argv)
        deadline = time.monotonic() + RESTART_WAIT_S
        while (u := show(name, UNIT_PROPS)).get("Job") and time.monotonic() < deadline:
            time.sleep(0.2)  # a slow restart: the metrics stream shows the rest
        return unit_row(name, u), None


MOCK_APT = """\
Hit:1 http://deb.debian.org/debian trixie InRelease
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
"""


class MockSystem(System):
    """--mock: nothing runs as root. The update replays MOCK_APT in the real log format, then asks for a reboot."""

    step_s = 0.15  # per log line

    def __init__(self, collector, state_dir):
        super().__init__(Path(state_dir) / "mock-update.log", Path(state_dir) / "mock-reboot-required")
        self.collector, self.worker = collector, None

    def _sudo(self, *argv):
        if argv == (SYSTEMCTL, "start", "--no-block", UPDATE_UNIT):
            self.worker = threading.Thread(target=self._apt, daemon=True)
            self.worker.start()
        elif argv == (SYSTEMCTL, "reboot"):
            log.info("mock: reboot requested; nothing happens")
            self.reboot_flag.unlink(missing_ok=True)

    def _running(self):
        return self.worker is not None and self.worker.is_alive()

    def _apt(self):
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.log_path, "w") as f:
            f.write(f"pidash-update: started {int(time.time())} {secrets.token_hex(16)}\n")
            for line in MOCK_APT.splitlines(keepends=True):
                f.flush()
                time.sleep(self.step_s)
                f.write(line)
            f.write(f"pidash-update: exit 0 at {int(time.time())}\n")
        self.reboot_flag.touch()

    def restart(self, name):
        row = next(u for u in self.collector.services()["units"] if u["name"] == name)
        return ({**row, "active_since": int(time.time())} if row["active"] == "active" else row), None
