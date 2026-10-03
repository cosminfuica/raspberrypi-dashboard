"""Fan profiles and the curve control loop.

Contract: docs/API.md "Fan endpoints" and "Curve semantics".
Mechanism: docs/PI_RECON.md "Fan control". The kernel's step_wise governor is released by
writing THERMAL_TEMP_INVALID to the active trip points, then a 1 Hz loop writes hwmon pwm1.
On exit the trips are restored and pwm1 is set to 255, so the kernel steps the fan down again.
Write access comes from deploy/90-pidash-fan.rules; the service itself never runs as root.
"""

import itertools
import json
import logging
import math
import os
import re
import socket
import threading
from datetime import date, datetime, timedelta
from pathlib import Path

from .collectors import find_hwmon, find_zone, milli_c

log = logging.getLogger("pidash.fan")

FAILSAFE_C = 80
FAILSAFE_RELEASE_C = 75
# Stall guard. Measured on the NEO 5 blower: it starts from standstill at pwm 10 (4 %, ~270 rpm) and stops at
# pwm 5, so 8 % (pwm 20, ~670 rpm) keeps a 2x margin. See PI_RECON.md "Verified on the hardware".
MIN_RUNNING_PCT = 8
INVALID_TRIP = -274000  # THERMAL_TEMP_INVALID: step_wise skips the trip; the 110 °C critical trip stays armed
DT_TRIPS = Path("/proc/device-tree/thermal-zones/cpu-thermal/trips")
RETRY_S = 10  # while the kernel is in charge, look for the fan / write access this often

CONSTRAINTS = {
    "points_min": 2,
    "points_max": 8,
    "temp_min_c": 20,
    "temp_max_c": 80,
    "hysteresis_max_c": 10,
    "min_running_pct": MIN_RUNNING_PCT,
}


def _points(*pairs):
    return [{"temp_c": t, "speed_pct": s} for t, s in pairs]


BUILTIN = [
    {"id": "silent", "name": "Silent", "builtin": True,
     "description": "Fan off up to 59 °C, then a slow ramp. Quietest; the SoC runs warmer under load.",
     "hysteresis_c": 4, "points": _points((59, 0), (60, 20), (68, 40), (75, 70), (79, 100))},
    {"id": "balanced", "name": "Balanced", "builtin": True,
     "description": "Your current config.txt curve, smoothed: 30 % at 55 °C, full speed at 75 °C. The default.",
     "hysteresis_c": 5, "points": _points((54, 0), (55, 30), (63, 50), (70, 70), (75, 100))},
    {"id": "performance", "name": "Performance", "builtin": True,
     "description": "Always on (30 % minimum), full speed from 72 °C. Coolest under load, audible at idle.",
     "hysteresis_c": 3, "points": _points((40, 30), (55, 55), (65, 80), (72, 100))},
    {"id": "max", "name": "Max", "builtin": True,
     "description": "Full speed all the time.",
     "hysteresis_c": 0, "points": _points((20, 100), (80, 100))},
]
CUSTOM = {"id": "custom", "name": "Custom", "builtin": False,
          "description": "Your own curve. Starts as a copy of Balanced."}
PROFILE_IDS = [p["id"] for p in BUILTIN] + ["custom"]
DEFAULT_NIGHT = {"enabled": False, "profile": "silent", "start": "23:00", "end": "07:00"}
HHMM = re.compile(r"([01]\d|2[0-3]):[0-5]\d", re.ASCII)  # ASCII: \d would accept any Unicode digit (e.g. Arabic-Indic)


class BodyError(ValueError):
    """Malformed or wrongly typed request body (422 invalid_request)."""


class CurveError(ValueError):
    """A curve that breaks a validation rule (422 invalid_curve)."""


class NightError(ValueError):
    """A night schedule that breaks a rule (422 invalid_night)."""


def _number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate_curve(body):
    """Check a custom curve against docs/API.md "Validation"; return it normalised to ints."""
    c = CONSTRAINTS
    if not isinstance(body, dict) or "hysteresis_c" not in body or "points" not in body:
        raise BodyError("expected an object with hysteresis_c and points")
    h, pts = body["hysteresis_c"], body["points"]
    if not _number(h) or not isinstance(pts, list) or not all(
            isinstance(p, dict) and _number(p.get("temp_c")) and _number(p.get("speed_pct")) for p in pts):
        raise BodyError("hysteresis_c must be a number and points a list of {temp_c, speed_pct} numbers")
    if not c["points_min"] <= len(pts) <= c["points_max"]:
        raise CurveError(f"points must have {c['points_min']} to {c['points_max']} entries (got {len(pts)})")
    if h != int(h) or not 0 <= h <= c["hysteresis_max_c"]:
        raise CurveError(f"hysteresis_c must be an integer from 0 to {c['hysteresis_max_c']} (got {h})")
    out = []
    for i, p in enumerate(pts):
        t, s = p["temp_c"], p["speed_pct"]
        if t != int(t) or not c["temp_min_c"] <= t <= c["temp_max_c"]:
            raise CurveError(f"points[{i}].temp_c must be an integer from {c['temp_min_c']} to {c['temp_max_c']} (got {t})")
        if s != int(s) or not 0 <= s <= 100:
            raise CurveError(f"points[{i}].speed_pct must be an integer from 0 to 100 (got {s})")
        t, s = int(t), int(s)
        if out and t <= out[-1][0]:
            raise CurveError(f"points[{i}].temp_c must be greater than points[{i - 1}].temp_c ({t} <= {out[-1][0]})")
        if out and s < out[-1][1]:
            raise CurveError(f"points[{i}].speed_pct must not be lower than points[{i - 1}].speed_pct ({s} < {out[-1][1]})")
        out.append((t, s))
    return {"hysteresis_c": int(h), "points": _points(*out)}


def validate_night(body):
    """Check a night schedule against docs/API.md "PUT /api/fan/night"; return its four keys, extra keys dropped."""
    keys = ("enabled", "profile", "start", "end")
    if not isinstance(body, dict) or not all(k in body for k in keys):
        raise BodyError("expected an object with enabled, profile, start and end")
    if not isinstance(body["enabled"], bool) or not all(isinstance(body[k], str) for k in keys[1:]):
        raise BodyError("enabled must be true or false, and profile, start and end strings")
    if (p := body["profile"]) not in PROFILE_IDS:
        raise NightError(f"profile must be one of {', '.join(PROFILE_IDS)} (got {p!r})")
    for k in ("start", "end"):
        if not HHMM.fullmatch(v := body[k]):
            raise NightError(f"{k} must be a 24-hour time HH:MM (got {v!r})")
    if body["start"] == body["end"]:
        raise NightError(f"start and end must differ (both {body['start']})")
    return {k: body[k] for k in keys}


def night_began(night, now):
    """The local date the night window holding `now` (a naive local datetime) began on, or None outside it."""
    t, start, end = now.strftime("%H:%M"), night["start"], night["end"]
    if start < end:  # inside one day, e.g. 13:00-15:00
        return now.date() if start <= t < end else None
    if t >= start:  # across midnight, before midnight
        return now.date()
    return now.date() - timedelta(days=1) if t < end else None  # across midnight, after it


def effective_profile(active, night, skip, now):
    """(profile the loop applies, schedule state). State: None (schedule off), "day" (outside the window), "night" or
    "skipped" (a pick during tonight's window paused it until the next start). Pure: the loop, status() and the
    handlers agree, and tests pass datetimes.
    ponytail: wall-clock window; the night the clocks change it runs an hour longer or shorter. Upgrade: zoneinfo
    boundaries if that ever matters."""
    if not night["enabled"]:
        return active, None
    began = night_began(night, now)
    if began is None:
        return active, "day"
    if skip == began.isoformat():
        return active, "skipped"
    return night["profile"], "night"


def curve_pct(points, t):
    """Linear interpolation; flat before the first and after the last point."""
    if t <= points[0]["temp_c"]:
        return float(points[0]["speed_pct"])
    for a, b in zip(points, points[1:]):
        if t <= b["temp_c"]:
            return a["speed_pct"] + (b["speed_pct"] - a["speed_pct"]) * (t - a["temp_c"]) / (b["temp_c"] - a["temp_c"])
    return float(points[-1]["speed_pct"])


def next_target(profile, t, prev):
    """One tick of the curve: rise at once, fall `hysteresis_c` late, never below the stall speed."""
    target = curve_pct(profile["points"], t)
    if prev is not None and target < prev:
        target = min(prev, curve_pct(profile["points"], t + profile["hysteresis_c"]))
    return float(MIN_RUNNING_PCT) if 0 < target < MIN_RUNNING_PCT else target


class FanStore:
    """Active profile, custom curve, night schedule and tonight's skip, persisted to $PIDASH_STATE_DIR/fan.json."""

    def __init__(self, state_dir):
        self.path = Path(state_dir) / "fan.json"
        self.active = "balanced"
        self.custom = {"hysteresis_c": BUILTIN[1]["hysteresis_c"], "points": BUILTIN[1]["points"]}
        # The fan thread reads what a request switches, so all four are switched and read together.
        self.night = dict(DEFAULT_NIGHT)
        self.skip = None  # the ISO date of the night a pick paused, or None; never in an API payload
        self._lock = threading.Lock()
        try:
            data = json.loads(self.path.read_text())
        except FileNotFoundError:
            return
        except (OSError, ValueError) as e:
            log.warning("ignoring unreadable %s: %s", self.path, e)
            return
        if not isinstance(data, dict):
            log.warning("ignoring %s: not an object", self.path)
            return
        try:
            self.custom = validate_curve(data.get("custom"))
        except ValueError as e:
            log.warning("%s: invalid custom curve, using the default: %s", self.path, e)
        if data.get("active") in PROFILE_IDS:
            self.active = data["active"]
        else:
            log.warning("%s: unknown active profile %r, using balanced", self.path, data.get("active"))
        if "night" in data:  # a fan.json from 0.3.0 has neither night nor skip
            try:
                self.night = validate_night(data["night"])
            except ValueError as e:
                log.warning("%s: invalid night schedule, using the default (off): %s", self.path, e)
        skip = data.get("skip")
        if skip is not None:
            try:
                self.skip = date.fromisoformat(skip).isoformat()
            except (TypeError, ValueError):
                log.warning("%s: invalid skip %r, ignoring it", self.path, skip)

    def save(self, active, custom, night, skip):
        """Write first, then switch: a failed write changes nothing."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        with open(tmp, "w") as f:
            json.dump({"active": active, "custom": custom, "night": night, "skip": skip}, f, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.path)
        with self._lock:
            self.active, self.custom, self.night, self.skip = active, custom, night, skip

    def effective(self, now):
        with self._lock:
            active, night, skip = self.active, self.night, self.skip
        return effective_profile(active, night, skip, now)

    def profile(self, pid):
        return {**CUSTOM, **self.custom} if pid == "custom" else next(p for p in BUILTIN if p["id"] == pid)

    def payload(self):
        return {"active": self.active, "constraints": CONSTRAINTS, "profiles": [self.profile(i) for i in PROFILE_IDS],
                "night": self.night}


def boot_trips(root=DT_TRIPS):
    """The active trip temperatures the kernel booted with (config.txt fan_temp*), ascending."""
    temps = []
    for node in root.iterdir() if root.is_dir() else ():
        try:
            if (node / "type").read_bytes().rstrip(b"\0") == b"active":
                temps.append(int.from_bytes((node / "temperature").read_bytes()[:4], "big"))
        except OSError:
            pass  # `name` and `phandle` are files, not trip nodes
    return sorted(temps)


class SysfsFan:
    """The Pi 5 FAN header: hwmon `pwmfan` + the `cpu-thermal` zone's active trips."""

    def __init__(self, hwmon, zone, dt_trips=DT_TRIPS):
        self.pwm_path, self.rpm_path, self.zone, self.dt_trips = hwmon / "pwm1", hwmon / "fan1_input", zone, dt_trips
        # sysfs lists them crit, tepid, warm, hot, vhot: the active trips come in ascending order,
        # which is how boot_trips() pairs them up after a crash.
        self.trips = []
        for i in itertools.count():
            kind = zone / f"trip_point_{i}_type"
            if not kind.exists():
                break
            if kind.read_text().strip() == "active":
                self.trips.append(zone / f"trip_point_{i}_temp")
        self.saved = None

    @classmethod
    def find(cls, hwmon_root=None, thermal_root=None, dt_trips=DT_TRIPS):
        """Return (fan, None) or (None, reason)."""
        try:
            hwmon, zone = find_hwmon("pwmfan", hwmon_root), find_zone("cpu-thermal", thermal_root)
            if hwmon is None:
                return None, "no hwmon device named pwmfan"
            if zone is None:
                return None, "no thermal zone named cpu-thermal"
            return cls(hwmon, zone, dt_trips), None
        except OSError as e:
            return None, f"cannot inspect the fan: {e}"

    def soc_temp(self):
        return milli_c(self.zone / "temp")

    def read(self):
        return int(self.pwm_path.read_text()), int(self.rpm_path.read_text())

    def write_pwm(self, pwm):
        self.pwm_path.write_text(str(int(pwm)))

    def writable(self):
        return bool(self.trips) and all(os.access(p, os.W_OK) for p in [self.pwm_path, *self.trips])

    def released(self):
        return any(int(p.read_text()) == INVALID_TRIP for p in self.trips)

    def release(self):
        current = [int(p.read_text()) for p in self.trips]
        self.saved = current if INVALID_TRIP not in current else None  # a dead run left them invalid
        for p in self.trips:
            p.write_text(str(INVALID_TRIP))

    def restore(self):
        """Full speed first, then the trips: step_wise only walks a fan down from a level it can leave."""
        try:
            self.write_pwm(255)
        finally:
            temps = self.saved or boot_trips(self.dt_trips)
            if len(temps) != len(self.trips):
                raise OSError(f"cannot restore the trip points: have {temps}, need {len(self.trips)} values")
            for p, t in zip(self.trips, temps):
                p.write_text(str(t))


def restore_fan():
    """`pidash --restore-fan` (systemd ExecStopPost=): undo a run that died without cleaning up."""
    dev, err = SysfsFan.find()
    try:
        if dev is None:
            log.info("nothing to restore: %s", err)
        elif not dev.released():
            log.info("nothing to restore: the kernel is in charge of the fan")
        else:
            dev.restore()
            log.warning("fan handed back to the kernel after an unclean stop (pwm 255, trip points restored)")
    except (OSError, ValueError) as e:
        log.error("could not hand the fan back to the kernel: %s", e)
        return 1
    return 0


def sd_notify(msg):
    """READY=1 / WATCHDOG=1 for a Type=notify systemd unit; a no-op anywhere else."""
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr:
        return
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as s:
            s.sendto(msg.encode(), "\0" + addr[1:] if addr[0] == "@" else addr)
    except OSError as e:
        log.debug("sd_notify failed: %s", e)


class FanController:
    """Runs the curve on its own thread, so a slow collector can never stall the fan.

    If the loop dies, the fan goes back to the kernel (pwm 255, trips restored). Under systemd the
    watchdog pings stop too, so the unit is restarted and re-applies the saved profile.
    """

    now = staticmethod(datetime.now)  # the Pi's local wall clock; tests patch it

    def __init__(self, find, store, control=True):
        self.find, self.store = find, store
        self.dev, self.error = None, "the fan has not been probed yet"
        self.disabled = None if control else "PIDASH_FAN_CONTROL=0"
        self.mode = "kernel"
        self.target = None  # target_pct of the last tick, after hysteresis and the stall guard
        self.temp = None    # SoC temperature of the last tick
        self.failsafe = False
        self._why = None    # why the kernel is still in charge; logged once per reason
        self._sched = None  # the last (profile, schedule) the loop ran; a change is logged
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None

    @property
    def driving(self):
        return self.mode != "kernel"

    def start(self):
        self._acquire()
        self._thread = threading.Thread(target=self._run, name="fan", daemon=True)
        self._thread.start()

    def _acquire(self):
        """Take the fan from the kernel governor if allowed. The loop retries every RETRY_S seconds: at boot,
        the pwmfan device and its udev permissions can appear after the service has started."""
        with self._lock:
            if self.driving or self._stop.is_set():
                return
            if self.dev is None:
                self.dev, self.error = self.find()
            if self.dev is None:
                why = self.error
            elif self.disabled:
                why = self.disabled
            elif not self.dev.writable():
                why = "no write access to pwm1 and the trip points; see deploy/90-pidash-fan.rules"
            else:
                try:
                    self.mode = "curve"
                    self.dev.release()
                    log.info("fan control on: profile %s", self.store.effective(self.now())[0])
                    self._why = None
                    return
                except (OSError, ValueError) as e:
                    # Don't retry: every attempt would end in a hand-back that kicks the fan to full speed.
                    why = self.disabled = f"could not release the kernel fan governor: {e}"
                    self._hand_back()
            if why != self._why:
                self._why = why
                log.warning("fan control off (%s): the kernel keeps the config.txt curve", why)

    def _run(self):
        try:
            for n in itertools.count(1):
                if n % RETRY_S == 0:
                    self._acquire()
                self.tick()
                sd_notify("WATCHDOG=1")
                if self._stop.wait(1.0):
                    break
        except Exception:
            log.exception("fan loop died")
        finally:
            self.restore()

    def tick(self):
        self.temp = self.dev.soc_temp() if self.dev else None
        with self._lock:
            if self.driving:
                self.dev.write_pwm(round(self.step(self.temp) * 255 / 100))

    def step(self, t):
        """docs/API.md "Curve semantics": failsafe, curve, hysteresis, stall guard. Returns target_pct."""
        pid, schedule = self.store.effective(self.now())
        if (pid, schedule) != self._sched:
            if self._sched is not None:
                log.info("fan profile %s (schedule: %s)", pid, schedule)
            self._sched = (pid, schedule)
        if t is None or t >= FAILSAFE_C:
            if not self.failsafe:
                log.warning("fan failsafe: SoC at %s °C, forcing full speed until below %s °C", t, FAILSAFE_RELEASE_C)
            self.failsafe = True
        elif t < FAILSAFE_RELEASE_C:
            self.failsafe = False
        if self.failsafe:
            self.target = 100.0
        else:
            self.target = next_target(self.store.profile(pid), t, self.target)
        self.mode = "failsafe" if self.failsafe else "curve"
        return self.target

    def restore(self):
        """Hand the fan back to the kernel if we hold it. Safe to call more than once."""
        with self._lock:
            if self.driving:
                self._hand_back()

    def _hand_back(self):
        self.mode, self.target = "kernel", None
        try:
            self.dev.restore()
            log.info("fan handed back to the kernel (pwm 255, trip points restored)")
        except OSError as e:
            log.error("could not hand the fan back to the kernel: %s", e)

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
        self.restore()

    def status(self):
        """The `fan` section of GET /api/metrics."""
        dev, target = self.dev, self.target
        if dev is None:
            return {"available": False, "error": self.error}
        try:
            pwm, rpm = dev.read()
        except (OSError, ValueError) as e:
            return {"available": False, "error": f"cannot read the fan: {e}"}
        pid, schedule = self.store.effective(self.now())
        return {
            "available": True,
            "rpm": rpm,
            "pwm": pwm,
            "speed_pct": round(pwm * 100 / 255, 1),
            "mode": self.mode,
            "profile": pid,
            "schedule": schedule,
            "target_pct": round(target, 1) if self.driving and target is not None else None,
            "control_temp_c": round(self.temp, 1) if self.temp is not None else None,
            "writable": dev.writable(),
            "reboot_required": False,
        }
