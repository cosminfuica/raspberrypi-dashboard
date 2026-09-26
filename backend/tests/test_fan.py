"""Fan profiles: curve validation and semantics, persistence, the control loop and the sysfs mechanism."""

import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from contract import example
from pidash import fan
from pidash.fan import (BUILTIN, INVALID_TRIP, BodyError, CurveError, FanController, FanStore, SysfsFan, curve_pct,
                        next_target, validate_curve)

BALANCED = BUILTIN[1]


def curve(*pairs, h=2):
    return {"hysteresis_c": h, "points": [{"temp_c": t, "speed_pct": s} for t, s in pairs]}


class Validation(unittest.TestCase):
    def test_documented_curves_are_valid(self):
        for p in BUILTIN:
            self.assertEqual(validate_curve(p), {"hysteresis_c": p["hysteresis_c"], "points": p["points"]})
        body = example("**`PUT /api/fan/profiles/custom`**", 0)
        self.assertEqual(validate_curve(body), body)

    def test_documented_error_message(self):
        with self.assertRaises(CurveError) as e:
            validate_curve(curve((45, 0), (60, 30), (60, 60)))
        self.assertEqual(str(e.exception), "points[2].temp_c must be greater than points[1].temp_c (60 <= 60)")

    def test_rules(self):
        bad = {
            "one point": curve((50, 50)),
            "nine points": curve(*((20 + 5 * i, 10 * i) for i in range(9))),
            "temp not increasing": curve((50, 10), (40, 20)),
            "speed decreasing": curve((40, 50), (50, 40)),
            "temp below 20": curve((19, 0), (50, 50)),
            "temp above 80": curve((50, 0), (81, 100)),
            "speed above 100": curve((40, 0), (50, 101)),
            "speed below 0": curve((40, -1), (50, 10)),
            "fractional temp": curve((40.5, 0), (50, 10)),
            "fractional speed": curve((40, 0), (50, 10.5)),
            "hysteresis above 10": curve((40, 0), (50, 10), h=11),
            "negative hysteresis": curve((40, 0), (50, 10), h=-1),
            "fractional hysteresis": curve((40, 0), (50, 10), h=2.5),
        }
        for name, body in bad.items():
            with self.subTest(name), self.assertRaises(CurveError):
                validate_curve(body)

    def test_malformed_bodies(self):
        for body in (None, [], {"points": []}, {"hysteresis_c": 2}, {"hysteresis_c": "2", "points": []},
                     {"hysteresis_c": 2, "points": [{"temp_c": "40", "speed_pct": 0}]},
                     {"hysteresis_c": 2, "points": [{"temp_c": True, "speed_pct": 0}]},
                     {"hysteresis_c": 2, "points": [[40, 0], [50, 10]]}):
            with self.subTest(body), self.assertRaises(BodyError):
                validate_curve(body)

    def test_equal_speeds_and_whole_floats_are_fine(self):
        self.assertEqual(validate_curve(curve((40.0, 30), (50, 30.0))), curve((40, 30), (50, 30)))


class Semantics(unittest.TestCase):
    def test_interpolation(self):
        pts = BALANCED["points"]
        self.assertEqual(curve_pct(pts, 20), 0)
        self.assertEqual(curve_pct(pts, 59), 40)  # halfway between 55 °C/30 % and 63 °C/50 %
        self.assertEqual(curve_pct(pts, 90), 100)

    def run_temps(self, profile, temps, prev=None):
        out = []
        for t in temps:
            prev = next_target(profile, t, prev)
            out.append(prev)
        return out

    def test_balanced_on_just_above_54_off_at_49(self):
        up = self.run_temps(BALANCED, [50, 54, 54.5, 55])
        self.assertEqual(up[:2], [0, 0])
        self.assertGreater(up[2], 0)
        down = self.run_temps(BALANCED, [53, 51, 49.5, 49], prev=30.0)
        self.assertTrue(all(s >= fan.MIN_RUNNING_PCT for s in down[:3]), down)
        self.assertEqual(down[3], 0)

    def test_sensor_jitter_does_not_toggle_the_fan(self):
        speeds = self.run_temps(BALANCED, [54.4, 54.6, 54.0, 54.6, 54.1, 54.5, 53.9])
        first_on = next(i for i, s in enumerate(speeds) if s > 0)
        self.assertTrue(all(s > 0 for s in speeds[first_on:]), speeds)

    def test_stall_guard(self):
        silent = BUILTIN[0]
        self.assertEqual(fan.MIN_RUNNING_PCT, 8)
        self.assertEqual(next_target(silent, 59.2, None), 8)   # the curve asks for 4 %
        self.assertEqual(next_target(silent, 59.5, None), 10)  # above the guard: unchanged
        self.assertEqual(next_target(silent, 58, None), 0)     # 0 means off


class Store(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def test_defaults(self):
        s = FanStore(self.dir)
        self.assertEqual((s.active, s.custom), ("balanced", {"hysteresis_c": 5, "points": BALANCED["points"]}))
        self.assertEqual(s.payload(), example("**`GET /api/fan/profiles`**"))

    def test_round_trip(self):
        c = curve((30, 20), (60, 100))
        FanStore(self.dir).save("custom", c)
        self.assertEqual(json.loads((self.dir / "fan.json").read_text()), {"active": "custom", "custom": c})
        s = FanStore(self.dir)
        self.assertEqual((s.active, s.custom), ("custom", c))
        self.assertEqual(s.profile("custom")["points"], c["points"])
        self.assertEqual(list(self.dir.iterdir()), [self.dir / "fan.json"])  # no temp file left behind

    def test_bad_files_fall_back(self):
        for content, active in (("{oops", "balanced"), ("[]", "balanced"),
                                ('{"active": "turbo", "custom": null}', "balanced"),
                                ('{"active": "max", "custom": {"hysteresis_c": 99, "points": []}}', "max")):
            (self.dir / "fan.json").write_text(content)
            with self.subTest(content), self.assertLogs("pidash.fan", "WARNING"):
                s = FanStore(self.dir)
            self.assertEqual(s.active, active)
            self.assertEqual(s.custom["points"], BALANCED["points"])

    def test_failed_save_changes_nothing(self):
        s = FanStore(self.dir / "missing")
        (self.dir / "missing").write_text("a file where the directory should be")
        with self.assertRaises(OSError):
            s.save("max", s.custom)
        self.assertEqual(s.active, "balanced")


class FakeDev:
    def __init__(self, temp=45.0, writable=True):
        self.temp, self._writable = temp, writable
        self.pwm, self.writes, self.released, self.restored = 0, [], False, 0

    def soc_temp(self):
        if isinstance(self.temp, Exception):
            raise self.temp
        return self.temp

    def read(self):
        return self.pwm, self.pwm * 20

    def write_pwm(self, pwm):
        self.pwm = pwm
        self.writes.append(pwm)

    def writable(self):
        return self._writable

    def release(self):
        self.released = True

    def restore(self):
        self.pwm, self.released, self.restored = 255, False, self.restored + 1


class Controller(unittest.TestCase):
    def make(self, dev, active="balanced", control=True):
        store = FanStore(tempfile.mkdtemp())
        store.active = active
        return FanController(lambda: (dev, None), store, control)

    def test_curve_and_failsafe(self):
        dev = FakeDev()
        c = self.make(dev)
        c._acquire()
        self.assertTrue(dev.released)
        steps = []
        with self.assertLogs("pidash.fan", "WARNING"):
            for t in (45, 56, 80, 77, 74.9, None, 60):
                dev.temp = t
                c.tick()
                steps.append((c.mode, dev.pwm))
        self.assertEqual(steps, [
            ("curve", 0),        # below the curve
            ("curve", 83),       # 32.5 % at 56 °C
            ("failsafe", 255),   # 80 °C
            ("failsafe", 255),   # still at or above 75 °C
            ("curve", 255),      # below 75 °C: back on the curve, which says ~100 % with hysteresis
            ("failsafe", 255),   # unreadable temperature
            ("curve", 142),      # 60 °C: falls late, to s(60 + 5) = 55.7 %
        ])

    def test_kernel_mode_never_writes(self):
        for dev, control in ((FakeDev(writable=False), True), (FakeDev(), False)):
            c = self.make(dev, control=control)
            with self.assertLogs("pidash.fan", "WARNING"):
                c._acquire()
            c.tick()
            self.assertEqual((c.mode, dev.writes, dev.released), ("kernel", [], False))
            self.assertEqual(c.status()["target_pct"], None)
            self.assertEqual(c.status()["profile"], "balanced")

    def test_takes_over_once_writable(self):
        dev = FakeDev(writable=False)
        c = self.make(dev)
        with self.assertLogs("pidash.fan", "WARNING"):
            c._acquire()
        self.assertEqual(c.mode, "kernel")
        dev._writable = True
        c._acquire()
        self.assertEqual(c.mode, "curve")

    def test_no_fan(self):
        c = FanController(lambda: (None, "no hwmon device named pwmfan"), FanStore(tempfile.mkdtemp()))
        with self.assertLogs("pidash.fan", "WARNING"):
            c._acquire()
        c.tick()
        self.assertEqual(c.status(), {"available": False, "error": "no hwmon device named pwmfan"})

    def test_failed_release_hands_back(self):
        dev = FakeDev()
        dev.release = mock.Mock(side_effect=PermissionError("denied"))
        c = self.make(dev)
        with self.assertLogs("pidash.fan", "WARNING") as logs:
            c._acquire()
            c._acquire()  # no second attempt
        self.assertEqual((c.mode, dev.restored, dev.release.call_count), ("kernel", 1, 1))
        self.assertIn("could not release the kernel fan governor: denied", logs.output[-1])

    def test_dead_loop_hands_back_at_full_speed(self):
        dev = FakeDev(45)
        c = self.make(dev, active="silent")
        with self.assertLogs("pidash.fan", "ERROR"):
            c.start()
            time.sleep(0.2)
            self.assertEqual((c.mode, dev.pwm), ("curve", 0))
            dev.temp = RuntimeError("sensor exploded")
            c._thread.join(3)
        self.assertEqual((c.mode, dev.pwm, dev.restored), ("kernel", 255, 1))
        c.stop()
        self.assertEqual(dev.restored, 1)  # handed back once

    def test_stop_hands_back(self):
        dev = FakeDev(45)
        c = self.make(dev, active="performance")
        c.start()
        time.sleep(0.2)
        self.assertEqual(c.status()["target_pct"], 38.3)
        c.stop()
        self.assertEqual((c.mode, dev.pwm, dev.restored, c._thread.is_alive()), ("kernel", 255, 1, False))


def fake_sysfs(root, trips=(55000, 63000, 70000, 75000)):
    """hwmon + thermal zone + device-tree trips laid out like the Pi 5's."""
    hw = root / "hwmon" / "hwmon3"
    hw.mkdir(parents=True)
    (root / "hwmon" / "hwmon0").mkdir()
    (root / "hwmon" / "hwmon0" / "name").write_text("cpu_thermal\n")
    for name, value in (("name", "pwmfan"), ("pwm1", "0"), ("fan1_input", "0")):
        (hw / name).write_text(value + "\n")
    zone = root / "thermal" / "thermal_zone0"
    zone.mkdir(parents=True)
    (zone / "type").write_text("cpu-thermal\n")
    (zone / "temp").write_text("45100\n")
    for i, (kind, temp) in enumerate([("critical", 110000)] + [("active", t) for t in trips]):
        (zone / f"trip_point_{i}_type").write_text(kind + "\n")
        (zone / f"trip_point_{i}_temp").write_text(f"{temp}\n")
    dt = root / "dt"
    for node, kind, temp in (("cpu-crit", "critical", 110000), ("cpu-hot", "active", 70000), ("cpu-tepid", "active", 55000),
                             ("cpu-vhot", "active", 75000), ("cpu-warm", "active", 63000)):
        (dt / node).mkdir(parents=True)
        (dt / node / "type").write_bytes(kind.encode() + b"\0")
        (dt / node / "temperature").write_bytes(temp.to_bytes(4, "big"))
    (dt / "name").write_bytes(b"trips\0")
    return root / "hwmon", root / "thermal", dt


class Sysfs(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.dev, err = SysfsFan.find(*fake_sysfs(self.root))
        self.assertIsNone(err)
        self.zone = self.root / "thermal" / "thermal_zone0"

    def trips(self):
        return [int((self.zone / f"trip_point_{i}_temp").read_text()) for i in range(5)]

    def test_find(self):
        self.assertEqual(self.dev.soc_temp(), 45.1)
        self.assertEqual(self.dev.read(), (0, 0))
        self.assertTrue(self.dev.writable())
        self.assertEqual(SysfsFan.find(self.root / "nope", self.root / "thermal")[1], "no hwmon device named pwmfan")

    def test_release_keeps_the_critical_trip_and_restore_puts_everything_back(self):
        self.dev.release()
        self.assertEqual(self.trips(), [110000] + [INVALID_TRIP] * 4)
        self.assertTrue(self.dev.released())
        self.dev.write_pwm(90)
        self.dev.restore()
        self.assertEqual(self.trips(), [110000, 55000, 63000, 70000, 75000])
        self.assertEqual(self.dev.read()[0], 255)
        self.assertFalse(self.dev.released())

    def test_restore_after_a_crash_uses_the_boot_values(self):
        for i in range(1, 5):  # a run that died left the trips released
            (self.zone / f"trip_point_{i}_temp").write_text(str(INVALID_TRIP))
        self.dev.release()
        self.dev.restore()
        self.assertEqual(self.trips(), [110000, 55000, 63000, 70000, 75000])

    def test_restore_fan_command(self):
        with mock.patch.object(SysfsFan, "find", return_value=(self.dev, None)):
            fan.restore_fan()  # nothing released: no-op
            self.assertEqual(self.dev.read()[0], 0)
            self.dev.release()
            with self.assertLogs("pidash.fan", "WARNING"):
                fan.restore_fan()
        self.assertEqual((self.trips()[1], self.dev.read()[0]), (55000, 255))


if __name__ == "__main__":
    unittest.main()
