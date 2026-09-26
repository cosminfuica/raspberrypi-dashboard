"""One process serves the API (docs/API.md) and the built frontend."""

import asyncio
import hmac
import json
import logging
import os
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from http import HTTPStatus
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Request, WebSocket
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.websockets import WebSocketDisconnect

from . import __version__
from .collectors import Collector
from .fan import (FAILSAFE_C, FAILSAFE_RELEASE_C, PROFILE_IDS, BodyError, CurveError, FanController, FanStore,
                  SysfsFan, validate_curve)
from .mock import MockCollector, MockFan

log = logging.getLogger("pidash")

API_VERSION = 1
HISTORY_S = 600
TICK_S = 1.0
DEFAULT_STATIC = Path(__file__).resolve().parents[2] / "frontend" / "dist"
SECTIONS = ("system", "cpu", "memory", "temps", "throttling", "power", "fan", "disks", "network",
            "processes", "services", "docker", "tailscale")
EVERY = {"processes": 3, "power": 5, "services": 5, "docker": 5, "tailscale": 5}  # seconds; the rest: 1
SERIES = {  # GET /api/history series -> path in the metrics snapshot
    "cpu_pct": ("cpu", "usage_pct"),
    "cpu_freq_mhz": ("cpu", "freq_mhz"),
    "load_1m": ("cpu", "load_avg", 0),
    "soc_temp_c": ("temps", "soc_c"),
    "nvme_temp_c": ("temps", "nvme_c"),
    "fan_rpm": ("fan", "rpm"),
    "fan_pct": ("fan", "speed_pct"),
    "mem_used_pct": ("memory", "ram", "used_pct"),
    "swap_used_pct": ("memory", "swap", "used_pct"),
    "disk_read_bytes_per_s": ("disks", "total", "read_bytes_per_s"),
    "disk_write_bytes_per_s": ("disks", "total", "write_bytes_per_s"),
    "net_rx_bytes_per_s": ("network", "total", "rx_bytes_per_s"),
    "net_tx_bytes_per_s": ("network", "total", "tx_bytes_per_s"),
    "pmic_w": ("power", "pmic_w"),
}
ERROR_CODES = {404: "not_found", 405: "method_not_allowed"}


def dig(obj, path):
    for key in path:
        try:
            obj = obj[key]
        except (KeyError, IndexError, TypeError):
            return None
    return obj


class ApiError(Exception):
    def __init__(self, status, code, message, headers=None):
        self.status, self.code, self.message, self.headers = status, code, message, headers


def error(status, code, message, headers=None):
    return JSONResponse({"error": code, "message": message}, status, headers=headers)


def same_origin(headers):
    """A browser's Origin must name the host it connected to (Host, or X-Forwarded-Host behind a proxy)."""
    origin = headers.get("origin")
    if origin is None:
        return True  # not a browser: curl, scripts
    try:
        o = urlsplit(origin)
        want = (o.hostname, o.port or {"http": 80, "https": 443}.get(o.scheme))
        for host in (headers.get("host"), (headers.get("x-forwarded-host") or "").split(",")[0].strip()):
            h = urlsplit("//" + host) if host else None
            if h and o.hostname and (h.hostname, h.port or want[1]) == want:
                return True
    except ValueError:  # a malformed port
        pass
    return False


class Client:
    """One WebSocket client's outbox: the latest message per type, so a slow client skips ticks, never queues."""

    def __init__(self):
        self.outbox = {}
        self.ready = asyncio.Event()

    def put(self, kind, data, merge=False):
        self.outbox[kind] = {**self.outbox.get(kind, {}), **data} if merge else data
        self.ready.set()

    async def pump(self, ws):
        try:
            while True:
                await self.ready.wait()
                self.ready.clear()
                while self.outbox:
                    kind = next(iter(self.outbox))
                    await ws.send_json({"type": kind, "data": self.outbox.pop(kind)})
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass  # the client went away


class Hub:
    """The sampler: latest snapshot, history ring and WebSocket fan-out. Lives on the event loop."""

    def __init__(self, collector, fan):
        self.collector, self.fan = collector, fan
        self.snapshot = {}
        self.ring = deque(maxlen=HISTORY_S)
        self.clients = set()
        self._errors = {}

    def collect(self, sections):
        """Runs on the one sampler thread: psutil keeps its CPU-percent baselines per thread."""
        out = {"ts": round(time.time(), 3)}
        for name in sections:
            try:
                out[name] = self.fan.status() if name == "fan" else getattr(self.collector, name)()
                self._errors.pop(name, None)
            except Exception as e:
                out[name] = None
                if self._errors.get(name) != repr(e):  # log each new failure once, not every second
                    self._errors[name] = repr(e)
                    log.exception("collector %r failed", name)
        return out

    def publish(self, tick):
        self.snapshot = {**self.snapshot, **tick}
        net = {i["name"]: (i["rx_bytes_per_s"], i["tx_bytes_per_s"]) for i in dig(self.snapshot, ("network", "interfaces")) or ()}
        self.ring.append((self.snapshot["ts"], [dig(self.snapshot, p) for p in SERIES.values()], net))
        for c in self.clients:
            c.put("metrics", tick, merge=True)

    def broadcast(self, kind, data):
        for c in self.clients:
            c.put(kind, data)

    def history(self, seconds=HISTORY_S):
        rows = list(self.ring)[-max(1, min(seconds, HISTORY_S)):]
        names = [i["name"] for i in dig(self.snapshot, ("network", "interfaces")) or ()]
        return {
            "interval_s": 1,
            "ts": [r[0] for r in rows],
            "series": {k: [r[1][i] for r in rows] for i, k in enumerate(SERIES)},
            "net": {n: {"rx_bytes_per_s": [r[2].get(n, (None, None))[0] for r in rows],
                        "tx_bytes_per_s": [r[2].get(n, (None, None))[1] for r in rows]} for n in names},
        }

    async def run(self, pool):
        loop = asyncio.get_running_loop()
        n, due = 1, loop.time() + TICK_S
        while True:
            await asyncio.sleep(max(0.0, due - loop.time()))
            try:
                sections = [s for s in SECTIONS if n % EVERY.get(s, 1) == 0]
                self.publish(await loop.run_in_executor(pool, self.collect, sections))
            except Exception:
                log.exception("sampler tick failed")
            n, due = n + 1, max(due + TICK_S, loop.time())  # fell behind: skip ticks, don't burst


def create_app(env=None):
    """The app, configured from PIDASH_* variables (docs/API.md "Configuration")."""
    env = os.environ if env is None else env
    token = env.get("PIDASH_TOKEN") or None
    mock = env.get("PIDASH_MOCK", "0") == "1"
    static_dir = Path(env.get("PIDASH_STATIC_DIR") or DEFAULT_STATIC)
    store = FanStore(env.get("PIDASH_STATE_DIR") or "./state")
    if mock:
        collector = MockCollector()
        find = lambda: (MockFan(collector.sim), None)
    else:
        collector = Collector()
        find = SysfsFan.find
    fan = FanController(find, store, control=env.get("PIDASH_FAN_CONTROL", "1") != "0")
    hub = Hub(collector, fan)
    static_info = {}

    @asynccontextmanager
    async def lifespan(app):
        pool = ThreadPoolExecutor(1, thread_name_prefix="sampler")
        loop = asyncio.get_running_loop()
        try:
            static_info.update(await loop.run_in_executor(pool, collector.info))
        except Exception:
            log.exception("could not read the host facts for /api/info")
        fan.start()  # re-applies the saved profile
        if not mock:  # rates and CPU percentages need a baseline sample
            await loop.run_in_executor(pool, hub.collect, SECTIONS)
            await asyncio.sleep(TICK_S)
        hub.publish(await loop.run_in_executor(pool, hub.collect, SECTIONS))
        sampler = asyncio.create_task(hub.run(pool))
        try:
            yield
        finally:
            sampler.cancel()
            fan.stop()
            pool.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(title="pidash", version=__version__, docs_url=None, redoc_url=None, openapi_url=None,
                  lifespan=lifespan)

    @app.exception_handler(ApiError)
    async def api_error(request, e):
        return error(e.status, e.code, e.message, e.headers)

    @app.exception_handler(HTTPException)
    async def http_error(request, e):
        code = ERROR_CODES.get(e.status_code, f"http_{e.status_code}")
        msg = f"no such path: {request.url.path}" if e.status_code == 404 else str(e.detail or HTTPStatus(e.status_code).phrase)
        return error(e.status_code, code, msg, getattr(e, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, e):
        msg = "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors())
        return error(422, "invalid_request", msg or "invalid request")

    @app.exception_handler(Exception)
    async def internal_error(request, e):
        return error(500, "internal_error", "internal server error (see the server log)")

    def require_token(request: Request):
        if not token:
            raise ApiError(403, "auth_not_configured", "set PIDASH_TOKEN on the server to enable changes")
        scheme, _, given = request.headers.get("authorization", "").partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(given.strip().encode(), token.encode()):
            raise ApiError(401, "unauthorized", "missing or invalid bearer token", {"WWW-Authenticate": "Bearer"})

    async def json_body(request):
        try:
            return json.loads(await request.body())
        except ValueError:
            raise ApiError(422, "invalid_request", "the request body must be JSON") from None

    def save(active, custom):
        try:
            store.save(active, custom)
        except OSError as e:
            raise ApiError(500, "state_write_failed", f"could not save {store.path}: {e}") from None
        hub.broadcast("fan_profiles", store.payload())

    def change(profile, applied):
        return {"active": store.active, "applied": applied, "reboot_required": False, "profile": profile}

    def info():
        s = static_info
        return {
            "api_version": API_VERSION, "app_version": __version__, "mock": mock,
            **{k: s.get(k) for k in ("hostname", "model", "os", "kernel", "arch", "cpu", "memory_total_bytes", "boot_time")},
            "server_time": round(time.time(), 3), "history_s": HISTORY_S, "auth_configured": token is not None,
            "limits": {"soc_throttle_c": 80, "soc_throttle_hard_c": 85,
                       "nvme_warn_c": dig(s, ("limits", "nvme_warn_c")), "nvme_crit_c": dig(s, ("limits", "nvme_crit_c")),
                       "fan_failsafe_c": FAILSAFE_C, "fan_failsafe_release_c": FAILSAFE_RELEASE_C},
        }

    # Handlers are async so they run on the event loop, next to the sampler: no locking needed.
    @app.get("/api/info")
    async def get_info():
        return info()

    @app.get("/api/metrics")
    async def get_metrics():
        return JSONResponse(hub.snapshot)

    @app.get("/api/history")
    async def get_history(seconds: int = HISTORY_S):
        return JSONResponse(hub.history(seconds))

    @app.get("/api/auth", dependencies=[Depends(require_token)])
    async def get_auth():
        return {"authenticated": True}

    @app.get("/api/fan")
    async def get_fan():
        return fan.status()

    @app.get("/api/fan/profiles")
    async def get_profiles():
        return store.payload()

    @app.get("/api/fan/profile")
    async def get_profile():
        return store.profile(store.active)

    @app.put("/api/fan/profile", dependencies=[Depends(require_token)])
    async def put_profile(request: Request):
        body = await json_body(request)
        pid = body.get("id") if isinstance(body, dict) else None
        if not isinstance(pid, str):
            raise ApiError(422, "invalid_request", 'expected {"id": "<profile id>"}')
        if pid not in PROFILE_IDS:
            raise ApiError(422, "unknown_profile", f"no profile '{pid}'")
        save(pid, store.custom)
        log.info("fan profile -> %s", pid)
        return change(store.profile(pid), fan.driving)

    @app.put("/api/fan/profiles/custom", dependencies=[Depends(require_token)])
    async def put_custom(request: Request):
        try:
            curve = validate_curve(await json_body(request))
        except BodyError as e:
            raise ApiError(422, "invalid_request", str(e)) from None
        except CurveError as e:
            raise ApiError(422, "invalid_curve", str(e)) from None
        save(store.active, curve)
        log.info("custom fan curve -> %s", curve)
        return change(store.profile("custom"), store.active == "custom" and fan.driving)

    @app.websocket("/api/ws")
    async def stream(ws: WebSocket):
        if not same_origin(ws.headers):
            await ws.close(code=1008)  # before accept(), uvicorn answers the handshake with HTTP 403
            return
        await ws.accept()
        client = Client()
        hub.clients.add(client)  # ticks from now on queue up behind the replay below
        try:
            for kind, data in (("hello", info()), ("fan_profiles", store.payload()), ("history", hub.history()),
                               ("metrics", hub.snapshot)):
                await ws.send_json({"type": kind, "data": data})
            tasks = [asyncio.create_task(client.pump(ws)), asyncio.create_task(drain(ws))]
            try:
                await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for t in tasks:
                    t.cancel()
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass
        finally:
            hub.clients.discard(client)

    # Mounted last so /api/* routes win. Nothing is served at / until `npm run build` has run.
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
    app.state.hub, app.state.fan, app.state.store = hub, fan, store
    return app


async def drain(ws):
    """Read and ignore client messages until the client disconnects."""
    while (await ws.receive())["type"] != "websocket.disconnect":
        pass
