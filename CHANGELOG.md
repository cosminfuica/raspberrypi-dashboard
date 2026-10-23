# Changelog

Generated from commit messages by [git-cliff](https://git-cliff.org) (`cliff.toml`). Do not edit by hand.

## [Unreleased]

### Backend

- Tests read tests/API.md, a frozen copy of the docs/API.md that c999bc7 deleted ([8e990dc](https://github.com/cosminfuica/raspberrypi-dashboard/commit/8e990dc9333d8163ecc7c4e81b741bbba10c71b4))
- Console test types after top hands the prompt back, not before (its exit flushes typed input; flaky in CI) ([b59178f](https://github.com/cosminfuica/raspberrypi-dashboard/commit/b59178f2bc4fa8862a0726332e1225b6396dc4db))

### Frontend

- Add pre-commit hooks (husky + lint-staged + prettier) ([dc85488](https://github.com/cosminfuica/raspberrypi-dashboard/commit/dc85488f0a005cfc83bfa4826d8f6994ba5e0f06))

### Docs

- AGENTS files checked against dc85488 (night schedule, caps, charts, the prettier hook, moved lines); docs/images/src/AGENTS.md for the image generators ([adea51c](https://github.com/cosminfuica/raspberrypi-dashboard/commit/adea51c64bbb00d6d13961cc1b7935a2fa298482))
- PRODUCT.md from the impeccable init interview (any Pi 5 owner, four visits, API.md rewrite pending) ([12899bf](https://github.com/cosminfuica/raspberrypi-dashboard/commit/12899bf5ab5dfb265b5adf4233b88840fd22868e))
- Update AGENTS.md files to reflect changes in documentation structure and content; clarify asset logs and contract helpers for tests ([7f61dbc](https://github.com/cosminfuica/raspberrypi-dashboard/commit/7f61dbcad7107ab2d8a8708abfc4fd4e4c34e64b))
- Update AGENTS.md to clarify release process; ci: enhance changelog.yml with release job for GitHub Releases ([069c611](https://github.com/cosminfuica/raspberrypi-dashboard/commit/069c611b50f7703fc14bfb175bab350e752e2369))

### Maintenance

- all: format every non-ignored file with prettier (frontend/.prettierrc); docs: agent skill docs, pyrightconfig.json, drop NOTES.md ([48395af](https://github.com/cosminfuica/raspberrypi-dashboard/commit/48395af667fe68632bc708bf4692b3fb8955b725))
- refactor: remove obsolete design files and update .gitignore ([c999bc7](https://github.com/cosminfuica/raspberrypi-dashboard/commit/c999bc70a3ee16f40c97df3e24782f110209d0f8))
- ci: changelog.yml regenerates CHANGELOG.md with git-cliff on every push to main and v* tag; docs: AGENTS.md release flow ([cd41ddf](https://github.com/cosminfuica/raspberrypi-dashboard/commit/cd41ddfabdb184590c7f0034cdcc1cabab64a3d3))

### Other

- Redesign README with launch page layout and new asset generators (#16) ([aae661f](https://github.com/cosminfuica/raspberrypi-dashboard/commit/aae661f23e7d737fdcc57bfb71e41375154460d5))
- Update demo video link in README ([4edaa70](https://github.com/cosminfuica/raspberrypi-dashboard/commit/4edaa705e34fbc6068d14d7cdc939c5ff40d729c))
- Update .gitignore to include .agents and skills-lock.json ([0610e7c](https://github.com/cosminfuica/raspberrypi-dashboard/commit/0610e7c9de1646f9e406223cfb5cdac50672c1ce))

## [0.4.0] - 2026-10-04

### Backend

- Cap json bodies at 64 KB (413) and /api/ws at 32 clients (1013), match Origin to Host only; install.sh: keep --no-docker ([d41308a](https://github.com/cosminfuica/raspberrypi-dashboard/commit/d41308ae22214dc2aac6f355db595473892174dd))
- Night fan schedule (PUT /api/fan/night), fan.profile is the profile applied now, utc_offset_s in info; docs: API contract (#11) ([3382cd4](https://github.com/cosminfuica/raspberrypi-dashboard/commit/3382cd4467f8070e32f4c8735e3aa96af62977d2))

### Frontend

- Favicon-off.svg for the offline verdict; docs: mark build and assets manifest (#6) ([ec8589e](https://github.com/cosminfuica/raspberrypi-dashboard/commit/ec8589e287f3e63d6c52aa48e4ae34590f7373d6))
- Callouts reflow at 320 px and with large fonts; herocheck checks it without phone emulation (#9) ([00ed1be](https://github.com/cosminfuica/raspberrypi-dashboard/commit/00ed1be5a30b00f2e551be29a9c13016d72afc0a))
- The fan card follows the running profile and the badge follows a pick at once; phonecheck.mjs (#12) ([2c8a311](https://github.com/cosminfuica/raspberrypi-dashboard/commit/2c8a31157f746b9c163a51b0955ca70cfa882bc1))
- Night schedule in the demo mock, and an &outage flag for a hung Pi (#11, #6) ([39fdf43](https://github.com/cosminfuica/raspberrypi-dashboard/commit/39fdf43909d11bd62f66cf198b1d23928fb76b95))
- Curve tabs read as a preview with Use under the tabs; a swipe on the chart scrolls the page, a point drag still edits (#7, #8) ([78abe28](https://github.com/cosminfuica/raspberrypi-dashboard/commit/78abe28645ac7b7da4a6aec000ebd2cc79440008))
- Quiet at night in the fan card: a switch, the Pi-clock times, what runs until when, and pause or resume for tonight (#11) ([cb8fe90](https://github.com/cosminfuica/raspberrypi-dashboard/commit/cb8fe90b2c4a22785d9a88ec9c1ae06aa9002ded))
- The verdict says No contact after 20 s without data, with the last state, Retry and the grey favicon; a next step for every reason; herocheck covers both (#6, #10) ([34c92d7](https://github.com/cosminfuica/raspberrypi-dashboard/commit/34c92d71068914b49b656b711ff52bbed801367c))
- Words for touch: 2D board, Power draw, System pinned on phones, 44 px labelled service actions, show token and where to find it (#12) ([11fbdfa](https://github.com/cosminfuica/raspberrypi-dashboard/commit/11fbdfa36197b67fa9be9a2166cd6c9b66d28b43))
- Herocheck checks the offline flip by data age, not time since load (F3-1) ([7f557b2](https://github.com/cosminfuica/raspberrypi-dashboard/commit/7f557b2f704111ebdc38ebd78645847af04859b6))
- Drop a dead curve-actions selector; backend: test applied under the night schedule (F2-1) ([15b8820](https://github.com/cosminfuica/raspberrypi-dashboard/commit/15b8820ce76d598eb61560b8d1c932da2c7365d6))
- The Custom points table fits at 412 px with a 32 px font; herocheck reflow checks the Custom tab (IS-4) ([608415c](https://github.com/cosminfuica/raspberrypi-dashboard/commit/608415ca383caceb52a2d493b36b0f7076b12559))

### Docs

- The design improvement plan (t_5d298674) and its review screenshots, with the c645 and t504 before/after shots ([a3231b8](https://github.com/cosminfuica/raspberrypi-dashboard/commit/a3231b8f4c68fd37717dcdf7269e1c5ebf4ce964))
- NOTES: 0.3.0, the board carries the verdict; deploy of 2026-09-30 ([e65bbd3](https://github.com/cosminfuica/raspberrypi-dashboard/commit/e65bbd3ab257f66ce90149b268cc421b5b5f24a8))
- AGENTS.md for coding agents: the root, backend/ and frontend/ ([c40eb27](https://github.com/cosminfuica/raspberrypi-dashboard/commit/c40eb27e1c5073681a8ecf2a8745bbf56c760266))
- AGENTS.md for coding agents (#5) ([081fb48](https://github.com/cosminfuica/raspberrypi-dashboard/commit/081fb481bb7dd336fb3d19f0225943be6819e98b))
- Angry-user persona review of the live dashboard (issues #6-#12) ([93d1a5b](https://github.com/cosminfuica/raspberrypi-dashboard/commit/93d1a5bde1a19a8698dae4ee6cc29b67249e0107))
- DESIGN.md, PRODUCT.md, README and AGENTS files describe the offline verdict, next steps, the curve preview, Quiet at night and the touch words (#6-#12) ([546b2a3](https://github.com/cosminfuica/raspberrypi-dashboard/commit/546b2a3816d617f1fb6c79fe4c07d81ae8476c38))
- NOTES: 0.4.0, the persona-review fixes, how to deploy, follow-ups; design review after-evidence; version 0.4.0 ([686e08d](https://github.com/cosminfuica/raspberrypi-dashboard/commit/686e08dd53888e0386db38c86811ba536eaf91ae))
- AGENTS files point at the lines the persona-review fixes moved; NOTES follow-ups from the reviews (F1-1) ([86dbabe](https://github.com/cosminfuica/raspberrypi-dashboard/commit/86dbabe8b6ed76cfc9201a5ab41c2e8d6a716f5f))
- README version badge 0.4.0; AGENTS.md counts it as a version place (IS-9) ([d2e98f0](https://github.com/cosminfuica/raspberrypi-dashboard/commit/d2e98f0f6493c2d766a3a26987596a4fc5908f96))

### Maintenance

- gitignore: local review evidence and task worktrees ([94b623b](https://github.com/cosminfuica/raspberrypi-dashboard/commit/94b623bd4b0f2707525f2797a488a22e62cb1499))
- ci: test backend and frontend; Renovate automerges non-major updates once CI is green ([10562e9](https://github.com/cosminfuica/raspberrypi-dashboard/commit/10562e92bf05d2418b057e337866e493b57b5aca))
- chore(renovate): keep CI on the oldest supported Python ([156ceb8](https://github.com/cosminfuica/raspberrypi-dashboard/commit/156ceb848d2a17f1e21ea77b22416a8510c38530))
- chore(init-deep): snapshot of the AGENTS.md run (.omo/init-deep.json) ([8956b4d](https://github.com/cosminfuica/raspberrypi-dashboard/commit/8956b4df8ddbc20c212cecb262eee805938638fb))
- chore: update .gitignore to include strix_runs and .omo directories ([1c71964](https://github.com/cosminfuica/raspberrypi-dashboard/commit/1c71964c27d12943f809ff106db676e4ee0d8e7e))

### Other

- Add renovate.json ([0be6c17](https://github.com/cosminfuica/raspberrypi-dashboard/commit/0be6c176d9d11db79da02e051422d7a4aa0a742b))
- Claude/exciting wozniak 28c2s7 (#4) ([2ea864f](https://github.com/cosminfuica/raspberrypi-dashboard/commit/2ea864f08e7ebdf8ef40c5c2d30ab38ccfbc6283))

## [0.3.0] - 2026-09-30

### Backend

- Gzip HTTP responses, cache hashed /assets/ for good (plan H4) ([c385ddd](https://github.com/cosminfuica/raspberrypi-dashboard/commit/c385dddc57d6822dcde350906a357b6c3c57fccb))

### Frontend

- Design plan H1-H3, M1-M8, L1-L4: verdict first under 1101 px, still first paint, audits clear, forced colors, phone padlock pad, healthy rows, tab verdict, sliced 3D build, assembly drawing ([91a72f8](https://github.com/cosminfuica/raspberrypi-dashboard/commit/91a72f80b7e93f649568a8801a217e925ccdc2c1))
- Brand mark A1 in the page: header mark (24 px), favicons with the LED variants, PWA and touch icons; build.py installs to frontend/public and checks the header copy ([32f3a45](https://github.com/cosminfuica/raspberrypi-dashboard/commit/32f3a4565ff383d9ada97c2b55ab8d70f6677253))
- Design QA fixes: ultra-wide header and strip follow the column, Thermals mark labels stay inside, no native number spinners, GiB keeps its case, System pads share one column, no-break % ticks; docs: design QA report (t_4ce6f0a7) ([451554e](https://github.com/cosminfuica/raspberrypi-dashboard/commit/451554e4e0b25994dd6ff60e8b57e49d99d8127e))
- The board carries the verdict; verdict-first focus order ([8042baa](https://github.com/cosminfuica/raspberrypi-dashboard/commit/8042baa8c337f81e73de030669050200d0c1f6da))

### Docs

- NOTES: 0.2.0 is live on the Pi; what was checked there, and what wasn't ([cd0cee6](https://github.com/cosminfuica/raspberrypi-dashboard/commit/cd0cee63a4b529a2c593a31f2b5e0cd207bdfca7))
- Brand mark and social preview poster (assets A1, A2) ([02daff5](https://github.com/cosminfuica/raspberrypi-dashboard/commit/02daff50b3bd321d6671b62ff0d6ec1d7fe598de))
- DESIGN.md: Verdict role, responsive hero, field outline 0.40, forced colors, touch targets, no callout blur (plan L5) ([b07cee1](https://github.com/cosminfuica/raspberrypi-dashboard/commit/b07cee1836d99091207af00af5111ee2fdfae750))
- README plan R1-R5, R7: new mark, refreshed captures, inline tour, how it works, poster footer ([30cf4e8](https://github.com/cosminfuica/raspberrypi-dashboard/commit/30cf4e8b83c036723281be0161dcf649ce21ff74))
- DESIGN.md board verdict and hero order, QA report 4.2 and L1 fixed, README feature line, design review; version 0.3.0 (t_bc550f99) ([a35b532](https://github.com/cosminfuica/raspberrypi-dashboard/commit/a35b5326c0084c6e4e30b4d2745f5fb63dc5f39b))

## [0.2.0] - 2026-09-29

### Backend

- Secured reboot, system update and service restart API ([778a3e4](https://github.com/cosminfuica/raspberrypi-dashboard/commit/778a3e48e0259d52afd9998beed25f18343de7bc))
- Web console over WebSocket + PTY (/api/console/ws) ([6fb87f2](https://github.com/cosminfuica/raspberrypi-dashboard/commit/6fb87f2c21a1a32ee1a4b474b2398a0bd176403f))
- Shutdown (systemctl poweroff) and read-only service logs (journalctl) ([8de5778](https://github.com/cosminfuica/raspberrypi-dashboard/commit/8de577832e5c75e6d85cacc098a9cbe1d4be0c12))

### Frontend

- Sign-in, System card (update, reboot), service restart, web console ([2199889](https://github.com/cosminfuica/raspberrypi-dashboard/commit/21998890d3b642a68f90c87bd21b603b34f20273))
- Scripts/actionscheck.mjs, the browser check for sign-in, update, reboot, restart and the console ([682fcc1](https://github.com/cosminfuica/raspberrypi-dashboard/commit/682fcc1abdf3ced75dc1b186233fa9504ceb5f8a))
- Shut down, a logs dialog per service, installable as an app ([65b1ccd](https://github.com/cosminfuica/raspberrypi-dashboard/commit/65b1ccdb675d7577c173ad59cc54b68a1ac2882e))

### Install and deploy

- install.sh: tailscale serve follows the port pidash really listens on ([e3626f4](https://github.com/cosminfuica/raspberrypi-dashboard/commit/e3626f412b2a948e95586553e2d2f654a14c698b))

### Docs

- DESIGN.md: the monospace exception (console, apt log) ([f822bf3](https://github.com/cosminfuica/raspberrypi-dashboard/commit/f822bf3aa90f0b42f93174ffd786ee413294e50a))
- FEATURES.md (shutdown, service logs, home-screen app), and README/NOTES/DESIGN/PRODUCT to match ([7a8352b](https://github.com/cosminfuica/raspberrypi-dashboard/commit/7a8352be75276822b7079a838a2fd4a28e09d0f9))
- Rewrite README for Pi owners, with real screenshots ([95e1e8f](https://github.com/cosminfuica/raspberrypi-dashboard/commit/95e1e8f25209f20bad11fef758685e34b0c57e99))
- README gallery lines up, screenshots framed for GitHub's dark theme ([d9f32ec](https://github.com/cosminfuica/raspberrypi-dashboard/commit/d9f32ec2f296448589a20dc0f00a24cad46361e3))
- README: the Pi-side packages for a build elsewhere; tunnel user name ([8631ce4](https://github.com/cosminfuica/raspberrypi-dashboard/commit/8631ce4392e42ae170d13e871626b240cdc68032))
- README: the console tests need top (procps) ([2f4b766](https://github.com/cosminfuica/raspberrypi-dashboard/commit/2f4b766619394bfe87f616df05999c7adeed84fd))
- NOTES: the Quick start builds on the Pi now; the desktop build stays as an option ([ec08d0c](https://github.com/cosminfuica/raspberrypi-dashboard/commit/ec08d0c2fc5067e4fa84feb166000f3411c766fe))

## [0.1.0] - 2026-09-27

### Backend

- Metrics API, WebSocket stream and fan profile control ([4d4940c](https://github.com/cosminfuica/raspberrypi-dashboard/commit/4d4940c57d3939cff0ffa6c88e2632af7649c97c))

### Frontend

- Live dashboard UI, 3D board, fan curve editor ([8401388](https://github.com/cosminfuica/raspberrypi-dashboard/commit/8401388820cf58fead256c963274e68601807f93))
- Visual QA and polish pass (60 fps, edge cases, real-Pi check) ([340bf4d](https://github.com/cosminfuica/raspberrypi-dashboard/commit/340bf4d21d4aa94b91fd32ecea74dda81f8f347d))
- Nav highlight follows the clicked section when cards share a row ([e8d240c](https://github.com/cosminfuica/raspberrypi-dashboard/commit/e8d240c3c74ec7aca3cb874334eb6bc833b6adca))

### Install and deploy

- deploy: install.sh / uninstall.sh, tailscale serve, full README ([8c7ff2a](https://github.com/cosminfuica/raspberrypi-dashboard/commit/8c7ff2ab44766ab776ae99351cea3f30ffaccd2c))

### Docs

- Precise step_wise hand-back notes, error codes, timestamp precision ([3c236ba](https://github.com/cosminfuica/raspberrypi-dashboard/commit/3c236bab440a97b61e36c5f106957363ce2f3985))
- Note the example homeassistant process matches the example container ([aa472b9](https://github.com/cosminfuica/raspberrypi-dashboard/commit/aa472b981bc0afb78aaa6334e8bcb586423a06b5))
- NOTES: how to preview the dashboard on the desktop ([2a3dc6e](https://github.com/cosminfuica/raspberrypi-dashboard/commit/2a3dc6e9f43673714484ae5ecc3bd50229c4443b))

### Other

- Scaffold: FastAPI + Vite, Pi recon, API contract ([5ca044d](https://github.com/cosminfuica/raspberrypi-dashboard/commit/5ca044d70526e782e6c1c266e5aa32232abc0044))
