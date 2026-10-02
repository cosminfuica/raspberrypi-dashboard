# backend/: the pidash server

Own file: score 12 (module boundary, 196 defs, `ApiError` and `create_app` imported across modules and tests) and a
distinct domain: Pi sysfs writes, root through sudo, a real shell.

## OVERVIEW

Package `pidash` (FastAPI, uvicorn, websockets, psutil; Python >= 3.11) plus its stdlib `unittest` suite in `tests/`.

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| CLI flags, startup, `--restore-fan` | `pidash/__main__.py` | READY=1 only after the port binds; SIGHUP becomes SIGTERM so the fan is handed back |
| Routes, env config, sampler | `pidash/app.py` | `create_app(env)` :155, `Hub` :96; cadence in `SECTIONS`/`EVERY`, charted paths in `SERIES` |
| New metric section | `collectors.py` + `mock.py` + `app.py` | Section name = `Collector` method name; `MockCollector` needs the same method and shape |
| Fan curve, failsafe, sysfs | `pidash/fan.py` | `validate_curve` :77, `next_target` :116, `SysfsFan`, `FanController` :272 |
| Token, cookie, CSRF, audit log | `pidash/auth.py` | `Auth.require` is the route dependency; `Audited` logs every POST/PUT/PATCH/DELETE under /api, refusals included |
| Reboot, update job, restart, journal | `pidash/system.py` | `System` (real) and `MockSystem` (pretend) |
| Web console | `pidash/console.py` | One PTY bash per session; every refusal is decided in `Console.serve` |
| Contract helpers for tests | `tests/contract.py` | `example(heading, n)` loads an API.md json block; `shape_errors(expected, actual)` |

## CONVENTIONS

- Errors: raise `ApiError(status, code, message)`. It renders `{"error": "<snake_code>", "message": "<lowercase sentence>"}`.
- Collectors raise `Unavailable` inside `@optional` sections, which become `{"available": false, "error": ...}`. Any
  other exception nulls the section for that tick and is logged once per distinct error.
- Threads: every collector runs on the one `sampler` thread, because psutil keeps CPU-percent baselines per thread,
  so handlers read `hub.snapshot` and never call a `Collector` method. The fan loop has its own thread and `_lock`.
  `Hub.snapshot`, `ring` and `clients` live on the event loop, so they have no locks.
- Handlers that wait on systemctl are plain `def` (FastAPI's thread pool). Actions that stop pidash (reboot, poweroff,
  restarting pidash.service) run as a `BackgroundTask` after the response has gone out.
- Env flags are literal: `PIDASH_MOCK` is on only for `"1"`, `PIDASH_FAN_CONTROL` is off only for `"0"`.
- Subprocesses take argv lists (root: `sudo -n` with fixed arguments). Never a shell string; a test asserts it.
- Persist like `FanStore.save`: write a temp file, fsync, `os.replace`, then switch the in-memory state.
- `PIDASH_STATE_DIR` defaults to `./state` (git-ignored). Mock runs write `fan.json` and `audit.log` there.

## ANTI-PATTERNS

- A POST/PUT/PATCH/DELETE route without `Depends(auth.require)` fails `test_every_mutating_route_is_protected`; only
  login and logout are open. A new WebSocket route checks `same_origin()` (and `auth.check()` if privileged) before
  `accept()`: a 1008 close before accept answers the handshake with HTTP 403.
- `SERVICE_NAME` (system.py:40) must equal the restart regex in deploy/pidash.sudoers (the `Sudoers` test compares
  them); `LOG_NAME` is its looser read-only twin. Change them together.
- Keep every fan hand-back path: `ExecStopPost=pidash --restore-fan`, the `finally: app.state.fan.stop()` in
  `__main__`, the `WATCHDOG=1` ping on each tick (`WatchdogSec=15`). A failed release is not retried: each attempt
  would kick the fan to full speed.
- Never touch `trip_point_0` (the 110 °C critical trip). The failsafe (80 °C or an unreadable SoC: full speed until
  below 75 °C) and the 8 % stall floor are fixed, not settings.
- Console: no `preexec_fn` (a child forked from a threaded process can deadlock before exec; `setsid -c` instead), no
  `PIDASH_TOKEN` in the shell's env, at most 3 sessions (close code 4429).

## TESTS

- `-t tests` in the discover command makes `tests/` the top level, so `from contract import ...` and
  `from test_api import serve, call` resolve. There is no pytest.
- Most tests run a real uvicorn in mock mode on an ephemeral port: `test_api.serve(**env)`, with a temp state dir and
  `PIDASH_STATIC_DIR=/nonexistent`.
- Contract matching (`shape_errors`): key sets must match exactly, a documented int stays an int, `null` matches
  anything. A new payload key fails the tests until API.md has it.
- Fan tests lay out fake hwmon, thermal-zone and device-tree files in a temp dir. Console tests start a real bash and
  run `top` (procps). Tests that need `visudo` or `journalctl` skip without them.
- One test: `.venv/bin/python -m unittest discover -s tests -t tests -k test_every_mutating_route_is_protected`.
