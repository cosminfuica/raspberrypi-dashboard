# PROJECT KNOWLEDGE BASE

**Generated:** 2026-10-23
**Commit:** dc85488
**Branch:** main

## OVERVIEW

pidash: a live dashboard and fan controller for one Raspberry Pi 5 (Argon NEO 5 case, NVMe), reached over Tailscale.
FastAPI backend (Python >= 3.11) plus a framework-free Vite + three.js page that the backend serves from `frontend/dist`.

## STRUCTURE

```
./
├── backend/          # package pidash + unittest suite (own AGENTS.md)
├── frontend/         # the page; npm run build -> frontend/dist (own AGENTS.md)
├── deploy/           # systemd units, udev fan rule, sudoers drop-in, pidash-update (apt) script
├── docs/             # agents/ = agent-skill config; images/ = page and README images; screenshots/ = live-Pi capture
├── docs/images/src/  # every image generator: brand mark, icons, README media, screenshots (own AGENTS.md)
├── .github/readme/   # README banner, clip, bento tiles, spec cards, strips; BRIEF.md = their locked look and asset log
├── get.sh            # curl | bash bootstrap: latest release's pidash.tar.gz (prebuilt dist), then its install.sh
├── install.sh        # Pi install AND update: idempotent, keeps token, settings, fan profile
├── uninstall.sh      # removes everything install.sh added; safe to run twice
├── DESIGN.md         # binding visual system (named rules, Do's and Don'ts)
├── PRODUCT.md        # users, purpose, principles
├── GLOSSARY.md       # domain terms: name concepts with its words, not the ones under _Avoid_
├── CHANGELOG.md      # hand-maintained release history
└── renovate.json     # minor/patch/pin/digest automerge as branch merges; the CI Python is pinned out
```

## WHERE TO LOOK

| Task                                                 | Location                                                                       | Notes                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Any endpoint, field, message, setting                | `backend/tests/API.md`                                                         | Frozen copy of `docs/API.md` (deleted in c999bc7; the owner is rewriting it). The contract tests read it |
| Sensors, fan mechanism, sysfs paths                  | `git show c999bc7^:docs/PI_RECON.md`                                           | Deleted from the tree, not replaced. Read before touching fan or privilege code                          |
| Visual decisions                                     | `DESIGN.md`                                                                    | Binding. `frontend/AGENTS.md` lists the rules that break visibly                                         |
| Root privileges                                      | `deploy/pidash.sudoers`, `deploy/90-pidash-fan.rules`, `deploy/pidash.service` | Exactly four sudo commands; group-write on pwm1 and trips 1-4                                            |
| Install, upgrade, uninstall                          | `get.sh`, `install.sh`, `uninstall.sh`, `.github/workflows/release.yml`        | install.sh needs a built `frontend/dist`; the release's `pidash.tar.gz` carries one for get.sh           |
| Brand mark, icons, README media, screenshots, poster | `docs/images/src/` (own AGENTS.md)                                             | Every image is generated. README media: read `.github/readme/BRIEF.md` first                             |

## CODE MAP

| Symbol          | Type     | Location                          | Refs                          | Role                                                     |
| --------------- | -------- | --------------------------------- | ----------------------------- | -------------------------------------------------------- |
| `create_app`    | function | backend/pidash/app.py:157         | 4 importers                   | Builds the app from `PIDASH_*` env; real or mock wiring  |
| `Hub`           | class    | backend/pidash/app.py:98          | app + tests                   | 1 Hz sampler, 600 s history ring, WebSocket fan-out      |
| `ApiError`      | class    | backend/pidash/auth.py:44         | app, system, tests            | Every JSON error `{error, message}`                      |
| `FanStore`      | class    | backend/pidash/fan.py:180         | app, test_fan, test_vectors   | `fan.json`; pick/save_custom/save_night decide the pause |
| `FanController` | class    | backend/pidash/fan.py:366         | app, test_api, test_fan       | Fan curve loop on its own thread; failsafe; hand-back    |
| `System`        | class    | backend/pidash/system.py:128      | app, tests                    | sudo actions, apt update job, service restart, journal   |
| `api`           | function | frontend/src/link/net.js:33       | 5 importers                   | REST with the CSRF header                                |
| `fmt`           | object   | frontend/src/ui/format.js:5       | 18 importers                  | Every displayed number and unit                          |
| `verdict`       | function | frontend/src/health/verdict.js:64 | verdict-view.js, verdict.test | The Verdict: Reasons, Health levels, No contact; no DOM  |
| `createScene3D` | function | frontend/src/board/scene3d.js:418 | stage.js (lazy)               | The exploded 3D board                                    |

## CONVENTIONS

- Contract-first: `backend/tests/API.md` json examples are backend test fixtures (`backend/tests/contract.py`), and
  `frontend/src/demo/mock.js` re-implements the same contract in the browser. A payload change touches the code,
  `backend/tests/API.md` and mock.js together; a deviation is noted under its "Deviations".
- Version lives in 6 places, bumped by hand: `backend/pidash/__init__.py`, `backend/pyproject.toml`,
  `frontend/package.json` (+ `package-lock.json`), `frontend/src/demo/mock.js` (`app_version`), README.md (the version
  badge). The bump is what makes open pages reload themselves after an install.
- Commits: `area: lowercase summary` (`backend:`, `frontend:`, `docs:`, `deploy:`, `install.sh:`, `ci:`). Multi-area
  joins with `; docs: ...`. A task id goes at the end, `(t_xxxxxxxx)`.
  Renovate's own commits read `chore(deps): update dependency ...`.
- Task worktrees live under `.worktrees/` (git-ignored) on `wt/t_xxxxxxxx` branches.
- Design-review evidence goes in `docs/design-review/<date>[-<name>]/` (WebP shots plus a README); lab scripts and
  Lighthouse reports go in `.impeccable/review/`. Both paths are git-ignored: the evidence stays on disk, out of the repo.
- Formatting: Prettier for frontend/ only (`frontend/.prettierrc`: no semicolons, single quotes, width 120), run on
  staged frontend files by the husky pre-commit hook that `npm ci` installs (`core.hooksPath=frontend/.husky/_`).
  The hook also runs frontend `npm test` on every commit. No linter or type checker; Python has no formatter and
  almost no type hints. Comments explain why and cite their contract.
- `ponytail:` comments mark deliberate shortcuts with their ceiling and upgrade path. Keep the format.

## ANTI-PATTERNS (THIS PROJECT)

- Never bind `0.0.0.0` (`wlan0` is on the home LAN, no firewall), never `tailscale funnel`, never a router
  port-forward of 8787. install.sh's `tailscale serve` on 8787 is the only way in.
- Never write `config.txt` or require a reboot: fan control is a runtime loop that parks and restores the kernel curve.
- Never widen the sudoers rule or run apt with arguments from a request. The update is the fixed `pidash-update` unit.
- `/etc/pidash/pidash.env`: one setting per line, nothing after the value: systemd reads a trailing `# comment` as
  part of it.
- Don't bump the CI Python (3.11, the oldest supported) and don't add a Docker image: fan control needs host `/sys`
  and the systemd post-stop hand-back.
- Images: the Pi board is captured from the app, never drawn by an image model. No Raspberry Pi logo. Text is set in
  the composition, never inside a generated image.
- The repo topics and social preview on GitHub are the owner's call.

## COMMANDS

```bash
# backend
cd backend && python3 -m venv .venv && .venv/bin/pip install -e .
PIDASH_TOKEN=dev .venv/bin/pidash --mock [--port 18787]   # fake Pi; sign in with "dev"
.venv/bin/python -m unittest discover -s tests -t tests   # CI's exact command

# frontend
cd frontend && npm ci
npm run dev       # :5173, proxies /api to :8787; http://localhost:5173/?demo needs no backend (token "demo")
npm test          # node:assert scripts
npm run build     # frontend/dist, which the backend serves at /

# release: .github/workflows/release.yml creates a GitHub Release with GitHub-generated notes on every v* tag.
# Update CHANGELOG.md by hand when preparing a release.
git tag vX.Y.Z && git push origin vX.Y.Z

# on the Pi (updating = same steps)
cd ~/pidash && git pull && (cd frontend && npm ci && npm run build) && sudo ./install.sh [--no-docker | --docker]
```

## NOTES

- CI (`.github/workflows/ci.yml`): backend on Python 3.11, frontend on Node 24 (`npm ci`, `npm test`, `npm run
build`). Renovate auto-merges green minor/patch updates straight to main (branch automerge, no PR), so pull before work.
- Git-ignored, local-only, not project code: `.agents/`, `skills-lock.json`, `.impeccable/`, `.omo/` (except the tracked
  `.omo/init-deep.json`), `.worktrees/`, `strix_runs/`, `brag-output/`.
- Building the page needs Node >= 20.19; Raspberry Pi OS Bookworm ships an older one, so build elsewhere and rsync it.
- `pidash-update` is the Pi's apt updater behind the System card, not an updater for pidash itself.
- The web console is a real shell as `pidash`, which is in the `docker` group (root-equivalent) unless installed with
  `--no-docker`. It is off without a token and off by default in mock mode.
- Nothing is served at `/` until `frontend/dist` exists; the API still works.
- A sudoers, udev or unit change takes effect only after `sudo ./install.sh` is re-run on the Pi.

## Agent skills

### Issue tracker

GitHub Issues on cosminfuica/raspberrypi-dashboard, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the repo root; `docs/adr/` is created with the first ADR. See `docs/agents/domain.md`.
