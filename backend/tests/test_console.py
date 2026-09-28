"""The web console, /api/console/ws (docs/API.md "Console"): a real bash on a PTY behind a real mock-mode server.

The server runs in a thread of this process, so every shell it starts is a child of this process: `children()`
would list a zombie.
"""

import contextlib
import json
import os
import re
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect

from test_api import call, serve
from test_system import CSRF, post

from pidash import console
from pidash.app import create_app
from pidash.console import resize_of

BEARER = {"Authorization": "Bearer dev"}
ON = {"PIDASH_TOKEN": "dev", "PIDASH_CONSOLE": "1"}  # mock mode: off unless asked for


def open_console(base, headers=BEARER, **kw):
    return connect(base.replace("http", "ws", 1) + "/api/console/ws", additional_headers=headers, open_timeout=5, **kw)


def type_line(conn, line):
    conn.send(line.encode() + b"\r")


def read_until(conn, marker, timeout=10):
    """The terminal's output up to `marker`. Markers are computed by the shell ($((6*7)) -> 42), so the echo of
    the typed command can't match them."""
    out, deadline = b"", time.monotonic() + timeout
    while marker not in out:
        try:
            out += conn.recv(max(0.01, deadline - time.monotonic()))
        except TimeoutError:
            raise AssertionError(f"no {marker!r} in the output: {out[-3000:]!r}") from None
    return out


def closed(conn, timeout=10):
    """Reads to the end: the server's (close code, reason)."""
    deadline = time.monotonic() + timeout
    try:
        while True:
            conn.recv(max(0.01, deadline - time.monotonic()))
    except ConnectionClosed as e:
        return e.rcvd.code, e.rcvd.reason


def audit(state, action, n=1, timeout=10):
    """The audit lines for `action`, once there are at least n."""
    deadline, path = time.monotonic() + timeout, Path(state) / "audit.log"
    while True:
        text = path.read_text() if path.exists() else ""
        lines = [x for x in map(json.loads, text.split("\n")[:-1]) if x["action"] == action]  # whole lines only
        if len(lines) >= n:
            return lines
        if time.monotonic() > deadline:
            raise AssertionError(f"fewer than {n} {action!r} audit lines: {lines}")
        time.sleep(0.05)


def last_end(state):
    """The "console end" line of the session that ended last, once every session that started has ended."""
    ends = audit(state, "console end", len(audit(state, "console start", 0)))
    return ends[-1] if ends else None


def children():
    """(pid, state) of this process's children, zombies included."""
    kids = []
    for stat in Path("/proc").glob("[0-9]*/stat"):
        with contextlib.suppress(OSError):
            state, ppid = stat.read_text().rsplit(")", 1)[1].split()[:2]
            if int(ppid) == os.getpid():
                kids.append((int(stat.parent.name), state))
    return kids


def gone(pid, timeout=5):
    deadline = time.monotonic() + timeout
    while Path(f"/proc/{pid}").exists():
        if time.monotonic() > deadline:
            return False
        time.sleep(0.05)
    return True


class Refused(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.state = tempfile.mkdtemp()
        cls.base = cls.enterClassContext(serve(cls.state, **ON))

    def test_needs_sign_in_and_the_same_origin(self):
        cases = {"no auth": {"headers": {}}, "wrong token": {"headers": {"Authorization": "Bearer nope"}},
                 "forged cookie": {"headers": {"Cookie": "pidash_session=9999999999.00"}},
                 "other site": {"origin": "http://evil.example"}}
        for name, kw in cases.items():
            with self.subTest(name), self.assertRaises(InvalidStatus) as e:
                open_console(self.base, **kw)
            self.assertEqual(e.exception.response.status_code, 403, name)  # before any shell starts
        reasons = [x["reason"] for x in audit(self.state, "console refused", 4)]
        self.assertEqual(reasons, ["unauthorized"] * 3 + ["cross_origin"])
        self.assertEqual(children(), [])

    def test_a_browser_signs_in_with_the_session_cookie(self):
        _, _, headers = post(self.base, "/api/auth/login", {"token": "dev"}, CSRF)
        cookie = {"Cookie": headers["set-cookie"].split(";")[0]}
        with open_console(self.base, cookie, origin="http://" + self.base.split("//")[1]) as conn:
            type_line(conn, "echo $((6*7))-ok")
            read_until(conn, b"42-ok")
        self.assertEqual(audit(self.state, "console start")[-1]["auth"], "session")

    def test_on_by_default_only_with_a_token_and_not_in_mock_mode(self):
        for env in ({"PIDASH_CONSOLE": "1"}, {"PIDASH_TOKEN": "dev"}, {**ON, "PIDASH_CONSOLE": "0"},
                    {**ON, "PIDASH_CONSOLE": "false"}, {**ON, "PIDASH_CONSOLE": "maybe"}):
            with self.subTest(env), serve(**env) as base:
                self.assertIs(call(base, "/api/info")[1]["console_enabled"], False)
                with self.assertRaises(InvalidStatus) as e:
                    open_console(base)
                self.assertEqual(e.exception.response.status_code, 403)
        real = {"PIDASH_STATE_DIR": tempfile.mkdtemp(), "PIDASH_STATIC_DIR": "/nonexistent"}  # not started
        self.assertIs(create_app({**real, "PIDASH_TOKEN": "x"}).state.console.enabled, True)
        self.assertIs(create_app({**real, "PIDASH_TOKEN": "x", "PIDASH_CONSOLE": "off"}).state.console.enabled, False)
        self.assertIs(create_app(real).state.console.enabled, False)


class Session(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.state = tempfile.mkdtemp()
        cls.base = cls.enterClassContext(serve(cls.state, **ON))

    def tearDown(self):
        last_end(self.state)  # every session has ended...
        self.assertEqual(children(), [])  # ...and its shell was reaped

    def test_shell_resize_ctrl_c_top_and_exit(self):
        self.assertIs(call(self.base, "/api/info")[1]["console_enabled"], True)
        home = str(Path(self.state) / "console")
        with mock.patch.dict(os.environ, {"PIDASH_TOKEN": "secret"}), open_console(self.base) as conn:
            conn.send(json.dumps({"type": "resize", "cols": 100, "rows": 40}))
            type_line(conn, 'uname -a; stty size; echo "[${PIDASH_TOKEN-unset}][$HOME][$PWD][$TERM]$((6*7))-env"')
            out = read_until(conn, b"42-env")
            self.assertIn(os.uname().release.encode(), out)
            self.assertIn(b"40 100", out)
            self.assertIn(f"[unset][{home}][{home}][xterm-256color]42-env".encode(), out)  # pidash's env stays out

            type_line(conn, "echo $((3*3))-go; sleep 30")
            read_until(conn, b"9-go")
            time.sleep(0.3)
            started = time.monotonic()
            conn.send(b"\x03")  # Ctrl+C: the terminal sends SIGINT to its foreground job (job control works)
            type_line(conn, "echo rc=$?")
            read_until(conn, b"rc=130")
            self.assertLess(time.monotonic() - started, 5)

            type_line(conn, "top -d 0.5")  # interactive, full screen
            read_until(conn, b"load average")
            conn.send(json.dumps({"type": "resize", "cols": 70, "rows": 20}))  # while top runs (SIGWINCH)
            time.sleep(0.6)
            conn.send(b"q")
            type_line(conn, "stty size; echo $((2*3))-after-top")
            self.assertIn(b"20 70", read_until(conn, b"6-after-top"))

            type_line(conn, "exit 3")
            self.assertEqual(closed(conn), (1000, "shell exited (status 3)"))
        start, end = audit(self.state, "console start")[-1], last_end(self.state)
        self.assertEqual((start["auth"], start["ip"], end["pid"], end["reason"]),
                         ("bearer", "127.0.0.1", start["pid"], "shell exited (status 3)"))
        self.assertGreater(end["duration_s"], 0)

    def test_closing_the_socket_hangs_up_the_shell_and_its_jobs(self):
        with open_console(self.base) as conn:
            type_line(conn, "sleep 300 & echo job=$! shell=$$ $((7*6))-ids")
            out = read_until(conn, b"42-ids")
        job, shell = (int(re.search(rb"%s=(\d+)" % k, out)[1]) for k in (b"job", b"shell"))
        self.assertEqual(audit(self.state, "console start")[-1]["pid"], shell)  # no process between pidash and bash
        self.assertEqual(last_end(self.state)["reason"], "client disconnected")
        self.assertTrue(gone(shell) and gone(job))

    def test_a_shell_that_ignores_the_hangup_is_killed(self):
        with mock.patch.object(console, "GRACE_S", 0.5), open_console(self.base) as conn:
            type_line(conn, "echo shell=$$ $((5*5))-x; trap '' HUP; exec sleep 300")  # `sleep` inherits the ignored HUP
            shell = int(re.search(rb"shell=(\d+)", read_until(conn, b"25-x"))[1])
            time.sleep(0.3)
            conn.close()
            last_end(self.state)
        self.assertTrue(gone(shell, timeout=0))

    def test_bad_messages_close_the_session(self):
        with open_console(self.base) as conn:
            conn.send("ls")  # keystrokes must be binary
            code, reason = closed(conn)
        self.assertEqual(code, 1003)
        self.assertIn("binary frames", reason)

    def test_a_shell_that_cannot_start(self):
        with mock.patch.object(console.pty, "openpty", side_effect=OSError(24, "Too many open files")), \
                open_console(self.base) as conn:
            self.assertEqual(closed(conn), (1011, "could not start the shell: [Errno 24] Too many open files"))

    def test_three_sessions_at_most(self):
        with contextlib.ExitStack() as stack:
            conns = [stack.enter_context(open_console(self.base)) for _ in range(console.MAX_SESSIONS)]
            with open_console(self.base) as extra:  # signed in: accepted, then closed with the reason
                self.assertEqual(closed(extra), (4429, "3 console sessions are open already"))
            self.assertEqual(audit(self.state, "console refused")[-1]["reason"], "too_many_sessions")
            ended = len(audit(self.state, "console end", 0))
            conns[0].close()
            audit(self.state, "console end", ended + 1)
            with open_console(self.base) as again:
                type_line(again, "echo $((8*8))-again")
                read_until(again, b"64-again")


class Idle(unittest.TestCase):
    def test_closed_after_idle_s_without_input(self):
        state = tempfile.mkdtemp()
        with serve(state, **ON, PIDASH_CONSOLE_IDLE_S="1") as base, open_console(base) as conn:
            for _ in range(4):  # input keeps it open
                time.sleep(0.5)
                conn.send(json.dumps({"type": "resize", "cols": 80, "rows": 24}))
            started = time.monotonic()
            self.assertEqual(closed(conn), (4408, "closed after 1 s without input"))
            self.assertGreater(time.monotonic() - started, 0.8)
            self.assertEqual(last_end(state)["reason"], "closed after 1 s without input")
        self.assertEqual(children(), [])


class Messages(unittest.TestCase):
    def test_resize(self):
        self.assertEqual(resize_of('{"type": "resize", "cols": 120, "rows": 32}'), (120, 32))
        self.assertEqual(resize_of('{"type":"resize","cols":1000,"rows":1}'), (1000, 1))
        for bad in ('{"type": "resize", "cols": 0, "rows": 24}', '{"type": "resize", "cols": 1001, "rows": 24}',
                    '{"type": "resize", "cols": 80.0, "rows": 24}', '{"type": "resize", "cols": true, "rows": 24}',
                    '{"type": "resize", "cols": "80", "rows": 24}', '{"type": "resize", "cols": 80}',
                    '{"type": "input", "cols": 80, "rows": 24}', "[80, 24]", '"resize"', "resize", "", None):
            with self.subTest(bad):
                self.assertIsNone(resize_of(bad))


if __name__ == "__main__":
    unittest.main()
