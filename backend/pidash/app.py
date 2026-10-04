"""One process serves the API (docs/API.md) and the built frontend."""

import asyncio
import json
import logging
import os
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from http import HTTPStatus
from pathlib import Path

from fastapi import Depends, FastAPI, Request, WebSocket
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
from starlette.exceptions import HTTPException
from starlette.middleware.gzip import GZipMiddleware
from starlette.websockets import WebSocketDisconnect

from . import __version__
from .auth import ApiError, Audited, Auth, same_origin
from .collectors import Collector
from .console import Console
from .fan import (FAILSAFE_C, FAILSAFE_RELEASE_C, PROFILE_IDS, BodyError, CurveError, FanController, FanStore,
                  NightError, SysfsFan, night_began, validate_curve, validate_night)
from .mock import MockCollector, MockFan
from .system import CURSOR, LOG_LINES_MAX, LOG_NAME, SERVICE_NAME, MockSystem, System

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
MAX_BODY = 64 * 1024  # bytes; the largest real body, an 8-point curve, is well under 1 KB
MAX_WS_CLIENTS = 32  # /api/ws fan-out clients; a few browser tabs per owner, never thousands


def dig(obj, path):
    for key in path:
        try:
            obj = obj[key]
        except (KeyError, IndexError, TypeError):
            return None
    return obj


def error(status, code, message, headers=None):
    return JSONResponse({"error": code, "message": message}, status, headers=headers)


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
    state_dir = env.get("PIDASH_STATE_DIR") or "./state"
    store = FanStore(state_dir)
    if mock:
        collector = MockCollector()
        find = lambda: (MockFan(collector.sim), None)
    else:
        collector = Collector()
        find = SysfsFan.find
    fan = FanController(find, store, control=env.get("PIDASH_FAN_CONTROL", "1") != "0")
    hub = Hub(collector, fan)
    auth = Auth(token, state_dir)
    system = MockSystem(collector, state_dir) if mock else System()
    # The console needs a token: without one, nobody could sign in. Mock mode would still start a real shell, so
    # there it is off unless asked for (the demo token "dev" is well known).
    console_on = token is not None and env.get("PIDASH_CONSOLE", "0" if mock else "1").lower() in ("1", "true", "yes", "on")
    console = Console(auth, console_on, int(env.get("PIDASH_CONSOLE_IDLE_S") or 900), Path(state_dir).absolute() / "console")
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
    app.add_middleware(Audited, auth=auth)
    # A Pi on Wi-Fi to a phone over Tailscale: the page's text assets are ~760 KB raw and ~205 KB gzipped. HTTP only;
    # the WebSockets (/api/ws, /api/console/ws) are untouched. Level 6: level 9 costs the Pi's CPU for ~1 % less
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)

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

    async def json_body(request):
        body = bytearray()
        async for chunk in request.stream():  # streamed, so an oversized body is never held whole
            body += chunk
            if len(body) > MAX_BODY:
                raise ApiError(413, "body_too_large", f"the request body must be at most {MAX_BODY} bytes")
        try:
            return json.loads(body)
        except ValueError:
            raise ApiError(422, "invalid_request", "the request body must be JSON") from None

    def save(active, custom, night, skip):
        try:
            store.save(active, custom, night, skip)
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
            "server_time": round(time.time(), 3), "utc_offset_s": time.localtime().tm_gmtoff, "history_s": HISTORY_S, "auth_configured": token is not None,
            "console_enabled": console.enabled,
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

    @app.get("/api/auth", dependencies=[Depends(auth.require)])
    async def get_auth():
        return {"authenticated": True}

    @app.post("/api/auth/login")
    async def login(request: Request):
        return auth.login(request, await json_body(request))

    @app.post("/api/auth/logout")
    async def logout(request: Request):
        return auth.logout(request)

    @app.get("/api/fan")
    async def get_fan():
        return fan.status()

    @app.get("/api/fan/profiles")
    async def get_profiles():
        return store.payload()

    @app.get("/api/fan/profile")
    async def get_profile():
        return store.profile(store.active)

    @app.put("/api/fan/profile", dependencies=[Depends(auth.require)])
    async def put_profile(request: Request):
        body = await json_body(request)
        pid = body.get("id") if isinstance(body, dict) else None
        if not isinstance(pid, str):
            raise ApiError(422, "invalid_request", 'expected {"id": "<profile id>"}')
        if pid not in PROFILE_IDS:
            raise ApiError(422, "unknown_profile", f"no profile '{pid}'")
        # A pick inside tonight's window applies now and pauses the schedule until its next start.
        began = night_began(store.night, fan.now()) if store.night["enabled"] else None
        save(pid, store.custom, store.night, began.isoformat() if began else None)
        log.info("fan profile -> %s", pid)
        return change(store.profile(pid), fan.driving)

    @app.put("/api/fan/profiles/custom", dependencies=[Depends(auth.require)])
    async def put_custom(request: Request):
        try:
            curve = validate_curve(await json_body(request))
        except BodyError as e:
            raise ApiError(422, "invalid_request", str(e)) from None
        except CurveError as e:
            raise ApiError(422, "invalid_curve", str(e)) from None
        save(store.active, curve, store.night, store.skip)
        log.info("custom fan curve -> %s", curve)
        return change(store.profile("custom"), store.effective(fan.now())[0] == "custom" and fan.driving)

    @app.put("/api/fan/night", dependencies=[Depends(auth.require)])
    async def put_night(request: Request):
        try:
            night = validate_night(await json_body(request))
        except BodyError as e:
            raise ApiError(422, "invalid_request", str(e)) from None
        except NightError as e:
            raise ApiError(422, "invalid_night", str(e)) from None
        save(store.active, store.custom, night, None)  # any change ends tonight's pause: the same settings again = resume
        log.info("night schedule -> %s", night)
        pid, schedule = store.effective(fan.now())
        return {"night": night, "profile": pid, "schedule": schedule}

    # Privileged actions (system.py, docs/API.md "System actions"). They wait on systemctl, so they're plain
    # `def`: FastAPI runs them in its thread pool, off the event loop. An action that stops pidash (a reboot, a
    # shutdown, restarting pidash itself) runs as a background task, once the response has gone out.
    @app.post("/api/system/reboot", dependencies=[Depends(auth.require)])
    def reboot():
        return JSONResponse({"rebooting": True}, 202, background=BackgroundTask(system.power("reboot")))

    @app.post("/api/system/shutdown", dependencies=[Depends(auth.require)])
    def shutdown():
        return JSONResponse({"shutting_down": True}, 202, background=BackgroundTask(system.power("poweroff")))

    @app.post("/api/system/update", status_code=202, dependencies=[Depends(auth.require)])
    def start_update():
        return system.start_update()

    @app.get("/api/system/update", dependencies=[Depends(auth.require)])
    def get_update(offset: int = 0):
        return system.update_status(offset)

    @app.post("/api/services/{name}/restart", dependencies=[Depends(auth.require)])
    def restart_service(name: str):
        if not SERVICE_NAME.fullmatch(name):
            raise ApiError(422, "invalid_service_name", f"not a restartable service name: {name!r}")
        if name not in {u["name"] for u in dig(hub.snapshot, ("services", "units")) or ()}:
            raise ApiError(404, "unknown_service", f"no service '{name}' in the services list")
        row, later = system.restart(name)
        return JSONResponse(row, 202 if later else 200, background=BackgroundTask(later) if later else None)

    # A read, but not a public one: logs can hold anything a service prints. No CSRF header needed (a GET).
    @app.get("/api/services/{name}/logs", dependencies=[Depends(auth.require)])
    def service_logs(name: str, lines: int = 200, after: str | None = None):
        if not LOG_NAME.fullmatch(name):
            raise ApiError(422, "invalid_service_name", f"not a service name: {name!r}")
        if not 1 <= lines <= LOG_LINES_MAX:
            raise ApiError(422, "invalid_request", f"lines must be from 1 to {LOG_LINES_MAX}")
        if after is not None and not CURSOR.fullmatch(after):
            raise ApiError(422, "invalid_request", "after must be the cursor of an earlier answer")
        if name not in {u["name"] for u in dig(hub.snapshot, ("services", "units")) or ()}:
            raise ApiError(404, "unknown_service", f"no service '{name}' in the services list")
        return system.journal(name, lines, after)

    @app.websocket("/api/ws")
    async def stream(ws: WebSocket):
        if not same_origin(ws.headers):
            await ws.close(code=1008)  # before accept(), uvicorn answers the handshake with HTTP 403
            return
        await ws.accept()
        if len(hub.clients) >= MAX_WS_CLIENTS:
            # After accept(), so the client sees 1013 (try again later) rather than a bare 403; no await between
            # this check and the add below, so a burst of handshakes can't overshoot the cap.
            await ws.close(code=1013)
            return
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

    @app.websocket("/api/console/ws")
    async def console_ws(ws: WebSocket):
        await console.serve(ws)  # console.py, docs/API.md "Console": auth, Origin, limits, audit

    # Mounted last so /api/* routes win. Nothing is served at / until `npm run build` has run.
    if static_dir.is_dir():
        app.mount("/", Frontend(directory=static_dir, html=True), name="frontend")
    app.state.hub, app.state.fan, app.state.store, app.state.auth, app.state.system = hub, fan, store, auth, system
    app.state.console = console
    return app


class Frontend(StaticFiles):
    """The built page. Vite names the files in /assets/ by their content hash, so they never change and are cached
    for good; the rest (index.html, the manifest, the icons) is revalidated on every load, or a browser may keep
    showing the old page after a re-install."""

    def file_response(self, full_path, stat_result, scope, status_code=200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        immutable = scope["path"].startswith("/assets/")
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if immutable else "no-cache"
        return response


async def drain(ws):
    """Read and ignore client messages until the client disconnects."""
    while (await ws.receive())["type"] != "websocket.disconnect":
        pass
