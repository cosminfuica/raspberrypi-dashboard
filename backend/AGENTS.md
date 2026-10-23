# backend/: the pidash server

Own file: score 12 (module boundary, 201 defs, `ApiError` and `create_app` imported across modules and tests) and a
distinct domain: Pi sysfs writes, root through sudo, a real shell.

## OVERVIEW

Package `pidash` (FastAPI, uvicorn, websockets, psutil; Python >= 3.11) plus its stdlib `unittest` suite in `tests/`.

## WHERE TO LOOK

| Task                                 | Location                                           | Notes                                                                                                                                                                                                                                                            |
| ------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI flags, startup, `--restore-fan`  | `pidash/__main__.py`                               | READY=1 only after the port binds; SIGHUP becomes SIGTERM so the fan is handed back                                                                                                                                                                              |
| Routes, env config, sampler          | `pidash/app.py`                                    | `create_app(env)` :157, `Hub` :98; cadence in `SECTIONS`/`EVERY`, charted paths in `SERIES`                                                                                                                                                                      |
| New metric section                   | `collectors.py` + `mock.py` + `app.py`             | Section name = `Collector` method name, listed in `SECTIONS`; `MockCollector` needs the same method and shape. Exception: `fan` comes from `fan.status()` (app.py:113)                                                                                           |
| Fan curve, failsafe, sysfs           | `pidash/fan.py`                                    | `validate_curve` :85, `validate_night` :114, `effective_profile` :141, `next_target` :167, `FanStore` :175 (writers `pick`, `save_custom`, `save_night`; reader `applied`), `SysfsFan`, `FanController` :361 (`FanController.now` is the clock seam tests patch) |
| Night schedule                       | `pidash/fan.py`, `PUT /api/fan/night` (app.py:322) | `DEFAULT_NIGHT` :65 is off; a window may cross midnight. Tonight's pause lives in `FanStore`: `pick` inside the window pauses until the next start, `save_night` ends it, `save_custom` keeps it. Stored as `fan.json` key `skip`, never in a payload            |
| Token, cookie, CSRF, audit log       | `pidash/auth.py`                                   | `Auth.require` is the route dependency; `Audited` logs every POST/PUT/PATCH/DELETE under /api, refusals included                                                                                                                                                 |
| Reboot, update job, restart, journal | `pidash/system.py`                                 | `System` (real) and `MockSystem` (pretend)                                                                                                                                                                                                                       |
| Web console                          | `pidash/console.py`                                | One PTY bash per session; every refusal is decided in `Console.serve`                                                                                                                                                                                            |
| Contract helpers for tests           | `tests/contract.py`                                | `example(heading, n)` loads a tests/API.md json block; `shape_errors(expected, actual)`                                                                                                                                                                          |

## CONVENTIONS

- Errors: raise `ApiError(status, code, message)`. It renders `{"error": "<snake_code>", "message": "<lowercase sentence>"}`.
  Starlette's own errors come out as `http_<status>` with its phrase (`http_error`, app.py:214).
- Collectors raise `Unavailable` inside `@optional` sections, which become `{"available": false, "error": ...}`. Any
  other exception nulls the section for that tick and is logged once per distinct error.
- Threads: every collector runs on the one `sampler` thread, because psutil keeps CPU-percent baselines per thread,
  so handlers read `hub.snapshot` and never call a `Collector` method. The fan loop has its own thread and `_lock`.
  `Hub.snapshot`, `ring` and `clients` live on the event loop, so they have no locks.
- Handlers that wait on systemctl are plain `def` (FastAPI's thread pool). Actions that stop pidash (reboot, poweroff,
  restarting pidash.service) run as a `BackgroundTask` after the response has gone out.
- Env flags are literal: `PIDASH_MOCK` is on only for `"1"`, `PIDASH_FAN_CONTROL` is off only for `"0"`. The exception
  is `PIDASH_CONSOLE` (app.py:177): 1/true/yes/on, default on (off in mock), and never without `PIDASH_TOKEN`.
- Caps: `MAX_BODY` 64 KB (413 `body_too_large`), `MAX_WS_CLIENTS` 32 (close 1013 after `accept()`), app.py:58-59.
- Subprocesses take argv lists (root: `sudo -n` with fixed arguments). Never a shell string; a test asserts it.
- Persist like `FanStore._write`: write a temp file, fsync, `os.replace`, then switch the in-memory state under the lock.
- `PIDASH_STATE_DIR` defaults to `./state` (git-ignored). Mock runs write `fan.json`, `audit.log`,
  `mock-update.log`, `mock-reboot-required` and the console's `console/` home there.

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
- Contract matching (`shape_errors`, contract.py:25): key sets must match exactly except under `free` paths (`$.net`,
  keyed by interface name), a documented int stays an int, `null` matches anything. A new payload key fails the tests
  until tests/API.md has it. `FailSoft.test_this_machine` and `RealJournal` read the host they run on.
- `tests/fan_vectors.json`: every `want` is the output of the `pidash/fan.py` functions, never typed by hand.
  `tests/test_vectors.py` runs it against fan.py and frontend `curve.test.js` runs the same file against curve.js. A
  change to fan.py alone fails `test_vectors` first; `curve.test.js` fails only once the wants are rewritten from fan.py.
- `tests/test_mirrors.py` pins frontend code that copies a backend rule: main.js `RESTARTABLE` = `system.SERVICE_NAME`.
- Fan tests lay out fake hwmon, thermal-zone and device-tree files in a temp dir. Console tests start a real bash and
  run `top` (procps). Tests that need `visudo` or `journalctl` skip without them.
- One test: `.venv/bin/python -m unittest discover -s tests -t tests -k test_every_mutating_route_is_protected`.
