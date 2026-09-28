"""Auth, CSRF, audit and the privileged actions (reboot, update, service restart).

The HTTP tests run a real mock-mode server, like test_api. The real `System` is tested with subprocess.run
mocked, and deploy/pidash-update runs for real against a fake apt-get. Nothing here needs root.
"""

import json
import os
import re
import stat
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest import mock

from test_api import call, serve

from pidash import system
from pidash.app import create_app
from pidash.auth import ApiError
from pidash.system import SERVICE_NAME, System, job_status

ROOT = Path(__file__).resolve().parents[2]
SUDOERS = ROOT / "deploy" / "pidash.sudoers"
UPDATE_SCRIPT = ROOT / "deploy" / "pidash-update"
CSRF = {"X-Pidash-CSRF": "1"}


def post(base, path, body=None, headers=None):
    """A POST like the browser's: JSON, extra headers, and the (status, body, response headers) back."""
    req = urllib.request.Request(base + path, json.dumps(body).encode() if body is not None else b"", method="POST",
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.load(r), r.headers
    except urllib.error.HTTPError as e:
        return e.code, json.load(e), e.headers


def get(base, path, headers=None):
    req = urllib.request.Request(base + path, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def audit_lines(state):
    p = Path(state) / "audit.log"
    return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []


class Endpoints(unittest.TestCase):
    """One mock server; the update replays quickly."""

    @classmethod
    def setUpClass(cls):
        cls.state = tempfile.mkdtemp()
        cls.enterClassContext(mock.patch.object(system.MockSystem, "step_s", 0.01))
        cls.base = cls.enterClassContext(serve(cls.state, PIDASH_TOKEN="dev"))

    def test_every_action_needs_auth(self):
        for method, path in (("POST", "/api/system/reboot"), ("POST", "/api/system/update"),
                             ("GET", "/api/system/update"), ("POST", "/api/services/ssh.service/restart")):
            for token in (None, "wrong"):
                with self.subTest(method=method, path=path, token=token):
                    status, body = call(self.base, path, method, {} if method == "POST" else None, token)
                    self.assertEqual((status, body["error"]), (401, "unauthorized"))

    def test_every_mutating_route_is_protected(self):
        """A later POST/PUT/PATCH/DELETE that forgets Depends(auth.require) fails here."""
        app = create_app({"PIDASH_MOCK": "1", "PIDASH_STATE_DIR": self.state, "PIDASH_STATIC_DIR": "/nonexistent"})
        open_routes = {"/api/auth/login", "/api/auth/logout"}
        for route in app.routes:
            methods = getattr(route, "methods", None) or set()
            if methods - {"GET", "HEAD", "OPTIONS"} and route.path not in open_routes:
                deps = {d.call for d in route.dependant.dependencies}
                self.assertIn(app.state.auth.require, deps, route.path)

    def test_session_login_csrf_logout(self):
        self.assertEqual(post(self.base, "/api/auth/login", {"token": "dev"})[:2],
                         (403, {"error": "csrf_header_missing", "message": "a browser POST must send the header X-Pidash-CSRF: 1"}))
        self.assertEqual(post(self.base, "/api/auth/login", {"token": "nope"}, CSRF)[:2],
                         (401, {"error": "unauthorized", "message": "wrong token"}))
        self.assertEqual(post(self.base, "/api/auth/login", {"tok": 1}, CSRF)[0], 422)
        status, body, headers = post(self.base, "/api/auth/login", {"token": "dev"}, CSRF)
        self.assertEqual((status, body["authenticated"]), (200, True))
        set_cookie = headers["set-cookie"]
        for attr in ("HttpOnly", "SameSite=strict", "Path=/api", "Max-Age=604800"):
            self.assertIn(attr, set_cookie)
        cookie = {"Cookie": set_cookie.split(";")[0]}

        self.assertEqual(get(self.base, "/api/auth", cookie), (200, {"authenticated": True}))
        self.assertEqual(get(self.base, "/api/system/update", cookie)[0], 200)  # a read needs no CSRF header
        # A cookie alone can't change anything: that is what a forged cross-site form would send.
        status, body, _ = post(self.base, "/api/services/ssh.service/restart", None, cookie)
        self.assertEqual((status, body["error"]), (403, "csrf_header_missing"))
        status, body, _ = post(self.base, "/api/services/ssh.service/restart", None, {**cookie, **CSRF})
        self.assertEqual((status, body["name"], body["active"]), (200, "ssh.service", "active"))

        forged = {"Cookie": re.sub(r"\.\w+$", ".0000", cookie["Cookie"])}
        self.assertEqual(get(self.base, "/api/auth", forged)[0], 401)
        expired = {"Cookie": re.sub(r"=\d+\.", "=1000.", cookie["Cookie"])}
        self.assertEqual(get(self.base, "/api/auth", expired)[0], 401)

        status, body, headers = post(self.base, "/api/auth/logout", None, CSRF)
        self.assertEqual((status, body), (200, {"authenticated": False}))
        self.assertIn("Max-Age=0", headers["set-cookie"])

    def test_restart_validates_the_name(self):
        bad = {"ssh": 422, "ssh.socket": 422, "-.service": 422, "--now.service": 422, "a b.service": 422,
               "systemd-fsck@dev-disk-by\\x2dx.service": 422, "nope.service": 404}
        for name, want in bad.items():
            with self.subTest(name):
                path = "/api/services/" + urllib.parse.quote(name, safe="") + "/restart"
                self.assertEqual(call(self.base, path, "POST", {}, "dev")[0], want)
        status, body = call(self.base, "/api/services/ssh.service/restart", "POST", {}, "dev")
        self.assertEqual((status, body["name"], body["active"], body["sub"]), (200, "ssh.service", "active", "running"))
        self.assertAlmostEqual(body["active_since"], time.time(), delta=5)

    def test_update_job_and_409(self):
        status, job = call(self.base, "/api/system/update", "POST", {}, "dev")
        self.assertEqual((status, job["state"], job["exit_code"], job["ended_at"]), (202, "running", None, None))
        self.assertRegex(job["id"], r"^[0-9a-f]{32}$")
        self.assertAlmostEqual(job["started_at"], time.time(), delta=5)
        status, body = call(self.base, "/api/system/update", "POST", {}, "dev")  # one at a time
        self.assertEqual((status, body["error"]), (409, "update_running"))
        status, body = call(self.base, "/api/system/reboot", "POST", {}, "dev")  # no reboot mid-update
        self.assertEqual((status, body["error"]), (409, "update_running"))

        text, offset, s = job["log"], job["offset"], job
        for _ in range(200):  # poll like the frontend: only the new text each time
            status, s = call(self.base, f"/api/system/update?offset={offset}", token="dev")
            text, offset = text + s["log"], s["offset"]
            if s["state"] != "running":
                break
            time.sleep(0.02)
        self.assertEqual((s["id"], s["state"], s["exit_code"], s["reboot_required"]), (job["id"], "succeeded", 0, True))
        self.assertGreaterEqual(s["ended_at"], s["started_at"])
        self.assertEqual(text, system.MOCK_APT)  # every line once, no gaps, no markers

        status, body = call(self.base, "/api/system/reboot", "POST", {}, "dev")
        self.assertEqual((status, body), (202, {"rebooting": True}))
        for _ in range(50):  # the reboot runs after the response: in mock mode it clears the flag
            if not call(self.base, "/api/system/update", token="dev")[1]["reboot_required"]:
                break
            time.sleep(0.02)
        else:
            self.fail("the mock reboot did not clear reboot_required")

    def test_audit_log(self):
        call(self.base, "/api/services/nope.service/restart", "POST", {}, "wrong")
        call(self.base, "/api/fan/profile", "PUT", {"id": "max"}, "dev")
        lines = audit_lines(self.state)
        self.assertLessEqual({"ts", "user", "ip", "auth", "action", "status"}, set(lines[-1]))
        self.assertEqual({k: lines[-2][k] for k in ("ip", "auth", "action", "status")},
                         {"ip": "127.0.0.1", "auth": None, "action": "POST /api/services/nope.service/restart", "status": 401})
        self.assertEqual({k: lines[-1][k] for k in ("auth", "action", "status")},
                         {"auth": "bearer", "action": "PUT /api/fan/profile", "status": 200})
        self.assertNotIn("dev", (Path(self.state) / "audit.log").read_text())  # never the token
        self.assertEqual(stat.S_IMODE(os.stat(Path(self.state) / "audit.log").st_mode), 0o600)
        call(self.base, "/api/info")
        self.assertEqual(len(audit_lines(self.state)), len(lines))  # reads aren't audited


class NoToken(unittest.TestCase):
    def test_everything_is_refused(self):
        with serve() as base:
            for path in ("/api/system/reboot", "/api/system/update", "/api/services/ssh.service/restart"):
                status, body = call(base, path, "POST", {}, "anything")
                self.assertEqual((status, body["error"]), (403, "auth_not_configured"), path)
            self.assertEqual(post(base, "/api/auth/login", {"token": ""}, CSRF)[1]["error"], "auth_not_configured")


class Sudoers(unittest.TestCase):
    def test_same_pattern_as_the_app(self):
        rule = re.search(r"\^restart --no-block -- (.+)\$$", SUDOERS.read_text(), re.M)
        self.assertEqual(rule[1], SERVICE_NAME.pattern)

    @unittest.skipUnless(Path("/usr/bin/visudo").exists() or Path("/usr/sbin/visudo").exists(), "no visudo")
    def test_visudo_accepts_it(self):
        visudo = next(p for p in ("/usr/sbin/visudo", "/usr/bin/visudo") if Path(p).exists())
        p = subprocess.run([visudo, "-cf", str(SUDOERS)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)


def completed(code=0, out="", err=""):
    return subprocess.CompletedProcess([], code, out, err)


class RealSystem(unittest.TestCase):
    """System with subprocess.run mocked: the exact argv, and how systemctl's answers are read."""

    def setUp(self):
        d = Path(tempfile.mkdtemp())
        self.log, self.flag = d / "update.log", d / "reboot-required"
        self.sys = System(self.log, self.flag)
        self.calls, self.unit = [], {"ActiveState": "inactive", "Job": ""}

        def run(argv, **kw):
            self.assertNotIsInstance(argv, str)  # an argv list: never a shell string
            self.assertNotIn("shell", kw)
            self.calls.append(list(argv))
            return self.fake(list(argv))
        patcher = mock.patch("subprocess.run", side_effect=run)
        patcher.start()
        self.addCleanup(patcher.stop)

    def fake(self, argv):
        if argv[:2] == ["systemctl", "show"]:
            unit = argv[-1]
            props = {"pidash-update.service": self.unit}.get(unit) or {
                "Description": "OpenBSD Secure Shell server", "LoadState": "loaded", "ActiveState": "active",
                "SubState": "running", "UnitFileState": "enabled", "ActiveEnterTimestamp": "@1790358100",
                "MemoryCurrent": "5767168", "Job": "", "MainPID": "1234", "SuccessAction": "none", "FailureAction": "none",
                "RefuseManualStart": "no", "RefuseManualStop": "no", "StandardInput": "null",
                **{"systemd-poweroff.service": {"SuccessAction": "poweroff-force"},
                   "systemd-battery-check.service": {"FailureAction": "poweroff-force"},
                   "systemd-tmpfiles-setup.service": {"RefuseManualStop": "yes"},
                   "emergency.service": {"StandardInput": "tty-force"}}.get(unit, {})}
            return completed(0, "".join(f"{k}={v}\n" for k, v in props.items()))
        if argv[:3] == ["sudo", "-n", system.SYSTEMCTL] and argv[3] == "start":
            self.log.write_bytes(b"pidash-update: started 1790500000 abc123\nHit:1 http://deb.debian.org trixie\npartial")
            self.unit = {"ActiveState": "activating", "Job": "42"}
        return completed()

    def sudo_calls(self):
        return [c for c in self.calls if c[0] == "sudo"]

    def test_update(self):
        s = self.sys.start_update()
        self.assertEqual(self.sudo_calls(), [["sudo", "-n", "/usr/bin/systemctl", "start", "--no-block", "pidash-update.service"]])
        self.assertEqual({k: s[k] for k in ("id", "state", "exit_code", "started_at", "ended_at", "reboot_required")},
                         {"id": "abc123", "state": "running", "exit_code": None, "started_at": 1790500000,
                          "ended_at": None, "reboot_required": False})
        self.assertEqual(s["log"], "Hit:1 http://deb.debian.org trixie\n")  # not the half-written line
        with self.assertRaises(ApiError) as e:
            self.sys.start_update()
        self.assertEqual(e.exception.status, 409)
        with self.assertRaises(ApiError) as e:
            self.sys.reboot()
        self.assertEqual(e.exception.status, 409)
        self.assertEqual(len(self.sudo_calls()), 1)

        with open(self.log, "ab") as f:
            f.write(b" line\nE: Unable to fetch some archives\npidash-update: exit 100 at 1790500060\n")
        self.unit = {"ActiveState": "failed", "Job": ""}
        self.flag.touch()
        s = self.sys.update_status(s["offset"])
        self.assertEqual({k: s[k] for k in ("state", "exit_code", "ended_at", "reboot_required", "log")},
                         {"state": "failed", "exit_code": 100, "ended_at": 1790500060, "reboot_required": True,
                          "log": "partial line\nE: Unable to fetch some archives\n"})

    def test_update_that_never_starts(self):
        self.fake = lambda argv: completed(0, "ActiveState=inactive\nJob=\n")
        with mock.patch.object(system, "UPDATE_START_WAIT_S", 0.2), self.assertRaises(ApiError) as e:
            self.sys.start_update()
        self.assertEqual((e.exception.status, e.exception.code), (500, "update_not_started"))

    def test_sudo_refused(self):
        self.fake = lambda argv: completed(1, err="sudo: a password is required\n") if argv[0] == "sudo" else completed(
            0, "ActiveState=inactive\n")
        with self.assertRaises(ApiError) as e:
            self.sys.reboot()
        self.assertEqual(e.exception.status, 500)
        self.assertIn("sudo: a password is required", e.exception.message)
        self.assertIn("/etc/sudoers.d/pidash", e.exception.message)

    def test_reboot(self):
        later = self.sys.reboot()
        self.assertEqual(self.sudo_calls(), [["sudo", "-n", "-l", "/usr/bin/systemctl", "reboot"]])  # a check only
        later()
        self.assertEqual(self.sudo_calls()[-1], ["sudo", "-n", "/usr/bin/systemctl", "reboot"])

    def test_restart(self):
        row, later = self.sys.restart("ssh.service")
        self.assertIsNone(later)
        self.assertEqual(self.sudo_calls(), [["sudo", "-n", "/usr/bin/systemctl", "restart", "--no-block", "--", "ssh.service"]])
        self.assertEqual(row, {"name": "ssh.service", "description": "OpenBSD Secure Shell server", "load": "loaded",
                               "active": "active", "sub": "running", "enabled": "enabled",
                               "active_since": 1790358100, "memory_bytes": 5767168})

    def test_restart_refusals(self):
        for name in ("systemd-poweroff.service", "systemd-battery-check.service", "systemd-tmpfiles-setup.service",
                     "emergency.service", "pidash-update.service"):
            with self.subTest(name):
                with self.assertRaises(ApiError) as e:
                    self.sys.restart(name)
                self.assertEqual((e.exception.status, e.exception.code), (403, "restart_not_allowed"))
        self.assertEqual(self.sudo_calls(), [])

    def test_restarting_pidash_itself_answers_first(self):
        with mock.patch("os.getpid", return_value=1234):  # MainPID of the fake unit
            row, later = self.sys.restart("pidash.service")
        self.assertEqual((row["active"], self.sudo_calls()), ("active", []))
        later()
        self.assertEqual(self.sudo_calls(), [["sudo", "-n", "/usr/bin/systemctl", "restart", "--no-block", "--", "pidash.service"]])


class UpdateScript(unittest.TestCase):
    """deploy/pidash-update for real, with a fake apt-get first on PATH."""

    def run_script(self, apt):
        d = Path(tempfile.mkdtemp())
        (d / "apt-get").write_text(f"#!/bin/sh\necho \"apt-get $* [$DEBIAN_FRONTEND]\"\n{apt}\n")
        (d / "apt-get").chmod(0o755)
        env = {**os.environ, "PATH": f"{d}:{os.environ['PATH']}", "PIDASH_UPDATE_LOG": str(d / "log"),
               "INVOCATION_ID": "0123abcd"}
        p = subprocess.run(["sh", str(UPDATE_SCRIPT)], env=env, capture_output=True, text=True, timeout=10)
        return p.returncode, d / "log"

    def test_success(self):
        code, log = self.run_script("exit 0")
        self.assertEqual(code, 0)
        s = job_status(log, running=False)
        self.assertEqual((s["id"], s["state"], s["exit_code"]), ("0123abcd", "succeeded", 0))
        self.assertAlmostEqual(s["started_at"], time.time(), delta=10)
        self.assertEqual(s["log"], "apt-get update [noninteractive]\napt-get -y --with-new-pkgs -o "
                                   "Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade [noninteractive]\n")

    def test_failure_stops_before_upgrade(self):
        code, log = self.run_script('[ "$1" = update ] && echo "E: network down" && exit 100')
        s = job_status(log, running=False)
        self.assertEqual((code, s["state"], s["exit_code"]), (100, "failed", 100))
        self.assertNotIn("upgrade", s["log"])

    def test_log_states(self):
        d = Path(tempfile.mkdtemp())
        self.assertEqual(job_status(d / "missing", running=False)["state"], "idle")
        (d / "cut").write_bytes(b"pidash-update: started 1 x\nSetting up libc6 ...\n")  # the Pi went down mid-update
        self.assertEqual(job_status(d / "cut", running=False)["state"], "failed")
        (d / "utf8").write_bytes("pidash-update: started 1 x\nok\nhalf \u00e9".encode()[:-1])
        s = job_status(d / "utf8", running=True)
        self.assertEqual((s["log"], s["offset"]), ("ok\n", 30))
        (d / "nonl").write_bytes(b"pidash-update: started 1 x\nno newline at the end" b"pidash-update: exit 0 at 2\n")
        s = job_status(d / "nonl", running=False)
        self.assertEqual((s["state"], s["exit_code"], s["log"]), ("succeeded", 0, "no newline at the end"))


class Threads(unittest.TestCase):
    def test_concurrent_update_requests_start_one(self):
        """Two requests at the same moment: one 202, one 409."""
        with mock.patch.object(system.MockSystem, "step_s", 0.05), serve(PIDASH_TOKEN="dev") as base:
            results = []
            ts = [threading.Thread(target=lambda: results.append(call(base, "/api/system/update", "POST", {}, "dev")[0]))
                  for _ in range(2)]
            for t in ts:
                t.start()
            for t in ts:
                t.join()
        self.assertEqual(sorted(results), [202, 409])


if __name__ == "__main__":
    unittest.main()
