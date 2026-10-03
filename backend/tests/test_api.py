"""The HTTP + WebSocket API in mock mode, checked against the examples in docs/API.md.

Each test talks to a real uvicorn server on a free port, like the frontend does.
"""

import gzip
import json
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

import uvicorn
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect

from contract import example, shape_errors
from pidash import app as pidash_app
from pidash.app import MAX_BODY, create_app

METRICS = example("### GET /api/metrics")
SECTIONS = [k for k in METRICS if k != "ts"]
EVERY_TICK = ["system", "cpu", "memory", "temps", "throttling", "fan", "disks", "network"]


@contextmanager
def serve(state=None, **env):
    """A mock-mode server in a thread; yields its base URL."""
    app = create_app({"PIDASH_MOCK": "1", "PIDASH_STATE_DIR": state or tempfile.mkdtemp(),
                      "PIDASH_STATIC_DIR": "/nonexistent", **env})
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started:
        assert thread.is_alive() and time.time() < deadline, "server did not start"
        time.sleep(0.02)
    try:
        yield f"http://127.0.0.1:{sock.getsockname()[1]}"
    finally:
        server.should_exit = True
        thread.join(10)


def call(base, path, method="GET", body=None, token=None):
    data = body if isinstance(body, bytes) or body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data, method=method, headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def ws(base, **kw):
    return connect(base.replace("http", "ws", 1) + "/api/ws", open_timeout=5, **kw)


def recv(conn, timeout=5):
    return json.loads(conn.recv(timeout))


class Reads(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = cls.enterClassContext(serve(PIDASH_TOKEN="dev"))

    def get(self, path):
        status, body = call(self.base, path)
        self.assertEqual(status, 200, body)
        return body

    def test_info(self):
        info = self.get("/api/info")
        self.assertEqual(shape_errors(example("### GET /api/info"), info), [])
        self.assertEqual((info["mock"], info["hostname"], info["auth_configured"]), (True, "mock-pi", True))

    def test_metrics(self):
        m = self.get("/api/metrics")
        self.assertEqual(list(m), list(METRICS))
        self.assertEqual(shape_errors(METRICS, m), [])
        self.assertTrue(all(m[s].get("available", True) for s in SECTIONS))
        self.assertEqual(m["cpu"]["usage_pct"], round(100 - m["cpu"]["times_pct"]["idle"], 1))

    def test_mock_covers_the_edge_cases(self):
        m = self.get("/api/metrics")
        self.assertEqual(sorted((c["state"], c["health"]) for c in m["docker"]["containers"]),
                         [("exited", None), ("paused", None), ("running", "healthy"), ("running", "unhealthy")])
        self.assertGreater(m["services"]["summary"]["total"], 120)
        self.assertEqual(m["services"]["summary"]["failed"], 1)
        self.assertEqual(m["services"]["units"][0]["active"], "failed")
        self.assertTrue(m["throttling"]["since_boot"]["under_voltage"])
        self.assertEqual(sorted(p["connection"] for p in m["tailscale"]["peers"]), ["direct", "offline", "relay"])

    def test_history(self):
        time.sleep(1.2)
        h = self.get("/api/history")
        self.assertEqual(shape_errors(example("### GET /api/history"), h), [])
        self.assertGreaterEqual(len(h["ts"]), 2)
        self.assertTrue(all(len(v) == len(h["ts"]) for v in h["series"].values()))
        self.assertEqual(list(h["series"]), list(example("### GET /api/history")["series"]))
        names = [i["name"] for i in self.get("/api/metrics")["network"]["interfaces"]]
        self.assertEqual(list(h["net"]), names)
        self.assertEqual(len(self.get("/api/history?seconds=1")["ts"]), 1)

    def test_fan(self):
        self.assertEqual(shape_errors(METRICS["fan"], self.get("/api/fan")), [])
        self.assertEqual(self.get("/api/fan/profiles"), example("**`GET /api/fan/profiles`**"))
        self.assertEqual(self.get("/api/fan/profile"), example("**`GET /api/fan/profiles`**")["profiles"][1])

    def test_errors(self):
        self.assertEqual(call(self.base, "/api/nope"), (404, {"error": "not_found", "message": "no such path: /api/nope"}))
        status, body = call(self.base, "/api/history?seconds=abc")
        self.assertEqual((status, body["error"]), (422, "invalid_request"))
        self.assertEqual(call(self.base, "/api/info", "POST")[0], 405)

    def test_body_size_cap(self):
        def login(size):  # a {"token": "aaa…"} body of exactly `size` bytes
            body = b'{"token": "' + b"a" * (size - 13) + b'"}'
            self.assertEqual(len(body), size)
            return call(self.base, "/api/auth/login", "POST", body)
        # At the cap the body is parsed and reaches the auth checks; one byte more is refused before any of them.
        self.assertEqual(login(MAX_BODY)[1]["error"], "csrf_header_missing")
        self.assertEqual(login(MAX_BODY + 1), (413, {"error": "body_too_large",
                                                     "message": f"the request body must be at most {MAX_BODY} bytes"}))
        status, body = call(self.base, "/api/fan/profiles/custom", "PUT", b"[" + b"0," * MAX_BODY + b"0]", "dev")
        self.assertEqual((status, body["error"]), (413, "body_too_large"))

    def test_auth(self):
        unauthorized = (401, {"error": "unauthorized", "message": "missing or invalid bearer token"})
        self.assertEqual(call(self.base, "/api/auth"), unauthorized)
        self.assertEqual(call(self.base, "/api/auth", token="wrong"), unauthorized)
        self.assertEqual(call(self.base, "/api/fan/profile", "PUT", {"id": "max"}), unauthorized)
        self.assertEqual(call(self.base, "/api/auth", token="dev"), (200, {"authenticated": True}))


class Changes(unittest.TestCase):
    def test_no_token_configured(self):
        refused = (403, {"error": "auth_not_configured", "message": "set PIDASH_TOKEN on the server to enable changes"})
        with serve() as base:
            self.assertFalse(call(base, "/api/info")[1]["auth_configured"])
            self.assertEqual(call(base, "/api/auth", token="anything"), refused)
            self.assertEqual(call(base, "/api/fan/profile", "PUT", {"id": "max"}, "anything"), refused)
            self.assertEqual(call(base, "/api/fan/profiles/custom", "PUT", {}, "anything"), refused)

    def test_switch_persist_broadcast(self):
        state = tempfile.mkdtemp()
        with serve(state, PIDASH_TOKEN="dev") as base, ws(base) as conn:
            self.assertEqual([recv(conn)["type"] for _ in range(4)], ["hello", "fan_profiles", "history", "metrics"])
            status, body = call(base, "/api/fan/profile", "PUT", {"id": "performance"}, "dev")
            self.assertEqual((status, body), (200, example("**`PUT /api/fan/profile`**", 1)))
            self.assertEqual(json.loads((Path(state) / "fan.json").read_text())["active"], "performance")
            while (msg := recv(conn))["type"] != "fan_profiles":
                self.assertEqual(msg["type"], "metrics")
            self.assertEqual(msg["data"]["active"], "performance")

            self.assertEqual(call(base, "/api/fan/profile", "PUT", {"id": "turbo"}, "dev"),
                             (422, {"error": "unknown_profile", "message": "no profile 'turbo'"}))
            for bad in (b"{nope", {"name": "max"}, {"id": 3}, []):
                status, body = call(base, "/api/fan/profile", "PUT", bad, "dev")
                self.assertEqual((status, body["error"]), (422, "invalid_request"), bad)
        with serve(state, PIDASH_TOKEN="dev") as base:  # restart: the choice survives
            self.assertEqual(call(base, "/api/fan/profile")[1]["id"], "performance")

    def test_custom_curve(self):
        state = tempfile.mkdtemp()
        request = example("**`PUT /api/fan/profiles/custom`**", 0)
        with serve(state, PIDASH_TOKEN="dev") as base:
            self.assertEqual(call(base, "/api/fan/profiles/custom", "PUT", request, "dev"),
                             (200, example("**`PUT /api/fan/profiles/custom`**", 1)))
            bad = {"hysteresis_c": 2, "points": [{"temp_c": 45, "speed_pct": 0}, {"temp_c": 60, "speed_pct": 30},
                                                 {"temp_c": 60, "speed_pct": 60}]}
            self.assertEqual(call(base, "/api/fan/profiles/custom", "PUT", bad, "dev"), (422, {
                "error": "invalid_curve", "message": "points[2].temp_c must be greater than points[1].temp_c (60 <= 60)"}))
            status, body = call(base, "/api/fan/profiles/custom", "PUT", {"points": []}, "dev")
            self.assertEqual((status, body["error"]), (422, "invalid_request"))
            status, body = call(base, "/api/fan/profile", "PUT", {"id": "custom"}, "dev")
            self.assertEqual((body["active"], body["applied"], body["profile"]["points"]), ("custom", True, request["points"]))
        with serve(state) as base:
            self.assertEqual(call(base, "/api/fan/profile")[1]["points"], request["points"])

    def test_saved_profile_is_reapplied_on_start(self):
        state = tempfile.mkdtemp()
        (Path(state) / "fan.json").write_text(json.dumps({"active": "max", "custom": example("**`PUT /api/fan/profiles/custom`**", 0)}))
        with serve(state) as base:
            time.sleep(1.2)
            fan = call(base, "/api/fan")[1]
        self.assertEqual({k: fan[k] for k in ("pwm", "mode", "profile", "target_pct")},
                         {"pwm": 255, "mode": "curve", "profile": "max", "target_pct": 100.0})


class Stream(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = cls.enterClassContext(serve())

    def test_replay_then_ticks(self):
        with ws(self.base) as conn:
            hello, profiles, history, full = (recv(conn) for _ in range(4))
            self.assertEqual(shape_errors(example("### GET /api/info"), hello["data"]), [])
            self.assertEqual(profiles["data"], example("**`GET /api/fan/profiles`**"))
            self.assertEqual(shape_errors(example("### GET /api/history"), history["data"]), [])
            self.assertEqual((full["type"], list(full["data"])), ("metrics", list(METRICS)))
            ticks = [recv(conn) for _ in range(6)]
        self.assertTrue(all(t["type"] == "metrics" for t in ticks))
        for t in ticks:
            d = t["data"]
            self.assertLessEqual({"ts", *EVERY_TICK}, set(d))
            self.assertEqual(shape_errors({k: METRICS[k] for k in d}, d), [])
        seen = {k for t in ticks for k in t["data"]}
        self.assertLessEqual({"processes", "power", "services", "docker", "tailscale"}, seen)
        gaps = [b["data"]["ts"] - a["data"]["ts"] for a, b in zip(ticks[1:], ticks[2:])]
        self.assertTrue(all(0.7 < g < 1.3 for g in gaps), gaps)

    def test_origin_check(self):
        host = self.base.split("//")[1]
        # A client's own X-Forwarded-Host must not pick the host its Origin is matched to.
        for kw in ({"origin": "http://evil.example"},
                   {"origin": "http://evil.example", "additional_headers": {"X-Forwarded-Host": "evil.example"}}):
            with self.subTest(kw), self.assertRaises(InvalidStatus) as e:
                ws(self.base, **kw)
            self.assertEqual(e.exception.response.status_code, 403)
        for kw in ({}, {"origin": f"http://{host}"}):
            with ws(self.base, **kw) as conn:
                self.assertEqual(recv(conn)["type"], "hello", kw)

    def test_client_cap(self):
        with mock.patch.object(pidash_app, "MAX_WS_CLIENTS", 2), serve() as base, ws(base) as first, ws(base) as second:
            for conn in (first, second):
                self.assertEqual(recv(conn)["type"], "hello")
            with ws(base) as third, self.assertRaises(ConnectionClosed) as e:
                recv(third)
            self.assertEqual(e.exception.rcvd.code, 1013)
            second.close()
            deadline = time.time() + 5  # the server drops the closed client shortly after: its slot is free again
            while True:
                with ws(base) as conn:
                    try:
                        self.assertEqual(recv(conn)["type"], "hello")
                        break
                    except ConnectionClosed:
                        self.assertLess(time.time(), deadline, "a freed slot was never reused")
                        time.sleep(0.05)


class Frontend(unittest.TestCase):
    def test_static_files_do_not_swallow_api_errors(self):
        dist = Path(tempfile.mkdtemp())
        (dist / "index.html").write_text("<title>pidash</title>")
        with serve(PIDASH_STATIC_DIR=str(dist)) as base:
            with urllib.request.urlopen(base + "/", timeout=10) as r:
                self.assertEqual(r.read(), b"<title>pidash</title>")
            self.assertEqual(call(base, "/api/nope"), (404, {"error": "not_found", "message": "no such path: /api/nope"}))
            self.assertEqual(call(base, "/api/info")[0], 200)

    def test_page_is_revalidated_hashed_assets_are_cached_for_good(self):
        dist = Path(tempfile.mkdtemp())
        (dist / "index.html").write_text("<title>pidash</title>")
        (dist / "assets").mkdir()
        (dist / "assets" / "index-Ab12Cd34.js").write_text("")
        with serve(PIDASH_STATIC_DIR=str(dist)) as base:
            for path, want in (("/", "no-cache"), ("/index.html", "no-cache"),
                               ("/assets/index-Ab12Cd34.js", "public, max-age=31536000, immutable")):
                with urllib.request.urlopen(base + path, timeout=10) as r:
                    self.assertEqual(r.headers.get("Cache-Control"), want, path)

    def test_text_is_gzipped_when_asked(self):
        dist = Path(tempfile.mkdtemp())
        (dist / "index.html").write_text("<title>pidash</title>")
        (dist / "assets").mkdir()
        body = "const board = 'Raspberry Pi 5';\n" * 200  # over the 1 KB threshold
        (dist / "assets" / "scene3d-Ab12Cd34.js").write_text(body)
        with serve(PIDASH_STATIC_DIR=str(dist)) as base:
            url = base + "/assets/scene3d-Ab12Cd34.js"
            with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept-Encoding": "gzip"}), timeout=10) as r:
                self.assertEqual(r.headers.get("Content-Encoding"), "gzip")
                self.assertEqual(gzip.decompress(r.read()).decode(), body)
                self.assertEqual(r.headers.get("Cache-Control"), "public, max-age=31536000, immutable")
            with urllib.request.urlopen(url, timeout=10) as r:  # a client that didn't ask gets it as is
                self.assertIsNone(r.headers.get("Content-Encoding"))
                self.assertEqual(r.read().decode(), body)


if __name__ == "__main__":
    unittest.main()
