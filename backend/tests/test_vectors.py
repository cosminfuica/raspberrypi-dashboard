"""fan_vectors.json against fan.py. frontend/src/curve.test.js runs the same file against curve.js, so both languages
agree on the curve, the stall guard, the failsafe, validation, the night schedule and pwm."""

import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from pidash import fan
from pidash.fan import (BUILTIN, CONSTRAINTS, FAILSAFE_C, FAILSAFE_RELEASE_C, PROFILE_IDS, BodyError, CurveError,
                        FanController, FanStore, NightError, curve_pct, effective_profile, next_target, night_began,
                        validate_curve, validate_night)

V = json.loads((Path(__file__).resolve().parent / "fan_vectors.json").read_text())
CURVES = V["curves"]


def judge(fn, body, codes):
    try:
        fn(body)
        return None
    except tuple(codes) as e:
        return [codes[type(e)], str(e)]


class Vectors(unittest.TestCase):
    def test_constants(self):
        self.assertEqual(V["constraints"], CONSTRAINTS)
        self.assertEqual(V["limits"], {"fan_failsafe_c": FAILSAFE_C, "fan_failsafe_release_c": FAILSAFE_RELEASE_C})
        self.assertEqual(V["profile_ids"], PROFILE_IDS)
        for p in BUILTIN:
            self.assertEqual(CURVES[p["id"]], {"hysteresis_c": p["hysteresis_c"], "points": p["points"]})
        self.assertIsNone(judge(validate_curve, CURVES["custom"], {CurveError: "invalid_curve"}))

    def test_speed_at(self):
        for v in V["speed_at"]:
            with self.subTest(v):
                self.assertAlmostEqual(curve_pct(CURVES[v["curve"]]["points"], v["t"]), v["want"], delta=1e-9)

    def test_ticks(self):
        for v in V["ticks"]:
            prev = None
            for t, (mode, want) in zip(v["temps"], v["want"], strict=True):
                with self.subTest(curve=v["curve"], t=t):
                    prev = next_target(CURVES[v["curve"]], t, prev)
                    self.assertEqual(mode, "curve")  # next_target has no failsafe; failsafe_ticks covers it
                    self.assertLess(abs(prev - want), 1e-9)

    def test_failsafe_ticks(self):
        for v in V["failsafe_ticks"]:
            store = FanStore(tempfile.mkdtemp())  # as test_fan.Controller.make
            store.active = v["curve"]
            if v["curve"] == "custom":
                store.custom = CURVES["custom"]
            c = FanController(lambda: (None, "no fan"), store)
            c.target = None
            with self.assertLogs("pidash.fan", "WARNING"):  # every run enters the failsafe once
                for t, (mode, want) in zip(v["temps"], v["want"], strict=True):
                    c.step(t)
                    self.assertEqual(c.mode, mode, (v["curve"], t))
                    self.assertLess(abs(c.target - want), 1e-9, (v["curve"], t))

    def test_validate_curve(self):
        for v in V["validate_curve"]:
            with self.subTest(v["body"]):
                self.assertEqual(judge(validate_curve, v["body"], {BodyError: "invalid_request", CurveError: "invalid_curve"}),
                                 v["want"])

    def test_night_began(self):
        for v in V["night_began"]:
            with self.subTest(v):
                began = night_began(v["night"], datetime.fromisoformat(v["now"]))
                self.assertEqual(began.isoformat() if began else None, v["want"])

    def test_applied(self):
        for v in V["applied"]:
            with self.subTest(v):
                got = effective_profile(v["active"], v["night"], v["skip"], datetime.fromisoformat(v["now"]))
                self.assertEqual(list(got), v["want"])

    def test_validate_night(self):
        for v in V["validate_night"]:
            with self.subTest(v["body"]):
                self.assertEqual(judge(validate_night, v["body"], {BodyError: "invalid_request", NightError: "invalid_night"}),
                                 v["want"])

    def test_pwm(self):
        for v in V["pwm"]:
            with self.subTest(v):
                self.assertEqual(fan.pwm_of(v["target"]), v["want"])


if __name__ == "__main__":
    unittest.main()
